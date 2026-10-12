import { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

import { requireAuth } from "../core/auth.js";
import { dbClient } from "../core/db.js";
import { factory } from "../core/factory.js";
import {
  TRUNK_NAME_RE,
  getAsteriskStatus,
  renderPjsipTrunks,
} from "./asterisk-config.js";
import { fetchInboxMessages, testMailboxLogin } from "./inbox.js";
import {
  parseEmailRows,
  parsePhoneRows,
  parseProxyRows,
} from "./import-parsers.js";
import {
  assignProxiesToEmails,
  checkAllRegProxies,
  checkRegProxy,
} from "./proxy-check.js";
import { getRegSettings, invalidateRegSettings } from "./reg-settings.js";
import {
  getRegistrationAvailability,
  markRegistrationNumberInvalid,
  markRegistrationNumbersInvalid,
} from "./registration.service.js";
import { testSpeechkitKey } from "./sip-transcription.service.js";
import { getTrunkLockInfo } from "./trunk-lock.js";

// Регистрация: всё, что нужно для запуска — настройки, прокси для почт,
// почты, транки с номерами и результат (попытки)

const app = factory.createApp().basePath("/farm/registration");

app.use("/*", requireAuth);

const RESOURCE_STATUSES = [
  "free",
  "reserved",
  "used",
  "blocked",
  "cooldown",
  "used_no_call",
  "no_call",
  "paused",
] as const;

type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

const listQuery = (ctx: Context) => {
  const page = Math.max(1, Number(ctx.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(ctx.req.query("pageSize") ?? 50) || 50));

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search: (ctx.req.query("search") ?? "").trim(),
    status: (ctx.req.query("status") ?? "").trim(),
  };
};

const paginated = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  total,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

const countBy = <K extends string>(rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
  rows.reduce<Partial<Record<K, number>>>((acc, row) => {
    acc[row[key] as K] = row._count._all;
    return acc;
  }, {});

const isResourceStatus = (value: string): value is ResourceStatus =>
  (RESOURCE_STATUSES as readonly string[]).includes(value);

const readText = async (ctx: Context): Promise<string> => {
  const body = await ctx.req.json().catch(() => ({}));
  const text: string = typeof body?.text === "string" ? body.text : "";

  if (!text.trim()) throw new HTTPException(400, { message: "Список пуст" });

  return text;
};

const badRequest = (message: string) => new HTTPException(400, { message });

// ─── Обзор и онбординг ────────────────────────────────────────────────────

const settingsView = async () => {
  const settings = await getRegSettings();

  return {
    speechkitConfigured: Boolean(settings.speechkitApiKey),
    speechkitKeyHint: settings.speechkitApiKey ? settings.speechkitApiKey.slice(-4) : null,
    imapHost: settings.imapHost,
    imapPort: settings.imapPort,
    sipDomain: settings.sipDomain,
    sipAuthDomain: settings.sipAuthDomain,
    sipOutboundProxy: settings.sipOutboundProxy,
    sipIdentifyHost: settings.sipIdentifyHost,
  };
};

app.get("/overview", async (ctx) => {
  const todayStart = dayjs().startOf("day").toDate();
  const since = dayjs().subtract(13, "day").startOf("day").toDate();

  const [
    settings,
    proxyRows,
    emailRows,
    emailsWithoutProxy,
    trunksTotal,
    trunksEnabled,
    phoneRows,
    accountRows,
    reasonRows,
    todayRows,
    daily,
    asterisk,
    availability,
  ] = await Promise.all([
    settingsView(),
    dbClient.regProxy.groupBy({ by: ["status"], _count: { _all: true } }),
    dbClient.regEmail.groupBy({ by: ["status"], _count: { _all: true } }),
    dbClient.regEmail.count({ where: { status: "free", proxyId: null } }),
    dbClient.regTrunk.count(),
    dbClient.regTrunk.count({ where: { enabled: true } }),
    dbClient.regTrunkPhone.groupBy({
      by: ["status"],
      where: { trunk: { enabled: true } },
      _count: { _all: true },
    }),
    dbClient.regAccount.groupBy({ by: ["status"], _count: { _all: true } }),
    dbClient.regAccount.groupBy({
      by: ["failureReason"],
      where: { status: "failed" },
      _count: { _all: true },
    }),
    dbClient.regAccount.groupBy({
      by: ["status"],
      where: { createdAt: { gte: todayStart } },
      _count: { _all: true },
    }),
    dbClient.$queryRaw<Array<{ day: string; registered: number; failed: number }>>`
      SELECT to_char(("createdAt" AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day,
             count(*) FILTER (WHERE status = 'registered')::int AS registered,
             count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM "RegAccount"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1`,
    getAsteriskStatus(),
    getRegistrationAvailability(),
  ]);

  const proxies = countBy<"unchecked" | "active" | "dead">(proxyRows, "status");
  const emails = countBy<ResourceStatus>(emailRows, "status");
  const phones = countBy<ResourceStatus>(phoneRows, "status");
  const accounts = countBy<"in_progress" | "registered" | "failed">(accountRows, "status");
  const today = countBy<"in_progress" | "registered" | "failed">(todayRows, "status");
  const failureReasons = countBy<string>(
    reasonRows.map((row) => ({ ...row, failureReason: row.failureReason ?? "unknown" })),
    "failureReason",
  );

  const proxiesTotal = Object.values(proxies).reduce((sum, value) => sum + (value ?? 0), 0);
  const emailsTotal = Object.values(emails).reduce((sum, value) => sum + (value ?? 0), 0);
  const phonesTotal = Object.values(phones).reduce((sum, value) => sum + (value ?? 0), 0);

  // Шаги онбординга: что уже готово для запуска реги
  const steps = [
    {
      key: "settings",
      title: "Настройки",
      done: settings.speechkitConfigured && Boolean(settings.imapHost),
      hint: settings.speechkitConfigured
        ? `IMAP ${settings.imapHost}:${settings.imapPort}`
        : "Нужен ключ SpeechKit для расшифровки звонков",
    },
    {
      key: "proxies",
      title: "Прокси",
      done: (proxies.active ?? 0) > 0,
      hint: `${proxies.active ?? 0} живых из ${proxiesTotal}`,
    },
    {
      key: "emails",
      title: "Почты",
      done: (emails.free ?? 0) > 0,
      hint: `${emails.free ?? 0} свободных из ${emailsTotal}${
        emailsWithoutProxy ? `, без прокси: ${emailsWithoutProxy}` : ""
      }`,
    },
    {
      key: "trunks",
      title: "Транки",
      done: trunksEnabled > 0 && (phones.free ?? 0) > 0 && asterisk.configInSync,
      hint: `${trunksEnabled} включено, свободных номеров ${phones.free ?? 0}${
        trunksEnabled > 0 && !asterisk.configInSync ? ", Asterisk ещё не подтянул транки" : ""
      }`,
    },
    {
      key: "accounts",
      title: "Аккаунты",
      done: (accounts.registered ?? 0) > 0,
      hint: `${accounts.registered ?? 0} зарегистрировано`,
    },
  ];

  return ctx.json({
    settings,
    proxies: { total: proxiesTotal, ...proxies },
    emails: { total: emailsTotal, withoutProxy: emailsWithoutProxy, byStatus: emails },
    trunks: { total: trunksTotal, enabled: trunksEnabled, phones: { total: phonesTotal, byStatus: phones } },
    accounts: { byStatus: accounts, today, failureReasons, daily },
    asterisk,
    availability,
    steps,
    // Для старта достаточно первых четырёх шагов, аккаунты — это результат
    ready: steps.slice(0, 4).every((step) => step.done),
  });
});

// ─── Настройки ────────────────────────────────────────────────────────────

app.get("/settings", async (ctx) => ctx.json(await settingsView()));

app.patch("/settings", async (ctx) => {
  const body = await ctx.req.json();

  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const data: Prisma.SettingsUpdateInput = {};

  // Ключ: строка — заменить, null — стереть, не передан — не трогать
  if (body.speechkitApiKey === null) data.regSpeechkitApiKey = null;
  else if (text(body.speechkitApiKey)) data.regSpeechkitApiKey = text(body.speechkitApiKey);

  if (text(body.imapHost)) data.regImapHost = text(body.imapHost);
  if (body.imapPort !== undefined) {
    const port = Number(body.imapPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw badRequest("Неверный порт IMAP");
    data.regImapPort = port;
  }
  if (text(body.sipDomain)) data.regSipDomain = text(body.sipDomain);
  if (text(body.sipAuthDomain)) data.regSipAuthDomain = text(body.sipAuthDomain);
  if (text(body.sipOutboundProxy)) data.regSipOutboundProxy = text(body.sipOutboundProxy);
  if (text(body.sipIdentifyHost)) data.regSipIdentifyHost = text(body.sipIdentifyHost);

  await dbClient.settings.update({ where: { id: 1 }, data });
  invalidateRegSettings();

  return ctx.json(await settingsView());
});

// Проверить ключ до сохранения (передан в теле) или уже сохранённый
app.post("/settings/test-speechkit", async (ctx) => {
  const body = await ctx.req.json().catch(() => ({}));
  const key =
    (typeof body?.speechkitApiKey === "string" && body.speechkitApiKey.trim()) ||
    (await getRegSettings()).speechkitApiKey;

  if (!key) throw badRequest("Ключ SpeechKit не задан");

  return ctx.json(await testSpeechkitKey(key));
});

// ─── Прокси ───────────────────────────────────────────────────────────────

app.get("/proxies", async (ctx) => {
  const query = listQuery(ctx);
  const where: Prisma.RegProxyWhereInput = {
    ...(["unchecked", "active", "dead"].includes(query.status)
      ? { status: query.status as "unchecked" | "active" | "dead" }
      : {}),
    ...(query.search
      ? {
          OR: [
            { host: { contains: query.search, mode: "insensitive" } },
            { label: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    dbClient.regProxy.findMany({
      where,
      include: { _count: { select: { emails: true } } },
      orderBy: { createdAt: "desc" },
      skip: query.skip,
      take: query.pageSize,
    }),
    dbClient.regProxy.count({ where }),
  ]);

  return ctx.json(
    paginated(
      items.map(({ _count, ...item }) => ({ ...item, emailsCount: _count.emails })),
      total,
      query.page,
      query.pageSize,
    ),
  );
});

app.post("/proxies/import", async (ctx) => {
  const parsed = parseProxyRows(await readText(ctx));
  const existing = await dbClient.regProxy.findMany({
    select: { host: true, port: true, username: true },
  });
  const known = new Set(existing.map((item) => `${item.host}:${item.port}:${item.username ?? ""}`));

  const fresh = parsed.valid.filter((row) => {
    const key = `${row.host}:${row.port}:${row.username ?? ""}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });

  const created = fresh.length
    ? await dbClient.regProxy.createManyAndReturn({ data: fresh, select: { id: true } })
    : [];

  // Сразу проверяем новые: без проверки прокси не раздаётся почтам
  for (const proxy of created) {
    await checkRegProxy(proxy.id).catch(() => null);
  }

  return ctx.json({
    created: created.length,
    duplicates: parsed.valid.length - fresh.length,
    invalid: parsed.invalid,
  });
});

app.patch("/proxies/:id", async (ctx) => {
  const body = await ctx.req.json();
  const data: Prisma.RegProxyUpdateInput = {};

  if (typeof body.host === "string" && body.host.trim()) data.host = body.host.trim();
  if (body.port !== undefined) data.port = Number(body.port);
  if (body.username !== undefined) data.username = body.username || null;
  if (body.password !== undefined) data.password = body.password || null;
  if (body.label !== undefined) data.label = body.label || null;

  const item = await dbClient.regProxy.update({ where: { id: ctx.req.param("id") }, data });

  return ctx.json(item);
});

app.delete("/proxies/:id", async (ctx) => {
  await dbClient.regProxy.delete({ where: { id: ctx.req.param("id") } });

  return ctx.json({ ok: true });
});

app.post("/proxies/:id/check", async (ctx) => ctx.json(await checkRegProxy(ctx.req.param("id"))));

app.post("/proxies/check-all", async (ctx) => ctx.json(await checkAllRegProxies()));

// Раздать живые прокси почтам: по умолчанию только тем, у кого прокси нет или он мёртв
app.post("/proxies/assign-emails", async (ctx) => {
  const body = await ctx.req.json().catch(() => ({}));

  return ctx.json(await assignProxiesToEmails({ reassignAll: body?.reassignAll === true }));
});

app.post("/proxies/delete-dead", async (ctx) => {
  const result = await dbClient.regProxy.deleteMany({ where: { status: "dead" } });

  return ctx.json({ deleted: result.count });
});

// ─── Почты ────────────────────────────────────────────────────────────────

app.get("/emails", async (ctx) => {
  const query = listQuery(ctx);
  const proxyFilter = ctx.req.query("proxy");
  const where: Prisma.RegEmailWhereInput = {
    ...(isResourceStatus(query.status) ? { status: query.status } : {}),
    ...(proxyFilter === "none" ? { proxyId: null } : proxyFilter === "any" ? { proxyId: { not: null } } : {}),
    ...(query.search ? { email: { contains: query.search, mode: "insensitive" } } : {}),
  };

  const [items, total] = await Promise.all([
    dbClient.regEmail.findMany({
      where,
      include: { proxy: { select: { id: true, host: true, port: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip: query.skip,
      take: query.pageSize,
    }),
    dbClient.regEmail.count({ where }),
  ]);

  return ctx.json(paginated(items, total, query.page, query.pageSize));
});

app.post("/emails/import", async (ctx) => {
  const parsed = parseEmailRows(await readText(ctx));
  const existing = parsed.valid.length
    ? await dbClient.regEmail.findMany({
        where: { email: { in: parsed.valid.map((row) => row.email) } },
        select: { email: true },
      })
    : [];
  const known = new Set(existing.map((item) => item.email));
  const fresh = parsed.valid.filter((row) => !known.has(row.email));

  for (let index = 0; index < fresh.length; index += 500) {
    await dbClient.regEmail.createMany({
      data: fresh.slice(index, index + 500),
      skipDuplicates: true,
    });
  }

  // Новые ящики сразу получают прокси, если живые есть
  const proxies = fresh.length ? await assignProxiesToEmails() : { assigned: 0, proxies: 0 };

  return ctx.json({
    created: fresh.length,
    duplicates: parsed.valid.length - fresh.length,
    invalid: parsed.invalid,
    proxiesAssigned: proxies.assigned,
  });
});

app.patch("/emails/:id", async (ctx) => {
  const body = await ctx.req.json();
  const data: Prisma.RegEmailUpdateInput = {};

  if (typeof body.password === "string" && body.password.trim()) data.password = body.password.trim();
  if (typeof body.status === "string") {
    if (!isResourceStatus(body.status)) throw badRequest("Неизвестный статус");
    data.status = body.status;
  }
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.proxyId !== undefined) {
    data.proxy = body.proxyId ? { connect: { id: body.proxyId } } : { disconnect: true };
  }

  const item = await dbClient.regEmail.update({
    where: { id: ctx.req.param("id") },
    data,
    include: { proxy: { select: { id: true, host: true, port: true, status: true } } },
  });

  return ctx.json(item);
});

app.delete("/emails/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const used = await dbClient.regAccount.count({ where: { emailId: id } });

  if (used) throw badRequest("Почта уже использовалась в реге — её можно только заблокировать");

  await dbClient.regEmail.delete({ where: { id } });

  return ctx.json({ ok: true });
});

// Удалить списком: использованные в реге пропускаем и возвращаем отдельно
app.post("/emails/delete-bulk", async (ctx) => {
  const addresses = [
    ...new Set(
      (await readText(ctx))
        .split(/\r?\n/)
        .map((row) => row.split(/[:;]/)[0].trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  const emails = await dbClient.regEmail.findMany({
    where: { email: { in: addresses } },
    select: { id: true, email: true, _count: { select: { accounts: true } } },
  });

  const found = new Set(emails.map((item) => item.email));
  const inUse = emails.filter((item) => item._count.accounts > 0).map((item) => item.email);
  const deletable = emails.filter((item) => item._count.accounts === 0).map((item) => item.id);

  const result = deletable.length
    ? await dbClient.regEmail.deleteMany({ where: { id: { in: deletable } } })
    : { count: 0 };

  return ctx.json({
    deleted: result.count,
    inUse,
    notFound: addresses.filter((address) => !found.has(address)),
  });
});

app.post("/emails/:id/test", async (ctx) => ctx.json(await testMailboxLogin(ctx.req.param("id"))));

app.get("/emails/:id/messages", async (ctx) => {
  const messages = await fetchInboxMessages(ctx.req.param("id"), 5).catch((error) => {
    throw badRequest(`IMAP: ${error instanceof Error ? error.message : String(error)}`);
  });

  return ctx.json(
    messages.map(({ htmlBody, textBody, ...message }) => ({
      ...message,
      preview: (textBody ?? htmlBody?.replace(/<[^>]+>/g, " ") ?? "").replace(/\s+/g, " ").slice(0, 300),
    })),
  );
});

// ─── Транки ───────────────────────────────────────────────────────────────

const lockStage = async (accountId: string | null) => {
  if (!accountId) return null;

  const account = await dbClient.regAccount.findUnique({
    where: { id: accountId },
    include: {
      email: { select: { status: true } },
      sipCalls: {
        include: { _count: { select: { transcripts: true } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!account) return null;

  const call = account.sipCalls[0] ?? null;
  const stage = call?._count.transcripts
    ? "has_transcription"
    : call?.status === "streaming"
      ? "call_streaming"
      : call && call.status !== "rejected"
        ? "waiting_transcription"
        : account.email.status === "reserved"
          ? "waiting_email_code"
          : "in_progress";

  return { id: account.id, phone: account.phone, stage };
};

app.get("/trunks", async (ctx) => {
  const [trunks, statusRows, asterisk] = await Promise.all([
    dbClient.regTrunk.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { phones: true, accounts: true } } },
    }),
    dbClient.regTrunkPhone.groupBy({ by: ["trunkId", "status"], _count: { _all: true } }),
    getAsteriskStatus(),
  ]);

  const items = await Promise.all(
    trunks.map(async ({ sipPassword, _count, lockOwner: _owner, lockUntil: _until, ...trunk }) => {
      const lock = await getTrunkLockInfo(trunk.id);

      return {
        ...trunk,
        sipPasswordSet: Boolean(sipPassword),
        phonesCount: _count.phones,
        accountsCount: _count.accounts,
        phoneStatusCounts: statusRows
          .filter((row) => row.trunkId === trunk.id)
          .reduce<Record<string, number>>((acc, row) => {
            acc[row.status] = row._count._all;
            return acc;
          }, {}),
        lock: { ...lock, account: await lockStage(lock.accountId) },
      };
    }),
  );

  return ctx.json({ items, asterisk });
});

// Что сейчас уходит в Asterisk (пароли скрыты) — для сверки
app.get("/trunks/asterisk", async (ctx) => {
  const [status, config] = await Promise.all([getAsteriskStatus(), renderPjsipTrunks()]);

  return ctx.json({
    ...status,
    preview: config.text.replace(/^password = .*$/gm, "password = ********"),
  });
});

const trunkInput = (body: Record<string, unknown>, partial: boolean) => {
  const data: {
    name?: string;
    sipPassword?: string;
    notes?: string | null;
    enabled?: boolean;
    outboundProxy?: string | null;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    const name = body.name.trim();
    if (!TRUNK_NAME_RE.test(name)) throw badRequest("SIP-ID транка: только латиница, цифры, точка, дефис");
    data.name = name;
  } else if (!partial) {
    throw badRequest("Укажите SIP-ID транка");
  }

  if (typeof body.sipPassword === "string" && body.sipPassword.trim()) {
    if (/[\r\n]/.test(body.sipPassword)) throw badRequest("Пароль не может содержать перенос строки");
    data.sipPassword = body.sipPassword.trim();
  } else if (!partial) {
    throw badRequest("Укажите пароль SIP");
  }

  if (body.notes !== undefined) data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;

  // Свой outbound proxy транка: пусто — общий из настроек SIP-провайдера
  if (body.outboundProxy !== undefined) {
    const proxy = typeof body.outboundProxy === "string" ? body.outboundProxy.trim() : "";
    if (proxy && !/^[A-Za-z0-9.-]+(:\d+)?$/.test(proxy)) throw badRequest("Outbound proxy: хост или хост:порт");
    data.outboundProxy = proxy || null;
  }

  return data;
};

app.post("/trunks", async (ctx) => {
  const data = trunkInput(await ctx.req.json(), false) as {
    name: string;
    sipPassword: string;
    notes?: string | null;
    enabled?: boolean;
  };

  const exists = await dbClient.regTrunk.count({ where: { name: data.name } });
  if (exists) throw badRequest("Транк с таким SIP-ID уже есть");

  const { sipPassword, lockOwner: _owner, lockUntil: _until, ...trunk } = await dbClient.regTrunk.create({
    data,
  });

  return ctx.json({ ...trunk, sipPasswordSet: Boolean(sipPassword) }, 201);
});

app.patch("/trunks/:id", async (ctx) => {
  const data = trunkInput(await ctx.req.json(), true);
  const { sipPassword, lockOwner: _owner, lockUntil: _until, ...trunk } = await dbClient.regTrunk.update({
    where: { id: ctx.req.param("id") },
    data,
  });

  return ctx.json({ ...trunk, sipPasswordSet: Boolean(sipPassword) });
});

app.delete("/trunks/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const lock = await getTrunkLockInfo(id);

  if (lock.locked) throw badRequest("На транке идёт регистрация — дождитесь окончания или выключите транк");

  // Номера удаляются вместе с транком, аккаунты остаются (номер в них записан копией)
  await dbClient.regTrunk.delete({ where: { id } });

  return ctx.json({ ok: true });
});

app.get("/trunks/:id/phones", async (ctx) => {
  const query = listQuery(ctx);
  const where: Prisma.RegTrunkPhoneWhereInput = {
    trunkId: ctx.req.param("id"),
    ...(isResourceStatus(query.status) ? { status: query.status } : {}),
    ...(query.search ? { phone: { contains: query.search.replace(/\D/g, "") || query.search } } : {}),
  };

  const [items, total] = await Promise.all([
    dbClient.regTrunkPhone.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: query.skip,
      take: query.pageSize,
    }),
    dbClient.regTrunkPhone.count({ where }),
  ]);

  return ctx.json(paginated(items, total, query.page, query.pageSize));
});

app.post("/trunks/:id/import", async (ctx) => {
  const trunkId = ctx.req.param("id");
  await dbClient.regTrunk.findUniqueOrThrow({ where: { id: trunkId } });

  const parsed = parsePhoneRows(await readText(ctx));
  const invalid = [...parsed.invalid];

  const existing = parsed.valid.length
    ? await dbClient.regTrunkPhone.findMany({
        where: { phone: { in: parsed.valid.map((row) => row.phone) } },
        select: { phone: true, trunkId: true, trunk: { select: { name: true } } },
      })
    : [];
  const existingByPhone = new Map(existing.map((item) => [item.phone, item]));

  const fresh = parsed.valid.filter((row) => {
    const found = existingByPhone.get(row.phone);
    if (!found) return true;

    invalid.push({
      row: row.phone,
      reason:
        found.trunkId === trunkId ? "Номер уже есть в этом транке" : `Номер уже в транке ${found.trunk.name}`,
    });
    return false;
  });

  let created = 0;

  for (let index = 0; index < fresh.length; index += 500) {
    const result = await dbClient.regTrunkPhone.createMany({
      data: fresh.slice(index, index + 500).map((row) => ({ phone: row.phone, trunkId })),
      skipDuplicates: true,
    });
    created += result.count;
  }

  return ctx.json({ created, invalid });
});

app.delete("/trunks/phones/:phoneId", async (ctx) => {
  const phone = await dbClient.regTrunkPhone.findUniqueOrThrow({ where: { id: ctx.req.param("phoneId") } });

  if (phone.status === "reserved") throw badRequest("Номер сейчас в реге");

  await dbClient.regTrunkPhone.delete({ where: { id: phone.id } });

  return ctx.json({ ok: true });
});

// Вернуть номер в ротацию (после паузы, «без звонка», блокировки по ошибке)
app.post("/trunks/phones/:phoneId/restore", async (ctx) => {
  const phone = await dbClient.regTrunkPhone.findUniqueOrThrow({ where: { id: ctx.req.param("phoneId") } });

  if (phone.status === "reserved") throw badRequest("Номер сейчас в реге");

  await dbClient.regTrunkPhone.update({
    where: { id: phone.id },
    data: { status: "free", pausedUntil: null },
  });

  return ctx.json({ ok: true });
});

app.post("/trunks/phones/:phoneId/mark-invalid", async (ctx) => {
  await markRegistrationNumberInvalid({ trunkPhoneId: ctx.req.param("phoneId") });

  return ctx.json({ ok: true });
});

// Все «без звонка» — обратно в работу
app.post("/trunks/restore-no-call", async (ctx) => {
  const result = await dbClient.regTrunkPhone.updateMany({
    where: { status: "no_call" },
    data: { status: "free", pausedUntil: null },
  });

  return ctx.json({ restored: result.count });
});

app.post("/trunks/mark-invalid-bulk", async (ctx) => {
  const parsed = parsePhoneRows(await readText(ctx));
  const result = await markRegistrationNumbersInvalid(parsed.valid.map((row) => row.phone));

  return ctx.json({ ...result, invalid: parsed.invalid });
});

// ─── Аккаунты ─────────────────────────────────────────────────────────────

const accountWhere = (ctx: Context): Prisma.RegAccountWhereInput => {
  const status = ctx.req.query("status");
  const failureReason = ctx.req.query("failureReason");
  const period = ctx.req.query("period");
  const search = (ctx.req.query("search") ?? "").trim();
  const periodDays: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

  return {
    ...(status && ["in_progress", "registered", "failed"].includes(status)
      ? { status: status as "in_progress" | "registered" | "failed" }
      : {}),
    ...(failureReason
      ? { failureReason: failureReason as Prisma.EnumRegFailureReasonNullableFilter["equals"] }
      : {}),
    ...(period && period in periodDays
      ? { createdAt: { gte: dayjs().subtract(periodDays[period], "day").startOf("day").toDate() } }
      : {}),
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { phone: { contains: search.replace(/\D/g, "") || search } },
            { email: { email: { contains: search, mode: "insensitive" } } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
};

app.get("/accounts", async (ctx) => {
  const query = listQuery(ctx);
  const where = accountWhere(ctx);

  const [items, total] = await Promise.all([
    dbClient.regAccount.findMany({
      where,
      include: {
        email: { select: { email: true } },
        trunk: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: query.skip,
      take: query.pageSize,
    }),
    dbClient.regAccount.count({ where }),
  ]);

  return ctx.json(paginated(items, total, query.page, query.pageSize));
});

app.get("/accounts/export.csv", async (ctx) => {
  const items = await dbClient.regAccount.findMany({
    where: accountWhere(ctx),
    include: { email: { select: { email: true } }, trunk: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = [
    "id",
    "status",
    "failureReason",
    "phone",
    "email",
    "trunk",
    "firstName",
    "lastName",
    "username",
    "birthDate",
    "twoFaPassword",
    "accountCreatedAt",
    "createdAt",
  ];

  const rows = items.map((item) =>
    [
      item.id,
      item.status,
      item.failureReason,
      item.phone,
      item.email.email,
      item.trunk?.name,
      item.firstName,
      item.lastName,
      item.username,
      item.birthDate.toISOString().slice(0, 10),
      item.twoFaPassword,
      item.accountCreatedAt?.toISOString(),
      item.createdAt.toISOString(),
    ]
      .map(cell)
      .join(","),
  );

  ctx.header("Content-Type", "text/csv; charset=utf-8");
  ctx.header("Content-Disposition", `attachment; filename="reg-accounts-${dayjs().format("YYYY-MM-DD")}.csv"`);

  return ctx.body(`﻿${[header.join(","), ...rows].join("\n")}`);
});

app.get("/accounts/:id", async (ctx) => {
  const account = await dbClient.regAccount.findUnique({
    where: { id: ctx.req.param("id") },
    include: {
      email: { select: { id: true, email: true, status: true } },
      trunk: { select: { id: true, name: true } },
      sipCalls: {
        include: { transcripts: { orderBy: { sequence: "asc" } } },
        orderBy: { createdAt: "desc" },
      },
      events: { orderBy: { createdAt: "asc" }, take: 100 },
    },
  });

  if (!account) throw new HTTPException(404, { message: "Аккаунт не найден" });

  return ctx.json(account);
});

export default app;
