import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { requireAuth } from "./auth.js";
import { dbClient } from "./db.js";
import { factory } from "./factory.js";
import { invalidateRegSettings } from "../reg/reg-settings.js";

// Что делать после регистрации (подписки, настройки Telegram) и из каких
// имён собирать профили

const app = factory.createApp().basePath("/settings");

app.use("/*", requireAuth);

const view = async () => {
  const row = await dbClient.settings.findUniqueOrThrow({ where: { id: 1 } });

  return {
    channels: row.regChannels,
    subscribeCount: row.regSubscribeCount,
    disableMedia: row.regDisableMedia,
    disablePowerSaving: row.regDisablePowerSaving,
    nameGender: row.regNameGender,
    femaleFirstNames: row.regFemaleFirstNames,
    femaleLastNames: row.regFemaleLastNames,
    maleFirstNames: row.regMaleFirstNames,
    maleLastNames: row.regMaleLastNames,
  };
};

// Канал: @name, t.me/name, https://t.me/s/name → name
const channelName = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(t\.me|telegram\.me)\/(s\/)?/i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];

const names = z.array(z.string()).transform((items) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 2000),
);

const patchSchema = z.object({
  channels: z.array(z.string()).optional(),
  subscribeCount: z.number().int().min(0).max(50).optional(),
  disableMedia: z.boolean().optional(),
  disablePowerSaving: z.boolean().optional(),
  nameGender: z.enum(["female", "male", "mixed"]).optional(),
  femaleFirstNames: names.optional(),
  femaleLastNames: names.optional(),
  maleFirstNames: names.optional(),
  maleLastNames: names.optional(),
});

app.get("/registration", async (ctx) => ctx.json(await view()));

app.patch("/registration", async (ctx) => {
  const parsed = patchSchema.safeParse(await ctx.req.json().catch(() => ({})));

  if (!parsed.success) throw new HTTPException(400, { message: "Неверные настройки" });

  const input = parsed.data;
  let channels: string[] | undefined;

  if (input.channels) {
    channels = [...new Set(input.channels.map(channelName).filter(Boolean))];
    const bad = channels.filter((name) => !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name));

    if (bad.length) {
      throw new HTTPException(400, { message: `Не похоже на канал: ${bad.slice(0, 3).join(", ")}` });
    }
  }

  await dbClient.settings.update({
    where: { id: 1 },
    data: {
      ...(channels ? { regChannels: channels } : {}),
      ...(input.subscribeCount !== undefined ? { regSubscribeCount: input.subscribeCount } : {}),
      ...(input.disableMedia !== undefined ? { regDisableMedia: input.disableMedia } : {}),
      ...(input.disablePowerSaving !== undefined
        ? { regDisablePowerSaving: input.disablePowerSaving }
        : {}),
      ...(input.nameGender ? { regNameGender: input.nameGender } : {}),
      ...(input.femaleFirstNames ? { regFemaleFirstNames: input.femaleFirstNames } : {}),
      ...(input.femaleLastNames ? { regFemaleLastNames: input.femaleLastNames } : {}),
      ...(input.maleFirstNames ? { regMaleFirstNames: input.maleFirstNames } : {}),
      ...(input.maleLastNames ? { regMaleLastNames: input.maleLastNames } : {}),
    },
  });

  invalidateRegSettings();

  return ctx.json(await view());
});

export default app;
