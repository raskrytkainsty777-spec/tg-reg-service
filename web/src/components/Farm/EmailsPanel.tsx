import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  CloseButton,
  Group,
  Loader,
  Menu,
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
  IconMail,
  IconPlugConnected,
  IconSearch,
  IconTrash,
  IconTrashX,
  IconUpload,
  IconSwitchHorizontal,
} from "@tabler/icons-react";

import {
  useDeleteFarmEmail,
  useDeleteFarmEmailsBulk,
  useGetFarmEmails,
  useGetFarmOverview,
  useImportFarmEmails,
  useTestFarmEmail,
  useUpdateFarmEmailStatus,
} from "../../api/queries/farm.query";
import type {
  FarmEmail,
  FarmResourceStatus,
} from "../../api/services/farm.service";
import { EmailMessagesModal } from "./EmailMessagesModal";
import { ImportTextModal } from "./ImportTextModal";
import { showImportResult } from "./ImportResult";
import {
  PROXY_STATUS,
  RESOURCE_STATUSES,
  errorMessage,
  formatDateTime,
  fromNow,
  resourceStatus,
  resourceStatusOptions,
} from "./farmLabels";
import { notification } from "../Notification/Notification";

const PAGE_SIZE = 50;

/** Пул почт для реги: статусы, прокси, проверка входа и письма */
export function EmailsPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<FarmResourceStatus | null>(null);
  const [proxy, setProxy] = useState<"none" | "any" | null>(null);

  const [importOpened, importHandlers] = useDisclosure(false);
  const [deleteOpened, deleteHandlers] = useDisclosure(false);
  const [messagesEmail, setMessagesEmail] = useState<FarmEmail | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Счётчики по статусам — из обзора, он и так подтягивается на вкладке
  const { data: overview } = useGetFarmOverview();
  const { data, isLoading } = useGetFarmEmails({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status ?? undefined,
    proxy: proxy ?? undefined,
  });

  const { mutateAsync: importEmails, isPending: isImporting } =
    useImportFarmEmails();
  const { mutateAsync: deleteBulk, isPending: isDeletingBulk } =
    useDeleteFarmEmailsBulk();
  const { mutateAsync: testEmail } = useTestFarmEmail();
  const { mutateAsync: updateStatus } = useUpdateFarmEmailStatus();
  const { mutateAsync: deleteEmail } = useDeleteFarmEmail();

  const byStatus = overview?.emails.byStatus ?? {};
  const statusOptions = resourceStatusOptions("email");
  const statusTitles = Object.fromEntries(
    statusOptions.map((option) => [option.value, option.label])
  ) as Record<FarmResourceStatus, string>;

  const applyFilter = (next: {
    status?: FarmResourceStatus | null;
    proxy?: "none" | "any" | null;
  }) => {
    if (next.status !== undefined) setStatus(next.status);
    if (next.proxy !== undefined) setProxy(next.proxy);
    setPage(1);
  };

  const onImport = async (text: string) => {
    const result = await importEmails(text);

    showImportResult({
      title: `Добавлено почт: ${result.created}`,
      description: `Дубликатов: ${result.duplicates}. Раздано прокси: ${result.proxiesAssigned}`,
      rows: result.invalid,
    });
  };

  const onDeleteBulk = async (text: string) => {
    const result = await deleteBulk(text);

    showImportResult({
      title: `Удалено почт: ${result.deleted}`,
      description:
        result.inUse.length || result.notFound.length
          ? `Использованы в реге: ${result.inUse.length}, не найдены: ${result.notFound.length}`
          : undefined,
      rowsTitle: "Не удалены",
      rows: [
        ...result.inUse.map((row) => ({
          row,
          reason: "Использовалась в реге — можно только заблокировать",
        })),
        ...result.notFound.map((row) => ({ row, reason: "Не найдена" })),
      ],
    });
  };

  const onTest = async (email: FarmEmail) => {
    setTestingId(email.id);

    try {
      const result = await testEmail(email.id);
      const via = result.viaProxy ? "через прокси" : "без прокси";

      if (result.ok) {
        notification.success({
          message: `Вход в ${email.email} выполнен`,
          description: `Писем во «Входящих»: ${result.messages}, ${result.latencyMs} мс, ${via}`,
        });
      } else {
        notification.error({
          message: `Не удалось войти в ${email.email} (${via})`,
          description: result.error,
        });
      }
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    } finally {
      setTestingId(null);
    }
  };

  const onChangeStatus = (email: FarmEmail, next: FarmResourceStatus) =>
    updateStatus({ id: email.id, status: next })
      .then(() =>
        notification.success({
          message: `${email.email}: ${resourceStatus(next, "email").title}`,
        })
      )
      .catch((err) => notification.error({ message: errorMessage(err) }));

  const confirmDelete = (email: FarmEmail) =>
    modals.openConfirmModal({
      title: "Удалить почту",
      centered: true,
      children: (
        <Text size="sm">
          Удалить {email.email}? Почту, которая уже была в реге, удалить нельзя —
          её можно только заблокировать.
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteEmail(email.id)
          .then(() => notification.success({ message: "Почта удалена" }))
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  const rows = data?.items.map((email) => {
    const label = resourceStatus(email.status, "email");

    return (
      <Table.Tr key={email.id}>
        <Table.Td fz="sm">{email.email}</Table.Td>
        <Table.Td>
          <Badge size="sm" fullWidth={false} color={label.color}>
            {label.title}
          </Badge>
        </Table.Td>
        <Table.Td fz="sm">
          {email.proxy ? (
            <Group gap={6} wrap="nowrap">
              <Text ff="monospace" fz="sm">
                {email.proxy.host}:{email.proxy.port}
              </Text>
              {email.proxy.status !== "active" && (
                <Badge
                  size="xs"
                  variant="light"
                  fullWidth={false}
                  color={PROXY_STATUS[email.proxy.status].color}
                >
                  {PROXY_STATUS[email.proxy.status].title}
                </Badge>
              )}
            </Group>
          ) : (
            <Text fz="sm" c="gray.5">
              без прокси
            </Text>
          )}
        </Table.Td>
        <Table.Td fz="sm">
          <Tooltip
            label={formatDateTime(email.lastInboxSyncAt)}
            disabled={!email.lastInboxSyncAt}
          >
            <span>{fromNow(email.lastInboxSyncAt)}</span>
          </Tooltip>
        </Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap" justify="flex-end">
            <Tooltip label="Проверить вход">
              <ActionIcon
                variant="subtle"
                color="grape"
                loading={testingId === email.id}
                onClick={() => onTest(email)}
              >
                <IconPlugConnected size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Письма">
              <ActionIcon
                variant="subtle"
                color="blue"
                onClick={() => setMessagesEmail(email)}
              >
                <IconMail size={18} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Tooltip label="Сменить статус">
                  <ActionIcon variant="subtle" color="gray">
                    <IconSwitchHorizontal size={18} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Статус почты</Menu.Label>
                {statusOptions.map((option) => (
                  <Menu.Item
                    key={option.value}
                    disabled={option.value === email.status}
                    onClick={() => onChangeStatus(email, option.value)}
                  >
                    {option.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <Tooltip label="Удалить">
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => confirmDelete(email)}
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
    <Stack gap="md">
      {/* Счётчики по статусам — это и есть фильтр */}
      <Group gap="xs">
        <Button
          size="compact-sm"
          color="dark"
          variant={!status ? "filled" : "light"}
          onClick={() => applyFilter({ status: null })}
        >
          Все: {overview?.emails.total ?? "…"}
        </Button>
        {RESOURCE_STATUSES.filter((item) => byStatus[item]).map((item) => {
          const label = resourceStatus(item, "email");

          return (
            <Button
              key={item}
              size="compact-sm"
              color={label.color}
              variant={status === item ? "filled" : "light"}
              onClick={() => applyFilter({ status: status === item ? null : item })}
            >
              {statusTitles[item]}: {byStatus[item]}
            </Button>
          );
        })}
        {!!overview?.emails.withoutProxy && (
          <Button
            size="compact-sm"
            color="orange"
            variant={status === "free" && proxy === "none" ? "filled" : "outline"}
            onClick={() => applyFilter({ status: "free", proxy: "none" })}
          >
            Свободные без прокси: {overview.emails.withoutProxy}
          </Button>
        )}
      </Group>

      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end">
          <TextInput
            placeholder="Поиск по адресу"
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
            w={200}
            clearable
            data={statusOptions}
            value={status}
            onChange={(value) =>
              applyFilter({ status: (value as FarmResourceStatus) ?? null })
            }
          />
          <Select
            placeholder="Прокси: любые"
            w={170}
            clearable
            data={[
              { value: "any", label: "С прокси" },
              { value: "none", label: "Без прокси" },
            ]}
            value={proxy}
            onChange={(value) =>
              applyFilter({ proxy: (value as "none" | "any") ?? null })
            }
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
            color="red"
            leftSection={<IconTrashX size={16} />}
            onClick={deleteHandlers.open}
          >
            Удалить списком
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
              {debouncedSearch || status || proxy
                ? "Ничего не нашлось"
                : "Почт пока нет — загрузите список через «Импорт»"}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Почта</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Прокси</Table.Th>
                  <Table.Th>Ящик проверен</Table.Th>
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
        title="Импорт почт"
        description="По одной на строку: email:пароль или email;пароль. Новым почтам сразу раздаются живые прокси"
        placeholder={"user@rambler.ru:password\nuser2@rambler.ru;password"}
        submitLabel="Загрузить"
        loading={isImporting}
        onSubmit={onImport}
      />

      <ImportTextModal
        opened={deleteOpened}
        onClose={deleteHandlers.close}
        title="Удалить почты списком"
        description="По одному адресу на строку (можно вставить email:пароль — пароль отбросится). Почты, которые уже были в реге, не удаляются"
        placeholder={"user@rambler.ru\nuser2@rambler.ru"}
        submitLabel="Удалить"
        submitColor="red"
        loading={isDeletingBulk}
        onSubmit={onDeleteBulk}
      />

      <EmailMessagesModal
        email={messagesEmail}
        onClose={() => setMessagesEmail(null)}
      />
    </Stack>
  );
}
