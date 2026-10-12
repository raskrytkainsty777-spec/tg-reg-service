import { notifications } from "@mantine/notifications";
import notificationsClasses from "./Notifications.module.css";
import { IconCheck, IconX } from "@tabler/icons-react";

import { WA } from "../../theme";

interface NotificationProps {
  message: string;
  description?: string;
  /** Одинаковый id не плодит копии, пока первое уведомление на экране */
  id?: string;
}

// Уведомления по правилу яркости v2: тинт и тёмный текст того же цвета
export const notification = {
  success: ({ message, description = "", id }: NotificationProps) =>
    notifications.show({
      id,
      title: message,
      message: description,
      icon: <IconCheck size={20} color={WA.greenText} />,
      classNames: notificationsClasses,
      color: "transparent",
      bg: WA.greenTint,
      styles: {
        title: { color: WA.greenText },
        description: { color: WA.greenText },
        closeButton: { color: WA.greenText },
      },
    }),
  error: ({ message, description = "", id }: NotificationProps) =>
    notifications.show({
      id,
      title: message,
      message: description,
      icon: <IconX size={20} color={WA.orangeText} />,
      classNames: notificationsClasses,
      color: "transparent",
      bg: WA.orangeTint,
      styles: {
        title: { color: WA.orangeText },
        description: { color: WA.orangeText },
        closeButton: { color: WA.orangeText },
      },
    }),
};
