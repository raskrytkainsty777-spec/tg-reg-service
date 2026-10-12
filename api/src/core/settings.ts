import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { dbClient } from "./db.js";

// Настройки — одна строка. Заводим её при первом старте: вход admin/admin
// (или ADMIN_LOGIN/ADMIN_PASSWORD из env) и случайный токен входа

export const newAccessToken = () => randomBytes(24).toString("base64url");

export const ensureSettings = async () => {
  const row = await dbClient.settings.findUnique({ where: { id: 1 } });

  if (row) return row;

  return dbClient.settings.create({
    data: {
      id: 1,
      adminLogin: process.env.ADMIN_LOGIN?.trim() || "admin",
      adminPasswordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD?.trim() || "admin", 10),
      mustChangePassword: true,
      accessToken: process.env.ACCESS_TOKEN?.trim() || newAccessToken(),
    },
  });
};

export const getSettingsRow = async () =>
  (await dbClient.settings.findUnique({ where: { id: 1 } })) ?? ensureSettings();
