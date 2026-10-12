import { getFarmSettings } from "./proxyma.js";

// Тонкий клиент к открытому API GeeLark (облачные телефоны).
// Авторизация — обычный bearer, подписи запросов нет

export class GeelarkError extends Error {
  constructor(
    readonly code: number | string,
    message: string,
  ) {
    super(`GeeLark ${code}: ${message}`);
  }
}

const ADD_NEW_TIMEOUT_MS = 180_000;

// В настройках адрес может лежать и с /open/v1 на конце, и без него
const apiRoot = (baseUrl: string) => baseUrl.replace(/\/+$/, "").replace(/\/open\/v1$/, "");

const post = async <T>(path: string, payload: unknown, timeoutMs = 60_000): Promise<T> => {
  const settings = await getFarmSettings();

  if (!settings.geelarkApiKey) {
    throw new GeelarkError(-1, "Ключ GeeLark не задан в настройках");
  }

  const response = await fetch(`${apiRoot(settings.geelarkBaseUrl)}/open/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.geelarkApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new GeelarkError(response.status, "запрос отклонён");

  const body = (await response.json()) as { code?: number; msg?: string; data?: T };

  if (body.code !== 0) throw new GeelarkError(body.code ?? -1, body.msg ?? "неизвестная ошибка");

  return body.data as T;
};

export type GeelarkBrand = {
  surfaceBrandName?: string;
  surfaceModelName?: string;
};

/** Железо, доступное для этой версии Android — чтобы телефоны не были близнецами */
export const brandList = async (androidVer: number) => {
  const data = await post<GeelarkBrand[] | { items?: GeelarkBrand[] }>(
    "/phone/brand/list",
    { androidVer },
  );

  return Array.isArray(data) ? data : (data.items ?? []);
};

export type GeelarkAddNewDetail = {
  index?: number;
  code?: number;
  msg?: string;
  id?: string;
  profileName?: string;
  envSerialNo?: string;
  equipmentInfo?: {
    countryName?: string;
    timeZone?: string;
    deviceBrand?: string;
    deviceModel?: string;
    imei?: string;
    phoneNumber?: string;
  };
};

export type GeelarkPhoneRow = {
  profileName: string;
  proxyInformation: string;
  mobileLanguage: string;
  netType: number;
  surfaceBrandName?: string;
  surfaceModelName?: string;
};

export const phoneAddNew = (mobileType: string, rows: GeelarkPhoneRow[]) =>
  post<{ details?: GeelarkAddNewDetail[] }>(
    "/phone/addNew",
    { mobileType, chargeMode: 0, data: rows },
    ADD_NEW_TIMEOUT_MS,
  );

/** Питание телефонов: 0 запущен, 1 запускается, 2 выключен, 3 просрочен */
export const phoneStatus = (ids: string[]) =>
  post<{
    successDetails?: { id: string; status: number }[];
  }>("/phone/status", { ids });

/** Удалить профили в GeeLark: за них капает оплата, пока они существуют */
export const phoneDelete = (ids: string[]) =>
  post<unknown>("/phone/delete", { ids });

/** Строка прокси в том виде, в каком её ждёт addNew */
export const buildProxyInformation = (proxy: {
  proxyHost: string;
  proxyPort: number;
  proxyType: string;
  proxyUser?: string | null;
  proxyPassword?: string | null;
}) => {
  const scheme = (proxy.proxyType || "socks5").toLowerCase();
  const auth = proxy.proxyUser
    ? `${proxy.proxyUser}${proxy.proxyPassword ? `:${proxy.proxyPassword}` : ""}@`
    : "";

  return `${scheme}://${auth}${proxy.proxyHost}:${proxy.proxyPort}`;
};

export type GeelarkProxyEntry = {
  id: string;
  scheme?: string;
  server?: string;
  port?: number | string;
  username?: string;
  password?: string;
};

/** Реестр прокси GeeLark: на его записи ссылаются профили телефонов */
export const proxyList = (page: number, pageSize = 100) =>
  post<{ list?: GeelarkProxyEntry[]; total?: number }>("/proxy/list", { page, pageSize });

/** Найти запись прокси по адресу и логину; листаем реестр постранично */
export const findProxyEntry = async (server: string, port: number, username?: string | null) => {
  for (let page = 1; page <= 40; page += 1) {
    const { list = [] } = await proxyList(page);

    const found = list.find(
      (item) =>
        item.server === server &&
        Number(item.port) === Number(port) &&
        (!username || (item.username ?? "") === username),
    );

    if (found) return found;
    if (list.length < 100) break;
  }

  return null;
};

/**
 * Поменять запись прокси. GeeLark отвечает 200 и тогда, когда правка не
 * применилась (failAmount > 0) — такой ответ считаем ошибкой
 */
export const proxyUpdate = async (item: {
  id: string;
  scheme: string;
  server: string;
  port: number;
  username: string;
  password: string;
}) => {
  const data = await post<{
    failAmount?: number;
    failDetails?: { code?: number; msg?: string }[];
  }>("/proxy/update", { list: [item] });

  if (Number(data?.failAmount ?? 0) > 0) {
    const detail = data.failDetails?.[0];
    throw new GeelarkError(detail?.code ?? -1, `прокси не обновлён: ${detail?.msg ?? "без причины"}`);
  }

  return data;
};

/** Включить и выключить телефоны (воркер делает это сам, здесь — на всякий) */
export const phoneStop = (ids: string[]) => post<unknown>("/phone/stop", { ids });
