import { useState } from "react";
import { Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { IconPlugConnected } from "@tabler/icons-react";

import { useTestFarmSpeechkit } from "../../api/queries/farm.query";
import { errorMessage } from "./farmLabels";
import { notification } from "../Notification/Notification";
import { ConnectedMark, HelpButton } from "../Settings/ui";
import { SPEECHKIT_HELP, savedKeyPlaceholder } from "../Settings/help";

interface SpeechkitKeyFieldProps {
  value: string;
  onChange: (value: string) => void;
  configured: boolean;
  hint: string | null;
  /** Заголовок с галочкой и «?» — когда поле стоит не в своей карточке */
  withTitle?: boolean;
}

/**
 * Ключ Yandex SpeechKit: сам ключ наружу не отдаётся, видно только хвост.
 * «Проверить» гоняет введённый ключ, а если поле пустое — сохранённый
 */
export function SpeechkitKeyField({
  value,
  onChange,
  configured,
  hint,
  withTitle = true,
}: SpeechkitKeyFieldProps) {
  const { mutateAsync: testKey, isPending } = useTestFarmSpeechkit();
  const [error, setError] = useState<string | null>(null);

  const onTest = async () => {
    try {
      const response = await testKey(value.trim() || undefined);

      if (response.ok) {
        setError(null);
        notification.success({ message: "Ключ SpeechKit работает" });
      } else {
        setError(response.error ?? "Ключ не работает");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Stack gap="xs">
      {withTitle && (
        <Group gap={6}>
          <Text fw={800} fz={16}>
            Yandex SpeechKit
          </Text>
          <ConnectedMark ok={configured} />
          <HelpButton title={SPEECHKIT_HELP.title}>
            {SPEECHKIT_HELP.content}
          </HelpButton>
        </Group>
      )}

      <Group gap="sm" align="flex-start" wrap="nowrap">
        <PasswordInput
          flex={1}
          placeholder={configured ? savedKeyPlaceholder(hint) : "AQVN..."}
          value={value}
          error={error}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setError(null);
          }}
        />
        <Button
          variant="light"
          color="gray"
          leftSection={<IconPlugConnected size={16} />}
          loading={isPending}
          disabled={!configured && !value.trim()}
          onClick={onTest}
        >
          Проверить
        </Button>
      </Group>
    </Stack>
  );
}
