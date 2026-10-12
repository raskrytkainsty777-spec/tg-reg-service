import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconBan,
  IconList,
  IconPencil,
  IconPhoneCall,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";

import {
  useDeleteFarmTrunk,
  useGetFarmTrunks,
  useImportFarmTrunkPhones,
  useMarkFarmPhonesInvalidBulk,
  useRestoreFarmNoCallPhones,
  useUpdateFarmTrunk,
} from "../../api/queries/farm.query";
import type { FarmTrunk } from "../../api/services/farm.service";
import { AsteriskPanel } from "./AsteriskPanel";
import { SipProviderCard } from "./SipProviderCard";
import { ImportTextModal } from "./ImportTextModal";
import { showImportResult } from "./ImportResult";
import { TrunkFormModal } from "./TrunkFormModal";
import { TrunkPhonesModal } from "./TrunkPhonesModal";
import {
  LOCK_STAGE,
  RESOURCE_STATUSES,
  errorMessage,
  resourceStatus,
} from "./farmLabels";
import { notification } from "../Notification/Notification";

interface TrunkCardProps {
  trunk: FarmTrunk;
  onEdit: () => void;
  onImport: () => void;
  onPhones: () => void;
}

function TrunkCard({ trunk, onEdit, onImport, onPhones }: TrunkCardProps) {
  const { mutateAsync: updateTrunk, isPending: isToggling } =
    useUpdateFarmTrunk();
  const { mutateAsync: deleteTrunk } = useDeleteFarmTrunk();

  const onToggle = (enabled: boolean) =>
    updateTrunk({ id: trunk.id, form: { enabled } })
      .then(() =>
        notification.success({
          message: enabled
            ? `Транк ${trunk.name} включён`
            : `Транк ${trunk.name} выключен`,
          description: "Asterisk подхватит изменение в течение 30 секунд",
        })
      )
      .catch((err) => notification.error({ message: errorMessage(err) }));

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "Удалить транк",
      centered: true,
      children: (
        <Text size="sm">
          Удалить транк {trunk.name} вместе с его номерами ({trunk.phonesCount})?
          Аккаунты, зарегистрированные на нём, останутся.
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        deleteTrunk(trunk.id)
          .then(() =>
            notification.success({ message: `Транк ${trunk.name} удалён` })
          )
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  const { lock } = trunk;
  const counts = RESOURCE_STATUSES.filter(
    (status) => trunk.phoneStatusCounts[status]
  );

  return (
    <Card withBorder radius={16} bg={trunk.enabled ? undefined : "gray.0"}>
      <Stack gap="sm">
        {/* На телефоне кнопки уходят строкой ниже, а не за край карточки */}
        <Group justify="space-between" wrap="wrap" align="flex-start" gap="xs">
          <Group gap="xs" miw={0}>
            <Title order={4} ff="monospace" style={{ wordBreak: "break-all" }}>
              {trunk.name}
            </Title>
            <Badge
              size="sm"
              fullWidth={false}
              variant="light"
              color={trunk.sipPasswordSet ? "green" : "red"}
            >
              {trunk.sipPasswordSet ? "пароль задан" : "нет пароля"}
            </Badge>
            {lock.locked && (
              <Badge size="sm" fullWidth={false} color="blue">
                идёт рега
              </Badge>
            )}
          </Group>

          <Group gap={4} wrap="wrap">
            <Switch
              mr="xs"
              label={trunk.enabled ? "Включён" : "Выключен"}
              checked={trunk.enabled}
              disabled={isToggling}
              onChange={(event) => onToggle(event.currentTarget.checked)}
            />
            <Tooltip label="Загрузить номера">
              <ActionIcon variant="subtle" color="dark" onClick={onImport}>
                <IconUpload size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Номера">
              <ActionIcon variant="subtle" color="blue" onClick={onPhones}>
                <IconList size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Изменить">
              <ActionIcon variant="subtle" color="gray" onClick={onEdit}>
                <IconPencil size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Удалить">
              <ActionIcon variant="subtle" color="red" onClick={confirmDelete}>
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            color="dark"
            onClick={onPhones}
          >
            Номеров: {trunk.phonesCount}
          </Button>
          {counts.map((status) => {
            const label = resourceStatus(status, "phone");

            return (
              <Button
                key={status}
                size="compact-xs"
                variant="light"
                color={label.color}
                onClick={onPhones}
              >
                {label.title}: {trunk.phoneStatusCounts[status]}
              </Button>
            );
          })}
          <Text size="xs" c="gray.6">
            Аккаунтов: {trunk.accountsCount}
          </Text>
        </Group>

        {lock.locked ? (
          <Group gap="xs">
            <IconPhoneCall size={16} color="var(--mantine-color-blue-6)" />
            <Text size="sm">
              Идёт рега
              {lock.account?.phone ? `: номер ${lock.account.phone}` : ""}
              {" · "}
              {LOCK_STAGE[lock.account?.stage ?? "reserving"]}
              {lock.ttlSeconds !== null
                ? ` · осталось ${lock.ttlSeconds} сек`
                : ""}
            </Text>
          </Group>
        ) : (
          <Text size="sm" c="gray.6">
            {trunk.enabled
              ? "Свободен — ждёт следующую регу"
              : "Выключен — номера не выдаются"}
          </Text>
        )}

        {trunk.outboundProxy && (
          <Text size="sm" c="gray.7">
            Outbound proxy:{" "}
            <Text span ff="monospace" size="sm" style={{ wordBreak: "break-all" }}>
              {trunk.outboundProxy}
            </Text>
          </Text>
        )}

        {trunk.notes && (
          <Text size="sm" c="gray.7" style={{ whiteSpace: "pre-wrap" }}>
            {trunk.notes}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** SIP-транки провайдера и их номера. Сверху — общие настройки провайдера */
export function TrunksPanel() {
  const { data, isLoading } = useGetFarmTrunks();

  const [formOpened, formHandlers] = useDisclosure(false);
  const [bulkBlockOpened, bulkBlockHandlers] = useDisclosure(false);
  // Снимок транка на момент клика: список обновляется каждые 10 секунд,
  // а форма не должна сбрасываться посреди правки
  const [editingTrunk, setEditingTrunk] = useState<FarmTrunk | null>(null);
  const [importTrunk, setImportTrunk] = useState<FarmTrunk | null>(null);
  const [phonesTrunk, setPhonesTrunk] = useState<FarmTrunk | null>(null);

  const { mutateAsync: importPhones, isPending: isImporting } =
    useImportFarmTrunkPhones();
  const { mutateAsync: restoreNoCall } = useRestoreFarmNoCallPhones();
  const { mutateAsync: markInvalidBulk, isPending: isBlocking } =
    useMarkFarmPhonesInvalidBulk();

  const openForm = (trunk: FarmTrunk | null) => {
    setEditingTrunk(trunk);
    formHandlers.open();
  };

  const onImport = async (text: string) => {
    if (!importTrunk) return;

    const result = await importPhones({ id: importTrunk.id, text });

    showImportResult({
      title: `Загружено номеров в ${importTrunk.name}: ${result.created}`,
      description: result.invalid.length
        ? `Не загружено: ${result.invalid.length}`
        : undefined,
      rows: result.invalid,
    });
  };

  const onBulkBlock = async (text: string) => {
    const result = await markInvalidBulk(text);

    showImportResult({
      title: `Заблокировано номеров: ${result.invalidated.length}`,
      description: result.notFound.length
        ? `Не найдены: ${result.notFound.length}`
        : undefined,
      rowsTitle: "Не заблокированы",
      rows: [
        ...result.notFound.map((row) => ({
          row,
          reason: "Номера нет ни в одном транке",
        })),
        ...result.invalid,
      ],
    });
  };

  const confirmRestoreNoCall = () =>
    modals.openConfirmModal({
      title: "Вернуть номера «без звонка» в работу",
      centered: true,
      children: (
        <Text size="sm">
          Все номера со статусом «Без звонка» снова станут свободными и пойдут в
          регу по кругу.
        </Text>
      ),
      labels: { confirm: "Вернуть", cancel: "Отмена" },
      onConfirm: () =>
        restoreNoCall()
          .then((result) =>
            notification.success({
              message: `Возвращено в работу: ${result.restored}`,
            })
          )
          .catch((err) => notification.error({ message: errorMessage(err) })),
    });

  return (
    <Stack gap="md">
      <SipProviderCard />

      {data && <AsteriskPanel asterisk={data.asterisk} />}

      <Group justify="space-between">
        <Button
          color="dark"
          leftSection={<IconPlus size={16} />}
          onClick={() => openForm(null)}
        >
          Добавить транк
        </Button>

        <Group gap="xs">
          <Button
            variant="light"
            color="green"
            leftSection={<IconRefresh size={16} />}
            onClick={confirmRestoreNoCall}
          >
            Вернуть «без звонка» в работу
          </Button>
          <Button
            variant="light"
            color="red"
            leftSection={<IconBan size={16} />}
            onClick={bulkBlockHandlers.open}
          >
            Заблокировать номера списком
          </Button>
        </Group>
      </Group>

      {isLoading && (
        <Center p="xl">
          <Loader />
        </Center>
      )}

      {data && !data.items.length && (
        <Card withBorder radius={16}>
          <Center p="lg">
            <Text c="gray.6">
              Транков пока нет — добавьте SIP-логин и пароль от провайдера
            </Text>
          </Center>
        </Card>
      )}

      {data?.items.map((trunk) => (
        <TrunkCard
          key={trunk.id}
          trunk={trunk}
          onEdit={() => openForm(trunk)}
          onImport={() => setImportTrunk(trunk)}
          onPhones={() => setPhonesTrunk(trunk)}
        />
      ))}

      <TrunkFormModal
        opened={formOpened}
        onClose={formHandlers.close}
        trunk={editingTrunk}
      />

      <TrunkPhonesModal
        trunk={phonesTrunk}
        onClose={() => setPhonesTrunk(null)}
      />

      <ImportTextModal
        opened={!!importTrunk}
        onClose={() => setImportTrunk(null)}
        title={`Загрузить номера в ${importTrunk?.name ?? ""}`}
        description="По одному на строку. Номера РФ: 7XXXXXXXXXX, 8… и 9… приводятся к 7… Номера сразу уходят в регу по кругу"
        placeholder={"79991234567\n89991234568"}
        submitLabel="Загрузить"
        loading={isImporting}
        onSubmit={onImport}
      />

      <ImportTextModal
        opened={bulkBlockOpened}
        onClose={bulkBlockHandlers.close}
        title="Заблокировать номера списком"
        description="По одному на строку. Номера перестанут выдаваться в регу; если по номеру сейчас идёт рега, она будет сорвана"
        placeholder={"79991234567\n79991234568"}
        submitLabel="Заблокировать"
        submitColor="red"
        loading={isBlocking}
        onSubmit={onBulkBlock}
      />
    </Stack>
  );
}
