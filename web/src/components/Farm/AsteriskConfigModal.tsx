import {
  Badge,
  Center,
  Code,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import { useGetFarmAsterisk } from "../../api/queries/farm.query";
import { errorMessage, fromNow } from "./farmLabels";

interface AsteriskConfigModalProps {
  opened: boolean;
  onClose: () => void;
}

/** Что сейчас уходит в Asterisk — кусок pjsip.conf, пароли скрыты */
export function AsteriskConfigModal({ opened, onClose }: AsteriskConfigModalProps) {
  const { data, isLoading, error } = useGetFarmAsterisk(opened);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Конфиг транков для Asterisk"
      centered
      size="xl"
    >
      {isLoading && (
        <Center p="xl">
          <Loader />
        </Center>
      )}

      {error && (
        <Text c="red.7" size="sm">
          {errorMessage(error)}
        </Text>
      )}

      {data && (
        <Stack gap="sm">
          <Group gap="xs">
            <Badge
              fullWidth={false}
              color={data.configInSync ? "green" : "orange"}
              variant="light"
            >
              {data.configInSync ? "актуален" : "ждёт обновления"}
            </Badge>
            <Text size="sm" c="gray.7">
              Забран {fromNow(data.configFetchedAt)}, транков в конфиге:{" "}
              {data.enabledTrunks}
            </Text>
          </Group>

          <ScrollArea.Autosize mah="65vh">
            <Code block>{data.preview}</Code>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Modal>
  );
}
