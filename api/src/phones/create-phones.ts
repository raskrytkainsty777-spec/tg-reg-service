import { dbClient } from "../core/db.js";
import {
  buildProxyInformation,
  brandList,
  phoneAddNew,
  type GeelarkPhoneRow,
} from "./geelark.js";
import { buildPhoneProxy } from "./proxyma.js";

// Создание облачных телефонов: на каждый берём свободный порт Proxyma под
// страну, заводим профиль в GeeLark и записываем его себе.
// GeeLark режет большой addNew по таймауту — шлём пачками

const ADD_NEW_CHUNK = 20;
const DEFAULT_ANDROID_VER = 15;
export const MAX_PHONES_PER_RUN = 200;

// Имя профиля продолжает нумерацию страны: DE-01, DE-02…
const maxCountrySeq = async (countryCode: string) => {
  const phones = await dbClient.farmPhone.findMany({
    where: { profileName: { startsWith: `${countryCode}-` } },
    select: { profileName: true },
  });

  return phones.reduce((max, phone) => {
    const parsed = Number(phone.profileName.slice(countryCode.length + 1));

    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
};

export type CreatePhonesInput = {
  countries: Record<string, number>;
  groupId?: string | null;
  androidVer?: number;
};

export const createPhones = async (input: CreatePhonesInput) => {
  const androidVer = input.androidVer ?? DEFAULT_ANDROID_VER;
  const wanted = Object.entries(input.countries)
    .map(([code, count]) => [code.trim().toUpperCase().slice(0, 2), Number(count)] as const)
    .filter(([code, count]) => code.length === 2 && count > 0);

  const total = wanted.reduce((sum, [, count]) => sum + count, 0);

  if (!total) throw new Error("Не выбрано ни одной страны");
  if (total > MAX_PHONES_PER_RUN) {
    throw new Error(`За один раз не больше ${MAX_PHONES_PER_RUN} телефонов`);
  }

  // Железо перемешиваем, чтобы телефоны пачки не были одинаковыми
  const brands = (await brandList(androidVer).catch(() => [])).sort(() => Math.random() - 0.5);

  const taken = new Set(
    (await dbClient.farmPhone.findMany({ select: { profileName: true } })).map(
      (phone) => phone.profileName,
    ),
  );

  const rows: GeelarkPhoneRow[] = [];
  const meta: {
    countryCode: string;
    profileName: string;
    proxy: Awaited<ReturnType<typeof buildPhoneProxy>>;
  }[] = [];

  for (const [countryCode, count] of wanted) {
    let seq = await maxCountrySeq(countryCode);

    for (let made = 0; made < count; made += 1) {
      seq += 1;

      let profileName = `${countryCode}-${String(seq).padStart(2, "0")}`;

      while (taken.has(profileName)) {
        seq += 1;
        profileName = `${countryCode}-${String(seq).padStart(2, "0")}`;
      }

      taken.add(profileName);

      // Прокси выдаём до создания: строка уходит в GeeLark вместе с профилем
      const proxy = await buildPhoneProxy({ profileName, countryCode });
      const brand = brands.length ? brands[rows.length % brands.length] : null;

      rows.push({
        profileName,
        proxyInformation: buildProxyInformation({
          proxyHost: proxy.proxyHost,
          proxyPort: proxy.proxyPort,
          proxyType: proxy.proxyType,
          proxyUser: proxy.proxyUser,
          proxyPassword: proxy.proxyPassword,
        }),
        mobileLanguage: "baseOnIP",
        netType: 1,
        ...(brand?.surfaceBrandName ? { surfaceBrandName: brand.surfaceBrandName } : {}),
        ...(brand?.surfaceModelName ? { surfaceModelName: brand.surfaceModelName } : {}),
      });
      meta.push({ countryCode, profileName, proxy });
    }
  }

  const details: Awaited<ReturnType<typeof phoneAddNew>>["details"] = [];

  for (let start = 0; start < rows.length; start += ADD_NEW_CHUNK) {
    try {
      const data = await phoneAddNew(`Android ${androidVer}`, rows.slice(start, start + ADD_NEW_CHUNK));
      details.push(...(data.details ?? []));
    } catch (error) {
      // Упавшая пачка не должна терять уже созданное — но первую пробрасываем,
      // иначе непонятно, почему «создано 0»
      if (start === 0) throw error;
      break;
    }
  }

  // GeeLark нумерует details с нуля и не всегда по порядку — матчим по имени
  const byName = new Map(
    (details ?? []).filter((item) => item.profileName).map((item) => [item.profileName, item]),
  );

  const created: string[] = [];
  const errors: { profileName: string; error: string }[] = [];

  for (const item of meta) {
    const detail = byName.get(item.profileName);

    if (!detail) {
      errors.push({ profileName: item.profileName, error: "нет ответа от GeeLark" });
      continue;
    }

    if (detail.code !== 0 || !detail.id) {
      errors.push({
        profileName: item.profileName,
        error: detail.msg ?? `код ${detail.code}`,
      });
      continue;
    }

    const equipment = detail.equipmentInfo ?? {};

    await dbClient.farmPhone.create({
      data: {
        profileName: detail.profileName ?? item.profileName,
        geelarkId: detail.id,
        serialNo: detail.envSerialNo ?? null,
        countryCode: item.countryCode,
        countryName: equipment.countryName ?? null,
        timezone: equipment.timeZone ?? null,
        brand: equipment.deviceBrand ?? null,
        model: equipment.deviceModel ?? null,
        imei: equipment.imei ?? null,
        androidVer,
        ...item.proxy,
        groupId: input.groupId ?? null,
      },
    });

    created.push(item.profileName);
  }

  return { created: created.length, failed: errors.length, errors, phones: created };
};
