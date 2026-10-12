import { Stack } from "@mantine/core";

import { PhonesPanel } from "../components/Farm/Accounts/PhonesPanel";
import { PageHeader } from "../components/ui/wa";

export function PhonesPage() {
  return (
    <Stack gap={28}>
      <PageHeader
        title="Телефоны"
        subtitle="Облачные телефоны GeeLark и Telegram-аккаунты на них: группы, прокси, история. Один телефон — один аккаунт"
      />

      <PhonesPanel />
    </Stack>
  );
}
