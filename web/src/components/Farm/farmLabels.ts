import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ru";

import type {
  FarmAccountStatus,
  FarmFailureReason,
  FarmLockStage,
  FarmProxyStatus,
  FarmResourceStatus,
  FarmSipCallStatus,
} from "../../api/services/farm.service";

export { errorMessage } from "../../helpers/errors";

dayjs.extend(relativeTime);

// Подписи статусов регистрации. У номеров и почт один набор статусов,
// но разный род: «Свободен» номер, «Свободна» почта

interface Label {
  title: string;
  color: string;
}

const RESOURCE_STATUS: Record<
  FarmResourceStatus,
  { phone: string; email: string; color: string }
> = {
  free: { phone: "Свободен", email: "Свободна", color: "green" },
  reserved: { phone: "В реге", email: "В реге", color: "blue" },
  used: { phone: "Использован", email: "Использована", color: "gray" },
  blocked: { phone: "Заблокирован", email: "Заблокирована", color: "red" },
  cooldown: { phone: "Отдыхает", email: "Отдыхает", color: "yellow" },
  used_no_call: { phone: "Без звонка", email: "Без звонка", color: "orange" },
  no_call: { phone: "Без звонка", email: "Без звонка", color: "orange" },
  paused: { phone: "Пауза", email: "Пауза", color: "gray" },
};

export const RESOURCE_STATUSES = Object.keys(
  RESOURCE_STATUS
) as FarmResourceStatus[];

export const resourceStatus = (
  status: string,
  kind: "phone" | "email"
): Label => {
  const found = RESOURCE_STATUS[status as FarmResourceStatus];

  return found
    ? { title: found[kind], color: found.color }
    : { title: status, color: "gray" };
};

// Для Select: у used_no_call и no_call одинаковая подпись, уточняем
export const resourceStatusOptions = (kind: "phone" | "email") =>
  RESOURCE_STATUSES.map((status) => ({
    value: status,
    label:
      status === "used_no_call"
        ? `${RESOURCE_STATUS[status][kind]} (использован${kind === "email" ? "а" : ""})`
        : RESOURCE_STATUS[status][kind],
  }));

export const PROXY_STATUS: Record<FarmProxyStatus, Label> = {
  unchecked: { title: "Не проверен", color: "gray" },
  active: { title: "Живой", color: "green" },
  dead: { title: "Мёртвый", color: "red" },
};

export const ACCOUNT_STATUS: Record<FarmAccountStatus, Label> = {
  in_progress: { title: "В процессе", color: "blue" },
  registered: { title: "Зарегистрирован", color: "green" },
  failed: { title: "Сорван", color: "red" },
};

export const FAILURE_REASON: Record<FarmFailureReason, string> = {
  already_registered: "Номер уже зарегистрирован",
  no_call: "Нет звонка",
  other_error: "Ошибка",
  invalid_sip_code: "Не распознан код",
  wrong_email: "Почта не подошла",
  banned: "Номер в бане",
  flood: "Флуд — пауза",
  no_email_code: "Не пришёл код на почту",
  stuck: "Завис экран",
  canceled: "Отменено",
};

export const failureReasonTitle = (reason: string | null | undefined) =>
  reason
    ? (FAILURE_REASON[reason as FarmFailureReason] ?? reason)
    : "Не указана";

export const LOCK_STAGE: Record<FarmLockStage, string> = {
  reserving: "Начало",
  in_progress: "Начало",
  waiting_email_code: "Ждёт код с почты",
  waiting_transcription: "Звонок, ждём расшифровку",
  call_streaming: "Идёт звонок",
  has_transcription: "Код получен",
};

export const SIP_CALL_STATUS: Record<FarmSipCallStatus, Label> = {
  waiting: { title: "Ждёт", color: "gray" },
  streaming: { title: "Идёт звонок", color: "blue" },
  ended: { title: "Завершён", color: "green" },
  failed: { title: "Ошибка", color: "red" },
  rejected: { title: "Отклонён", color: "orange" },
};

export const SIP_REJECT_REASON: Record<string, string> = {
  trunk_not_found: "Транк не найден",
  trunk_lock_expired: "Лок транка истёк",
  active_account_not_found: "Нет активной реги на транке",
};

// События аккаунта из журнала реги
export const ACCOUNT_EVENT: Record<string, string> = {
  assigned: "Выданы номер и почта",
  call_accepted: "Принят звонок",
  email_code_no_call: "Код с почты получен, звонка нет",
  no_call: "Звонка не было",
  invalid_sip_code: "Код из звонка не распознан",
  wrong_email: "Неверная почта",
  number_invalidated: "Номер заблокирован",
  released: "Номер и почта освобождены",
  completed: "Регистрация завершена",
};

// ─── Форматирование ───────────────────────────────────────────────────────

export const formatDateTime = (value: string | Date | null | undefined) =>
  value ? dayjs(value).format("DD.MM.YY HH:mm") : "—";

export const fromNow = (value: string | Date | null | undefined) =>
  value ? dayjs(value).locale("ru").fromNow() : "никогда";

// Сохранить blob как файл
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

// Строк во вставленном списке — показываем под полем ввода
export const countRows = (text: string) =>
  text.split(/\r?\n/).filter((row) => row.trim()).length;
