import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Center,
  CloseButton,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconBan, IconRefresh, IconSearch, IconTrash } from "@tabler/icons-react";

import {
  useDeleteFarmTrunkPhone,
  useGetFarmTrunkPhones,
  useMarkFarmTrunkPhoneInvalid,
  useRestoreFarmTrunkPhone,
} from "../../api/queries/farm.query";
import type {
  FarmTrunk,
  FarmTrunkPhone,
} from "../../api/services/farm.service";
import {
  errorMessage,
  formatDateTime,
  resourceStatus,
  resourceStatusOptions,
} from "./farmLabels";
import { notification } from "../Notification/Notification";

const PAGE_SIZE = 50;

interface TrunkPhonesModalProps {
  trunk: FarmTrunk | null;
  onClose: () => void;
}

/** Номера транка: статусы, возврат в работу, блокировка, удаление */
export function TrunkPhonesModal({ trunk, onClose }: TrunkPhonesModalProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Каждый транк открываем с чистыми фильтрами
  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatus(null);
  }, [trunk?.id]);

  const { data, isLoading } = useGetFarmTrunkPhones(trunk?.id ?? null, {
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status ?? undefined,
  });

  const { mutateAsync: restorePhone } = useRestoreFarmTrunkPhone();
  const { mutateAsync: markInvalid } = useMarkFarmTrunkPhoneInvalid();
  const { mutateAsync: deletePhone } = useDeleteFarmTrunkPhone();

  const run = async (
    phone: FarmTrunkPhone,
    action: (id: string) => Promise<unknown>,
    message: string
  ) => {
    setBusyId(phone.id);

    try {
      await action(phone.id);
      notification.success({ message });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const confirmBlock = (phone: FarmTrunkPhone) =>
    modals.openConfirmModal({
      title: "Заблокировать номер",
      centered: true,
      children: (
        <Text size="sm">
          Номер {phone.phone} больше не будет выдаваться в регу. Если по нему
          сейчас идёт рега, она будет сорвана.
        </Text>
      ),
      labels: { confirm: "Заблокировать", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        run(phone, markInvalid, `Номер ${phone.phone} заблокирован`),
    });

  const confirmDelete = (phone: FarmTrunkPhone) =>
    modals.openConfirmModal({
      title: "Удалить номер",
      centered: true,
      children: <Text size="sm">Удалить номер {phone.phone} из транка?</Text>,
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () => run(phone, deletePhone, `Номер ${phone.phone} удалён`),
    });

  const rows = data?.items.map((phone) => {
    const label = resourceStatus(phone.status, "phone");
    const inRegistration = phone.status === "reserved";

    return (
      <Table.Tr key={phone.id}>
        <Table.Td ff="monospace" fz="sm">
          {phone.phone}
        </Table.Td>
        <Table.Td>
          <Badge size="sm" fullWidth={false} color={label.color}>
            {label.title}
          </Badge>
        </Table.Td>
        <Table.Td fz="sm">
          {phone.pausedUntil ? `до ${formatDateTime(phone.pausedUntil)}` : "—"}
        </Table.Td>
        <Table.Td fz="sm">{formatDateTime(phone.createdAt)}</Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap" justify="flex-end">
            <Tooltip label="Вернуть в работу">
              <ActionIcon
                variant="subtle"
                color="green"
                disabled={inRegistration || phone.status === "free"}
                loading={busyId === phone.id}
                onClick={() =>
                  run(phone, restorePhone, `Номер ${phone.phone} снова в работе`)
                }
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Заблокировать">
              <ActionIcon
                variant="subtle"
                color="orange"
                disabled={phone.status === "blocked"}
                onClick={() => confirmBlock(phone)}
              >
                <IconBan size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Удалить">
              <ActionIcon
                variant="subtle"
                color="red"
                disabled={inRegistration}
                onClick={() => confirmDelete(phone)}
              >
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Modal
      opened={!!trunk}
      onClose={onClose}
      title={`Номера транка ${trunk?.name ?? ""}`}
      centered
      size="xl"
    >
      <Stack gap="md">
        <Group gap="sm">
          <TextInput
            placeholder="Поиск по номеру"
            w={220}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            leftSection={<IconSearch size={16} />}
            rightSectionPointerEvents="all"
            rightSection={
              <CloseButton
                aria-label="Очистить"
                onClick={() => setSearch("")}
                style={{ display: search ? undefined : "none" }}
              />
            }
          />
          <Select
            placeholder="Все статусы"
            w={220}
            clearable
            data={resourceStatusOptions("phone")}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </Group>

        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : !data?.items.length ? (
          <Center p="xl">
            <Text c="gray.6">
              {debouncedSearch || status
                ? "Ничего не нашлось"
                : "В транке пока нет номеров"}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Номер</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Пауза</Table.Th>
                  <Table.Th>Добавлен</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{rows}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Group justify="space-between">
          <Text size="sm" c="gray.6">
            Всего: {data?.total ?? 0}
          </Text>
          {(data?.totalPages ?? 1) > 1 && (
            <Pagination
              total={data?.totalPages ?? 1}
              value={page}
              onChange={setPage}
              size="sm"
            />
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
