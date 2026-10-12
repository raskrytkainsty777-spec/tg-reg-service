import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { useGetFarmEmailMessages } from "../../api/queries/farm.query";
import type { FarmEmail } from "../../api/services/farm.service";
import { errorMessage, formatDateTime } from "./farmLabels";

interface EmailMessagesModalProps {
  email: FarmEmail | null;
  onClose: () => void;
}

/** Последние письма ящика — чтобы глазами увидеть, приходят ли коды */
export function EmailMessagesModal({ email, onClose }: EmailMessagesModalProps) {
  const { data, isLoading, isFetching, error, refetch } =
    useGetFarmEmailMessages(email?.id ?? null);

  return (
    <Modal
      opened={!!email}
      onClose={onClose}
      title={`Письма: ${email?.email ?? ""}`}
      centered
      size="lg"
    >
      <Stack>
        <Group justify="space-between">
          <Text size="sm" c="gray.6">
            Последние 5 писем из «Входящих»
            {email?.proxy ? ` через ${email.proxy.host}:${email.proxy.port}` : ", без прокси"}
          </Text>
          <Button
            size="xs"
            variant="light"
            color="gray"
            leftSection={<IconRefresh size={14} />}
            loading={isFetching}
            onClick={() => refetch()}
          >
            Обновить
          </Button>
        </Group>

        {isLoading && (
          <Center p="xl">
            <Loader />
          </Center>
        )}

        {error && !isFetching && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {errorMessage(error, "Не удалось прочитать ящик")}
          </Alert>
        )}

        {data && !data.length && (
          <Text c="gray.6" ta="center" py="md">
            Ящик пуст
          </Text>
        )}

        {data?.map((message) => (
          <Card key={message.id} withBorder p="sm">
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text fw={600} size="sm">
                  {message.subject || "(без темы)"}
                </Text>
                <Text size="xs" c="gray.6" style={{ whiteSpace: "nowrap" }}>
                  {formatDateTime(message.receivedAt)}
                </Text>
              </Group>
              <Text size="xs" c="gray.7">
                {message.fromName ? `${message.fromName} ` : ""}
                {message.fromAddress ? `<${message.fromAddress}>` : ""}
              </Text>
              {message.preview && (
                <Text size="sm" c="gray.8">
                  {message.preview}
                </Text>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Modal>
  );
}
