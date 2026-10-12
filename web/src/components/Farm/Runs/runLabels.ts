import type { RunPhoneStatus, RunStatus } from "../../../api/services/runs.service";

// Подписи запусков регистрации и телефонов в них

interface Label {
  title: string;
  color: string;
}

export const RUN_STATUS: Record<RunStatus, Label> = {
  queued: { title: "В очереди", color: "gray" },
  running: { title: "Идёт", color: "purple" },
  canceling: { title: "Останавливается", color: "yellow" },
  done: { title: "Готово", color: "green" },
  done_with_errors: { title: "Готово с ошибками", color: "orange" },
  canceled: { title: "Остановлен", color: "gray" },
  interrupted: { title: "Прерван", color: "red" },
};

export const runStatus = (status: string): Label =>
  RUN_STATUS[status as RunStatus] ?? { title: status, color: "gray" };

// Запуск ещё можно остановить
export const isRunActive = (status: string) =>
  status === "queued" || status === "running";

export const RUN_PHONE_STATUS: Record<RunPhoneStatus, Label> = {
  pending: { title: "Ждёт", color: "gray" },
  running: { title: "Идёт", color: "purple" },
  ok: { title: "Зарегистрирован", color: "green" },
  failed: { title: "Ошибка", color: "red" },
  skipped: { title: "Пропущен", color: "gray" },
};

export const runPhoneStatus = (status: string): Label =>
  RUN_PHONE_STATUS[status as RunPhoneStatus] ?? { title: status, color: "gray" };

// Шаг сценария: ok — зелёный, failed — красный, остальное (идёт, пропущен) — серый
export const stepColor = (status: string) =>
  status === "ok" ? "green" : status === "failed" ? "red" : status === "running" ? "purple" : "gray";

export const stepStatusTitle = (status: string) =>
  ({
    ok: "ок",
    failed: "ошибка",
    running: "идёт",
    skipped: "пропущен",
  })[status] ?? status;

// Длительность «2 мин 05 с» между двумя отметками; без конца — до сейчас
export const formatDuration = (from: string | null, to: string | null) => {
  if (!from) return null;

  const seconds = Math.max(
    0,
    Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours) return `${hours} ч ${String(minutes).padStart(2, "0")} мин`;
  if (minutes) return `${minutes} мин ${String(rest).padStart(2, "0")} с`;
  return `${rest} с`;
};
