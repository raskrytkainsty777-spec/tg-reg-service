import { useState } from "react";
import {
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
} from "@mantine/core";

import { useGetFarmGroups } from "../../../api/queries/farmAccounts.query";
import { useGetFarmTrunks } from "../../../api/queries/farm.query";
import { useStartRun } from "../../../api/queries/runs.query";
import { errorMessage } from "../farmLabels";
import { notification } from "../../Notification/Notification";
import { InfoBlock } from "../../ui/wa";

/**
 * Запуск регистрации: какие телефоны, сколько разом и когда сдаться.
 * Один телефон — один аккаунт, поэтому берутся только телефоны без аккаунта
 */
export function RunLauncher() {
  const { data: groups } = useGetFarmGroups();
  const { data: trunks } = useGetFarmTrunks();
  const { mutateAsync: start, isPending } = useStartRun();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<number | string>(2);
  const [errorsPerPhone, setErrorsPerPhone] = useState<number | string>(8);

  // Больше телефонов разом, чем транков, смысла нет: лишние будут ждать звонка
  const enabledTrunks = trunks?.items.filter((trunk) => trunk.enabled).length;

  // Сколько в группе телефонов без аккаунта — столько и возьмёт запуск
  const free = (stat: { phones: number; accounts: number }) =>
    Math.max(0, stat.phones - stat.accounts);

  const onStart = async () => {
    try {
      const run = await start({
        groupId,
        concurrency: Math.min(20, Math.max(1, Number(concurrency) || 1)),
        errorsPerPhone: Math.max(1, Number(errorsPerPhone) || 8),
      });

      notification.success({
        message: "Регистрация запущена",
        description: `Телефонов в запуске: ${run.total}`,
      });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <Card withBorder p="28px 30px">
      <Stack gap={24}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>
          Запуск регистрации
        </div>

        <InfoBlock>
          Берутся только телефоны без аккаунта. Номер и почту выдаёт сервис, код
          приходит с почты и со звонка на транк.
        </InfoBlock>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          <Select
            label="Группа телефонов"
            description="Пусто — все телефоны"
            placeholder={
              groups ? `Все телефоны (без аккаунта: ${free(groups.total)})` : "Все телефоны"
            }
            clearable
            data={(groups?.groups ?? []).map((group) => ({
              value: group.id,
              label: `${group.name} (без аккаунта: ${free(group)})`,
            }))}
            value={groupId}
            onChange={setGroupId}
          />
          <NumberInput
            label="Параллельно телефонов"
            description={
              enabledTrunks !== undefined
                ? `Не больше, чем включено транков (сейчас ${enabledTrunks})`
                : "Не больше, чем включено транков"
            }
            min={1}
            max={20}
            allowDecimal={false}
            value={concurrency}
            onChange={setConcurrency}
          />
          <NumberInput
            label="Ошибок на телефон до остановки"
            description="Столько неудач — и телефон выходит из запуска"
            min={1}
            max={50}
            allowDecimal={false}
            value={errorsPerPhone}
            onChange={setErrorsPerPhone}
          />
        </SimpleGrid>

        <Group justify="flex-end">
          <Button color="orange" size="lg" loading={isPending} onClick={onStart}>
            ▶ Запустить регистрацию
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
