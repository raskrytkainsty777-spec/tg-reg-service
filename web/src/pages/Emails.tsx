import { Stack } from "@mantine/core";

import { EmailsPanel } from "../components/Farm/EmailsPanel";
import { ImapSettingsCard } from "../components/Farm/ImapSettingsCard";
import { PageHeader } from "../components/ui/wa";

export function EmailsPage() {
  return (
    <Stack gap={28}>
      <PageHeader
        title="Почты"
        subtitle="Пул почт для регистрации. Формат импорта: email:пароль, по одной на строку — новым почтам сразу раздаются живые прокси"
      />

      <ImapSettingsCard />

      <EmailsPanel />
    </Stack>
  );
}
