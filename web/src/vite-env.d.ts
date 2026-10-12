/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес API, если фронт и API на разных доменах. Пусто — тот же домен */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
