import apiInstance from "../instance";

// Запуски регистрации: воркер поднимает телефоны без аккаунта пачками
// по concurrency и регистрирует на каждом Telegram. Один телефон — один аккаунт

export type RunStatus =
  | "queued"
  | "running"
  | "canceling"
  | "done"
  | "done_with_errors"
  | "canceled"
  | "interrupted";

export type RunPhoneStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface RunStep {
  name: string;
  status: string;
  detail: string;
  at: string;
}

export interface RunPhone {
  id: string;
  phoneId: string;
  profileName: string;
  status: RunPhoneStatus;
  error: string | null;
  lastStep: string | null;
  account: { phone: string; username: string | null } | null;
  startedAt: string | null;
  finishedAt: string | null;
  steps: RunStep[];
}

export interface Run {
  id: string;
  status: RunStatus;
  groupName: string | null;
  concurrency: number;
  errorsPerPhone: number;
  total: number;
  done: number;
  ok: number;
  failed: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  phones: RunPhone[];
}

export interface RunStartForm {
  // null — все группы
  groupId: string | null;
  concurrency: number;
  errorsPerPhone: number;
}

export const RunsService = {
  getRuns: async () =>
    (await apiInstance.get<{ items: Run[] }>("/runs")).data,

  start: async (form: RunStartForm) =>
    (await apiInstance.post<Run>("/runs", form)).data,

  cancel: async (id: string) =>
    (await apiInstance.post(`/runs/${id}/cancel`)).data,
};
