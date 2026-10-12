import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconPlus, IconTrash } from "@tabler/icons-react";

import { useCreateFarmPhones } from "../../../api/queries/farmAccounts.query";
import type { FarmGroup } from "../../../api/services/farmAccounts.service";
import { errorMessage } from "../farmLabels";
import { notification } from "../../Notification/Notification";

// Android-версии, под которые GeeLark отдаёт железо
const ANDROID_VERSIONS = ["13", "14", "15"];

interface CreatePhonesModalProps {
  opened: boolean;
  onClose: () => void;
  groups: FarmGroup[];
  groupId: string | null;
}

/**
 * Создание облачных телефонов: страна и сколько штук. Прокси Proxyma
 * подбирается под страну сам и вяжется к телефону при создании
 */
export function CreatePhonesModal({
  opened,
  onClose,
  groups,
  groupId,
}: CreatePhonesModalProps) {
  const { mutateAsync: createPhones, isPending } = useCreateFarmPhones();

  const [rows, setRows] = useState<{ country: string; count: number | string }[]>([
    { country: "", count: 1 },
  ]);
  const [androidVer, setAndroidVer] = useState("15");
  const [targetGroup, setTargetGroup] = useState<string | null>(groupId);

  const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);

  const onCreate = async () => {
    const countries: Record<string, number> = {};

    for (const row of rows) {
      const code = row.country.trim().toUpperCase().slice(0, 2);
      const count = Number(row.count) || 0;

      if (code.length === 2 && count > 0) {
        countries[code] = (countries[code] ?? 0) + count;
      }
    }

    if (!Object.keys(countries).length) {
      notification.error({ message: "Укажите страну и количество" });
      return;
    }

    try {
      const result = await createPhones({
        countries,
        androidVer: Number(androidVer),
        groupId: targetGroup,
      });

      if (result.created) {
        notification.success({ message: `Создано телефонов: ${result.created}` });
      }

      if (result.failed) {
        notification.error({
          message: `Не создано: ${result.failed}. ${result.errors
            .slice(0, 3)
            .map((item) => `${item.profileName} — ${item.error}`)
            .join("; ")}`,
        });
      }

      if (result.created) {
        setRows([{ country: "", count: 1 }]);
        onClose();
      }
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Создать телефоны" size="md">
      <Stack>
        <Text size="sm" c="gray.7">
          Телефон создаётся в GeeLark с прокси Proxyma под выбранную страну —
          отдельно заводить прокси не нужно. Имя профиля продолжает нумерацию
          страны: DE-01, DE-02 и так далее.
        </Text>

        {rows.map((row, index) => (
          <Group key={index} align="flex-end" gap="xs">
            <TextInput
              label={index === 0 ? "Страна" : undefined}
              description={index === 0 ? "Код из двух букв: DE, BE, FI" : undefined}
              placeholder="DE"
              maxLength={2}
              w={140}
              value={row.country}
              onChange={(event) => {
                const country = event.currentTarget.value.toUpperCase();
                setRows((current) =>
                  current.map((item, i) => (i === index ? { ...item, country } : item)),
                );
              }}
            />
            <NumberInput
              label={index === 0 ? "Сколько" : undefined}
              min={1}
              max={200}
              allowDecimal={false}
              w={110}
              value={row.count}
              onChange={(count) =>
                setRows((current) =>
                  current.map((item, i) => (i === index ? { ...item, count } : item)),
                )
              }
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}

        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => setRows((current) => [...current, { country: "", count: 1 }])}
        >
          Ещё страна
        </Button>

        <Group grow align="flex-start">
          <Select
            label="Android"
            data={ANDROID_VERSIONS}
            value={androidVer}
            onChange={(value) => setAndroidVer(value ?? "15")}
          />
          <Select
            label="Группа"
            placeholder="Без группы"
            clearable
            data={groups.map((group) => ({ value: group.id, label: group.name }))}
            value={targetGroup}
            onChange={setTargetGroup}
          />
        </Group>

        {total > 50 && (
          <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
            {total} телефонов — это примерно {Math.ceil((total * 1.1) / 60)} мин.
            Окно закрывать нельзя, запрос идёт синхронно.
          </Alert>
        )}

        <Button color="dark" loading={isPending} onClick={onCreate} disabled={!total}>
          Создать {total ? `(${total})` : ""}
        </Button>
      </Stack>
    </Modal>
  );
}
