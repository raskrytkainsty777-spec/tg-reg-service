import { modals } from "@mantine/modals";

import type { FarmInvalidRow } from "../../api/services/farm.service";
import { InvalidRowsList } from "./InvalidRowsList";
import { notification } from "../Notification/Notification";

interface ShowImportResultParams {
  title: string;
  description?: string;
  rows?: FarmInvalidRow[];
  rowsTitle?: string;
}

/**
 * Итог импорта: уведомление со счётчиками, а если были плохие строки —
 * окно со списком «строка — причина»
 */
export const showImportResult = ({
  title,
  description,
  rows = [],
  rowsTitle = "Не загружены",
}: ShowImportResultParams) => {
  notification.success({ message: title, description });

  if (rows.length) {
    modals.open({
      title: `${rowsTitle}: ${rows.length}`,
      size: "lg",
      centered: true,
      children: <InvalidRowsList rows={rows} />,
    });
  }
};
