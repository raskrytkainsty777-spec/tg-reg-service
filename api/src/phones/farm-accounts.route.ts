import { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import { HTTPException } from "hono/http-exception";

import { requireAuth } from "../core/auth.js";
import { dbClient } from "../core/db.js";
import { factory } from "../core/factory.js";
import { checkPhoneProxies, checkPhoneProxy, replacePhoneProxy } from "./proxyma.js";
import { phoneDelete } from "./geelark.js";
import { createPhones } from "./create-phones.js";
import { phoneStatus } from "./geelark.js";

// Телефоны GeeLark с Telegram-аккаунтами. Один телефон — один аккаунт,
// поэтому список плоский: строка = телефон

const app = factory.createApp().basePath("/farm/accounts");

app.use("/*", requireAuth);

const PAGE_SIZE = 50;

const phoneView = (
  phone: Prisma.FarmPhoneGetPayload<{ include: { group: true } }>,
) => ({
  id: phone.id,
  profileName: phone.profileName,
  geelarkId: phone.geelarkId,
  countryCode: phone.countryCode,
  countryName: phone.countryName,
  brand: phone.brand,
  model: phone.model,
  androidVer: phone.androidVer,
  group: phone.group ? { id: phone.group.id, name: phone.group.name } : null,
  proxy: phone.proxyHost
    ? {
        host: phone.proxyHost,
        port: phone.proxyPort,
        type: phone.proxyType,
        status: phone.proxyStatus,
        latencyMs: phone.proxyLatencyMs,
        error: phone.proxyError,
        checkedAt: phone.proxyCheckedAt,
        replacedAt: phone.proxyReplacedAt,
      }
    : null,
  account: phone.accountPhone
    ? {
        phone: phone.accountPhone,
        firstName: phone.accountFirstName,
        lastName: phone.accountLastName,
        username: phone.accountUsername,
        status: phone.accountStatus,
        statusReason: phone.statusReason,
        registeredAt: phone.registeredAt,
        lastLaunchedAt: phone.lastLaunchedAt,
        lastError: phone.lastError,
      }
    : null,
});

// ─── Настройки GeeLark и Proxyma ──────────────────────────────────────────
// Ключи наружу не отдаём: только «заполнено» и хвост, чтобы было видно,
// что лежит именно тот ключ

const keyHint = (value: string | null | undefined) =>
  value && value.length > 4 ? `…${value.slice(-4)}` : null;

app.get("/settings", async (ctx) => {
  const row = await dbClient.settings.findUnique({ where: { id: 1 } });

  return ctx.json({
    geelarkBaseUrl: row?.farmGeelarkBaseUrl ?? "https://openapi.geelark.com/open/v1",
    geelarkConfigured: !!row?.farmGeelarkApiKey,
    geelarkKeyHint: keyHint(row?.farmGeelarkApiKey),
    proxymaConfigured: !!row?.farmProxymaApiKey,
    proxymaKeyHint: keyHint(row?.farmProxymaApiKey),
    proxymaPackageKey: row?.farmProxymaPackageKey ?? "",
    proxymaGwHost: row?.farmProxymaGwHost ?? "",
    proxymaPortLo: row?.farmProxymaPortLo ?? null,
    proxymaPortHi: row?.farmProxymaPortHi ?? null,
  });
});

app.patch("/settings", async (ctx) => {
  const body = await ctx.req.json<{
    geelarkBaseUrl?: string;
    geelarkApiKey?: string;
    proxymaApiKey?: string;
    proxymaPackageKey?: string;
    proxymaGwHost?: string;
    proxymaPortLo?: number | null;
    proxymaPortHi?: number | null;
  }>();

  // Пустая строка ключа значит «не менять» — иначе форма затирала бы его
  const data = {
    ...(body.geelarkBaseUrl === undefined
      ? {}
      : { farmGeelarkBaseUrl: body.geelarkBaseUrl.trim() }),
    ...(body.geelarkApiKey?.trim() ? { farmGeelarkApiKey: body.geelarkApiKey.trim() } : {}),
    ...(body.proxymaApiKey?.trim() ? { farmProxymaApiKey: body.proxymaApiKey.trim() } : {}),
    ...(body.proxymaPackageKey === undefined
      ? {}
      : { farmProxymaPackageKey: body.proxymaPackageKey.trim() }),
    ...(body.proxymaGwHost === undefined
      ? {}
      : { farmProxymaGwHost: body.proxymaGwHost.trim() }),
    ...(body.proxymaPortLo === undefined ? {} : { farmProxymaPortLo: body.proxymaPortLo }),
    ...(body.proxymaPortHi === undefined ? {} : { farmProxymaPortHi: body.proxymaPortHi }),
  };

  await dbClient.settings.update({ where: { id: 1 }, data });

  return ctx.json({ ok: true });
});

// ─── Группы ───────────────────────────────────────────────────────────────

app.get("/groups", async (ctx) => {
  const [groups, phones] = await Promise.all([
    dbClient.farmGroup.findMany({ orderBy: { createdAt: "asc" } }),
    dbClient.farmPhone.findMany({ select: { groupId: true, accountPhone: true } }),
  ]);

  // Цифры группы считаем в памяти: телефонов сотни, отдельные запросы лишние
  const stat = (items: typeof phones) => ({
    phones: items.length,
    accounts: items.filter((item) => item.accountPhone).length,
  });

  return ctx.json({
    total: stat(phones),
    ungrouped: stat(phones.filter((phone) => !phone.groupId)),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      ...stat(phones.filter((phone) => phone.groupId === group.id)),
    })),
  });
});

app.post("/groups", async (ctx) => {
  const body = await ctx.req.json<{ name?: string; color?: string | null }>();
  const name = body.name?.trim();

  if (!name) throw new HTTPException(400, { message: "Не указано название группы" });

  const exists = await dbClient.farmGroup.findUnique({ where: { name } });

  if (exists) throw new HTTPException(409, { message: "Такая группа уже есть" });

  return ctx.json(
    await dbClient.farmGroup.create({ data: { name, color: body.color ?? null } }),
  );
});

app.patch("/groups/:id", async (ctx) => {
  const body = await ctx.req.json<{ name?: string; color?: string | null }>();

  return ctx.json(
    await dbClient.farmGroup.update({
      where: { id: ctx.req.param("id") },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.color === undefined ? {} : { color: body.color }),
      },
    }),
  );
});

app.delete("/groups/:id", async (ctx) => {
  // Телефоны не удаляем — они просто остаются без группы
  await dbClient.farmGroup.delete({ where: { id: ctx.req.param("id") } });

  return ctx.json({ ok: true });
});

// ─── Телефоны ─────────────────────────────────────────────────────────────

app.get("/phones", async (ctx) => {
  const page = Math.max(1, Number(ctx.req.query("page") ?? 1));
  const pageSize = Math.min(
    1000,
    Math.max(1, Number(ctx.req.query("pageSize") ?? PAGE_SIZE)),
  );
  const search = ctx.req.query("search")?.trim();
  const groupId = ctx.req.query("groupId")?.trim();
  const status = ctx.req.query("status")?.trim();

  const where: Prisma.FarmPhoneWhereInput = {
    ...(groupId === "none" ? { groupId: null } : groupId ? { groupId } : {}),
    ...(status === "idle"
      ? { accountPhone: null }
      : status && status !== "all"
        ? { accountStatus: status as Prisma.FarmPhoneWhereInput["accountStatus"] }
        : {}),
    ...(search
      ? {
          OR: [
            { profileName: { contains: search, mode: "insensitive" } },
            { accountPhone: { contains: search } },
            { accountUsername: { contains: search, mode: "insensitive" } },
            { accountFirstName: { contains: search, mode: "insensitive" } },
            { countryName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    dbClient.farmPhone.findMany({
      where,
      include: { group: true },
      orderBy: { profileName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    dbClient.farmPhone.count({ where }),
  ]);

  return ctx.json({
    items: items.map(phoneView),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

app.patch("/phones/:id", async (ctx) => {
  const body = await ctx.req.json<{ groupId?: string | null }>();

  const phone = await dbClient.farmPhone.update({
    where: { id: ctx.req.param("id") },
    data: body.groupId === undefined ? {} : { groupId: body.groupId },
    include: { group: true },
  });

  return ctx.json(phoneView(phone));
});

app.post("/phones/move", async (ctx) => {
  const body = await ctx.req.json<{ ids?: string[]; groupId?: string | null }>();
  const ids = body.ids ?? [];

  if (!ids.length) throw new HTTPException(400, { message: "Не выбраны телефоны" });

  const result = await dbClient.farmPhone.updateMany({
    where: { id: { in: ids } },
    data: { groupId: body.groupId ?? null },
  });

  return ctx.json({ moved: result.count });
});

app.post("/phones/create", async (ctx) => {
  const body = await ctx.req.json<{
    countries?: Record<string, number>;
    groupId?: string | null;
    androidVer?: number;
  }>();

  try {
    return ctx.json(
      await createPhones({
        countries: body.countries ?? {},
        groupId: body.groupId ?? null,
        androidVer: body.androidVer,
      }),
    );
  } catch (error) {
    throw new HTTPException(502, {
      message: error instanceof Error ? error.message : "Не удалось создать телефоны",
    });
  }
});

// Питание телефонов GeeLark отдаёт пачками до 100 id за раз.
// В базе не храним: значение живое и протухает через минуту
app.post("/phones/refresh-status", async (ctx) => {
  const phones = await dbClient.farmPhone.findMany({
    where: { geelarkId: { not: null } },
    select: { id: true, geelarkId: true },
  });

  const byGeelark = new Map(phones.map((phone) => [phone.geelarkId!, phone.id]));
  const ids = [...byGeelark.keys()];
  const power: Record<string, number> = {};

  for (let start = 0; start < ids.length; start += 100) {
    const data = await phoneStatus(ids.slice(start, start + 100));

    for (const detail of data.successDetails ?? []) {
      const phoneId = byGeelark.get(detail.id);

      if (phoneId) power[phoneId] = detail.status;
    }
  }

  return ctx.json({ power });
});

// ─── Прокси телефона ──────────────────────────────────────────────────────

/** Проверить прокси у выделенных телефонов разом */
app.post("/phones/proxy/check-bulk", async (ctx) => {
  const body = await ctx.req.json<{ ids?: string[] }>();
  const ids = body.ids ?? [];

  if (!ids.length) throw new HTTPException(400, { message: "Не выбраны телефоны" });

  return ctx.json(await checkPhoneProxies(ids));
});

/**
 * Удалить телефоны. По умолчанию сносим профили и в GeeLark: пока они
 * существуют, за них капает оплата. Если GeeLark отказал — телефоны у нас
 * остаются, чтобы не потерять связь с профилем, который никто не удалил
 */
app.post("/phones/delete", async (ctx) => {
  const body = await ctx.req.json<{ ids?: string[]; inGeelark?: boolean }>();
  const ids = body.ids ?? [];

  if (!ids.length) throw new HTTPException(400, { message: "Не выбраны телефоны" });

  const phones = await dbClient.farmPhone.findMany({
    where: { id: { in: ids } },
    select: { id: true, geelarkId: true, accountPhone: true },
  });

  const withAccount = phones.filter((phone) => phone.accountPhone).length;
  const geelarkIds = phones
    .map((phone) => phone.geelarkId)
    .filter((id): id is string => !!id);

  if (body.inGeelark !== false && geelarkIds.length) {
    try {
      await phoneDelete(geelarkIds);
    } catch (error) {
      throw new HTTPException(502, {
        message: `GeeLark не удалил профили: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }. Телефоны остались на месте`,
      });
    }
  }

  const removed = await dbClient.farmPhone.deleteMany({ where: { id: { in: ids } } });

  return ctx.json({ deleted: removed.count, withAccount });
});

app.post("/phones/:id/proxy/check", async (ctx) => {
  const phone = await checkPhoneProxy(ctx.req.param("id"));

  return ctx.json({
    status: phone.proxyStatus,
    latencyMs: phone.proxyLatencyMs,
    error: phone.proxyError,
  });
});

app.post("/phones/:id/proxy/replace", async (ctx) => {
  const phone = await replacePhoneProxy(ctx.req.param("id"));

  return ctx.json({
    host: phone.proxyHost,
    port: phone.proxyPort,
    status: phone.proxyStatus,
    latencyMs: phone.proxyLatencyMs,
    error: phone.proxyError,
  });
});

// ─── История телефона ─────────────────────────────────────────────────────

app.get("/phones/:id/events", async (ctx) => {
  const events = await dbClient.farmPhoneEvent.findMany({
    where: { phoneId: ctx.req.param("id") },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return ctx.json(
    events.map((event) => ({
      id: event.id,
      kind: event.kind,
      detail: event.detail,
      hasScreenshot: !!event.screenshot,
      createdAt: event.createdAt,
    })),
  );
});

app.get("/phones/events/:eventId/screenshot", async (ctx) => {
  const event = await dbClient.farmPhoneEvent.findUniqueOrThrow({
    where: { id: ctx.req.param("eventId") },
    select: { screenshot: true },
  });

  if (!event.screenshot) throw new HTTPException(404, { message: "Скриншота нет" });

  return ctx.json({ screenshot: event.screenshot });
});

// ─── Сводка для шапки ─────────────────────────────────────────────────────

app.get("/summary", async (ctx) => {
  const phones = await dbClient.farmPhone.findMany({
    select: { accountPhone: true, registeredAt: true },
  });

  const today = dayjs().startOf("day");

  return ctx.json({
    phones: phones.length,
    accounts: phones.filter((phone) => phone.accountPhone).length,
    registeredToday: phones.filter(
      (phone) => phone.registeredAt && dayjs(phone.registeredAt).isAfter(today),
    ).length,
  });
});

export default app;
