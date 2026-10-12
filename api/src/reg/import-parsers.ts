// Разбор вставленных списков: прокси, почты, номера.
// Невалидные строки возвращаем с причиной — их показываем после импорта

export type ImportRowResult<T> = {
  valid: T[];
  invalid: Array<{ row: string; reason: string }>;
};

export const splitRows = (input: string) =>
  input
    .split(/\r?\n/g)
    .map((row) => row.trim())
    .filter(Boolean);

type ProxyRow = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

/** host:port или host:port:user:pass, допускается префикс socks5:// и user:pass@host:port */
export const parseProxyRows = (input: string): ImportRowResult<ProxyRow> => {
  const valid: ProxyRow[] = [];
  const invalid: ImportRowResult<never>["invalid"] = [];

  for (const row of splitRows(input)) {
    const cleaned = row.replace(/^socks5h?:\/\//i, "");
    let host: string | undefined;
    let portRaw: string | undefined;
    let username: string | undefined;
    let password: string | undefined;

    if (cleaned.includes("@")) {
      const [auth, address] = cleaned.split("@");
      [username, password] = auth.split(":");
      [host, portRaw] = address.split(":");
    } else {
      const parts = cleaned.split(":");

      if (parts.length !== 2 && parts.length !== 4) {
        invalid.push({ row, reason: "Неверный формат" });
        continue;
      }

      [host, portRaw, username, password] = parts;
    }

    const port = Number(portRaw);

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      invalid.push({ row, reason: "Неверный host или port" });
      continue;
    }

    valid.push({
      host,
      port,
      username: username || undefined,
      password: password || undefined,
    });
  }

  return { valid, invalid };
};

/** email:password или email;password */
export const parseEmailRows = (
  input: string,
): ImportRowResult<{ email: string; password: string }> => {
  const valid: Array<{ email: string; password: string }> = [];
  const invalid: ImportRowResult<never>["invalid"] = [];
  const seen = new Set<string>();

  for (const row of splitRows(input)) {
    const separator = row.includes(";") ? ";" : ":";
    const index = row.indexOf(separator);
    const email = index > 0 ? row.slice(0, index).trim().toLowerCase() : "";
    const password = index > 0 ? row.slice(index + 1).trim() : "";

    if (!email || !password || !email.includes("@")) {
      invalid.push({ row, reason: "Неверный формат" });
      continue;
    }

    if (seen.has(email)) {
      invalid.push({ row, reason: "Дубликат в списке" });
      continue;
    }

    seen.add(email);
    valid.push({ email, password });
  }

  return { valid, invalid };
};

/** Номера РФ в формате 7XXXXXXXXXX: 8… и 9… приводим к 7… */
export const normalizeRuPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10 && digits.startsWith("9")) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;

  return digits;
};

export const parsePhoneRows = (input: string): ImportRowResult<{ phone: string }> => {
  const valid: Array<{ phone: string }> = [];
  const invalid: ImportRowResult<never>["invalid"] = [];
  const seen = new Set<string>();

  for (const row of splitRows(input)) {
    const phone = normalizeRuPhone(row);

    if (phone.length !== 11 || !phone.startsWith("7")) {
      invalid.push({ row, reason: "Неверный формат номера" });
      continue;
    }

    if (seen.has(phone)) {
      invalid.push({ row, reason: "Дубликат в списке" });
      continue;
    }

    seen.add(phone);
    valid.push({ phone });
  }

  return { valid, invalid };
};
