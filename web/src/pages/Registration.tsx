import { SegmentedControl, Stack } from "@mantine/core";
import { useSearchParams } from "react-router-dom";

import { AccountsPanel } from "../components/Farm/AccountsPanel";
import { RunsPanel } from "../components/Farm/Runs/RunsPanel";
import { PageHeader } from "../components/ui/wa";

// Вкладки регистрации. Переключатель держим в адресе: ?tab=attempts
const TABS = [
  {
    value: "launch",
    label: "Запуск",
    hint: "Запуск регистрации на телефонах без аккаунта и ход запусков",
  },
  {
    value: "attempts",
    label: "Попытки",
    hint: "Попытки регистрации: что получилось, что сорвалось и по какой причине",
  },
] as const;

type RegistrationTab = (typeof TABS)[number]["value"];

export function RegistrationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: RegistrationTab = TABS.some((item) => item.value === raw)
    ? (raw as RegistrationTab)
    : "launch";
  const current = TABS.find((item) => item.value === tab)!;

  return (
    <Stack gap={28}>
      <PageHeader title="Регистрация" subtitle={current.hint} />

      <SegmentedControl
        style={{ alignSelf: "flex-start" }}
        value={tab}
        onChange={(value) => setSearchParams({ tab: value }, { replace: true })}
        data={TABS.map((item) => ({ value: item.value, label: item.label }))}
        styles={{ label: { fontWeight: 800, padding: "12px 26px" } }}
      />

      {tab === "launch" && <RunsPanel />}
      {tab === "attempts" && <AccountsPanel />}
    </Stack>
  );
}
