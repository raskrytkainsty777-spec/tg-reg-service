import { Button, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";

import { PageTitle } from "../components/ui/wa";

export function NotFoundPage() {
  return (
    <Stack gap="md" align="flex-start">
      <PageTitle>404</PageTitle>
      <Text c="gray.7">Такой страницы нет</Text>
      <Button component={Link} to="/phones" color="dark">
        К телефонам
      </Button>
    </Stack>
  );
}
