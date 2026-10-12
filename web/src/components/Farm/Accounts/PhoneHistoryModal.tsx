import { useState } from "react";
import {
  Button,
  Center,
  Image,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";

import { useGetFarmPhoneEvents } from "../../../api/queries/farmAccounts.query";
import { FarmAccountsService } from "../../../api/services/farmAccounts.service";
import { errorMessage, formatDateTime } from "../farmLabels";
import { notification } from "../../Notification/Notification";
import { eventKindTitle } from "./accountLabels";

interface PhoneHistoryModalProps {
  phoneId: string | null;
  title: string;
  onClose: () => void;
}

/**
 * История телефона: что с ним случилось и скриншот экрана в момент косяка
 */
export function PhoneHistoryModal({
  phoneId,
  title,
  onClose,
}: PhoneHistoryModalProps) {
  const { data: events, isLoading } = useGetFarmPhoneEvents(phoneId);
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const showScreenshot = async (eventId: string) => {
    try {
      const result = await FarmAccountsService.getEventScreenshot(eventId);
      setScreenshot(result.screenshot);
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <>
      <Modal
        opened={!!phoneId}
        onClose={onClose}
        title={`История · ${title}`}
        size="lg"
      >
        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : !events?.length ? (
          <Text c="gray.6" ta="center" py="lg">
            Событий пока не было
          </Text>
        ) : (
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Когда</Table.Th>
                <Table.Th>Событие</Table.Th>
                <Table.Th>Детали</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.map((event) => (
                <Table.Tr key={event.id}>
                  <Table.Td>
                    <Text size="sm">{formatDateTime(event.createdAt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{eventKindTitle(event.kind)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="gray.7">
                      {event.detail ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {event.hasScreenshot && (
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconPhoto size={14} />}
                        onClick={() => showScreenshot(event.id)}
                      >
                        Экран
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Modal>

      <Modal
        opened={!!screenshot}
        onClose={() => setScreenshot(null)}
        title="Экран телефона"
        size="auto"
        centered
      >
        <Stack>{screenshot && <Image src={screenshot} maw={420} />}</Stack>
      </Modal>
    </>
  );
}
