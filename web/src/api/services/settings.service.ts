import apiInstance from "../instance";

// Что делать с аккаунтом сразу после регистрации: настройки Telegram,
// подписки на каналы и из каких имён собирать профиль

export type NameGender = "female" | "male" | "mixed";

export interface RegistrationSettings {
  // Каналы для подписки — голые username без @
  channels: string[];
  // Сколько каналов из списка открыть новому аккаунту; 0 — не подписываться
  subscribeCount: number;
  // Выключить автозагрузку медиа и экономию трафика
  disableMedia: boolean;
  // Выключить энергосбережение
  disablePowerSaving: boolean;
  nameGender: NameGender;
  femaleFirstNames: string[];
  femaleLastNames: string[];
  maleFirstNames: string[];
  maleLastNames: string[];
}

export const SettingsService = {
  getRegistration: async () =>
    (await apiInstance.get<RegistrationSettings>("/settings/registration")).data,

  // Шлём только изменённые поля
  updateRegistration: async (form: Partial<RegistrationSettings>) =>
    (
      await apiInstance.patch<RegistrationSettings>(
        "/settings/registration",
        form,
      )
    ).data,
};
