import { useState } from "react";

import {
  useGetFarmSettings,
  useUpdateFarmSettings,
} from "../../api/queries/farm.query";
import { SpeechkitKeyField } from "../Farm/SpeechkitKeyField";
import { errorMessage } from "../Farm/farmLabels";
import { notification } from "../Notification/Notification";
import { SPEECHKIT_HELP } from "./help";
import { SaveButton, SettingsCard } from "./ui";

/** Ключ Yandex SpeechKit: распознаёт код из звонка Telegram */
export function SpeechkitSettings() {
  const { data: settings, isLoading } = useGetFarmSettings();
  const { mutateAsync: updateSettings, isPending } = useUpdateFarmSettings();
  const [speechkitKey, setSpeechkitKey] = useState("");

  const onSave = async () => {
    try {
      await updateSettings({ speechkitApiKey: speechkitKey.trim() });
      setSpeechkitKey("");
      notification.success({ message: "Ключ SpeechKit сохранён" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="Yandex SpeechKit"
      ok={!!settings?.speechkitConfigured}
      help={SPEECHKIT_HELP}
      loading={isLoading}
      actions={
        <SaveButton
          loading={isPending}
          // Пустое поле — сохранённый ключ не трогаем
          disabled={!speechkitKey.trim()}
          onClick={onSave}
        />
      }
    >
      <SpeechkitKeyField
        withTitle={false}
        value={speechkitKey}
        onChange={setSpeechkitKey}
        configured={!!settings?.speechkitConfigured}
        hint={settings?.speechkitKeyHint ?? null}
      />
    </SettingsCard>
  );
}
