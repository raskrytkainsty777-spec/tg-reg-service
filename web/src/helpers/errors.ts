import { isAxiosError } from "axios";

/**
 * Текст ошибки бэкенда. Hono отдаёт HTTPException как { message },
 * часть ручек — { error }; на всякий случай понимаем и простой текст
 */
export const errorMessage = (err: unknown, fallback = "Ошибка сервера") => {
  if (isAxiosError(err)) {
    const data = err.response?.data;

    if (typeof data === "string" && data.trim()) return data;
    if (data && typeof data === "object") {
      const { message, error } = data as { message?: unknown; error?: unknown };

      if (typeof message === "string" && message.trim()) return message;
      if (typeof error === "string" && error.trim()) return error;
    }
    if (!err.response) return "Сервер недоступен";
  }

  return fallback;
};

/**
 * То же для ответа, который ждали blob'ом (выгрузка CSV): при ошибке
 * текст ошибки тоже приходит blob'ом — разбираем его как JSON или текст
 */
export const blobErrorMessage = async (err: unknown, fallback = "Не удалось выгрузить") => {
  const data = isAxiosError(err) ? err.response?.data : null;

  if (!(data instanceof Blob)) return errorMessage(err, fallback);

  const text = (await data.text()).trim();

  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // не JSON — отдаём как есть
  }

  return text || fallback;
};
