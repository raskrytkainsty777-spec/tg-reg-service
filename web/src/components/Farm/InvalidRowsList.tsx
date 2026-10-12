import {
  Button,
  CopyButton,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconCopy, IconCopyCheck } from "@tabler/icons-react";

import type { FarmInvalidRow } from "../../api/services/farm.service";

interface RowsListProps {
  rows: FarmInvalidRow[];
}

// Строки, которые не прошли: сама строка и причина. Их удобно скопировать,
// поправить и вставить заново
export function InvalidRowsList({ rows }: RowsListProps) {
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="gray.7">
          Строк: {rows.length}
        </Text>
        <CopyButton value={rows.map((item) => item.row).join("\n")}>
          {({ copied, copy }) => (
            <Button
              size="xs"
              variant="light"
              color={copied ? "green" : "gray"}
              leftSection={
                copied ? <IconCopyCheck size={14} /> : <IconCopy size={14} />
              }
              onClick={copy}
            >
              {copied ? "Скопировано" : "Скопировать строки"}
            </Button>
          )}
        </CopyButton>
      </Group>

      <ScrollArea.Autosize mah={420}>
        <Table verticalSpacing={6} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Строка</Table.Th>
              <Table.Th>Причина</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((item, index) => (
              <Table.Tr key={`${item.row}-${index}`}>
                <Table.Td ff="monospace" fz="sm" style={{ wordBreak: "break-all" }}>
                  {item.row}
                </Table.Td>
                <Table.Td fz="sm">{item.reason}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </Stack>
  );
}
