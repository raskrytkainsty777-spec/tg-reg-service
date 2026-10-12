import { useEffect, useState } from "react";
import { NumberInput, SimpleGrid, TextInput } from "@mantine/core";

import {
  useGetFarmSettings,
  useUpdateFarmSettings,
} from "../../api/queries/farm.query";
import { errorMessage } from "./farmLabels";
import { notification } from "../Notification/Notification";
import { SaveButton, SettingsCard } from "../Settings/ui";

const DEFAULT_HOST = "imap.rambler.ru";
const DEFAULT_PORT = 993;

/** IMAP почтового сервиса: через него читаются коды подтверждения с почт */
export function ImapSettingsCard() {
  const { data: settings, isLoading } = useGetFarmSettings();
  const { mutateAsync: updateSettings, isPending } = useUpdateFarmSettings();

  const [imapHost, setImapHost] = useState(DEFAULT_HOST);
  const [imapPort, setImapPort] = useState<number | string>(DEFAULT_PORT);

  useEffect(() => {
    if (!settings) return;

    setImapHost(settings.imapHost || DEFAULT_HOST);
    setImapPort(settings.imapPort || DEFAULT_PORT);
  }, [settings]);

  const onSave = async () => {
    const port = Number(imapPort);

    if (!imapHost.trim() || !port || port < 1 || port > 65535) {
      notification.error({ message: "Укажите сервер и порт от 1 до 65535" });
      return;
    }

    try {
      await updateSettings({ imapHost: imapHost.trim(), imapPort: port });
      notification.success({ message: "IMAP сохранён" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="IMAP"
      loading={isLoading}
      actions={<SaveButton loading={isPending} onClick={onSave} />}
    >
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput
          label="Сервер"
          placeholder={DEFAULT_HOST}
          value={imapHost}
          onChange={(event) => setImapHost(event.currentTarget.value)}
        />
        <NumberInput
          label="Порт"
          placeholder={String(DEFAULT_PORT)}
          min={1}
          max={65535}
          allowDecimal={false}
          value={imapPort}
          onChange={setImapPort}
        />
      </SimpleGrid>
    </SettingsCard>
  );
}
