import { useEffect, useState } from "react";
import {
  Button,
  Group,
  NumberInput,
  Pill,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

import {
  useGetRegistrationSettings,
  useUpdateRegistrationSettings,
} from "../../api/queries/settings.query";
import type { RegistrationSettings } from "../../api/services/settings.service";
import { errorMessage } from "../../helpers/errors";
import { notification } from "../Notification/Notification";
import { SaveButton, SettingsCard } from "./ui";

// Username канала в Telegram: латиница, цифры и подчёркивание, 4–32 символа
const USERNAME_RE = /^[A-Za-z0-9_]{4,32}$/;

/**
 * @name, t.me/name, https://t.me/name, t.me/s/name → name.
 * Ссылки-приглашения (t.me/+…, joinchat) не подходят: подписка идёт по username
 */
export const normalizeChannel = (raw: string): { name: string } | { error: string } => {
  let value = raw.trim();

  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.replace(/^(t\.me|telegram\.me|telegram\.dog)\//i, "");
  value = value.replace(/^s\//i, "");
  value = value.split(/[/?#]/)[0];
  value = value.replace(/^@/, "");

  if (value.startsWith("+") || /^joinchat$/i.test(value)) {
    return { error: `${raw}: приватные ссылки-приглашения не подходят — нужен @username` };
  }

  if (!USERNAME_RE.test(value)) {
    return { error: `${raw}: не похоже на канал (@name или t.me/name)` };
  }

  return { name: value };
};

type Form = Pick<
  RegistrationSettings,
  "channels" | "subscribeCount" | "disableMedia" | "disablePowerSaving"
>;

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Что сделать с аккаунтом сразу после регистрации */
export function AfterRegistrationSettings() {
  const { data: settings, isLoading } = useGetRegistrationSettings();
  const { mutateAsync: update, isPending } = useUpdateRegistrationSettings();

  const [form, setForm] = useState<Form>({
    channels: [],
    subscribeCount: 0,
    disableMedia: false,
    disablePowerSaving: false,
  });
  const [channelInput, setChannelInput] = useState("");
  const [channelError, setChannelError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;

    setForm({
      channels: settings.channels ?? [],
      subscribeCount: settings.subscribeCount ?? 0,
      disableMedia: !!settings.disableMedia,
      disablePowerSaving: !!settings.disablePowerSaving,
    });
  }, [settings]);

  // Можно вставить сразу несколько: через пробел, запятую или с новой строки
  const onAddChannels = () => {
    const parts = channelInput.split(/[\s,;]+/).filter(Boolean);

    if (!parts.length) return;

    const added: string[] = [];
    const errors: string[] = [];

    for (const part of parts) {
      const result = normalizeChannel(part);

      if ("error" in result) {
        errors.push(result.error);
      } else if (
        ![...form.channels, ...added].some(
          (channel) => channel.toLowerCase() === result.name.toLowerCase(),
        )
      ) {
        added.push(result.name);
      }
    }

    if (added.length) {
      setForm((current) => ({ ...current, channels: [...current.channels, ...added] }));
    }

    setChannelError(errors.length ? errors.join("; ") : null);
    // Неподошедшее оставляем в поле — поправить и добавить ещё раз
    setChannelInput(errors.length ? parts.filter((part) => "error" in normalizeChannel(part)).join(" ") : "");
  };

  const onRemoveChannel = (name: string) =>
    setForm((current) => ({
      ...current,
      channels: current.channels.filter((channel) => channel !== name),
    }));

  const onSave = async () => {
    if (!settings) return;

    // Шлём только изменённое
    const patch: Partial<RegistrationSettings> = {};
    const subscribeCount = Math.max(0, Number(form.subscribeCount) || 0);

    if (!sameList(form.channels, settings.channels ?? [])) patch.channels = form.channels;
    if (subscribeCount !== settings.subscribeCount) patch.subscribeCount = subscribeCount;
    if (form.disableMedia !== settings.disableMedia) patch.disableMedia = form.disableMedia;
    if (form.disablePowerSaving !== settings.disablePowerSaving) {
      patch.disablePowerSaving = form.disablePowerSaving;
    }

    if (!Object.keys(patch).length) {
      notification.success({ message: "Изменений нет" });
      return;
    }

    try {
      await update(patch);
      notification.success({ message: "Настройки после регистрации сохранены" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  const subscribeCount = Number(form.subscribeCount) || 0;

  return (
    <SettingsCard
      title="После регистрации"
      loading={isLoading}
      actions={<SaveButton loading={isPending} disabled={!settings} onClick={onSave} />}
    >
      <Switch
        label="Выключить автозагрузку медиа и экономию трафика"
        checked={form.disableMedia}
        onChange={(event) => {
          const disableMedia = event.currentTarget.checked;
          setForm((current) => ({ ...current, disableMedia }));
        }}
      />
      <Switch
        label="Выключить энергосбережение"
        checked={form.disablePowerSaving}
        onChange={(event) => {
          const disablePowerSaving = event.currentTarget.checked;
          setForm((current) => ({ ...current, disablePowerSaving }));
        }}
      />

      <Stack gap="xs">
        <Text fw={800} fz={18}>
          Каналы для подписки
        </Text>

        <Group gap="xs" align="flex-start" wrap="nowrap">
          <TextInput
            flex={1}
            placeholder="@channel или https://t.me/channel"
            value={channelInput}
            error={channelError}
            onChange={(event) => {
              setChannelInput(event.currentTarget.value);
              setChannelError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddChannels();
              }
            }}
          />
          <Button
            variant="outline"
            color="dark"
            leftSection={<IconPlus size={16} />}
            disabled={!channelInput.trim()}
            onClick={onAddChannels}
          >
            Добавить
          </Button>
        </Group>

        {form.channels.length ? (
          <Group gap={8}>
            {form.channels.map((channel) => (
              <Pill
                key={channel}
                size="md"
                withRemoveButton
                onRemove={() => onRemoveChannel(channel)}
                removeButtonProps={{ "aria-label": `Убрать @${channel}` }}
              >
                @{channel}
              </Pill>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="gray.6">
            Список пуст — подписываться не на что
          </Text>
        )}
      </Stack>

      <NumberInput
        maw={320}
        label="Подписаться на N каналов"
        description={
          subscribeCount > form.channels.length && form.channels.length
            ? `В списке всего ${form.channels.length} — подпишется на все`
            : "0 — не подписываться. Каналы берутся случайно из списка"
        }
        min={0}
        max={100}
        allowDecimal={false}
        value={form.subscribeCount}
        onChange={(value) =>
          setForm((current) => ({ ...current, subscribeCount: Number(value) || 0 }))
        }
      />
    </SettingsCard>
  );
}
