import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";

import { router } from "./routes/index.tsx";
import { cssVariablesResolver, theme } from "./theme.ts";
import { errorMessage } from "./helpers/errors.ts";
import { notification } from "./components/Notification/Notification.tsx";
import "./theme.css";

// Упавший запрос данных — уведомлением. id по ключу запроса: опрос раз в
// 5 секунд не плодит одинаковые уведомления, пока висит первое.
// 401 не показываем — интерсептор и так уводит на вход
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isAxiosError(error) && error.response?.status === 401) return;
      // Экран сам показывает ошибку (письма ящика, карточка аккаунта)
      if (query.meta?.silentError) return;

      notification.error({
        id: `query-${query.queryHash}`,
        message: errorMessage(error),
      });
    },
  }),
  // Мутации обрабатывают ошибки сами (try/catch у вызова)
  defaultOptions: {
    queries: {
      // Повтор при 4xx бесполезен: доступ, валидация, «не найдено»
      retry: (failureCount, error) =>
        !(isAxiosError(error) && (error.response?.status ?? 500) < 500) &&
        failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>
          <Notifications />

          <RouterProvider router={router} />
        </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>
);
