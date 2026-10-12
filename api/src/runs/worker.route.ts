import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { dbClient } from "../core/db.js";
import { factory } from "../core/factory.js";
import { requireInternalToken } from "../core/internal-token.js";
import { checkPhoneProxy, getFarmSettings, replacePhoneProxy } from "../phones/proxyma.js";
import {
  AllRegistrationLinesBusyError,
  NoFreeRegistrationNumbersError,
  NoRegistrationResourcesError,
  assignRegistrationResources,
  completeRegistration,
  failRegistration,
  getRegistrationEmailCode,
  getRegistrationTranscription,
} from "../reg/registration.service.js";
import { finishRunIfDone } from "./runs.service.js";

// Ручки воркера: он сам забирает запуск из очереди, пишет ход по телефонам,
// берёт комплект для реги и сообщает исход. Входящих соединений у воркера нет

const app = factory.createApp().basePath("/internal/worker");

app.use("/*", requireInternalToken);

const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new HTTPException(400, { message: JSON.stringify(result.error.issues) });
  }

  return result.data;
};

// ─── Настройки для сценария ───────────────────────────────────────────────

app.get("/config", async (ctx) => {
  const [row, farm, lines, freeEmails] = await Promise.all([
    dbClient.settings.findUnique({ where: { id: 1 } }),
    getFarmSettings(),
    dbClient.regTrunk.count({ where: { enabled: true, phones: { some: { status: "free" } } } }),
    dbClient.regEmail.count({ where: { status: "free" } }),
  ]);

  return ctx.json({
    geelarkApiKey: farm.geelarkApiKey,
    geelarkBaseUrl: farm.geelarkBaseUrl,
    channels: row?.regChannels ?? [],
    subscribeCount: row?.regSubscribeCount ?? 0,
    disableMedia: row?.regDisableMedia ?? true,
    disablePowerSaving: row?.regDisablePowerSaving ?? true,
    // Сколько рег может идти одновременно: звонок узнаём по транку
    lines,
    freeEmails,
  });
});

// ─── Запуски ──────────────────────────────────────────────────────────────

const runPayload = async (runId: string) => {
  const run = await dbClient.regRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      phones: {
        include: { phone: { select: { id: true, profileName: true, geelarkId: true } } },
        orderBy: { phone: { profileName: "asc" } },
      },
    },
  });

  return {
    id: run.id,
    status: run.status,
    concurrency: run.concurrency,
    errorsPerPhone: run.errorsPerPhone,
    phones: run.phones
      .filter((item) => item.status === "pending")
      .map((item) => ({
        runPhoneId: item.id,
        phoneId: item.phone.id,
        profileName: item.phone.profileName,
        geelarkId: item.phone.geelarkId,
      })),
  };
};

// Следующий запуск из очереди. Запуски идут по одному: телефонов и линий
// на два параллельных запуска всё равно не хватит
app.post("/runs/claim", async (ctx) => {
  const busy = await dbClient.regRun.count({ where: { status: { in: ["running", "canceling"] } } });

  if (busy) return ctx.json({ run: null });

  const next = await dbClient.regRun.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });

  if (!next) return ctx.json({ run: null });

  const claimed = await dbClient.regRun.updateMany({
    where: { id: next.id, status: "queued" },
    data: { status: "running", startedAt: new Date() },
  });

  if (claimed.count !== 1) return ctx.json({ run: null });

  return ctx.json({ run: await runPayload(next.id) });
});

app.get("/runs/:id", async (ctx) => {
  const run = await dbClient.regRun.findUnique({
    where: { id: ctx.req.param("id") },
    select: { status: true },
  });

  return ctx.json({ status: run?.status ?? "canceled" });
});

app.post("/runs/:id/finish", async (ctx) => {
  await finishRunIfDone(ctx.req.param("id"), true);

  return ctx.json({ ok: true });
});

// Воркер стартовал заново: всё, что числилось «в работе», прервано.
// Телефоны этих запусков могли остаться включёнными — отдаём их, воркер погасит
app.post("/runs/recover", async (ctx) => {
  const runs = await dbClient.regRun.findMany({
    where: { status: { in: ["running", "canceling"] } },
    select: { id: true },
  });
  const runIds = runs.map((run) => run.id);

  const running = await dbClient.regRunPhone.findMany({
    where: { runId: { in: runIds }, status: "running" },
    include: { phone: { select: { geelarkId: true } } },
  });

  await dbClient.regRunPhone.updateMany({
    where: { runId: { in: runIds }, status: { in: ["running", "pending"] } },
    data: { status: "failed", error: "воркер перезапущен", finishedAt: new Date() },
  });
  await dbClient.regRun.updateMany({
    where: { id: { in: runIds } },
    data: { status: "interrupted", finishedAt: new Date() },
  });

  return ctx.json({
    geelarkIds: running.map((item) => item.phone.geelarkId).filter(Boolean),
  });
});

const runPhoneSchema = z.object({
  status: z.enum(["pending", "running", "ok", "failed", "skipped"]).optional(),
  error: z.string().nullable().optional(),
});

app.post("/run-phones/:id", async (ctx) => {
  const input = parse(runPhoneSchema, await ctx.req.json());
  const now = new Date();

  const item = await dbClient.regRunPhone.update({
    where: { id: ctx.req.param("id") },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.error !== undefined ? { error: input.error?.slice(0, 500) ?? null } : {}),
      ...(input.status === "running" ? { startedAt: now } : {}),
      ...(input.status && ["ok", "failed", "skipped"].includes(input.status)
        ? { finishedAt: now }
        : {}),
    },
  });

  if (input.status === "running") {
    await dbClient.farmPhone.update({ where: { id: item.phoneId }, data: { lastLaunchedAt: now } });
  }

  return ctx.json({ ok: true });
});

const stepSchema = z.object({
  name: z.string().min(1),
  status: z.string().min(1),
  detail: z.string().optional().default(""),
});

app.post("/run-phones/:id/step", async (ctx) => {
  const input = parse(stepSchema, await ctx.req.json());
  const step = {
    name: input.name.slice(0, 80),
    status: input.status.slice(0, 20),
    detail: (input.detail ?? "").slice(0, 300),
    at: new Date().toISOString(),
  };

  // Шаги дописываем в конец JSON-массива одним запросом
  await dbClient.$executeRaw`
    UPDATE "RegRunPhone"
    SET steps = steps || ${JSON.stringify([step])}::jsonb,
        "lastStep" = ${`${step.name}:${step.status}`}
    WHERE id = ${ctx.req.param("id")}`;

  return ctx.json({ ok: true });
});

// ─── Телефон ──────────────────────────────────────────────────────────────

app.get("/phones/:id", async (ctx) => {
  const phone = await dbClient.farmPhone.findUnique({
    where: { id: ctx.req.param("id") },
    select: { id: true, geelarkId: true, profileName: true, accountPhone: true },
  });

  if (!phone) throw new HTTPException(404, { message: "Телефон не найден" });

  return ctx.json({ ...phone, hasAccount: Boolean(phone.accountPhone) });
});

const eventSchema = z.object({
  kind: z.string().min(1),
  detail: z.string().optional().nullable(),
  // PNG в base64 без префикса
  screenshot: z.string().optional().nullable(),
});

app.post("/phones/:id/event", async (ctx) => {
  const input = parse(eventSchema, await ctx.req.json());

  await dbClient.farmPhoneEvent.create({
    data: {
      phoneId: ctx.req.param("id"),
      kind: input.kind.slice(0, 80),
      detail: input.detail?.slice(0, 500) ?? null,
      screenshot: input.screenshot ? `data:image/png;base64,${input.screenshot}` : null,
    },
  });

  return ctx.json({ ok: true });
});

// Перед включением: прокси жив? Мёртвый — новая sticky-сессия Proxyma
// и правка записи прокси в GeeLark
app.post("/phones/:id/proxy/ensure", async (ctx) => {
  const phoneId = ctx.req.param("id");
  const phone = await dbClient.farmPhone.findUniqueOrThrow({ where: { id: phoneId } });

  if (!phone.proxyHost) return ctx.json({ ok: true, detail: "прокси не привязан" });

  const checked = await checkPhoneProxy(phoneId);

  if (checked.proxyStatus === "ok") {
    return ctx.json({ ok: true, detail: `жив, ${checked.proxyLatencyMs} мс` });
  }

  try {
    const replaced = await replacePhoneProxy(phoneId);

    return ctx.json({
      ok: replaced.proxyStatus === "ok",
      replaced: true,
      detail: `мёртвый (${checked.proxyError ?? "нет ответа"}) → замена ${replaced.proxyHost}:${replaced.proxyPort}: ${
        replaced.proxyStatus === "ok" ? "жив" : "тоже мёртвый"
      }`,
    });
  } catch (error) {
    return ctx.json({
      ok: false,
      detail: `мёртвый, замена не удалась: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

const accountSchema = z.object({
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});

app.post("/phones/:id/account", async (ctx) => {
  const input = parse(accountSchema, await ctx.req.json());

  await dbClient.farmPhone.update({
    where: { id: ctx.req.param("id") },
    data: {
      ...(input.username !== undefined ? { accountUsername: input.username } : {}),
      ...(input.firstName !== undefined ? { accountFirstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { accountLastName: input.lastName } : {}),
    },
  });

  return ctx.json({ ok: true });
});

// ─── Регистрация ──────────────────────────────────────────────────────────

app.post("/reg/assign", async (ctx) => {
  const input = parse(z.object({ phoneId: z.string().min(1) }), await ctx.req.json());
  const phone = await dbClient.farmPhone.findUniqueOrThrow({
    where: { id: input.phoneId },
    select: { id: true, profileName: true },
  });

  try {
    const account = await assignRegistrationResources(phone.profileName, undefined, phone.id);
    const started = await dbClient.regAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: { createdAt: true },
    });

    // Форма сессии — та же, что ждал сценарий от сервиса tg-regs
    return ctx.json(
      {
        account_id: account.accountId,
        phone_number: account.phoneNumber,
        email: account.email,
        first_name: account.firstName,
        last_name: account.lastName,
        username: account.username,
        trunk_name: account.trunkName,
        started_at: started.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    if (
      error instanceof NoRegistrationResourcesError ||
      error instanceof AllRegistrationLinesBusyError ||
      error instanceof NoFreeRegistrationNumbersError
    ) {
      return ctx.json({ error: error.message }, 409);
    }

    throw error;
  }
});

const accountState = async (accountId: string) =>
  dbClient.regAccount.findUnique({
    where: { id: accountId },
    select: { status: true, failureReason: true },
  });

app.get("/reg/:id/email-code", async (ctx) => {
  const accountId = ctx.req.param("id");
  const state = await accountState(accountId);

  if (!state || state.status !== "in_progress") {
    return ctx.json({ failed: true, reason: state?.failureReason ?? "not_found" });
  }

  const result = await getRegistrationEmailCode(accountId).catch((error) => ({
    imapError: error instanceof Error ? error.message : String(error),
  }));

  if (result && "code" in result) return ctx.json({ code: result.code });
  if (result && "imapError" in result) return ctx.json({ imapError: result.imapError });

  return ctx.json({});
});

app.get("/reg/:id/call-code", async (ctx) => {
  const accountId = ctx.req.param("id");
  const state = await accountState(accountId);

  if (!state || state.status !== "in_progress") {
    return ctx.json({ failed: true, reason: state?.failureReason ?? "not_found" });
  }

  const result = await getRegistrationTranscription(accountId);

  if (result && "code" in result) return ctx.json({ code: result.code });
  if (result && "error" in result) return ctx.json({ failed: true, reason: "invalid_sip_code" });

  const call = await dbClient.regSipCall.findFirst({
    where: { accountId, status: { not: "rejected" } },
    select: { status: true },
  });

  return ctx.json({ hasCall: Boolean(call), callStatus: call?.status ?? null });
});

const failSchema = z.object({
  outcome: z.enum([
    "banned",
    "already_registered",
    "twofa",
    "flood",
    "no_email_code",
    "no_call",
    "stuck",
    "canceled",
  ]),
});

app.post("/reg/:id/fail", async (ctx) => {
  const input = parse(failSchema, await ctx.req.json());
  await failRegistration(ctx.req.param("id"), input.outcome);

  return ctx.json({ ok: true });
});

// Аккаунт создан: попытка закрывается, номер и почта — «использованы»,
// аккаунт записывается в телефон. Юзернейм — отдельно, когда встанет
app.post("/reg/:id/complete", async (ctx) => {
  const accountId = ctx.req.param("id");
  const input = parse(z.object({ phoneId: z.string().min(1) }), await ctx.req.json());
  const account = await dbClient.regAccount.findUniqueOrThrow({ where: { id: accountId } });

  if (account.status === "in_progress") await completeRegistration(accountId);

  const number = account.phone ?? null;
  const taken = number
    ? await dbClient.farmPhone.findFirst({
        where: { accountPhone: number, id: { not: input.phoneId } },
        select: { profileName: true },
      })
    : null;

  if (taken) {
    throw new HTTPException(409, { message: `Номер уже числится за телефоном ${taken.profileName}` });
  }

  const now = new Date();

  await dbClient.farmPhone.update({
    where: { id: input.phoneId },
    data: {
      accountPhone: number,
      accountFirstName: account.firstName,
      accountLastName: account.lastName,
      accountUsername: null,
      accountStatus: "working",
      statusReason: null,
      registeredAt: now,
    },
  });

  await dbClient.farmPhoneEvent.create({
    data: { phoneId: input.phoneId, kind: "registered", detail: `${number} ${account.firstName} ${account.lastName}` },
  });

  return ctx.json({ ok: true });
});

export default app;
