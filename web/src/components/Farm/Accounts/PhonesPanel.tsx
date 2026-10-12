import { useMemo, useState } from "react";
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
  Menu,
  NumberInput,
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
  IconDotsVertical,
  IconFileDownload,
  IconHistory,
  IconPlugConnected,
  IconSwitchHorizontal,
  IconTrash,
} from "@tabler/icons-react";
import dayjs from "dayjs";

import {
  useCheckFarmPhoneProxy,
  useCheckFarmProxiesBulk,
  useCreateFarmGroup,
  useDeleteFarmGroup,
  useDeleteFarmPhones,
  useGetFarmGroups,
  useGetFarmPhones,
  useMoveFarmPhones,
  useReplaceFarmPhoneProxy,
} from "../../../api/queries/farmAccounts.query";
import type { FarmPhone } from "../../../api/services/farmAccounts.service";
import { downloadBlob, errorMessage, formatDateTime } from "../farmLabels";
import { notification } from "../../Notification/Notification";
import { CreatePhonesModal } from "./CreatePhonesModal";
import { PhoneHistoryModal } from "./PhoneHistoryModal";
import {
  PROXY_STATES,
  accountState,
  accountStateOptions,
  countryFlag,
} from "./accountLabels";
import { KpiCard, KpiGrid } from "../../ui/wa";
import { PILL_SELECT } from "../../ui/format";
import { csvBlob } from "../../../helpers/csv";
import { WA } from "../../../theme";

const PAGE_SIZES = [20, 50, 100, 1000];

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value, sticker }: StatProps & { sticker?: boolean }) {
  return <KpiCard compact label={label} value={value} color={sticker ? WA.orange : undefined} />;
}

/**
 * Телефоны GeeLark с привязанными Telegram-аккаунтами.
 * Один телефон — один аккаунт, поэтому строка таблицы и есть телефон
 */
export function PhonesPanel() {
  const [groupId, setGroupId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<string[]>([]);
  const [firstN, setFirstN] = useState<number | string>("");
  const [historyPhone, setHistoryPhone] = useState<FarmPhone | null>(null);
  const [createOpened, createHandlers] = useDisclosure(false);

  const [debouncedSearch] = useDebouncedValue(search, 300);

  const { data: groups } = useGetFarmGroups();
  const { data, isLoading } = useGetFarmPhones({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    groupId: groupId === "all" ? undefined : groupId,
    status,
  });

  const { mutateAsync: createGroup } = useCreateFarmGroup();
  const { mutateAsync: deleteGroup } = useDeleteFarmGroup();
  const { mutateAsync: movePhones } = useMoveFarmPhones();
  const { mutateAsync: checkProxiesBulk, isPending: proxyBulkPending } =
    useCheckFarmProxiesBulk();
  const { mutateAsync: deletePhones } = useDeleteFarmPhones();
  const { mutateAsync: checkProxy, isPending: checking } = useCheckFarmPhoneProxy();
  const { mutateAsync: replaceProxy } = useReplaceFarmPhoneProxy();

  // Цифры показываем по выбранной группе: оператор смотрит на свой кусок
  const stat = useMemo(() => {
    if (!groups) return null;
    if (groupId === "all") return groups.total;
    if (groupId === "none") return groups.ungrouped;

    return groups.groups.find((group) => group.id === groupId) ?? groups.total;
  }, [groups, groupId]);

  const currentGroup = groups?.groups.find((group) => group.id === groupId) ?? null;

  const items = data?.items ?? [];
  const allChecked = !!items.length && items.every((item) => selected.includes(item.id));

  const applyFilter = (reset: () => void) => {
    reset();
    setPage(1);
    setSelected([]);
  };

  const onCreateGroup = () => {
    let name = "";

    modals.open({
      title: "Новая группа",
      children: (
        <Stack>
          <TextInput
            label="Название"
            placeholder="например, Германия"
            data-autofocus
            onChange={(event) => {
              name = event.currentTarget.value;
            }}
          />
          <Button
            color="dark"
            onClick={async () => {
              try {
                const group = await createGroup({ name: name.trim() });
                applyFilter(() => setGroupId(group.id));
                modals.closeAll();
              } catch (err) {
                notification.error({ message: errorMessage(err) });
              }
            }}
          >
            Создать
          </Button>
        </Stack>
      ),
    });
  };

  // Телефоны группы не удаляются — остаются без группы
  const onDeleteGroup = () => {
    if (!currentGroup) return;

    modals.openConfirmModal({
      title: `Удалить группу «${currentGroup.name}»`,
      centered: true,
      children: (
        <Text size="sm">
          Телефоны группы ({currentGroup.phones}) не удалятся — они останутся без
          группы.
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await deleteGroup(currentGroup.id);
          applyFilter(() => setGroupId("all"));
          notification.success({ message: `Группа «${currentGroup.name}» удалена` });
        } catch (err) {
          notification.error({ message: errorMessage(err) });
        }
      },
    });
  };

  const onSelectFirstN = () => {
    const count = Number(firstN);

    if (!count || count < 1) return;

    setSelected(items.slice(0, count).map((item) => item.id));
  };

  const onMove = async (targetId: string | null) => {
    try {
      const result = await movePhones({ ids: selected, groupId: targetId });
      setSelected([]);
      notification.success({ message: `Перенесено: ${result.moved}` });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  const onCheckProxies = async () => {
    try {
      const result = await checkProxiesBulk(selected);
      notification.success({
        message: `Проверено ${result.checked}: живых ${result.ok}, мёртвых ${result.dead}`,
      });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  const onCheckProxy = async (phone: FarmPhone) => {
    try {
      const proxy = await checkProxy(phone.id);
      const label = PROXY_STATES[proxy.status]?.label ?? proxy.status;

      if (proxy.status === "ok") {
        notification.success({
          message: `${phone.profileName}: прокси ${label}`,
          description: proxy.latencyMs ? `${proxy.latencyMs} мс` : undefined,
        });
      } else {
        notification.error({
          message: `${phone.profileName}: прокси ${label}`,
          description: proxy.error ?? undefined,
        });
      }
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  // Удаление сносит профили и в GeeLark — оттуда их уже не вернуть,
  // поэтому спрашиваем и отдельно предупреждаем про телефоны с аккаунтом
  const onDelete = (ids: string[]) => {
    const withAccount = items.filter(
      (item) => ids.includes(item.id) && item.account,
    ).length;

    modals.openConfirmModal({
      title: `Удалить телефонов: ${ids.length}`,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            Профили удалятся и в GeeLark — вернуть их оттуда нельзя.
          </Text>
          {!!withAccount && (
            <Text size="sm" c="red.7">
              С привязанным Telegram-аккаунтом: {withAccount}. Аккаунты будут
              потеряны вместе с телефонами.
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          const result = await deletePhones({ ids, inGeelark: true });
          setSelected([]);
          notification.success({ message: `Удалено телефонов: ${result.deleted}` });
        } catch (err) {
          notification.error({ message: errorMessage(err) });
        }
      },
    });
  };

  const onReplaceProxy = async (phone: FarmPhone) => {
    try {
      const proxy = await replaceProxy(phone.id);
      notification.success({
        message: `${phone.profileName}: новый прокси ${proxy.host}:${proxy.port}`,
      });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  // Выгрузка — только загруженная страница: нужна вся группа — ставьте 1000 строк
  const onExport = () => {
    if (!items.length) {
      notification.error({ message: "На странице нет телефонов" });
      return;
    }

    const blob = csvBlob(
      ["profileName", "accountPhone", "firstName", "lastName", "username", "registeredAt"],
      items.map((phone) => [
        phone.profileName,
        phone.account?.phone,
        phone.account?.firstName,
        phone.account?.lastName,
        phone.account?.username,
        phone.account?.registeredAt
          ? dayjs(phone.account.registeredAt).format("YYYY-MM-DD HH:mm:ss")
          : "",
      ]),
    );

    downloadBlob(blob, `phones-${dayjs().format("YYYY-MM-DD")}.csv`);
  };

  const rows = items.map((phone) => {
    const account = phone.account;
    const state = accountState(account?.status ?? "idle");
    const proxyState = phone.proxy ? PROXY_STATES[phone.proxy.status] : null;

    return (
      <Table.Tr key={phone.id}>
        <Table.Td w={40}>
          <Checkbox
            checked={selected.includes(phone.id)}
            onChange={(event) =>
              setSelected((current) =>
                event.currentTarget.checked
                  ? [...current, phone.id]
                  : current.filter((id) => id !== phone.id),
              )
            }
          />
        </Table.Td>

        <Table.Td>
          <Group gap={6} wrap="nowrap">
            <Text size="sm">{countryFlag(phone.countryCode)}</Text>
            <Text fz={16} fw={800} c="orange" style={{ whiteSpace: "nowrap" }}>
              {phone.profileName}
            </Text>
          </Group>
        </Table.Td>

        <Table.Td>
          <Text fz={15} style={{ whiteSpace: "nowrap" }}>
            {account?.phone ?? "—"}
          </Text>
        </Table.Td>

        <Table.Td>
          {account ? (
            <Stack gap={0}>
              <Text fz={16} fw={800}>
                {[account.firstName, account.lastName].filter(Boolean).join(" ") || "—"}
              </Text>
              {account.username && (
                <Text fz={13} c="gray.6">
                  @{account.username}
                </Text>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="gray.6">
              аккаунта нет
            </Text>
          )}
        </Table.Td>

        <Table.Td>
          <Badge variant="light" color={state.color} fullWidth={false}>
            {state.label}
          </Badge>
          {account?.status === "temp_block" && account.blockedUntil && (
            <Text size="xs" c="gray.6" mt={2} style={{ whiteSpace: "nowrap" }}>
              до {formatDateTime(account.blockedUntil)}
            </Text>
          )}
        </Table.Td>

        <Table.Td>
          {phone.proxy ? (
            <Tooltip
              label={phone.proxy.error ?? `${phone.proxy.host}:${phone.proxy.port}`}
              multiline
              maw={320}
            >
              <Stack gap={0}>
                <Badge
                  size="sm"
                  variant="light"
                  color={proxyState?.color}
                  fullWidth={false}
                  style={{ alignSelf: "flex-start" }}
                >
                  {proxyState?.label}
                  {phone.proxy.latencyMs ? ` · ${phone.proxy.latencyMs} мс` : ""}
                </Badge>
                <Text fz={13} c="dimmed" mt={4}>
                  {phone.proxy.host}:{phone.proxy.port}
                </Text>
              </Stack>
            </Tooltip>
          ) : (
            <Text size="sm" c="gray.6">
              нет
            </Text>
          )}
        </Table.Td>

        <Table.Td>
          <Text fz={14} c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {formatDateTime(account?.registeredAt)}
          </Text>
        </Table.Td>

        <Table.Td w={40}>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Действия">
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconHistory size={14} />}
                onClick={() => setHistoryPhone(phone)}
              >
                История
              </Menu.Item>
              <Menu.Item
                leftSection={<IconPlugConnected size={14} />}
                disabled={checking}
                onClick={() => onCheckProxy(phone)}
              >
                Проверить прокси
              </Menu.Item>
              <Menu.Item
                leftSection={<IconSwitchHorizontal size={14} />}
                onClick={() => onReplaceProxy(phone)}
              >
                Заменить прокси
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => onDelete([phone.id])}
              >
                Удалить телефон
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Stack gap={24}>
      <KpiGrid min={200}>
        <Stat label="Телефонов" value={String(stat?.phones ?? 0)} />
        <Stat sticker label="С аккаунтом" value={String(stat?.accounts ?? 0)} />
        <Stat
          label="Без аккаунта"
          value={String(Math.max(0, (stat?.phones ?? 0) - (stat?.accounts ?? 0)))}
        />
      </KpiGrid>

      <Group gap={12}>
        <Select
          w={220}
          radius={999}
          styles={PILL_SELECT}
          value={groupId}
          onChange={(value) => applyFilter(() => setGroupId(value ?? "all"))}
          data={[
            { value: "all", label: `Все группы (${groups?.total.phones ?? 0})` },
            { value: "none", label: `Без группы (${groups?.ungrouped.phones ?? 0})` },
            ...(groups?.groups ?? []).map((group) => ({
              value: group.id,
              label: `${group.name} (${group.phones})`,
            })),
          ]}
        />
        <Button variant="outline" color="dark" onClick={onCreateGroup}>
          + Группа
        </Button>
        {currentGroup && (
          <Tooltip label="Удалить группу">
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Удалить группу"
              onClick={onDeleteGroup}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}

        <TextInput
          flex={1}
          miw={220}
          placeholder="Поиск по телефону, номеру, нику"
          radius={999}
          value={search}
          onChange={(event) => applyFilter(() => setSearch(event.currentTarget.value))}
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
          w={190}
          radius={999}
          styles={PILL_SELECT}
          value={status}
          onChange={(value) => applyFilter(() => setStatus(value ?? "all"))}
          data={accountStateOptions}
        />

        <NumberInput
          w={110}
          min={1}
          placeholder="первые N"
          value={firstN}
          onChange={setFirstN}
        />
        <Button variant="outline" color="dark" onClick={onSelectFirstN}>
          Выделить
        </Button>

        <Button
          variant="light"
          color="dark"
          leftSection={<IconFileDownload size={16} />}
          onClick={onExport}
        >
          CSV
        </Button>

        <Button color="orange" onClick={createHandlers.open}>
          + Создать телефоны
        </Button>
      </Group>

      {!!selected.length && (
        <Group gap="xs">
          <Text size="sm" c="gray.7">
            Выбрано: {selected.length}
          </Text>
          <Select
            w={220}
            placeholder="Перенести в группу"
            value={null}
            data={[
              { value: "none", label: "Без группы" },
              ...(groups?.groups ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              })),
            ]}
            onChange={(value) => value && onMove(value === "none" ? null : value)}
          />

          <Button
            variant="light"
            color="gray"
            leftSection={<IconPlugConnected size={16} />}
            loading={proxyBulkPending}
            onClick={onCheckProxies}
          >
            Прокси
          </Button>

          <Button
            variant="light"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={() => onDelete(selected)}
          >
            Удалить
          </Button>

          <Button variant="subtle" color="gray" onClick={() => setSelected([])}>
            Снять выделение
          </Button>
        </Group>
      )}

      <Card withBorder p={0}>
        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : !items.length ? (
          <Center p="xl">
            <Text c="gray.6">
              {debouncedSearch || status !== "all"
                ? "Ничего не нашлось"
                : "Телефонов пока нет"}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={960} type="native">
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox
                      checked={allChecked}
                      indeterminate={!allChecked && !!selected.length}
                      onChange={(event) =>
                        setSelected(
                          event.currentTarget.checked
                            ? items.map((item) => item.id)
                            : [],
                        )
                      }
                    />
                  </Table.Th>
                  <Table.Th>Телефон</Table.Th>
                  <Table.Th>Номер</Table.Th>
                  <Table.Th>Аккаунт</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Прокси</Table.Th>
                  <Table.Th>Регистрация</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{rows}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Group justify="space-between">
        <Group gap="xs">
          <Text size="sm" c="gray.6">
            Всего: {data?.total ?? 0}
          </Text>
          <Text size="sm" c="gray.6">
            Строк:
          </Text>
          {PAGE_SIZES.map((size) => (
            <Button
              key={size}
              size="compact-xs"
              variant={pageSize === size ? "filled" : "subtle"}
              color={pageSize === size ? "dark" : "gray"}
              onClick={() => applyFilter(() => setPageSize(size))}
            >
              {size}
            </Button>
          ))}
        </Group>
        {(data?.totalPages ?? 1) > 1 && (
          <Pagination
            total={data?.totalPages ?? 1}
            value={page}
            onChange={setPage}
            size="sm"
          />
        )}
      </Group>

      <CreatePhonesModal
        opened={createOpened}
        onClose={createHandlers.close}
        groups={groups?.groups ?? []}
        groupId={groupId === "all" || groupId === "none" ? null : groupId}
      />

      <PhoneHistoryModal
        phoneId={historyPhone?.id ?? null}
        title={historyPhone?.profileName ?? ""}
        onClose={() => setHistoryPhone(null)}
      />
    </Stack>
  );
}
