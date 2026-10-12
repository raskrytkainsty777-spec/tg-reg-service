import { useEffect, useState } from "react";
import { SimpleGrid, TextInput } from "@mantine/core";

import {
  useGetFarmSettings,
  useUpdateFarmSettings,
} from "../../api/queries/farm.query";
import { errorMessage } from "./farmLabels";
import { notification } from "../Notification/Notification";
import { SaveButton, SettingsCard } from "../Settings/ui";

const SIP_FIELDS = [
  {
    key: "sipDomain",
    label: "SIP-сервер",
    description: "Куда регистрируются транки",
  },
  {
    key: "sipAuthDomain",
    label: "Домен авторизации",
    description: "Realm провайдера, обычно совпадает с сервером",
  },
  {
    key: "sipOutboundProxy",
    label: "Outbound proxy",
    description: "Общий для всех транков; у транка может быть свой",
  },
  {
    key: "sipIdentifyHost",
    label: "Хост входящих звонков",
    description: "С какого адреса провайдер присылает звонки",
  },
] as const;

type SipKey = (typeof SIP_FIELDS)[number]["key"];

/**
 * Параметры SIP-провайдера: из них и транков собирается конфиг Asterisk.
 * Asterisk подхватит изменения в течение 30 секунд
 */
export function SipProviderCard() {
  const { data: settings, isLoading } = useGetFarmSettings();
  const { mutateAsync: updateSettings, isPending } = useUpdateFarmSettings();

  const [sip, setSip] = useState<Record<SipKey, string>>({
    sipDomain: "",
    sipAuthDomain: "",
    sipOutboundProxy: "",
    sipIdentifyHost: "",
  });

  useEffect(() => {
    if (!settings) return;

    setSip({
      sipDomain: settings.sipDomain ?? "",
      sipAuthDomain: settings.sipAuthDomain ?? "",
      sipOutboundProxy: settings.sipOutboundProxy ?? "",
      sipIdentifyHost: settings.sipIdentifyHost ?? "",
    });
  }, [settings]);

  const onSave = async () => {
    try {
      await updateSettings({
        sipDomain: sip.sipDomain.trim(),
        sipAuthDomain: sip.sipAuthDomain.trim(),
        sipOutboundProxy: sip.sipOutboundProxy.trim(),
        sipIdentifyHost: sip.sipIdentifyHost.trim(),
      });

      notification.success({
        message: "SIP-провайдер сохранён",
        description: "Asterisk подхватит изменения в течение 30 секунд",
      });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="SIP-провайдер"
      ok={!!settings?.sipDomain}
      loading={isLoading}
      actions={<SaveButton loading={isPending} onClick={onSave} />}
    >
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {SIP_FIELDS.map((field) => (
          <TextInput
            key={field.key}
            label={field.label}
            description={field.description}
            value={sip[field.key]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSip((current) => ({ ...current, [field.key]: value }));
            }}
          />
        ))}
      </SimpleGrid>
    </SettingsCard>
  );
}
