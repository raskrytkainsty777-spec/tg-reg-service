import type {
  FarmAccountState,
  FarmPhoneProxyStatus,
} from "../../../api/services/farmAccounts.service";

// Статусы аккаунта — те же, что были в ферме tg-walead: по ним операторы
// уже привыкли читать таблицу. «working» здесь — просто зарегистрирован:
// рассылок в сервисе регистрации нет
export const ACCOUNT_STATES: Record<
  FarmAccountState,
  { label: string; color: string }
> = {
  idle: { label: "Пустой", color: "gray" },
  working: { label: "Зарегистрирован", color: "green" },
  temp_block: { label: "temp block", color: "yellow" },
  spam: { label: "бан", color: "red" },
  frozen: { label: "заморожен", color: "dark" },
  logged_out: { label: "вылетел", color: "orange" },
  review: { label: "проверить", color: "blue" },
  // Остался от фермы рассылок: писать незнакомым Telegram запретил бессрочно
  cold_blocked: { label: "только ответы", color: "orange" },
};

export const accountState = (state: FarmAccountState) =>
  ACCOUNT_STATES[state] ?? ACCOUNT_STATES.idle;

// В фильтре — только статусы, которые бывают у сервиса регистрации
const FILTER_STATES: FarmAccountState[] = [
  "idle",
  "working",
  "temp_block",
  "spam",
  "frozen",
  "logged_out",
  "review",
];

export const accountStateOptions = [
  { value: "all", label: "Все статусы" },
  ...FILTER_STATES.map((value) => ({ value, label: ACCOUNT_STATES[value].label })),
];

export const PROXY_STATES: Record<
  FarmPhoneProxyStatus,
  { label: string; color: string }
> = {
  ok: { label: "живой", color: "green" },
  dead: { label: "мёртвый", color: "red" },
  unchecked: { label: "не проверен", color: "gray" },
};

// Флаг страны из кода: буквы кода → regional indicator symbols
export const countryFlag = (code: string | null) => {
  if (!code || code.length !== 2) return "";

  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((letter) => 127397 + letter.charCodeAt(0)),
  );
};

export const eventKindTitle = (kind: string) =>
  ({
    proxy_replaced: "Прокси заменён",
    review: "Снят в разбор",
    spam: "Улетел в спам",
    temp_block: "Temp block",
    error: "Ошибка",
  })[kind] ?? kind;
