import { Stack } from "@mantine/core";

import { TrunksPanel } from "../components/Farm/TrunksPanel";
import { PageHeader } from "../components/ui/wa";

export function TrunksPage() {
  return (
    <Stack gap={28}>
      <PageHeader
        title="Транки"
        subtitle="SIP-транки провайдера и их номера. Asterisk забирает транки автоматически в течение 30 секунд, номера уходят в регистрацию по кругу"
      />

      {/* Карточки SIP-провайдера и Asterisk рисует сама панель транков */}
      <TrunksPanel />
    </Stack>
  );
}
