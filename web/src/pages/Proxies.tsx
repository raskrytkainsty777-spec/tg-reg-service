import { Stack } from "@mantine/core";

import { ProxiesPanel } from "../components/Farm/ProxiesPanel";
import { PageHeader } from "../components/ui/wa";

export function ProxiesPage() {
  return (
    <Stack gap={28}>
      <PageHeader
        title="Прокси"
        subtitle="SOCKS5 для чтения кодов с почт: почтовый сервис не блокирует ящики за массовые входы с одного адреса. Формат: host:port или host:port:логин:пароль"
      />

      <ProxiesPanel />
    </Stack>
  );
}
