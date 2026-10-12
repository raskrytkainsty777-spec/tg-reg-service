import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";

import {
  useCreateFarmTrunk,
  useUpdateFarmTrunk,
} from "../../api/queries/farm.query";
import type { FarmTrunk } from "../../api/services/farm.service";
import { errorMessage } from "./farmLabels";
import { notification } from "../Notification/Notification";

// Имя секции в pjsip.conf строится из SIP-ID — только безопасные символы
const TRUNK_NAME_RE = /^[A-Za-z0-9_.-]+$/;

interface TrunkFormModalProps {
  opened: boolean;
  onClose: () => void;
  // Нет транка — создаём новый
  trunk: FarmTrunk | null;
}

/** Добавить или изменить SIP-транк. Пустой пароль при правке — оставить прежний */
export function TrunkFormModal({ opened, onClose, trunk }: TrunkFormModalProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [outboundProxy, setOutboundProxy] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const { mutateAsync: createTrunk, isPending: isCreating } =
    useCreateFarmTrunk();
  const { mutateAsync: updateTrunk, isPending: isUpdating } =
    useUpdateFarmTrunk();

  useEffect(() => {
    if (!opened) return;

    setName(trunk?.name ?? "");
    setPassword("");
    setNotes(trunk?.notes ?? "");
    setOutboundProxy(trunk?.outboundProxy ?? "");
    setNameError(null);
  }, [opened, trunk]);

  const onSubmit = async () => {
    const trimmed = name.trim();

    if (!TRUNK_NAME_RE.test(trimmed)) {
      setNameError("Только латиница, цифры, точка, дефис и подчёркивание");
      return;
    }

    try {
      if (trunk) {
        await updateTrunk({
          id: trunk.id,
          form: {
            name: trimmed,
            ...(password.trim() ? { sipPassword: password.trim() } : {}),
            notes: notes.trim() || null,
            // Пусто — стереть свой и брать общий из «SIP-провайдера»
            outboundProxy: outboundProxy.trim() || null,
          },
        });
        notification.success({ message: `Транк ${trimmed} сохранён` });
      } else {
        await createTrunk({
          name: trimmed,
          sipPassword: password.trim(),
          notes: notes.trim() || null,
          outboundProxy: outboundProxy.trim() || null,
        });
        notification.success({
          message: `Транк ${trimmed} добавлен`,
          description: "Asterisk подхватит его в течение 30 секунд",
        });
      }

      onClose();
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={trunk ? `Транк ${trunk.name}` : "Добавить транк"}
      centered
    >
      <Stack>
        <TextInput
          label="SIP-логин (SIP-ID)"
          description="Логин транка у провайдера"
          placeholder="SIP123456"
          required
          value={name}
          error={nameError}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setNameError(null);
          }}
        />
        <PasswordInput
          label="Пароль SIP"
          description={
            trunk
              ? trunk.sipPasswordSet
                ? "Пароль задан. Оставьте пустым, чтобы не менять"
                : "Пароль не задан"
              : undefined
          }
          required={!trunk}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <TextInput
          label="Свой outbound proxy"
          description="Пусто — берётся из «SIP-провайдера»"
          placeholder="sip:proxy.example.com:5060"
          value={outboundProxy}
          onChange={(event) => setOutboundProxy(event.currentTarget.value)}
        />
        <Textarea
          label="Заметка"
          placeholder="Например: чей транк, откуда номера"
          autosize
          minRows={2}
          maxRows={5}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button
            color="dark"
            loading={isCreating || isUpdating}
            disabled={!name.trim() || (!trunk && !password.trim())}
            onClick={onSubmit}
          >
            {trunk ? "Сохранить" : "Добавить"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
