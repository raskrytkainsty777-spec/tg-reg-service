import { Alert, Button, Group, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Link } from "react-router-dom";

import { useGetMe } from "../../api/queries/auth.query";

/** Вошли с паролем по умолчанию (admin / admin) — просим сменить на каждой странице */
export function DefaultPasswordAlert() {
  const { data: me } = useGetMe();

  if (!me?.mustChangePassword) return null;

  return (
    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} mb={24}>
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Text fz={15} fw={700}>
          Вы вошли с паролем по умолчанию — смените его в Настройках
        </Text>
        <Button component={Link} to="/settings#auth" size="compact-sm" color="dark">
          Сменить пароль
        </Button>
      </Group>
    </Alert>
  );
}
