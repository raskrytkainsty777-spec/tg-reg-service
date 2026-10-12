import {
  Badge,
  Card,
  Center,
  Code,
  Divider,
  Drawer,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Timeline,
  Title,
} from "@mantine/core";
import { IconPhoneIncoming } from "@tabler/icons-react";
import dayjs from "dayjs";

import { useGetFarmAccount } from "../../api/queries/farm.query";
import type { FarmSipCall } from "../../api/services/farm.service";
import {
  ACCOUNT_EVENT,
  ACCOUNT_STATUS,
  SIP_CALL_STATUS,
  SIP_REJECT_REASON,
  errorMessage,
  failureReasonTitle,
  formatDateTime,
  resourceStatus,
} from "./farmLabels";

interface AccountDrawerProps {
  accountId: string | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="gray.6">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: "break-word" }}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

function CallCard({ call }: { call: FarmSipCall }) {
  const status = SIP_CALL_STATUS[call.status] ?? {
    title: call.status,
    color: "gray",
  };
  const started = call.startedAt ?? call.createdAt;
  const duration =
    call.startedAt && call.endedAt
      ? dayjs(call.endedAt).diff(dayjs(call.startedAt), "second")
      : null;
  // Промежуточные куски расшифровки перекрываются финальными — берём финальные
  const finals = call.transcripts.filter((item) => item.final);
  const text = (finals.length ? finals : call.transcripts)
    .map((item) => item.text)
    .join(" ")
    .trim();

  return (
    <Card withBorder p="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <IconPhoneIncoming size={16} />
            <Text size="sm" fw={600} ff="monospace">
              {call.caller}
            </Text>
            <Text size="xs" c="gray.6">
              → {call.did}
            </Text>
          </Group>
          <Badge size="sm" fullWidth={false} color={status.color}>
            {status.title}
          </Badge>
        </Group>

        <Text size="xs" c="gray.6">
          {formatDateTime(started)}
          {duration !== null ? ` · ${duration} сек` : ""}
          {call.rejectReason
            ? ` · ${SIP_REJECT_REASON[call.rejectReason] ?? call.rejectReason}`
            : ""}
        </Text>

        {text ? (
          <Text size="sm" bg="gray.0" p="xs" style={{ borderRadius: 8 }}>
            {text}
          </Text>
        ) : (
          <Text size="xs" c="gray.5">
            Расшифровки нет
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** Карточка аккаунта: данные, звонки с расшифровкой и журнал событий */
export function AccountDrawer({ accountId, onClose }: AccountDrawerProps) {
  const { data: account, isLoading, error } = useGetFarmAccount(accountId);

  const status = account ? ACCOUNT_STATUS[account.status] : null;

  return (
    <Drawer
      opened={!!accountId}
      onClose={onClose}
      position="right"
      size="lg"
      title={<Title order={4}>Попытка регистрации</Title>}
    >
      {isLoading && (
        <Center p="xl">
          <Loader />
        </Center>
      )}

      {error && (
        <Text c="red.7" size="sm">
          {errorMessage(error)}
        </Text>
      )}

      {account && status && (
        <Stack gap="md">
          <Group gap="xs">
            <Badge fullWidth={false} color={status.color}>
              {status.title}
            </Badge>
            {account.status === "failed" && (
              <Badge fullWidth={false} variant="light" color="red">
                {failureReasonTitle(account.failureReason)}
              </Badge>
            )}
            <Text size="xs" c="gray.6">
              создан {formatDateTime(account.createdAt)}
            </Text>
          </Group>

          <SimpleGrid cols={2} spacing="sm">
            <Field label="Номер" value={account.phone} />
            <Field
              label="Почта"
              value={`${account.email.email} (${resourceStatus(account.email.status, "email").title.toLowerCase()})`}
            />
            <Field label="Транк" value={account.trunk?.name} />
            <Field
              label="Имя и фамилия"
              value={`${account.firstName} ${account.lastName}`}
            />
            <Field label="Username" value={account.username ? `@${account.username}` : null} />
            <Field
              label="Дата рождения"
              value={dayjs(account.birthDate).format("DD.MM.YYYY")}
            />
            <Field
              label="Аккаунт создан в Telegram"
              value={
                account.accountCreatedAt
                  ? formatDateTime(account.accountCreatedAt)
                  : null
              }
            />
            <Field label="Агент реги" value={account.externalAgentId} />
            <Field label="Заметка" value={account.notes} />
          </SimpleGrid>

          <Divider />

          <Stack gap="xs">
            <Text fw={600}>Звонки ({account.sipCalls.length})</Text>
            {account.sipCalls.length ? (
              account.sipCalls.map((call) => (
                <CallCard key={call.id} call={call} />
              ))
            ) : (
              <Text size="sm" c="gray.6">
                Звонков не было
              </Text>
            )}
          </Stack>

          <Divider />

          <Stack gap="xs">
            <Text fw={600}>События</Text>
            {account.events.length ? (
              <Timeline bulletSize={14} lineWidth={2}>
                {account.events.map((event) => (
                  <Timeline.Item
                    key={event.id}
                    title={
                      <Text size="sm" fw={500}>
                        {ACCOUNT_EVENT[event.action] ?? event.action}
                      </Text>
                    }
                  >
                    <Text size="xs" c="gray.6">
                      {dayjs(event.createdAt).format("DD.MM.YY HH:mm:ss")}
                    </Text>
                    {event.payload !== null && event.payload !== undefined && (
                      <Code block mt={4} fz="xs">
                        {JSON.stringify(event.payload, null, 2)}
                      </Code>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            ) : (
              <Text size="sm" c="gray.6">
                Событий нет
              </Text>
            )}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
