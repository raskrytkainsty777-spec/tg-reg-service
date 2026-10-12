import { SocksClient } from "socks";

import { dbClient } from "../core/db.js";
import { getRegSettings } from "./reg-settings.js";

const CHECK_TIMEOUT_MS = 10_000;
const BULK_CONCURRENCY = 10;

/**
 * Прокси нужен почтам, поэтому проверяем ровно то, ради чего он есть:
 * TCP-соединение через SOCKS5 до IMAP-сервера реги
 */
export const checkRegProxy = async (proxyId: string) => {
  const proxy = await dbClient.regProxy.findUniqueOrThrow({ where: { id: proxyId } });
  const settings = await getRegSettings();
  const startedAt = Date.now();

  let status: "active" | "dead" = "active";
  let latencyMs: number | null = null;
  let lastError: string | null = null;

  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.username ?? undefined,
        password: proxy.password ?? undefined,
      },
      command: "connect",
      destination: { host: settings.imapHost, port: settings.imapPort },
      timeout: CHECK_TIMEOUT_MS,
    });

    latencyMs = Date.now() - startedAt;
    socket.destroy();
  } catch (error) {
    status = "dead";
    lastError = error instanceof Error ? error.message : String(error);
  }

  return dbClient.regProxy.update({
    where: { id: proxy.id },
    data: { status, lastCheckAt: new Date(), lastLatencyMs: latencyMs, lastError },
  });
};

export const checkAllRegProxies = async () => {
  const proxies = await dbClient.regProxy.findMany({ select: { id: true } });
  const queue = [...proxies];
  let active = 0;
  let dead = 0;

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await checkRegProxy(next.id);
      if (result.status === "active") active += 1;
      else dead += 1;
    }
  };

  await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));

  return { checked: proxies.length, active, dead };
};

/**
 * Раздать живые прокси почтам без прокси по кругу, чтобы на каждый
 * прокси приходилось поровну ящиков
 */
export const assignProxiesToEmails = async (options: { reassignAll?: boolean } = {}) => {
  const proxies = await dbClient.regProxy.findMany({
    where: { status: "active" },
    select: { id: true, _count: { select: { emails: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (proxies.length === 0) return { assigned: 0, proxies: 0 };

  const emails = await dbClient.regEmail.findMany({
    where: options.reassignAll
      ? {}
      : { OR: [{ proxyId: null }, { proxy: { status: { not: "active" } } }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  // Начинаем с наименее загруженных, чтобы досыпать ящики туда, где их меньше
  const load = new Map(
    proxies.map((proxy) => [proxy.id, options.reassignAll ? 0 : proxy._count.emails]),
  );
  const byProxy = new Map<string, string[]>();

  for (const email of emails) {
    let target = proxies[0].id;

    for (const proxy of proxies) {
      if ((load.get(proxy.id) ?? 0) < (load.get(target) ?? 0)) target = proxy.id;
    }

    load.set(target, (load.get(target) ?? 0) + 1);
    byProxy.set(target, [...(byProxy.get(target) ?? []), email.id]);
  }

  for (const [proxyId, emailIds] of byProxy) {
    for (let index = 0; index < emailIds.length; index += 500) {
      await dbClient.regEmail.updateMany({
        where: { id: { in: emailIds.slice(index, index + 500) } },
        data: { proxyId },
      });
    }
  }

  return { assigned: emails.length, proxies: proxies.length };
};
