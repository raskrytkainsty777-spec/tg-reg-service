import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle, IconFileCode } from "@tabler/icons-react";
import dayjs from "dayjs";

import type { FarmAsteriskStatus } from "../../api/services/farm.service";
import { AsteriskConfigModal } from "./AsteriskConfigModal";
import { formatDateTime, fromNow } from "./farmLabels";

// Asterisk забирает конфиг раз в 30 секунд — дольше двух минут тишины
// значит, что он не запущен или не достучался до бэкенда
const ASTERISK_STALE_MINUTES = 2;

interface AsteriskPanelProps {
  asterisk: FarmAsteriskStatus;
}

/** Состояние Asterisk: забрал ли он актуальные транки и когда был звонок */
export function AsteriskPanel({ asterisk }: AsteriskPanelProps) {
  const [configOpened, configHandlers] = useDisclosure(false);

  const stale =
    !asterisk.configFetchedAt ||
    dayjs().diff(dayjs(asterisk.configFetchedAt), "minute") >=
      ASTERISK_STALE_MINUTES;

  return (
    <Card withBorder radius={16}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={5}>Asterisk</Title>
            <Badge
              fullWidth={false}
              variant="light"
              color={asterisk.configInSync ? "green" : "orange"}
            >
              {asterisk.configInSync ? "конфиг актуален" : "ждёт обновления"}
            </Badge>
          </Group>
          <Button
            size="xs"
            variant="light"
            color="gray"
            leftSection={<IconFileCode size={14} />}
            onClick={configHandlers.open}
          >
            Показать конфиг
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          <Stack gap={0}>
            <Text size="xs" c="gray.6">
              Конфиг забран
            </Text>
            <Tooltip
              label={formatDateTime(asterisk.configFetchedAt)}
              disabled={!asterisk.configFetchedAt}
            >
              <Text size="sm" fw={500} w="fit-content">
                {fromNow(asterisk.configFetchedAt)}
              </Text>
            </Tooltip>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="gray.6">
              Последний звонок
            </Text>
            <Tooltip
              label={formatDateTime(asterisk.lastCallAt)}
              disabled={!asterisk.lastCallAt}
            >
              <Text size="sm" fw={500} w="fit-content">
                {fromNow(asterisk.lastCallAt)}
              </Text>
            </Tooltip>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="gray.6">
              Транков в конфиге
            </Text>
            <Text size="sm" fw={500}>
              {asterisk.enabledTrunks}
            </Text>
          </Stack>
        </SimpleGrid>

        {stale && (
          <Alert
            color="orange"
            variant="light"
            p="xs"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm">
              {asterisk.configFetchedAt
                ? "Asterisk давно не забирал конфиг — проверьте, что он запущен."
                : "Asterisk ещё ни разу не забирал конфиг."}
            </Text>
          </Alert>
        )}
      </Stack>

      <AsteriskConfigModal opened={configOpened} onClose={configHandlers.close} />
    </Card>
  );
}
