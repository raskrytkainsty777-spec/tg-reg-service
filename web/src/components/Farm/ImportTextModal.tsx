import { useState } from "react";
import { Button, Group, Modal, Stack, Text, Textarea } from "@mantine/core";

import { countRows, errorMessage } from "./farmLabels";
import { notification } from "../Notification/Notification";

interface ImportTextModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  placeholder: string;
  submitLabel: string;
  submitColor?: string;
  // Итог показывает вызывающий; ошибку бэкенда покажем здесь
  onSubmit: (text: string) => Promise<unknown>;
  loading?: boolean;
}

/** Окно «вставьте список, по одной записи на строку» для всех импортов фермы */
export function ImportTextModal({
  opened,
  onClose,
  title,
  description,
  placeholder,
  submitLabel,
  submitColor = "dark",
  onSubmit,
  loading,
}: ImportTextModalProps) {
  const [text, setText] = useState("");

  const rows = countRows(text);

  const submit = async () => {
    try {
      await onSubmit(text);
      setText("");
      onClose();
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="lg">
      <Stack>
        <Textarea
          description={description}
          placeholder={placeholder}
          autosize
          minRows={6}
          maxRows={14}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          styles={{ input: { fontFamily: "monospace" } }}
        />

        <Group justify="space-between">
          <Text size="sm" c="gray.6">
            Строк: {rows}
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button
              color={submitColor}
              disabled={!rows}
              loading={loading}
              onClick={submit}
            >
              {submitLabel}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
