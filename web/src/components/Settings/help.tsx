import { Anchor, List, Stack, Text } from "@mantine/core";

/** Подсказка в пустом поле сохранённого ключа: точки и последние 4 символа */
export const savedKeyPlaceholder = (hint: string | null | undefined) =>
  `••••${(hint ?? "").slice(-4)}`;

/** Где взять ключ Yandex SpeechKit: им распознаётся код из звонка */
export const SPEECHKIT_HELP = {
  title: "Как получить ключ Yandex SpeechKit",
  content: (
    <Stack gap="sm">
      <List type="ordered" spacing="xs" size="sm">
        <List.Item>
          Войдите в{" "}
          <Anchor href="https://console.yandex.cloud" target="_blank" size="sm">
            console.yandex.cloud
          </Anchor>
          . Если облака ещё нет — создайте его и привяжите платёжный аккаунт:
          без оплаты распознавание не работает.
        </List.Item>
        <List.Item>
          Откройте каталог (обычно <b>default</b>) → <b>Сервисные аккаунты</b> →{" "}
          <b>Создать сервисный аккаунт</b>. Имя любое, например{" "}
          <b>speechkit</b>.
        </List.Item>
        <List.Item>
          Добавьте аккаунту роль <b>ai.speechkit-stt.user</b> и сохраните.
        </List.Item>
        <List.Item>
          Откройте созданный аккаунт → <b>Создать новый ключ</b> →{" "}
          <b>Создать API-ключ</b>. Если спросят область действия — выберите{" "}
          <b>yc.ai.speechkitStt.execute</b>.
        </List.Item>
        <List.Item>
          Скопируйте <b>секретный ключ</b> (начинается с AQVN) — Яндекс покажет
          его один раз. Вставьте сюда и нажмите «Сохранить».
        </List.Item>
      </List>
      <Text size="sm" c="gray.7">
        Ключ нужен, чтобы распознавать код подтверждения, который Telegram
        диктует во входящем звонке.
      </Text>
    </Stack>
  ),
};
