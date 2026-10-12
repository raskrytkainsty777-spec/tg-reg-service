import apiInstance from "../instance";

// Телефоны GeeLark с привязанными Telegram-аккаунтами.
// Один телефон — один аккаунт, поэтому строка списка и есть телефон

const BASE = "/farm/accounts";

export type FarmAccountState =
  | "idle"
  | "working"
  | "temp_block"
  | "spam"
  | "frozen"
  | "logged_out"
  | "review"
  | "cold_blocked";

export type FarmPhoneProxyStatus = "unchecked" | "ok" | "dead";

export interface FarmPhoneProxy {
  host: string;
  port: number | null;
  type: string | null;
  status: FarmPhoneProxyStatus;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string | null;
  replacedAt: string | null;
}

export interface FarmPhoneAccount {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  status: FarmAccountState;
  statusReason: string | null;
  // До какого момента temp block (срок от @SpamBot)
  blockedUntil: string | null;
  tgPackage: string | null;
  isPremium: boolean;
  registeredAt: string | null;
  lastLaunchedAt: string | null;
  lastError: string | null;
}

export interface FarmPhone {
  id: string;
  profileName: string;
  geelarkId: string | null;
  countryCode: string | null;
  countryName: string | null;
  brand: string | null;
  model: string | null;
  androidVer: number | null;
  group: { id: string; name: string } | null;
  proxy: FarmPhoneProxy | null;
  account: FarmPhoneAccount | null;
}

export interface FarmGroupStat {
  phones: number;
  accounts: number;
}

export interface FarmGroup extends FarmGroupStat {
  id: string;
  name: string;
  color: string | null;
}

export interface FarmGroupsResponse {
  total: FarmGroupStat;
  ungrouped: FarmGroupStat;
  groups: FarmGroup[];
}

export interface FarmPhonesResponse {
  items: FarmPhone[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FarmPhoneEvent {
  id: string;
  kind: string;
  detail: string | null;
  hasScreenshot: boolean;
  createdAt: string;
}

export const FarmAccountsService = {
  getGroups: async () =>
    (await apiInstance.get<FarmGroupsResponse>(`${BASE}/groups`)).data,

  createGroup: async (payload: { name: string; color?: string | null }) =>
    (await apiInstance.post<FarmGroup>(`${BASE}/groups`, payload)).data,

  deleteGroup: async (id: string) =>
    (await apiInstance.delete(`${BASE}/groups/${id}`)).data,

  getPhones: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    groupId?: string;
    status?: string;
  }) => (await apiInstance.get<FarmPhonesResponse>(`${BASE}/phones`, { params })).data,

  createPhones: async (payload: {
    countries: Record<string, number>;
    androidVer?: number;
    groupId?: string | null;
  }) =>
    (
      await apiInstance.post<{
        created: number;
        failed: number;
        errors: { profileName: string; error: string }[];
        phones: string[];
      }>(`${BASE}/phones/create`, payload)
    ).data,

  checkProxiesBulk: async (ids: string[]) =>
    (
      await apiInstance.post<{ checked: number; ok: number; dead: number }>(
        `${BASE}/phones/proxy/check-bulk`,
        { ids },
      )
    ).data,

  deletePhones: async (payload: { ids: string[]; inGeelark?: boolean }) =>
    (
      await apiInstance.post<{ deleted: number; withAccount: number }>(
        `${BASE}/phones/delete`,
        payload,
      )
    ).data,

  movePhones: async (payload: { ids: string[]; groupId: string | null }) =>
    (await apiInstance.post<{ moved: number }>(`${BASE}/phones/move`, payload)).data,

  checkProxy: async (id: string) =>
    (await apiInstance.post<FarmPhoneProxy>(`${BASE}/phones/${id}/proxy/check`)).data,

  replaceProxy: async (id: string) =>
    (await apiInstance.post<FarmPhoneProxy>(`${BASE}/phones/${id}/proxy/replace`)).data,

  getEvents: async (id: string) =>
    (await apiInstance.get<FarmPhoneEvent[]>(`${BASE}/phones/${id}/events`)).data,

  getEventScreenshot: async (eventId: string) =>
    (
      await apiInstance.get<{ screenshot: string }>(
        `${BASE}/phones/events/${eventId}/screenshot`,
      )
    ).data,
};
