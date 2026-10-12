import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Center,
  CloseButton,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconFileDownload, IconSearch } from "@tabler/icons-react";
import dayjs from "dayjs";

import { useGetFarmAccounts } from "../../api/queries/farm.query";
import {
  FarmService,
  type FarmAccountListParams,
} from "../../api/services/farm.service";
import { AccountDrawer } from "./AccountDrawer";
import {
  ACCOUNT_STATUS,
  FAILURE_REASON,
  downloadBlob,
  failureReasonTitle,
  formatDateTime,
} from "./farmLabels";
import { blobErrorMessage } from "../../helpers/errors";
import { notification } from "../Notification/Notification";

const PAGE_SIZE = 50;

type Period = "all" | "today" | "7d" | "30d";

/** Попытки регистрации: зарегистрированные и сорванные аккаунты */
export function AccountsPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Одни и те же фильтры — и для таблицы, и для выгрузки
  const filters: FarmAccountListParams = {
    search: debouncedSearch || undefined,
    status: status ?? undefined,
    failureReason: failureReason ?? undefined,
    period: period === "all" ? undefined : period,
  };

  const { data, isLoading } = useGetFarmAccounts({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const onExport = async () => {
    setIsExporting(true);

    try {
      const blob = await FarmService.exportAccounts(filters);
      downloadBlob(blob, `reg-accounts-${dayjs().format("YYYY-MM-DD")}.csv`);
    } catch (err) {
      // При responseType: blob текст ошибки тоже приходит blob'ом
      notification.error({ message: await blobErrorMessage(err) });
    } finally {
      setIsExporting(false);
    }
  };

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const rows = data?.items.map((account) => {
    const label = ACCOUNT_STATUS[account.status];

    return (
      <Table.Tr
        key={account.id}
        style={{ cursor: "pointer" }}
        onClick={() => setOpenedId(account.id)}
      >
        <Table.Td fz="sm" style={{ whiteSpace: "nowrap" }}>
          {formatDateTime(account.createdAt)}
        </Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            <Badge size="sm" fullWidth={false} color={label.color}>
              {account.kind === "restore" && account.status === "registered"
                ? "Восстановлен"
                : label.title}
            </Badge>
            {account.kind === "restore" && (
              <Badge size="sm" fullWidth={false} variant="light" color="violet">
                вход
              </Badge>
            )}
          </Group>
        </Table.Td>
        <Table.Td fz="sm">
          {account.status === "failed"
            ? failureReasonTitle(account.failureReason)
            : "—"}
        </Table.Td>
        <Table.Td fz="sm" ff="monospace">
          {account.phone ?? "—"}
        </Table.Td>
        <Table.Td fz="sm">{account.email.email}</Table.Td>
        <Table.Td fz="sm">{account.trunk?.name ?? "—"}</Table.Td>
        <Table.Td fz="sm">
          {account.firstName} {account.lastName}
        </Table.Td>
        <Table.Td fz="sm">{account.username ? `@${account.username}` : "—"}</Table.Td>
      </Table.Tr>
    );
  });

  const hasFilters = !!(debouncedSearch || status || failureReason || period !== "all");

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        {/* miw=0: на телефоне строка фильтров ужимается до экрана, а период
            листается вбок, а не распирает страницу */}
        <Group gap="sm" align="flex-end" miw={0}>
          <TextInput
            placeholder="Номер, почта, username, имя"
            w={260}
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
            data={Object.entries(ACCOUNT_STATUS).map(([value, item]) => ({
              value,
              label: item.title,
            }))}
            value={status}
            onChange={resetPage(setStatus)}
          />
          <Select
            placeholder="Любая причина"
            w={240}
            clearable
            data={Object.entries(FAILURE_REASON).map(([value, label]) => ({
              value,
              label,
            }))}
            value={failureReason}
            onChange={resetPage(setFailureReason)}
          />
          <SegmentedControl
            value={period}
            onChange={(value) => resetPage(setPeriod)(value as Period)}
            data={[
              { value: "all", label: "Всё время" },
              { value: "today", label: "Сегодня" },
              { value: "7d", label: "7 дней" },
              { value: "30d", label: "30 дней" },
            ]}
          />
        </Group>

        <Button
          variant="light"
          color="dark"
          leftSection={<IconFileDownload size={16} />}
          loading={isExporting}
          onClick={onExport}
        >
          Выгрузить CSV
        </Button>
      </Group>

      <Card withBorder p={0}>
        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : !data?.items.length ? (
          <Center p="xl">
            <Text c="gray.6">
              {hasFilters
                ? "Ничего не нашлось"
                : "Попыток пока нет — они появятся, когда регистрация начнёт брать номера"}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={1000}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Дата</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Причина</Table.Th>
                  <Table.Th>Номер</Table.Th>
                  <Table.Th>Почта</Table.Th>
                  <Table.Th>Транк</Table.Th>
                  <Table.Th>Имя и фамилия</Table.Th>
                  <Table.Th>Username</Table.Th>
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

      <AccountDrawer accountId={openedId} onClose={() => setOpenedId(null)} />
    </Stack>
  );
}
