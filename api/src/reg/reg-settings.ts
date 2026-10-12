import { dbClient } from "../core/db.js";
import type { NameLists } from "./generator.js";

// Настройки реги живут в строке Settings. Звонки и почты читают их
// на каждом шаге, поэтому держим копию на полминуты

const CACHE_TTL_MS = 30_000;

export type RegSettings = {
  speechkitApiKey: string | null;
  imapHost: string;
  imapPort: number;
  sipDomain: string;
  sipAuthDomain: string;
  sipOutboundProxy: string;
  sipIdentifyHost: string;
  names: NameLists;
};

let cached: { value: RegSettings; at: number } | null = null;

export const invalidateRegSettings = () => {
  cached = null;
};

export const getRegSettings = async (): Promise<RegSettings> => {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const row = await dbClient.settings.findUnique({ where: { id: 1 } });

  const value: RegSettings = {
    speechkitApiKey: row?.regSpeechkitApiKey?.trim() || null,
    imapHost: row?.regImapHost?.trim() || "imap.rambler.ru",
    imapPort: row?.regImapPort || 993,
    sipDomain: row?.regSipDomain?.trim() || "ip.beeline.ru",
    sipAuthDomain: row?.regSipAuthDomain?.trim() || "ip.beeline.ru",
    sipOutboundProxy: row?.regSipOutboundProxy?.trim() || "ip.beeline.ru",
    sipIdentifyHost: row?.regSipIdentifyHost?.trim() || "ip.beeline.ru",
    names: {
      gender: row?.regNameGender || "female",
      femaleFirstNames: row?.regFemaleFirstNames ?? [],
      femaleLastNames: row?.regFemaleLastNames ?? [],
      maleFirstNames: row?.regMaleFirstNames ?? [],
      maleLastNames: row?.regMaleLastNames ?? [],
    },
  };

  cached = { value, at: Date.now() };

  return value;
};
