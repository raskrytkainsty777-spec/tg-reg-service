import { useState, type FormEvent } from "react";
import {
  ActionIcon,
  Button,
  CopyButton,
  Divider,
  Group,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCheck, IconCopy, IconRefresh } from "@tabler/icons-react";

import {
  useChangePassword,
  useGetAccessToken,
  useRegenerateAccessToken,
} from "../../api/queries/auth.query";
import { errorMessage } from "../../helpers/errors";
import { notification } from "../Notification/Notification";
import { SettingsCard } from "./ui";

const MIN_PASSWORD = 6;

/** Поле только для чтения с кнопкой «скопировать» справа */
function CopyField({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <TextInput
      label={label}
      description={description}
      readOnly
      value={value}
      styles={{ input: { fontFamily: "monospace" } }}
      onFocus={(event) => event.currentTarget.select()}
      rightSectionPointerEvents="all"
      rightSection={
        <CopyButton value={value} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Скопировано" : "Скопировать"} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "green" : "gray"}
                disabled={!value}
                onClick={copy}
                aria-label="Скопировать"
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      }
    />
  );
}

function ChangePasswordForm() {
  const { mutateAsync: changePassword, isPending } = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (next.length < MIN_PASSWORD) {
      setError(`Новый пароль — не короче ${MIN_PASSWORD} символов`);
      return;
    }
    if (next !== confirm) {
      setError("Пароли не совпадают");
      return;
    }

    try {
      await changePassword({ current, next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      notification.success({ message: "Пароль изменён" });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack gap="sm">
        <Text fw={800} fz={18}>
          Сменить пароль
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <PasswordInput
            label="Текущий пароль"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.currentTarget.value);
              setError(null);
            }}
          />
          <PasswordInput
            label="Новый пароль"
            description={`Не короче ${MIN_PASSWORD} символов`}
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.currentTarget.value);
              setError(null);
            }}
          />
          <PasswordInput
            label="Ещё раз"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.currentTarget.value);
              setError(null);
            }}
          />
        </SimpleGrid>
        {error && (
          <Text size="sm" c="red.7" fw={700}>
            {error}
          </Text>
        )}
        <Group>
          <Button
            type="submit"
            size="xs"
            color="dark"
            loading={isPending}
            disabled={!current || !next || !confirm}
          >
            Сменить пароль
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * Постоянный токен доступа: им входят без пароля — например, открывают
 * сервис готовой ссылкой /login?token=…
 */
function AccessTokenBlock() {
  const { data, isLoading } = useGetAccessToken();
  const { mutateAsync: regenerate, isPending } = useRegenerateAccessToken();

  const token = data?.token ?? "";
  const link = token ? `${window.location.origin}/login?token=${encodeURIComponent(token)}` : "";

  const confirmRegenerate = () =>
    modals.openConfirmModal({
      title: "Выпустить новый токен",
      centered: true,
      children: (
        <Text size="sm">
          Старый токен и ссылки со входом по нему перестанут работать.
        </Text>
      ),
      labels: { confirm: "Выпустить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await regenerate();
          notification.success({ message: "Новый токен выпущен" });
        } catch (err) {
          notification.error({ message: errorMessage(err) });
        }
      },
    });

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={800} fz={18}>
          Токен доступа
        </Text>
        <Button
          size="xs"
          variant="outline"
          color="red"
          leftSection={<IconRefresh size={14} />}
          loading={isPending}
          disabled={isLoading}
          onClick={confirmRegenerate}
        >
          Выпустить новый
        </Button>
      </Group>
      <Text size="sm" c="gray.7">
        Вход без пароля: токен на странице входа или готовая ссылка. Храните
        как пароль.
      </Text>
      <CopyField label="Токен" value={isLoading ? "…" : token} />
      <CopyField label="Ссылка для входа" value={isLoading ? "…" : link} />
    </Stack>
  );
}

/** Вход: пароль и постоянный токен доступа */
export function AuthSettings() {
  return (
    <SettingsCard title="Вход">
      <ChangePasswordForm />
      <Divider />
      <AccessTokenBlock />
    </SettingsCard>
  );
}
