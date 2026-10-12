import type { ReactNode } from "react";
import {
  Badge,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Timeline,
} from "@mantine/core";
import dayjs from "dayjs";

import type { RunPhone } from "../../../api/services/runs.service";
import { formatDateTime } from "../farmLabels";
import {
  formatDuration,
  runPhoneStatus,
  stepColor,
  stepStatusTitle,
} from "./runLabels";

interface RunPhoneModalProps {
  // Телефон берём из свежих данных запуска — шаги дописываются, пока окно открыто
  phone: RunPhone | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="gray.6">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: "break-word" }}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

/** Шаги регистрации на одном телефоне: что сделал сценарий и где споткнулся */
export function RunPhoneModal({ phone, onClose }: RunPhoneModalProps) {
  const status = phone ? runPhoneStatus(phone.status) : null;

  return (
    <Modal
      opened={!!phone}
      onClose={onClose}
      title={`Телефон ${phone?.profileName ?? ""}`}
      size="lg"
    >
      {phone && status && (
        <Stack gap="md">
          <Group gap="xs">
            <Badge fullWidth={false} color={status.color}>
              {status.title}
            </Badge>
            {phone.startedAt && (
              <Text size="xs" c="gray.6">
                {formatDateTime(phone.startedAt)}
                {" · "}
                {formatDuration(phone.startedAt, phone.finishedAt)}
              </Text>
            )}
          </Group>

          <SimpleGrid cols={2} spacing="sm">
            <Field label="Номер" value={phone.account?.phone} />
            <Field
              label="Username"
              value={phone.account?.username ? `@${phone.account.username}` : null}
            />
          </SimpleGrid>

          {phone.error && (
            <Text size="sm" c="red.7" style={{ wordBreak: "break-word" }}>
              {phone.error}
            </Text>
          )}

          {phone.steps.length ? (
            <Timeline bulletSize={14} lineWidth={2}>
              {phone.steps.map((step, index) => (
                <Timeline.Item
                  key={`${step.at}-${index}`}
                  color={stepColor(step.status)}
                  title={
                    <Group gap={8} wrap="nowrap">
                      <Text size="sm" fw={700}>
                        {step.name}
                      </Text>
                      <Badge size="xs" fullWidth={false} color={stepColor(step.status)}>
                        {stepStatusTitle(step.status)}
                      </Badge>
                    </Group>
                  }
                >
                  <Text size="xs" c="gray.6">
                    {dayjs(step.at).format("DD.MM.YY HH:mm:ss")}
                  </Text>
                  {step.detail && (
                    <Text
                      size="sm"
                      c={step.status === "failed" ? "red.7" : "gray.8"}
                      mt={2}
                      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {step.detail}
                    </Text>
                  )}
                </Timeline.Item>
              ))}
            </Timeline>
          ) : (
            <Text size="sm" c="gray.6">
              {phone.status === "pending" ? "Телефон ещё ждёт очереди" : "Шагов пока нет"}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
