import apiInstance from "../instance";

// Регистрация: настройки, прокси для почт, почты, транки с номерами
// и результат — попытки (аккаунты). Всё живёт на бэкенде под /farm/registration

const BASE = "/farm/registration";

export type FarmResourceStatus =
  | "free"
  | "reserved"
  | "used"
  | "blocked"
  | "cooldown"
  | "used_no_call"
  | "no_call"
  | "paused";

export type FarmProxyStatus = "unchecked" | "active" | "dead";

export type FarmAccountStatus = "in_progress" | "registered" | "failed";

export type FarmFailureReason =
  | "already_registered"
  | "no_call"
  | "other_error"
  | "invalid_sip_code"
  | "wrong_email"
  | "banned"
  | "flood"
  | "no_email_code"
  | "stuck"
  | "canceled";

export type FarmLockStage =
  | "reserving"
  | "in_progress"
  | "waiting_email_code"
  | "waiting_transcription"
  | "call_streaming"
  | "has_transcription";

export type FarmSipCallStatus =
  | "waiting"
  | "streaming"
  | "ended"
  | "failed"
  | "rejected";

export interface FarmPaginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FarmListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

// Невалидная строка импорта: сама строка и почему не подошла
export interface FarmInvalidRow {
  row: string;
  reason: string;
}

// ─── Настройки ────────────────────────────────────────────────────────────

export interface FarmSettings {
  // Ключ наружу не отдаётся — только признак и последние 4 символа
  speechkitConfigured: boolean;
  speechkitKeyHint: string | null;
  imapHost: string;
  imapPort: number;
  sipDomain: string;
  sipAuthDomain: string;
  sipOutboundProxy: string;
  sipIdentifyHost: string;
}

export interface FarmSettingsForm {
  // Строка — заменить, null — стереть, не передан — не трогать
  speechkitApiKey?: string | null;
  imapHost?: string;
  imapPort?: number;
  sipDomain?: string;
  sipAuthDomain?: string;
  sipOutboundProxy?: string;
  sipIdentifyHost?: string;
}

export type FarmSpeechkitTestResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Обзор ────────────────────────────────────────────────────────────────

export interface FarmAsteriskStatus {
  configFetchedAt: string | null;
  // Asterisk забрал текущую версию транков — изменения применены
  configInSync: boolean;
  lastCallAt: string | null;
  enabledTrunks: number;
}

export interface FarmStep {
  key: "settings" | "proxies" | "emails" | "trunks" | "accounts";
  title: string;
  done: boolean;
  hint: string;
}

export interface FarmOverview {
  settings: FarmSettings;
  proxies: { total: number } & Partial<Record<FarmProxyStatus, number>>;
  emails: {
    total: number;
    withoutProxy: number;
    byStatus: Partial<Record<FarmResourceStatus, number>>;
  };
  trunks: {
    total: number;
    enabled: number;
    phones: {
      total: number;
      byStatus: Partial<Record<FarmResourceStatus, number>>;
    };
  };
  accounts: {
    byStatus: Partial<Record<FarmAccountStatus, number>>;
    today: Partial<Record<FarmAccountStatus, number>>;
    failureReasons: Partial<Record<FarmFailureReason | "unknown", number>>;
    daily: { day: string; registered: number; failed: number }[];
  };
  asterisk: FarmAsteriskStatus;
  availability: { available: boolean };
  steps: FarmStep[];
  // Для старта достаточно первых четырёх шагов
  ready: boolean;
}

// ─── Прокси ───────────────────────────────────────────────────────────────

export interface FarmProxy {
  id: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  label: string | null;
  status: FarmProxyStatus;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  emailsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FarmProxyImportResult {
  created: number;
  duplicates: number;
  invalid: FarmInvalidRow[];
}

// ─── Почты ────────────────────────────────────────────────────────────────

export interface FarmEmail {
  id: string;
  email: string;
  status: FarmResourceStatus;
  notes: string | null;
  proxyId: string | null;
  proxy: {
    id: string;
    host: string;
    port: number;
    status: FarmProxyStatus;
  } | null;
  lastInboxSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmEmailListParams extends FarmListParams {
  // none — без прокси, any — с любым прокси
  proxy?: "none" | "any";
}

export interface FarmEmailImportResult extends FarmProxyImportResult {
  proxiesAssigned: number;
}

export interface FarmEmailDeleteBulkResult {
  deleted: number;
  // Использованные в реге удалить нельзя — только заблокировать
  inUse: string[];
  notFound: string[];
}

export type FarmMailboxTestResult =
  | { ok: true; messages: number; latencyMs: number; viaProxy: boolean }
  | { ok: false; error: string; viaProxy: boolean };

export interface FarmInboxMessage {
  id: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string;
  preview: string;
}

// ─── Транки ───────────────────────────────────────────────────────────────

export interface FarmTrunkLock {
  locked: boolean;
  accountId: string | null;
  ttlSeconds: number | null;
  // Нет аккаунта при активном локе — рега только начинается
  account: { id: string; phone: string | null; stage: FarmLockStage } | null;
}

export interface FarmTrunk {
  id: string;
  name: string;
  enabled: boolean;
  notes: string | null;
  // Свой outbound proxy транка; null — общий из «SIP-провайдера»
  outboundProxy: string | null;
  sipPasswordSet: boolean;
  phonesCount: number;
  accountsCount: number;
  phoneStatusCounts: Partial<Record<FarmResourceStatus, number>>;
  lock: FarmTrunkLock;
  createdAt: string;
  updatedAt: string;
}

export interface FarmTrunkForm {
  name?: string;
  sipPassword?: string;
  notes?: string | null;
  // null — стереть (брать общий из «SIP-провайдера»)
  outboundProxy?: string | null;
  enabled?: boolean;
}

export interface FarmAsteriskPreview extends FarmAsteriskStatus {
  // Кусок pjsip.conf, который забирает Asterisk (пароли скрыты)
  preview: string;
}

export interface FarmTrunkPhone {
  id: string;
  phone: string;
  status: FarmResourceStatus;
  pausedUntil: string | null;
  notes: string | null;
  trunkId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FarmPhonesImportResult {
  created: number;
  invalid: FarmInvalidRow[];
}

export interface FarmMarkInvalidBulkResult {
  invalidated: string[];
  notFound: string[];
  invalid: FarmInvalidRow[];
}

// ─── Аккаунты ─────────────────────────────────────────────────────────────

export interface FarmAccountListParams extends FarmListParams {
  failureReason?: string;
  period?: "today" | "7d" | "30d";
}

export interface FarmAccount {
  id: string;
  status: FarmAccountStatus;
  failureReason: FarmFailureReason | null;
  firstName: string;
  lastName: string;
  username: string;
  birthDate: string;
  externalAgentId: string | null;
  accountCreatedAt: string | null;
  phone: string | null;
  notes: string | null;
  emailId: string;
  trunkId: string | null;
  trunkPhoneId: string | null;
  email: { email: string };
  trunk: { name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmSipTranscript {
  id: string;
  callId: string;
  sequence: number;
  text: string;
  final: boolean;
  createdAt: string;
}

export interface FarmSipCall {
  id: string;
  uuid: string;
  caller: string;
  did: string;
  status: FarmSipCallStatus;
  rejectReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  trunkId: string | null;
  accountId: string | null;
  transcripts: FarmSipTranscript[];
  createdAt: string;
}

export interface FarmAccountEvent {
  id: string;
  accountId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

export interface FarmAccountDetail extends Omit<FarmAccount, "email" | "trunk"> {
  email: { id: string; email: string; status: FarmResourceStatus };
  trunk: { id: string; name: string } | null;
  sipCalls: FarmSipCall[];
  events: FarmAccountEvent[];
}

export const FarmService = {
  getOverview: async () => {
    const { data } = await apiInstance.get<FarmOverview>(`${BASE}/overview`);
    return data;
  },

  // Настройки
  getSettings: async () => {
    const { data } = await apiInstance.get<FarmSettings>(`${BASE}/settings`);
    return data;
  },
  updateSettings: async (form: FarmSettingsForm) => {
    const { data } = await apiInstance.patch<FarmSettings>(
      `${BASE}/settings`,
      form
    );
    return data;
  },
  // Без ключа проверяется уже сохранённый
  testSpeechkit: async (speechkitApiKey?: string) => {
    const { data } = await apiInstance.post<FarmSpeechkitTestResult>(
      `${BASE}/settings/test-speechkit`,
      speechkitApiKey ? { speechkitApiKey } : {}
    );
    return data;
  },

  // Прокси
  getProxies: async (params: FarmListParams) => {
    const { data } = await apiInstance.get<FarmPaginated<FarmProxy>>(
      `${BASE}/proxies`,
      { params }
    );
    return data;
  },
  importProxies: async (text: string) => {
    const { data } = await apiInstance.post<FarmProxyImportResult>(
      `${BASE}/proxies/import`,
      { text }
    );
    return data;
  },
  updateProxy: async (
    id: string,
    form: Partial<Pick<FarmProxy, "host" | "port" | "username" | "password" | "label">>
  ) => {
    const { data } = await apiInstance.patch<FarmProxy>(
      `${BASE}/proxies/${id}`,
      form
    );
    return data;
  },
  deleteProxy: async (id: string) => {
    const { data } = await apiInstance.delete(`${BASE}/proxies/${id}`);
    return data;
  },
  checkProxy: async (id: string) => {
    const { data } = await apiInstance.post<FarmProxy>(
      `${BASE}/proxies/${id}/check`
    );
    return data;
  },
  checkAllProxies: async () => {
    const { data } = await apiInstance.post<{
      checked: number;
      active: number;
      dead: number;
    }>(`${BASE}/proxies/check-all`);
    return data;
  },
  assignProxiesToEmails: async (reassignAll: boolean) => {
    const { data } = await apiInstance.post<{
      assigned: number;
      proxies: number;
    }>(`${BASE}/proxies/assign-emails`, { reassignAll });
    return data;
  },
  deleteDeadProxies: async () => {
    const { data } = await apiInstance.post<{ deleted: number }>(
      `${BASE}/proxies/delete-dead`
    );
    return data;
  },

  // Почты
  getEmails: async (params: FarmEmailListParams) => {
    const { data } = await apiInstance.get<FarmPaginated<FarmEmail>>(
      `${BASE}/emails`,
      { params }
    );
    return data;
  },
  importEmails: async (text: string) => {
    const { data } = await apiInstance.post<FarmEmailImportResult>(
      `${BASE}/emails/import`,
      { text }
    );
    return data;
  },
  updateEmail: async (
    id: string,
    form: {
      password?: string;
      status?: FarmResourceStatus;
      notes?: string | null;
      proxyId?: string | null;
    }
  ) => {
    const { data } = await apiInstance.patch<FarmEmail>(
      `${BASE}/emails/${id}`,
      form
    );
    return data;
  },
  deleteEmail: async (id: string) => {
    const { data } = await apiInstance.delete(`${BASE}/emails/${id}`);
    return data;
  },
  deleteEmailsBulk: async (text: string) => {
    const { data } = await apiInstance.post<FarmEmailDeleteBulkResult>(
      `${BASE}/emails/delete-bulk`,
      { text }
    );
    return data;
  },
  testEmail: async (id: string) => {
    const { data } = await apiInstance.post<FarmMailboxTestResult>(
      `${BASE}/emails/${id}/test`
    );
    return data;
  },
  getEmailMessages: async (id: string) => {
    const { data } = await apiInstance.get<FarmInboxMessage[]>(
      `${BASE}/emails/${id}/messages`
    );
    return data;
  },

  // Транки
  getTrunks: async () => {
    const { data } = await apiInstance.get<{
      items: FarmTrunk[];
      asterisk: FarmAsteriskStatus;
    }>(`${BASE}/trunks`);
    return data;
  },
  getAsterisk: async () => {
    const { data } = await apiInstance.get<FarmAsteriskPreview>(
      `${BASE}/trunks/asterisk`
    );
    return data;
  },
  createTrunk: async (form: FarmTrunkForm) => {
    const { data } = await apiInstance.post(`${BASE}/trunks`, form);
    return data;
  },
  updateTrunk: async (id: string, form: FarmTrunkForm) => {
    const { data } = await apiInstance.patch(`${BASE}/trunks/${id}`, form);
    return data;
  },
  deleteTrunk: async (id: string) => {
    const { data } = await apiInstance.delete(`${BASE}/trunks/${id}`);
    return data;
  },
  getTrunkPhones: async (id: string, params: FarmListParams) => {
    const { data } = await apiInstance.get<FarmPaginated<FarmTrunkPhone>>(
      `${BASE}/trunks/${id}/phones`,
      { params }
    );
    return data;
  },
  importTrunkPhones: async (id: string, text: string) => {
    const { data } = await apiInstance.post<FarmPhonesImportResult>(
      `${BASE}/trunks/${id}/import`,
      { text }
    );
    return data;
  },
  deleteTrunkPhone: async (phoneId: string) => {
    const { data } = await apiInstance.delete(
      `${BASE}/trunks/phones/${phoneId}`
    );
    return data;
  },
  restoreTrunkPhone: async (phoneId: string) => {
    const { data } = await apiInstance.post(
      `${BASE}/trunks/phones/${phoneId}/restore`
    );
    return data;
  },
  markTrunkPhoneInvalid: async (phoneId: string) => {
    const { data } = await apiInstance.post(
      `${BASE}/trunks/phones/${phoneId}/mark-invalid`
    );
    return data;
  },
  restoreNoCallPhones: async () => {
    const { data } = await apiInstance.post<{ restored: number }>(
      `${BASE}/trunks/restore-no-call`
    );
    return data;
  },
  markPhonesInvalidBulk: async (text: string) => {
    const { data } = await apiInstance.post<FarmMarkInvalidBulkResult>(
      `${BASE}/trunks/mark-invalid-bulk`,
      { text }
    );
    return data;
  },

  // Аккаунты
  getAccounts: async (params: FarmAccountListParams) => {
    const { data } = await apiInstance.get<FarmPaginated<FarmAccount>>(
      `${BASE}/accounts`,
      { params }
    );
    return data;
  },
  // CSV отдаётся файлом — забираем как blob и сохраняем на стороне браузера
  exportAccounts: async (params: FarmAccountListParams) => {
    const { data } = await apiInstance.get<Blob>(`${BASE}/accounts/export.csv`, {
      params,
      responseType: "blob",
    });
    return data;
  },
  getAccount: async (id: string) => {
    const { data } = await apiInstance.get<FarmAccountDetail>(
      `${BASE}/accounts/${id}`
    );
    return data;
  },
};
