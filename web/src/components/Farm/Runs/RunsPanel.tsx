import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Center,
  Collapse,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconChevronDown,
  IconChevronRight,
  IconPlayerStop,
} from "@tabler/icons-react";

import { useCancelRun, useGetRuns } from "../../../api/queries/runs.query";
import type { Run } from "../../../api/services/runs.service";
import { errorMessage, formatDateTime } from "../farmLabels";
import { notification } from "../../Notification/Notification";
import { Sticker } from "../../ui/wa";
import { WA } from "../../../theme";
import { RunLauncher } from "./RunLauncher";
import { RunPhoneModal } from "./RunPhoneModal";
import {
  formatDuration,
  isRunActive,
  runPhoneStatus,
  runStatus,
} from "./runLabels";

interface RunCardProps {
  run: Run;
  onOpenPhone: (phoneId: string) => void;
}

function RunCard({ run, onOpenPhone }: RunCardProps) {
  const { mutateAsync: cancel, isPending: canceling } = useCancelRun();
  // Идущий запуск раскрыт сразу — на него и смотрят
  const [expanded, setExpanded] = useState(isRunActive(run.status));

  const status = runStatus(run.status);
  const active = isRunActive(run.status);
  const restore = run.kind === "restore";

  const confirmCancel = () =>
    modals.openConfirmModal({
      title: restore ? "Остановить восстановление" : "Остановить регистрацию",
      centered: true,
      children: (
        <Text size="sm">
          Новые телефоны не возьмутся, идущие доделают текущий шаг и
          остановятся.
        </Text>
      ),
      labels: { confirm: "Остановить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        cancel(run.id)
          .then(() => notification.success({ message: "Запуск останавливается" }))
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  return (
    <Card withBorder p="18px 26px" style={{ borderRadius: 22 }}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap={16} wrap="wrap">
            <Sticker size={13} rotate={-2} color={restore ? WA.purple : WA.orange}>
              {restore
                ? "ВОССТАНОВЛЕНИЕ ВХОДА"
                : (run.groupName ?? "Все телефоны").toUpperCase()}
            </Sticker>
            <Badge fullWidth={false} color={status.color}>
              {status.title}
            </Badge>
            <Text fz={14} c="dimmed">
              {formatDateTime(run.createdAt)}
              {run.startedAt
                ? ` · ${formatDuration(run.startedAt, run.finishedAt)}`
                : ""}
            </Text>
          </Group>

          {active && (
            <Button
              size="compact-sm"
              variant="light"
              color="red"
              leftSection={<IconPlayerStop size={14} />}
              loading={canceling}
              onClick={confirmCancel}
            >
              Остановить
            </Button>
          )}
        </Group>

        <Group gap={24} wrap="wrap">
          <Text fz={15}>
            Телефонов{" "}
            <b>
              {run.done}/{run.total}
            </b>
          </Text>
          <Text fz={15} c="green" fw={700}>
            {restore ? "Восстановлено" : "Зарегистрировано"} <b>{run.ok}</b>
          </Text>
          {!!run.failed && (
            <Text fz={15} c="red.7" fw={700}>
              Ошибок <b>{run.failed}</b>
            </Text>
          )}
          <Text fz={13} c="dimmed">
            параллельно {run.concurrency}
            {!restore && ` · ошибок на телефон до остановки ${run.errorsPerPhone}`}
          </Text>
        </Group>

        <Progress
          value={run.total ? (run.done / run.total) * 100 : 0}
          color={run.failed ? "orange" : "green"}
          size="sm"
          animated={run.status === "running"}
        />

        {!!run.phones.length && (
          <>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              style={{ alignSelf: "flex-start" }}
              leftSection={
                expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
              }
              onClick={() => setExpanded((current) => !current)}
            >
              Телефоны ({run.phones.length})
            </Button>

            <Collapse in={expanded}>
              <Table.ScrollContainer minWidth={640}>
                <Table verticalSpacing={4} fz="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Телефон</Table.Th>
                      <Table.Th>Статус</Table.Th>
                      <Table.Th>Аккаунт</Table.Th>
                      <Table.Th>Последний шаг</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {run.phones.map((phone) => {
                      const label = runPhoneStatus(phone.status);

                      return (
                        <Table.Tr
                          key={phone.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => onOpenPhone(phone.id)}
                        >
                          <Table.Td fw={700} style={{ whiteSpace: "nowrap" }}>
                            {phone.profileName}
                          </Table.Td>
                          <Table.Td>
                            <Badge size="sm" fullWidth={false} color={label.color}>
                              {label.title}
                            </Badge>
                          </Table.Td>
                          <Table.Td style={{ whiteSpace: "nowrap" }}>
                            {phone.account
                              ? `${phone.account.phone}${
                                  phone.account.username ? ` · @${phone.account.username}` : ""
                                }`
                              : "—"}
                          </Table.Td>
                          <Table.Td
                            c={phone.error ? "red.7" : undefined}
                            style={{ wordBreak: "break-word" }}
                          >
                            {phone.error ?? phone.lastStep ?? "—"}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Collapse>
          </>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Регистрация → Запуск: форма запуска и ход запусков.
 * Сами телефоны крутит воркер — у него ADB до GeeLark
 */
export function RunsPanel() {
  const { data, isLoading } = useGetRuns();
  const [openedPhone, setOpenedPhone] = useState<{ runId: string; phoneId: string } | null>(
    null,
  );

  // Новые запуски — сверху
  const runs = useMemo(
    () =>
      [...(data?.items ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [data],
  );

  const phone = openedPhone
    ? (runs
        .find((run) => run.id === openedPhone.runId)
        ?.phones.find((item) => item.id === openedPhone.phoneId) ?? null)
    : null;

  return (
    <Stack gap={28}>
      <RunLauncher />

      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>Запуски</div>

      {isLoading ? (
        <Center p="xl">
          <Loader />
        </Center>
      ) : !runs.length ? (
        <Card withBorder p="xl">
          <Center>
            <Text c="gray.6">Регистрацию и восстановление пока не запускали</Text>
          </Center>
        </Card>
      ) : (
        runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            onOpenPhone={(phoneId) => setOpenedPhone({ runId: run.id, phoneId })}
          />
        ))
      )}

      <RunPhoneModal phone={phone} onClose={() => setOpenedPhone(null)} />
    </Stack>
  );
}
