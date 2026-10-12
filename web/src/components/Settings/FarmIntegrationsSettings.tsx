import { useEffect, useState } from "react";
import { PasswordInput, SimpleGrid, Stack, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import apiInstance from "../../api/instance";
import { errorMessage } from "../Farm/farmLabels";
import { notification } from "../Notification/Notification";
import { SaveButton, SettingsCard } from "./ui";
import { savedKeyPlaceholder } from "./help";

interface FarmIntegrations {
  geelarkConfigured: boolean;
  geelarkKeyHint: string | null;
  proxymaConfigured: boolean;
  proxymaKeyHint: string | null;
  proxymaPackageKey: string;
}

const BASE = "/farm/accounts/settings";

const useFarmIntegrations = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["farm-accounts", "integrations"],
    queryFn: async () => (await apiInstance.get<FarmIntegrations>(BASE)).data,
  });

  // Шлём только поля своей карточки: адрес API GeeLark, хост шлюза и порты
  // Proxyma сервер берёт по умолчанию или из API Proxyma
  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await apiInstance.patch(BASE, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farm-accounts"] });
    },
  });

  return { ...query, save: mutation.mutateAsync, isSaving: mutation.isPending };
};

function GeelarkCard() {
  const { data, isLoading, save, isSaving } = useFarmIntegrations();
  const [apiKey, setApiKey] = useState("");

  const onSave = async () => {
    try {
      await save({ geelarkApiKey: apiKey.trim() });
      setApiKey("");
      notification.success({ message: "Ключ GeeLark сохранён" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="GeeLark"
      ok={data?.geelarkConfigured}
      loading={isLoading}
      actions={
        <SaveButton
          loading={isSaving}
          disabled={!apiKey.trim()}
          onClick={onSave}
        />
      }
    >
      <PasswordInput
        label="API-ключ"
        placeholder={
          data?.geelarkConfigured
            ? savedKeyPlaceholder(data.geelarkKeyHint)
            : undefined
        }
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
      />
    </SettingsCard>
  );
}

function ProxymaCard() {
  const { data, isLoading, save, isSaving } = useFarmIntegrations();
  const [apiKey, setApiKey] = useState("");
  const [packageKey, setPackageKey] = useState("");

  useEffect(() => {
    if (data) setPackageKey(data.proxymaPackageKey);
  }, [data]);

  const onSave = async () => {
    try {
      await save({
        proxymaPackageKey: packageKey.trim(),
        // Пустое поле ключа — сохранённый не трогаем
        ...(apiKey.trim() ? { proxymaApiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      notification.success({ message: "Proxyma сохранена" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="Proxyma"
      ok={data?.proxymaConfigured && !!data.proxymaPackageKey}
      loading={isLoading}
      actions={<SaveButton loading={isSaving} onClick={onSave} />}
    >
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <PasswordInput
          label="API-ключ"
          placeholder={
            data?.proxymaConfigured
              ? savedKeyPlaceholder(data.proxymaKeyHint)
              : undefined
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
        <TextInput
          label="Ключ пакета"
          value={packageKey}
          onChange={(event) => setPackageKey(event.currentTarget.value)}
        />
      </SimpleGrid>
    </SettingsCard>
  );
}

/** Ключи: GeeLark (облачные телефоны) и Proxyma (мобильные прокси телефонов) */
export function FarmIntegrationsSettings() {
  return (
    <Stack gap="lg">
      <GeelarkCard />
      <ProxymaCard />
    </Stack>
  );
}
