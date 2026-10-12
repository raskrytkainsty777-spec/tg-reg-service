import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  LoadingOverlay,
  Modal,
  Stack,
  Title,
  Tooltip,
  type ButtonProps,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconHelpCircle,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

/** Пилюля «✓ подключён» у названия: интеграция подключена */
export function ConnectedMark({ ok }: { ok?: boolean }) {
  if (!ok) return null;

  return (
    <Badge color="green" size="sm" fullWidth={false}>
      ✓ подключён
    </Badge>
  );
}

/** Значок «?» у названия: инструкция открывается окном, а не висит на странице */
export function HelpButton({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Tooltip label="Инструкция" withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={open}
          aria-label="Инструкция"
        >
          <IconHelpCircle size={16} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={opened} onClose={close} title={title} size="lg">
        {children}
      </Modal>
    </>
  );
}

export function SaveButton(
  props: ButtonProps & {
    onClick?: () => void;
    type?: "submit" | "button";
    form?: string;
  }
) {
  return (
    <Button size="xs" color="dark" {...props}>
      Сохранить
    </Button>
  );
}

interface SettingsCardProps {
  title: ReactNode;
  /** Интеграция подключена — галочка у названия */
  ok?: boolean;
  /** Инструкция в окне по значку «?» */
  help?: { title: string; content: ReactNode };
  actions?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

/** Карточка настроек: название, галочка подключения, инструкция и действия в шапке */
export function SettingsCard({
  title,
  ok,
  help,
  actions,
  loading,
  children,
}: SettingsCardProps) {
  return (
    <Card withBorder pos="relative">
      <LoadingOverlay
        visible={!!loading}
        zIndex={100}
        overlayProps={{ radius: "sm", blur: 2 }}
      />

      <Card.Section inheritPadding pt={26} pb={0}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={12} wrap="nowrap">
            <Title order={3}>{title}</Title>
            <ConnectedMark ok={ok} />
            {help && <HelpButton title={help.title}>{help.content}</HelpButton>}
          </Group>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
      </Card.Section>

      {children && <Stack mt={18}>{children}</Stack>}
    </Card>
  );
}
