import { useEffect } from "react";
import { Stack } from "@mantine/core";
import { useLocation } from "react-router-dom";

import { FarmIntegrationsSettings } from "../components/Settings/FarmIntegrationsSettings";
import { SpeechkitSettings } from "../components/Settings/SpeechkitSettings";
import { AfterRegistrationSettings } from "../components/Settings/AfterRegistrationSettings";
import { NamesSettings } from "../components/Settings/NamesSettings";
import { AuthSettings } from "../components/Settings/AuthSettings";
import { PageTitle } from "../components/ui/wa";

export function SettingsPage() {
  const { hash } = useLocation();

  // /settings#auth — из плашки «пароль по умолчанию» сразу к смене пароля
  useEffect(() => {
    if (!hash) return;

    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);

  return (
    <Stack gap={28} maw={1200}>
      <PageTitle>Настройки</PageTitle>

      {/* Ключи сервисов: GeeLark и Proxyma */}
      <FarmIntegrationsSettings />

      <SpeechkitSettings />

      <AfterRegistrationSettings />

      <NamesSettings />

      <div id="auth" style={{ scrollMarginTop: 80 }}>
        <AuthSettings />
      </div>
    </Stack>
  );
}
