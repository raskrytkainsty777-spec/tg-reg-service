import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import type { MiddlewareHandler } from "hono";

import { dbClient } from "./db.js";
import { factory } from "./factory.js";
import { internalToken } from "./internal-token.js";
import { getSettingsRow, newAccessToken } from "./settings.js";

// Вход в кабинет: логин и пароль или токен. Пользователь один, ролей нет.
// Сессия — JWT на 30 дней

const SESSION_TTL_S = 30 * 24 * 60 * 60;

const jwtSecret = () =>
  process.env.JWT_SECRET?.trim() ||
  createHash("sha256").update(`jwt:${internalToken() || "tg-reg-service"}`).digest("hex");

const issue = async (login: string) =>
  sign({ sub: login, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }, jwtSecret(), "HS256");

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

export const requireAuth: MiddlewareHandler = async (ctx, next) => {
  const header = ctx.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) throw new HTTPException(401, { message: "Нужно войти" });

  let login = "";

  try {
    const payload = await verify(token, jwtSecret(), "HS256");
    login = String(payload.sub ?? "");
  } catch {
    throw new HTTPException(401, { message: "Сессия истекла — войдите заново" });
  }

  // Сессия выдана под прежним логином — после смены логина она не действует
  if (login !== (await getSettingsRow()).adminLogin) {
    throw new HTTPException(401, { message: "Сессия истекла — войдите заново" });
  }

  ctx.set("login", login);

  await next();
};

const app = factory.createApp().basePath("/auth");

app.post("/login", async (ctx) => {
  const body = await ctx.req.json<{ login?: string; password?: string }>().catch(() => ({}) as never);
  const settings = await getSettingsRow();
  const login = body.login?.trim() ?? "";
  const password = body.password ?? "";

  const ok =
    login === settings.adminLogin && (await bcrypt.compare(password, settings.adminPasswordHash));

  if (!ok) throw new HTTPException(401, { message: "Неверный логин или пароль" });

  return ctx.json({ token: await issue(settings.adminLogin) });
});

app.post("/token-login", async (ctx) => {
  const body = await ctx.req.json<{ token?: string }>().catch(() => ({}) as never);
  const settings = await getSettingsRow();
  const token = body.token?.trim() ?? "";

  if (!token || !sameText(token, settings.accessToken)) {
    throw new HTTPException(401, { message: "Токен не подходит" });
  }

  return ctx.json({ token: await issue(settings.adminLogin) });
});

app.use("/me", requireAuth);
app.get("/me", async (ctx) => {
  const settings = await getSettingsRow();

  return ctx.json({ login: settings.adminLogin, mustChangePassword: settings.mustChangePassword });
});

app.use("/password", requireAuth);
app.post("/password", async (ctx) => {
  const body = await ctx.req.json<{ current?: string; next?: string }>();
  const settings = await getSettingsRow();

  if (!(await bcrypt.compare(body.current ?? "", settings.adminPasswordHash))) {
    throw new HTTPException(400, { message: "Текущий пароль неверный" });
  }

  const next = body.next ?? "";

  if (next.length < 6) throw new HTTPException(400, { message: "Новый пароль — от 6 символов" });

  await dbClient.settings.update({
    where: { id: 1 },
    data: { adminPasswordHash: await bcrypt.hash(next, 10), mustChangePassword: false },
  });

  return ctx.json({ ok: true });
});

app.use("/access-token", requireAuth);
app.get("/access-token", async (ctx) => ctx.json({ token: (await getSettingsRow()).accessToken }));

app.use("/access-token/*", requireAuth);
app.post("/access-token/regenerate", async (ctx) => {
  const { accessToken } = await dbClient.settings.update({
    where: { id: 1 },
    data: { accessToken: newAccessToken() },
  });

  return ctx.json({ token: accessToken });
});

export default app;
