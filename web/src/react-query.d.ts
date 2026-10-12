import "@tanstack/react-query";

// meta запросов: silentError — экран сам показывает ошибку, общее уведомление не нужно
declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      silentError?: boolean;
    };
  }
}
