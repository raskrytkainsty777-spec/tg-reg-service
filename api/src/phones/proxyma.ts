import { SocksClient } from "socks";

import { dbClient } from "../core/db.js";
import { findProxyEntry, proxyUpdate } from "./geelark.js";

// Proxyma — мобильные резидентные прокси. Шлюз один, а «свой» IP телефону
// даёт sticky-модификатор логина: <логин>_c_<страна>_s_<сессия>. Работает он
// только на логине ШЛЮЗА, на логинах списков игнорируется — поэтому строки
// для телефонов собираем из кредов шлюза, взятых по API

const RESELLER_BASE = "https://api.proxyma1.io";
const GATEWAY_RE = /^\w+:\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/;
const CHECK_TIMEOUT_MS = 10_000;
// Пакет Proxyma отдаёт порты этого диапазона
const DEFAULT_PORT_LO = 10000;
const DEFAULT_PORT_HI = 10999;
// Через что проверяем живость прокси: 80 порт отвечает у любого узла
const CHECK_TARGET = { host: "api.telegram.org", port: 443 };

export type FarmProxySettings = {
  proxymaApiKey: string | null;
  proxymaPackageKey: string | null;
  proxymaGwHost: string | null;
  proxymaPortLo: number | null;
  proxymaPortHi: number | null;
};

export const getFarmSettings = async () => {
  const row = await dbClient.settings.findUnique({
    where: { id: 1 },
    select: {
      farmGeelarkBaseUrl: true,
      farmGeelarkApiKey: true,
      farmProxymaApiKey: true,
      farmProxymaPackageKey: true,
      farmProxymaGwHost: true,
      farmProxymaPortLo: true,
      farmProxymaPortHi: true,
    },
  });

  return {
    geelarkBaseUrl: row?.farmGeelarkBaseUrl?.trim() || "https://openapi.geelark.com/open/v1",
    geelarkApiKey: row?.farmGeelarkApiKey?.trim() || null,
    proxymaApiKey: row?.farmProxymaApiKey?.trim() || null,
    proxymaPackageKey: row?.farmProxymaPackageKey?.trim() || null,
    proxymaGwHost: row?.farmProxymaGwHost?.trim() || null,
    proxymaPortLo: row?.farmProxymaPortLo ?? null,
    proxymaPortHi: row?.farmProxymaPortHi ?? null,
  };
};

export class ProxymaNotConfiguredError extends Error {
  constructor() {
    super("Proxyma не настроена: заполните ключ и пакет в Настройках");
  }
}

/** Логин и пароль шлюза пакета — только они понимают sticky-модификаторы */
export const getGatewayCreds = async () => {
  const settings = await getFarmSettings();

  if (!settings.proxymaApiKey || !settings.proxymaPackageKey) {
    throw new ProxymaNotConfiguredError();
  }

  const response = await fetch(
    `${RESELLER_BASE}/api/reseller/get/api_tools/${settings.proxymaPackageKey}`,
    { headers: { "api-key": settings.proxymaApiKey } },
  );

  if (!response.ok) throw new Error(`Proxyma ответила ${response.status}`);

  const payload = (await response.json()) as {
    result?: { data?: Record<string, string> };
  };
  const data = payload.result?.data ?? {};
  const matched = GATEWAY_RE.exec(String(data.SOCKS5 ?? data.HTTPS ?? ""));

  if (!matched) throw new Error("Proxyma: не разобрал строку шлюза");

  return {
    username: matched[1],
    password: matched[2],
    host: settings.proxymaGwHost || matched[3],
    port: Number(matched[4]),
    settings,
  };
};

// Сессия должна пережить перезапуск: собираем её из имени профиля, а при
// замене прокси добавляем суффикс — новая сессия = новый IP
const sessionId = (profileName: string, attempt: number) =>
  `${profileName.toLowerCase().replace(/[^a-z0-9]/g, "")}${attempt > 0 ? `r${attempt}` : ""}`;

// Порт у каждого телефона свой: шлюз различает сессии в том числе по порту,
// и два телефона на одном порту начинают ходить одним IP
const pickFreePort = async (gateway: Awaited<ReturnType<typeof getGatewayCreds>>) => {
  const lo = gateway.settings.proxymaPortLo ?? DEFAULT_PORT_LO;
  const hi = gateway.settings.proxymaPortHi ?? DEFAULT_PORT_HI;

  if (hi < lo) return gateway.port;

  const taken = new Set(
    (
      await dbClient.farmPhone.findMany({
        where: { proxyPort: { not: null } },
        select: { proxyPort: true },
      })
    ).map((phone) => phone.proxyPort),
  );

  for (let port = lo; port <= hi; port += 1) {
    if (!taken.has(port)) return port;
  }

  // Диапазон кончился — пусть лучше повторится порт, чем упадёт создание
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};

/** Строка прокси под конкретный телефон: страна телефона + своя sticky-сессия */
export const buildPhoneProxy = async (input: {
  profileName: string;
  countryCode: string | null;
  attempt?: number;
}) => {
  const gateway = await getGatewayCreds();
  const port = await pickFreePort(gateway);

  const country = input.countryCode?.trim().toUpperCase();
  const suffix = [
    country ? `_c_${country}` : "",
    `_s_${sessionId(input.profileName, input.attempt ?? 0)}`,
  ].join("");

  return {
    proxyHost: gateway.host,
    proxyPort: port,
    proxyType: "socks5",
    proxyUser: `${gateway.username}${suffix}`,
    proxyPassword: gateway.password,
  };
};

/** Живость прокси телефона: TCP через SOCKS5 и время ответа */
export const checkPhoneProxy = async (phoneId: string) => {
  const phone = await dbClient.farmPhone.findUniqueOrThrow({ where: { id: phoneId } });

  if (!phone.proxyHost || !phone.proxyPort) {
    return dbClient.farmPhone.update({
      where: { id: phone.id },
      data: {
        proxyStatus: "dead",
        proxyError: "Прокси не привязан",
        proxyCheckedAt: new Date(),
      },
    });
  }

  const startedAt = Date.now();
  let proxyStatus: "ok" | "dead" = "ok";
  let proxyLatencyMs: number | null = null;
  let proxyError: string | null = null;

  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: phone.proxyHost,
        port: phone.proxyPort,
        type: 5,
        userId: phone.proxyUser ?? undefined,
        password: phone.proxyPassword ?? undefined,
      },
      command: "connect",
      destination: CHECK_TARGET,
      timeout: CHECK_TIMEOUT_MS,
    });

    proxyLatencyMs = Date.now() - startedAt;
    socket.destroy();
  } catch (error) {
    proxyStatus = "dead";
    proxyError = error instanceof Error ? error.message : String(error);
  }

  return dbClient.farmPhone.update({
    where: { id: phone.id },
    data: { proxyStatus, proxyLatencyMs, proxyError, proxyCheckedAt: new Date() },
  });
};

/**
 * Выдать телефону новый прокси: та же страна, новая sticky-сессия.
 * Прокси живёт и в самом GeeLark (запись реестра прокси, на которую смотрит
 * профиль) — правим её, иначе телефон так и ходил бы через старый IP
 */
export const replacePhoneProxy = async (phoneId: string) => {
  const phone = await dbClient.farmPhone.findUniqueOrThrow({ where: { id: phoneId } });
  // Счётчик замен прячем в самой сессии: время последней замены уже пишем
  const attempt = Math.floor(Date.now() / 1000) % 100000;
  const proxy = await buildPhoneProxy({
    profileName: `${phone.profileName}${attempt}`,
    countryCode: phone.countryCode,
  });

  if (phone.geelarkId && phone.proxyHost && phone.proxyPort) {
    // Ищем строго по логину: на одном host:port у GeeLark записи разных
    // телефонов (sticky-сессии), и «первая попавшаяся» пересадила бы соседа
    const entry = await findProxyEntry(phone.proxyHost, phone.proxyPort, phone.proxyUser);

    if (!entry) {
      throw new Error(
        `В GeeLark не нашлась запись прокси ${phone.proxyHost}:${phone.proxyPort} этого телефона`,
      );
    }

    await proxyUpdate({
      id: entry.id,
      scheme: proxy.proxyType,
      server: proxy.proxyHost,
      port: proxy.proxyPort,
      username: proxy.proxyUser,
      password: proxy.proxyPassword,
    });
  }

  await dbClient.farmPhone.update({
    where: { id: phone.id },
    data: {
      ...proxy,
      proxyStatus: "unchecked",
      proxyLatencyMs: null,
      proxyError: null,
      proxyReplacedAt: new Date(),
    },
  });

  await dbClient.farmPhoneEvent.create({
    data: {
      phoneId: phone.id,
      kind: "proxy_replaced",
      detail: `${proxy.proxyHost}:${proxy.proxyPort}`,
    },
  });

  return checkPhoneProxy(phone.id);
};

// Проверяем пачкой, но не все разом: каждый чек держит соединение до
// десяти секунд, и сотня параллельных упирается в сеть, а не в прокси
const CHECK_CONCURRENCY = 10;

/** Проверить прокси у выделенных телефонов */
export const checkPhoneProxies = async (phoneIds: string[]) => {
  const queue = [...phoneIds];
  let ok = 0;
  let dead = 0;

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const phone = await checkPhoneProxy(next).catch(() => null);

      if (!phone) continue;
      if (phone.proxyStatus === "ok") ok += 1;
      else dead += 1;
    }
  };

  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));

  return { checked: phoneIds.length, ok, dead };
};
