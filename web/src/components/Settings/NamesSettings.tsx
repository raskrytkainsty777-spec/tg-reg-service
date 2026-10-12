import { useEffect, useState } from "react";
import {
  Accordion,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";

import {
  useGetRegistrationSettings,
  useUpdateRegistrationSettings,
} from "../../api/queries/settings.query";
import type {
  NameGender,
  RegistrationSettings,
} from "../../api/services/settings.service";
import { errorMessage } from "../../helpers/errors";
import { notification } from "../Notification/Notification";
import { SaveButton, SettingsCard } from "./ui";

const GENDERS: { value: NameGender; label: string }[] = [
  { value: "female", label: "Женские" },
  { value: "male", label: "Мужские" },
  { value: "mixed", label: "Вперемешку" },
];

const LISTS = [
  { key: "femaleFirstNames", label: "Женские имена", placeholder: "Анна\nМария" },
  { key: "femaleLastNames", label: "Женские фамилии", placeholder: "Иванова\nСмирнова" },
  { key: "maleFirstNames", label: "Мужские имена", placeholder: "Алексей\nДмитрий" },
  { key: "maleLastNames", label: "Мужские фамилии", placeholder: "Иванов\nСмирнов" },
] as const;

type ListKey = (typeof LISTS)[number]["key"];

// Одно имя на строку: пробелы по краям и пустые строки отбрасываем
const toLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Из каких имён и фамилий собирать профиль нового аккаунта */
export function NamesSettings() {
  const { data: settings, isLoading } = useGetRegistrationSettings();
  const { mutateAsync: update, isPending } = useUpdateRegistrationSettings();

  const [gender, setGender] = useState<NameGender>("mixed");
  const [lists, setLists] = useState<Record<ListKey, string>>({
    femaleFirstNames: "",
    femaleLastNames: "",
    maleFirstNames: "",
    maleLastNames: "",
  });

  useEffect(() => {
    if (!settings) return;

    setGender(settings.nameGender ?? "mixed");
    setLists({
      femaleFirstNames: (settings.femaleFirstNames ?? []).join("\n"),
      femaleLastNames: (settings.femaleLastNames ?? []).join("\n"),
      maleFirstNames: (settings.maleFirstNames ?? []).join("\n"),
      maleLastNames: (settings.maleLastNames ?? []).join("\n"),
    });
  }, [settings]);

  const onSave = async () => {
    if (!settings) return;

    // Шлём только изменённое
    const patch: Partial<RegistrationSettings> = {};

    if (gender !== settings.nameGender) patch.nameGender = gender;

    for (const { key } of LISTS) {
      const lines = toLines(lists[key]);
      if (!sameList(lines, settings[key] ?? [])) patch[key] = lines;
    }

    if (!Object.keys(patch).length) {
      notification.success({ message: "Изменений нет" });
      return;
    }

    try {
      await update(patch);
      notification.success({ message: "Имена сохранены" });
    } catch (err) {
      notification.error({ message: errorMessage(err) });
    }
  };

  return (
    <SettingsCard
      title="Имена для аккаунтов"
      loading={isLoading}
      actions={<SaveButton loading={isPending} disabled={!settings} onClick={onSave} />}
    >
      <Stack gap={6}>
        <Text fw={800} fz={15}>
          Какие имена давать
        </Text>
        <SegmentedControl
          style={{ alignSelf: "flex-start" }}
          value={gender}
          onChange={(value) => setGender(value as NameGender)}
          data={GENDERS}
        />
      </Stack>

      <Accordion variant="separated" chevronPosition="left">
        <Accordion.Item value="lists">
          <Accordion.Control>
            Списки имён и фамилий
            <Text span size="sm" c="gray.6" ml={8}>
              {LISTS.map(({ key }) => toLines(lists[key]).length).join(" / ")}
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {LISTS.map((list) => (
                <Textarea
                  key={list.key}
                  label={list.label}
                  description={`По одному на строку · ${toLines(lists[list.key]).length}`}
                  placeholder={list.placeholder}
                  autosize
                  minRows={6}
                  maxRows={16}
                  value={lists[list.key]}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setLists((current) => ({ ...current, [list.key]: value }));
                  }}
                />
              ))}
            </SimpleGrid>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </SettingsCard>
  );
}
