import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { dbClient } from "../core/db.js";
import { getRegSettings } from "./reg-settings.js";

type ProxyLike = {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
};

export const buildSocksUrl = (proxy: ProxyLike) => {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}${
        proxy.password ? `:${encodeURIComponent(proxy.password)}` : ""
      }@`
    : "";

  return `socks5://${auth}${proxy.host}:${proxy.port}`;
};

export type InboxMessage = {
  id: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  receivedAt: string;
};

const openClient = async (
  mailbox: { email: string; password: string; proxy: ProxyLike | null },
) => {
  const settings = await getRegSettings();

  return new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapPort === 993,
    auth: { user: mailbox.email, pass: mailbox.password },
    proxy: mailbox.proxy ? buildSocksUrl(mailbox.proxy) : undefined,
    logger: false,
  });
};

/**
 * Последние письма ящика. Каждый вызов — новое IMAP-подключение: скрипт реги
 * спрашивает код раз в несколько секунд, держать сотни открытых сессий дороже
 */
export const fetchInboxMessages = async (emailId: string, limit: number) => {
  const mailbox = await dbClient.regEmail.findUniqueOrThrow({
    where: { id: emailId },
    include: { proxy: true },
  });

  const client = await openClient(mailbox);

  try {
    await client.connect();
    const lock = await client.mailboxOpen("INBOX");

    const messages: InboxMessage[] = [];
    const total = lock.exists ?? 0;

    if (total > 0) {
      const range = `${Math.max(1, total - limit + 1)}:*`;

      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      })) {
        if (!message.source) continue;

        const parsed = await simpleParser(message.source);
        const from = parsed.from?.value?.[0];
        const receivedAt =
          message.internalDate instanceof Date
            ? message.internalDate
            : new Date(message.internalDate ?? Date.now());

        messages.push({
          id: message.envelope?.messageId ?? `uid:${message.uid}`,
          fromName: from?.name ?? null,
          fromAddress: from?.address ?? null,
          subject: parsed.subject ?? message.envelope?.subject ?? null,
          textBody: parsed.text?.trim() ?? null,
          htmlBody: parsed.html ? String(parsed.html) : null,
          receivedAt: receivedAt.toISOString(),
        });
      }
    }

    messages.sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );

    await dbClient.regEmail.update({
      where: { id: mailbox.id },
      data: { lastInboxSyncAt: new Date() },
    });

    return messages.slice(0, limit);
  } finally {
    await client.logout().catch(() => undefined);
  }
};

/** Проверка входа в ящик: для онбординга и кнопки «проверить почту» */
export const testMailboxLogin = async (emailId: string) => {
  const mailbox = await dbClient.regEmail.findUniqueOrThrow({
    where: { id: emailId },
    include: { proxy: true },
  });

  const client = await openClient(mailbox);
  const startedAt = Date.now();

  try {
    await client.connect();
    const lock = await client.mailboxOpen("INBOX");

    return {
      ok: true as const,
      messages: lock.exists ?? 0,
      latencyMs: Date.now() - startedAt,
      viaProxy: Boolean(mailbox.proxy),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
      viaProxy: Boolean(mailbox.proxy),
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
};
