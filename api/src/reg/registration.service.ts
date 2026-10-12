import { Prisma } from "@prisma/client";

import { dbClient } from "../core/db.js";
import { generateAccountProfile } from "./generator.js";
import { fetchInboxMessages } from "./inbox.js";
import { getRegSettings } from "./reg-settings.js";
import {
  acquireTrunkLock,
  isTrunkLocked,
  releaseTrunkLock,
  replaceTrunkLock,
} from "./trunk-lock.js";

// Логика перенесена из tg-regs (services/internal-registration.ts). Новое:
// исход попытки сообщает воркер (failRegistration) — и номер с почтой
// уходят в бан, на паузу или обратно в пул по причине, а не «всё в брак»

export type RegistrationReleaseReason = "email_rejected" | "expired" | "canceled" | "other";

// Клиент внутри $transaction (у dbClient есть расширение, поэтому не Prisma.TransactionClient)
type Tx = Parameters<Parameters<typeof dbClient.$transaction>[0]>[0];

// Номер после неверной почты или неверного кода отдыхает 10 минут
const PHONE_PAUSE_MS = 10 * 60 * 1000;
// Флуд Telegram на номере — номер отдыхает полдня
const FLOOD_PAUSE_MS = 12 * 60 * 60 * 1000;
// Не пришёл код на почту — почта отдыхает час, на третий раз блокируется
const EMAIL_PAUSE_MS = 60 * 60 * 1000;
const EMAIL_MAX_FAILS = 3;
// В ящик за кодом ходим не чаще раза в 4 секунды на попытку
const EMAIL_CHECK_MIN_GAP_MS = 4_000;
// Сколько ждём звонка после того, как пришёл код на почту
const EMAIL_CODE_CALL_WAIT_MS = 4 * 60 * 1000;
// Аккаунт «в процессе» дольше получаса — скрипт упал, освобождаем ресурсы
const STALE_ACCOUNT_MS = 30 * 60 * 1000;
// Звонок с кодом длится 15–20 секунд; «в процессе» дольше минуты — статус потерян
const STREAM_MAX_AGE_MS = 60_000;

const TEXT_NORMALIZATION_ENABLED = process.env.TEXT_NORMALIZATION_ENABLED === "true";

const DIGIT_WORDS: Record<string, string> = {
  ноль: "0",
  нол: "0",
  один: "1",
  одна: "1",
  два: "2",
  две: "2",
  три: "3",
  четыре: "4",
  пять: "5",
  шесть: "6",
  семь: "7",
  восемь: "8",
  девять: "9",
};

// Робот Telegram диктует код словами: «один два три…»
const extractCodeFromTranscription = (text: string) => {
  const digits = TEXT_NORMALIZATION_ENABLED
    ? text.replace(/\D/g, "")
    : text
        .toLowerCase()
        .split(/\s+/)
        .map((word) => DIGIT_WORDS[word] ?? "")
        .join("");

  return digits.slice(0, 5);
};

export class NoRegistrationResourcesError extends Error {
  constructor() {
    super("no_resources_available");
  }
}

export class AllRegistrationLinesBusyError extends Error {
  constructor() {
    super("all_lines_busy");
  }
}

export class NoFreeRegistrationNumbersError extends Error {
  constructor() {
    super("no_free_numbers");
  }
}

export class RegistrationNumberNotFoundError extends Error {
  constructor() {
    super("number_not_found");
  }
}

const audit = (
  tx: Tx,
  data: {
    accountId?: string | null;
    entityType?: string;
    entityId: string;
    action: string;
    payload?: Prisma.InputJsonValue;
  },
) =>
  tx.regAuditLog.create({
    data: {
      accountId: data.accountId ?? null,
      entityType: data.entityType ?? "account",
      entityId: data.entityId,
      action: data.action,
      payload: data.payload,
    },
  });

const toPublicAccount = (
  account: Prisma.RegAccountGetPayload<{
    include: { email: true; trunk: true; trunkPhone: true };
  }>,
) => ({
  accountId: account.id,
  agentId: account.externalAgentId,
  externalAgentId: account.externalAgentId,
  phoneId: account.trunkPhoneId,
  phoneNumber: account.phone ?? account.trunkPhone?.phone ?? "",
  trunkId: account.trunkId,
  trunkName: account.trunk?.name ?? null,
  trunkPhoneId: account.trunkPhoneId,
  emailId: account.emailId,
  email: account.email.email,
  firstName: account.firstName,
  lastName: account.lastName,
  username: account.username,
  birthDate: account.birthDate.toISOString(),
  twoFaPassword: account.twoFaPassword,
});

const restoreExpiredPausedPhones = () =>
  Promise.all([
    dbClient.regTrunkPhone.updateMany({
      where: { status: "paused", pausedUntil: { lte: new Date() } },
      data: { status: "free", pausedUntil: null },
    }),
    dbClient.regEmail.updateMany({
      where: { status: "paused", pausedUntil: { lte: new Date() } },
      data: { status: "free", pausedUntil: null },
    }),
  ]);

export const getRegistrationAvailability = async () => {
  await restoreExpiredPausedPhones();

  const [trunks, emailsCount] = await Promise.all([
    dbClient.regTrunk.findMany({
      where: { enabled: true, phones: { some: { status: "free" } } },
      select: { id: true },
    }),
    dbClient.regEmail.count({ where: { status: "free" } }),
  ]);

  let hasUnlockedTrunk = false;

  for (const trunk of trunks) {
    if (!(await isTrunkLocked(trunk.id))) {
      hasUnlockedTrunk = true;
      break;
    }
  }

  return { available: hasUnlockedTrunk && emailsCount > 0 };
};

export const assignRegistrationResources = async (
  externalAgentId: string,
  phoneNumber?: string,
  farmPhoneId?: string,
) => {
  await restoreExpiredPausedPhones();
  const { names } = await getRegSettings();

  const normalizedPhone = phoneNumber?.trim() || undefined;
  // Транки по кругу: берём тот, что дольше всех не выдавал номер
  const trunks = await dbClient.regTrunk.findMany({
    where: {
      enabled: true,
      phones: { some: { status: "free", ...(normalizedPhone ? { phone: normalizedPhone } : {}) } },
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
  });

  if (trunks.length === 0) throw new NoFreeRegistrationNumbersError();

  let sawBusyLine = false;

  for (const trunk of trunks) {
    if (await isTrunkLocked(trunk.id)) {
      sawBusyLine = true;
      continue;
    }

    if (!(await acquireTrunkLock(trunk.id, "pending"))) {
      sawBusyLine = true;
      continue;
    }

    try {
      const accountId = await dbClient.$transaction(async (tx) => {
        const [trunkPhone, email] = await Promise.all([
          tx.regTrunkPhone.findFirst({
            where: { trunkId: trunk.id, phone: normalizedPhone, status: "free" },
            orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
          }),
          tx.regEmail.findFirst({
            where: { status: "free" },
            orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
          }),
        ]);

        if (!trunkPhone) throw new NoFreeRegistrationNumbersError();
        if (!email) throw new NoRegistrationResourcesError();

        const [phoneReservation, emailReservation] = await Promise.all([
          tx.regTrunkPhone.updateMany({
            where: { id: trunkPhone.id, status: "free" },
            data: { status: "reserved", pausedUntil: null },
          }),
          tx.regEmail.updateMany({
            where: { id: email.id, status: "free" },
            data: { status: "reserved" },
          }),
        ]);

        if (phoneReservation.count !== 1) throw new NoFreeRegistrationNumbersError();
        if (emailReservation.count !== 1) throw new NoRegistrationResourcesError();

        // username уникален: на редком совпадении генерируем заново
        let profile = generateAccountProfile(names);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const taken = await tx.regAccount.count({ where: { username: profile.username } });
          if (!taken) break;
          profile = generateAccountProfile(names);
        }

        const account = await tx.regAccount.create({
          data: {
            emailId: email.id,
            trunkId: trunk.id,
            trunkPhoneId: trunkPhone.id,
            phone: trunkPhone.phone,
            status: "in_progress",
            firstName: profile.firstName,
            lastName: profile.lastName,
            username: profile.username,
            birthDate: profile.birthDate,
            twoFaPassword: profile.twoFaPassword,
            externalAgentId,
            farmPhoneId: farmPhoneId ?? null,
          },
        });

        // Сдвигаем транк в конец очереди, иначе выигрывал бы всегда один и тот же
        await tx.regTrunk.update({
          where: { id: trunk.id },
          data: { updatedAt: new Date() },
        });

        await audit(tx, {
          accountId: account.id,
          entityId: account.id,
          action: "assigned",
          payload: {
            externalAgentId,
            trunkId: trunk.id,
            trunkPhoneId: trunkPhone.id,
            emailId: email.id,
          },
        });

        return account.id;
      });

      await replaceTrunkLock(trunk.id, accountId);

      const account = await dbClient.regAccount.findUniqueOrThrow({
        where: { id: accountId },
        include: { email: true, trunk: true, trunkPhone: true },
      });

      return toPublicAccount(account);
    } catch (error) {
      await releaseTrunkLock(trunk.id);

      if (error instanceof NoFreeRegistrationNumbersError) continue;

      throw error;
    }
  }

  if (sawBusyLine) throw new AllRegistrationLinesBusyError();

  throw new NoFreeRegistrationNumbersError();
};

export const releaseRegistration = async (
  accountId: string,
  reason: RegistrationReleaseReason,
) => {
  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUniqueOrThrow({ where: { id: accountId } });

    const emailStatus = reason === "email_rejected" ? "blocked" : "free";
    const phoneStatus = reason === "email_rejected" ? "cooldown" : "free";

    await tx.regAccount.update({
      where: { id: accountId },
      data: {
        status: "failed",
        failureReason: reason === "other" ? "other_error" : null,
      },
    });

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: emailStatus },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: phoneStatus, pausedUntil: null },
      });
    }

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "released",
      payload: { reason, emailStatus, phoneStatus },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

export const markNoCall = async (accountId: string) => {
  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUniqueOrThrow({ where: { id: accountId } });

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "failed", failureReason: "no_call" },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: "blocked", pausedUntil: null },
      });
    }

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "used_no_call" },
    });

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "no_call",
      payload: { phoneStatus: "blocked", emailStatus: "used_no_call" },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

/**
 * Навсегда убрать номер из ротации (бан, уже зарегистрирован, 2FA).
 * Если на номере идёт рега — она срывается, а почта возвращается в пул
 */
export const markRegistrationNumberInvalid = async (params: {
  trunkPhoneId?: string;
  phoneNumber?: string;
}) => {
  const releasedTrunkId = await dbClient.$transaction(async (tx) => {
    const trunkPhone = await tx.regTrunkPhone.findFirst({
      where: params.trunkPhoneId
        ? { id: params.trunkPhoneId }
        : { phone: params.phoneNumber?.trim() },
    });

    if (!trunkPhone) throw new RegistrationNumberNotFoundError();

    await tx.regTrunkPhone.update({
      where: { id: trunkPhone.id },
      data: { status: "blocked", pausedUntil: null },
    });

    const account = await tx.regAccount.findFirst({
      where: { trunkPhoneId: trunkPhone.id, status: "in_progress" },
      orderBy: { createdAt: "desc" },
    });

    if (!account) {
      await audit(tx, {
        entityType: "trunkPhone",
        entityId: trunkPhone.id,
        action: "number_invalidated",
        payload: { phone: trunkPhone.phone, hadActiveAccount: false },
      });

      return null;
    }

    await tx.regAccount.update({
      where: { id: account.id },
      data: { status: "failed", failureReason: "other_error" },
    });

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "free" },
    });

    await audit(tx, {
      accountId: account.id,
      entityId: account.id,
      action: "number_invalidated",
      payload: { phone: trunkPhone.phone, hadActiveAccount: true, emailStatus: "free" },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(releasedTrunkId);
};

export const markRegistrationNumbersInvalid = async (phoneNumbers: string[]) => {
  const invalidated: string[] = [];
  const notFound: string[] = [];

  for (const phoneNumber of phoneNumbers) {
    try {
      await markRegistrationNumberInvalid({ phoneNumber });
      invalidated.push(phoneNumber);
    } catch (error) {
      if (error instanceof RegistrationNumberNotFoundError) {
        notFound.push(phoneNumber);
        continue;
      }

      throw error;
    }
  }

  return { invalidated, notFound };
};

export const markWrongEmail = async (accountId: string) => {
  const pauseUntil = new Date(Date.now() + PHONE_PAUSE_MS);

  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUniqueOrThrow({ where: { id: accountId } });

    // Уже завершён (например, неверным кодом) — не перетираем исходную причину
    if (account.status !== "in_progress") return null;

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "failed", failureReason: "wrong_email" },
    });

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "blocked" },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: "paused", pausedUntil: pauseUntil },
      });
    }

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "wrong_email",
      payload: { phonePausedUntil: pauseUntil.toISOString(), emailStatus: "blocked" },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

export const completeRegistration = async (
  accountId: string,
  accountCreatedAt?: Date | null,
) => {
  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUniqueOrThrow({ where: { id: accountId } });
    const completedAt = accountCreatedAt ?? new Date();

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "registered", failureReason: null, accountCreatedAt: completedAt },
    });

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "used" },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: "used", pausedUntil: null },
      });
    }

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "completed",
      payload: { accountCreatedAt: completedAt.toISOString() },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

const extractTelegramCode = (value: string | null | undefined) => {
  if (!value) return null;

  const match =
    value.match(/(?:ваш\s+код|код|code)\s*[-:–—]?\s*(\d{4,8})/i) ??
    value.match(/\b(\d{4,8})\b/);

  return match?.[1] ?? null;
};

const isTelegramEmail = (message: { fromName: string | null; fromAddress: string | null }) =>
  (message.fromName ?? "").toLowerCase().includes("telegram") ||
  (message.fromAddress ?? "").toLowerCase() === "noreply@telegram.org";

// Код с почты пришёл, а звонка за 4 минуты нет — номер и почта «без звонка»
const markEmailCodeNoCall = async (accountId: string, receivedAt: Date) => {
  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUnique({ where: { id: accountId } });

    if (!account || account.status !== "in_progress") return null;

    const callsCount = await tx.regSipCall.count({
      where: { accountId, status: { not: "rejected" }, createdAt: { gte: receivedAt } },
    });

    if (callsCount > 0) return null;

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "used_no_call" },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: "no_call", pausedUntil: null },
      });
    }

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "failed", failureReason: "no_call" },
    });

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "email_code_no_call",
      payload: { emailCodeReceivedAt: receivedAt.toISOString() },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

// Когда последний раз ходили в ящик по попытке: воркер спрашивает код раз
// в пару секунд, а IMAP-вход на каждый вопрос — лишняя нагрузка на почту
const lastInboxCheck = new Map<string, number>();

export const getRegistrationEmailCode = async (accountId: string) => {
  const account = await dbClient.regAccount.findUnique({ where: { id: accountId } });

  if (!account) return null;

  // Код уже нашли — второй раз в ящик не ходим
  if (account.emailCode && account.emailCodeAt) {
    return { code: account.emailCode, receivedAt: account.emailCodeAt.toISOString() };
  }

  const last = lastInboxCheck.get(accountId) ?? 0;

  if (Date.now() - last < EMAIL_CHECK_MIN_GAP_MS) return null;

  lastInboxCheck.set(accountId, Date.now());

  const since = account.accountCreatedAt ?? account.createdAt;
  const messages = await fetchInboxMessages(account.emailId, 10);

  for (const message of messages.filter(isTelegramEmail)) {
    const receivedAt = new Date(message.receivedAt);

    if (receivedAt <= since) continue;

    const code =
      extractTelegramCode(message.subject) ??
      extractTelegramCode(message.textBody) ??
      extractTelegramCode(message.htmlBody);

    if (code) {
      lastInboxCheck.delete(accountId);
      // Время кода пишем своё, а не из письма: по нему уборщик ждёт звонка
      await dbClient.regAccount.update({
        where: { id: accountId },
        data: { emailCode: code, emailCodeAt: new Date() },
      });

      return { code, receivedAt: message.receivedAt };
    }
  }

  return null;
};

const markInvalidSipCode = async (accountId: string) => {
  const pauseUntil = new Date(Date.now() + PHONE_PAUSE_MS);

  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUnique({ where: { id: accountId } });

    if (!account || account.status !== "in_progress") return null;

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "failed", failureReason: "invalid_sip_code" },
    });

    await tx.regEmail.update({
      where: { id: account.emailId },
      data: { status: "blocked" },
    });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({
        where: { id: account.trunkPhoneId },
        data: { status: "paused", pausedUntil: pauseUntil },
      });
    }

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "invalid_sip_code",
      payload: { phonePausedUntil: pauseUntil.toISOString(), emailStatus: "blocked" },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

export const getRegistrationTranscription = async (accountId: string) => {
  const call = await dbClient.regSipCall.findFirst({
    where: { accountId, status: { not: "rejected" } },
    include: { transcripts: { where: { final: true }, orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  if (!call || call.transcripts.length === 0) return null;

  const transcription = call.transcripts.map((item) => item.text).join(" ").trim();
  const code = extractCodeFromTranscription(transcription);

  if (code.length < 5) {
    // Код часто звучит в последние секунды: пока звонок идёт, это «ещё не готово».
    // Ошибка — только когда звонок закончился (или завис дольше минуты)
    const callFinished = call.status === "ended" || call.status === "failed";
    const callStale =
      Date.now() - (call.startedAt ?? call.createdAt).getTime() > STREAM_MAX_AGE_MS;

    if (!callFinished && !callStale) return null;

    await markInvalidSipCode(accountId);

    return { error: "invalid_code" as const };
  }

  return { code, callReceivedAt: (call.startedAt ?? call.createdAt).toISOString() };
};

export const getRegistrationStatus = async (accountId: string) => {
  const account = await dbClient.regAccount.findUnique({
    where: { id: accountId },
    include: {
      trunkPhone: true,
      email: true,
      sipCalls: { include: { transcripts: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!account) return null;

  const lastCall = account.sipCalls[0] ?? null;

  return {
    accountId: account.id,
    status: account.status,
    phoneStatus: account.trunkPhone?.status ?? null,
    emailStatus: account.email.status,
    hasCall: Boolean(lastCall && lastCall.status !== "rejected"),
    hasTranscription: Boolean(lastCall?.transcripts.length),
  };
};

export const findActiveAccountByTrunk = (trunkId: string) =>
  dbClient.regAccount.findFirst({
    where: { trunkId, status: "in_progress" },
    orderBy: { createdAt: "desc" },
  });

export const findActiveAccountByPhone = (phone: string) =>
  dbClient.regAccount.findFirst({
    where: { phone, status: "in_progress" },
    orderBy: { createdAt: "desc" },
  });

/**
 * Исход неудачной попытки — его знает только сценарий на телефоне:
 *  banned / already_registered / twofa — номер в бан навсегда, почта в пул;
 *  flood — номер на полдня, почта в пул;
 *  no_email_code — почта на час (третий раз — в бан), номер на 10 минут;
 *  no_call — код с почты принят, звонка нет: номер и почта «без звонка»;
 *  stuck — завис экран: номер на 10 минут, почта в пул;
 *  canceled — сценарий остановили: всё обратно в пул
 */
export type RegFailOutcome =
  | "banned"
  | "already_registered"
  | "twofa"
  | "flood"
  | "no_email_code"
  | "no_call"
  | "stuck"
  | "canceled";

type PoolStatus = "free" | "blocked" | "paused";

export const failRegistration = async (accountId: string, outcome: RegFailOutcome) => {
  if (outcome === "no_call") return markNoCall(accountId);

  const now = Date.now();
  const trunkId = await dbClient.$transaction(async (tx) => {
    const account = await tx.regAccount.findUnique({
      where: { id: accountId },
      include: { email: true },
    });

    // Попытку уже закрыл бэкенд (например, нераспознанный код) — не перетираем
    if (!account || account.status !== "in_progress") return account?.trunkId ?? null;

    const reason = outcome === "twofa" ? "already_registered" : outcome;

    let phoneData: { status: PoolStatus; pausedUntil: Date | null } = {
      status: "free",
      pausedUntil: null,
    };
    let emailData: { status: PoolStatus; pausedUntil: Date | null; failCount?: { increment: number } } = {
      status: "free",
      pausedUntil: null,
    };

    if (outcome === "banned" || outcome === "already_registered" || outcome === "twofa") {
      phoneData = { status: "blocked", pausedUntil: null };
    } else if (outcome === "flood") {
      phoneData = { status: "paused", pausedUntil: new Date(now + FLOOD_PAUSE_MS) };
    } else if (outcome === "stuck") {
      phoneData = { status: "paused", pausedUntil: new Date(now + PHONE_PAUSE_MS) };
    } else if (outcome === "no_email_code") {
      phoneData = { status: "paused", pausedUntil: new Date(now + PHONE_PAUSE_MS) };
      emailData =
        account.email.failCount + 1 >= EMAIL_MAX_FAILS
          ? { status: "blocked", pausedUntil: null, failCount: { increment: 1 } }
          : {
              status: "paused",
              pausedUntil: new Date(now + EMAIL_PAUSE_MS),
              failCount: { increment: 1 },
            };
    }

    await tx.regAccount.update({
      where: { id: accountId },
      data: { status: "failed", failureReason: reason },
    });

    await tx.regEmail.update({ where: { id: account.emailId }, data: emailData });

    if (account.trunkPhoneId) {
      await tx.regTrunkPhone.update({ where: { id: account.trunkPhoneId }, data: phoneData });
    }

    await audit(tx, {
      accountId,
      entityId: accountId,
      action: "failed",
      payload: { outcome, phoneStatus: phoneData.status, emailStatus: emailData.status },
    });

    return account.trunkId;
  });

  await releaseTrunkLock(trunkId);
};

/**
 * Страховка от утечки номеров: если скрипт реги упал и не отпустил аккаунт,
 * через полчаса возвращаем номер и почту в пул как «истёкшие»
 */
export const releaseStaleRegistrations = async () => {
  const stale = await dbClient.regAccount.findMany({
    where: { status: "in_progress", createdAt: { lt: new Date(Date.now() - STALE_ACCOUNT_MS) } },
    select: { id: true },
  });

  for (const account of stale) {
    await releaseRegistration(account.id, "expired").catch((error) =>
      console.error("[reg] stale release failed", { accountId: account.id, error }),
    );
  }

  // Код с почты пришёл, а звонка за 4 минуты нет — номер и почта «без звонка».
  // Раньше это был таймер в памяти процесса и терялся при перезапуске
  const waiting = await dbClient.regAccount.findMany({
    where: {
      status: "in_progress",
      emailCodeAt: { lt: new Date(Date.now() - EMAIL_CODE_CALL_WAIT_MS) },
    },
    select: { id: true, emailCodeAt: true },
  });

  for (const account of waiting) {
    await markEmailCodeNoCall(account.id, account.emailCodeAt!).catch((error) =>
      console.error("[reg] no-call check failed", { accountId: account.id, error }),
    );
  }

  // Звонки, у которых потерялся финальный статус
  await dbClient.regSipCall.updateMany({
    where: {
      status: { in: ["waiting", "streaming"] },
      createdAt: { lt: new Date(Date.now() - 10 * STREAM_MAX_AGE_MS) },
    },
    data: { status: "failed", endedAt: new Date() },
  });

  return stale.length;
};
