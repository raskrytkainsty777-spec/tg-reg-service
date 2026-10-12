import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
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
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconArrowsShuffle,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconSkull,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";

import {
  useAssignFarmProxies,
  useCheckAllFarmProxies,
  useCheckFarmProxy,
  useDeleteDeadFarmProxies,
  useDeleteFarmProxy,
  useGetFarmProxies,
  useImportFarmProxies,
} from "../../api/queries/farm.query";
import type { FarmProxy } from "../../api/services/farm.service";
import { ImportTextModal } from "./ImportTextModal";
import { showImportResult } from "./ImportResult";
import { PROXY_STATUS, errorMessage, formatDateTime, fromNow } from "./farmLabels";
import { notification } from "../Notification/Notification";

const PAGE_SIZE = 50;

/** SOCKS5-прокси, через которые почты ходят за кодом */
export function ProxiesPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);

  const [importOpened, importHandlers] = useDisclosure(false);
  const [assignOpened, assignHandlers] = useDisclosure(false);
  const [reassignAll, setReassignAll] = useState(false);
  // Какую строку сейчас проверяем — крутилка только на ней
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const { data, isLoading } = useGetFarmProxies({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status ?? undefined,
  });

  const { mutateAsync: importProxies, isPending: isImporting } =
    useImportFarmProxies();
  const { mutateAsync: checkAll, isPending: isCheckingAll } =
    useCheckAllFarmProxies();
  const { mutateAsync: checkProxy } = useCheckFarmProxy();
  const { mutateAsync: assignProxies, isPending: isAssigning } =
    useAssignFarmProxies();
  const { mutateAsync: deleteDead } = useDeleteDeadFarmProxies();
  const { mutateAsync: deleteProxy } = useDeleteFarmProxy();

  const onImport = async (text: string) => {
    const result = await importProxies(text);

    showImportResult({
      title: `Добавлено прокси: ${result.created}`,
      description: `Дубликатов: ${result.duplicates}. Новые прокси уже проверены`,
      rows: result.invalid,
    });
  };

  const onCheckAll = async () => {
    try {
      const result = await checkAll();
      notification.success({
        message: `Проверено прокси: ${result.checked}`,
        description: `Живых: ${result.active}, мёртвых: ${result.dead}`,
      });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  const onCheck = async (proxy: FarmProxy) => {
    setCheckingId(proxy.id);

    try {
      const result = await checkProxy(proxy.id);

      if (result.status === "active") {
        notification.success({
          message: `${proxy.host}:${proxy.port} живой`,
          description: `Задержка ${result.lastLatencyMs ?? "—"} мс`,
        });
      } else {
        notification.error({
          message: `${proxy.host}:${proxy.port} не отвечает`,
          description: result.lastError ?? "",
        });
      }
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    } finally {
      setCheckingId(null);
    }
  };

  const onAssign = async () => {
    try {
      const result = await assignProxies(reassignAll);

      if (!result.proxies) {
        notification.error({
          message: "Нет живых прокси",
          description: "Сначала добавьте и проверьте прокси",
        });
      } else {
        notification.success({
          message: `Прокси розданы почтам: ${result.assigned}`,
          description: `Живых прокси в раздаче: ${result.proxies}`,
        });
      }

      assignHandlers.close();
      setReassignAll(false);
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  const confirmDeleteDead = () =>
    modals.openConfirmModal({
      title: "Удалить мёртвые прокси",
      centered: true,
      children: (
        <Text size="sm">
          Все прокси со статусом «Мёртвый» будут удалены. Почты, которые через
          них ходили, останутся без прокси — раздайте им живые заново.
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteDead()
          .then((result) =>
            notification.success({
              message: `Удалено мёртвых прокси: ${result.deleted}`,
            })
          )
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  const confirmDelete = (proxy: FarmProxy) =>
    modals.openConfirmModal({
      title: "Удалить прокси",
      centered: true,
      children: (
        <Text size="sm">
          Удалить {proxy.host}:{proxy.port}?
          {proxy.emailsCount
            ? ` Почты на нём (${proxy.emailsCount}) останутся без прокси.`
            : ""}
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteProxy(proxy.id)
          .then(() => notification.success({ message: "Прокси удалён" }))
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  const rows = data?.items.map((proxy) => (
    <Table.Tr key={proxy.id}>
      <Table.Td ff="monospace" fz="sm">
        {proxy.host}:{proxy.port}
      </Table.Td>
      <Table.Td fz="sm">{proxy.username ?? "—"}</Table.Td>
      <Table.Td fz="sm">{proxy.label ?? "—"}</Table.Td>
      <Table.Td>
        <Badge size="sm" fullWidth={false} color={PROXY_STATUS[proxy.status].color}>
          {PROXY_STATUS[proxy.status].title}
        </Badge>
      </Table.Td>
      <Table.Td fz="sm">
        {proxy.lastLatencyMs !== null ? `${proxy.lastLatencyMs} мс` : "—"}
      </Table.Td>
      <Table.Td fz="sm">{proxy.emailsCount}</Table.Td>
      <Table.Td fz="sm">
        <Tooltip label={formatDateTime(proxy.lastCheckAt)} disabled={!proxy.lastCheckAt}>
          <span>{fromNow(proxy.lastCheckAt)}</span>
        </Tooltip>
      </Table.Td>
      <Table.Td fz="xs" c="red.7" maw={260} style={{ wordBreak: "break-word" }}>
        {proxy.lastError ?? ""}
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap" justify="flex-end">
          <Tooltip label="Проверить">
            <ActionIcon
              variant="subtle"
              color="grape"
              loading={checkingId === proxy.id}
              onClick={() => onCheck(proxy)}
            >
              <IconPlugConnected size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Удалить">
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={() => confirmDelete(proxy)}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end">
          <TextInput
            placeholder="Хост или метка"
            w={240}
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
            w={180}
            clearable
            data={Object.entries(PROXY_STATUS).map(([value, item]) => ({
              value,
              label: item.title,
            }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </Group>

        <Group gap="xs">
          <Button
            color="dark"
            leftSection={<IconUpload size={16} />}
            onClick={importHandlers.open}
          >
            Импорт
          </Button>
          <Button
            variant="light"
            color="grape"
            leftSection={<IconRefresh size={16} />}
            loading={isCheckingAll}
            onClick={onCheckAll}
          >
            Проверить все
          </Button>
          <Button
            variant="light"
            leftSection={<IconArrowsShuffle size={16} />}
            onClick={assignHandlers.open}
          >
            Раздать почтам
          </Button>
          <Button
            variant="light"
            color="red"
            leftSection={<IconSkull size={16} />}
            onClick={confirmDeleteDead}
          >
            Удалить мёртвые
          </Button>
        </Group>
      </Group>

      <Card withBorder p={0}>
        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : !data?.items.length ? (
          <Center p="xl">
            <Text c="gray.6">
              {debouncedSearch || status
                ? "Ничего не нашлось"
                : "Прокси пока нет — загрузите список через «Импорт»"}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Адрес</Table.Th>
                  <Table.Th>Логин</Table.Th>
                  <Table.Th>Метка</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Задержка</Table.Th>
                  <Table.Th>Почт</Table.Th>
                  <Table.Th>Проверен</Table.Th>
                  <Table.Th>Ошибка</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{rows}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

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

      <ImportTextModal
        opened={importOpened}
        onClose={importHandlers.close}
        title="Импорт прокси"
        description="SOCKS5, по одному на строку: host:port или host:port:логин:пароль. После импорта каждый новый прокси проверяется — на большом списке это займёт время"
        placeholder={"1.2.3.4:1080\n5.6.7.8:1080:user:pass"}
        submitLabel="Загрузить"
        loading={isImporting}
        onSubmit={onImport}
      />

      <Modal
        opened={assignOpened}
        onClose={assignHandlers.close}
        title="Раздать прокси почтам"
        centered
      >
        <Stack>
          <Text size="sm">
            Живые прокси раздаются по кругу, поровну на каждый. По умолчанию —
            только почтам без прокси или с мёртвым прокси.
          </Text>
          <Checkbox
            label="Перераздать все почты заново"
            description="Каждая почта получит новый прокси, даже если текущий живой"
            checked={reassignAll}
            onChange={(event) => setReassignAll(event.currentTarget.checked)}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={assignHandlers.close}>
              Отмена
            </Button>
            <Button color="dark" loading={isAssigning} onClick={onAssign}>
              Раздать
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
