import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import authRoute from "./core/auth.js";
import { dbClient } from "./core/db.js";
import { ensureSettings } from "./core/settings.js";
import settingsRoute from "./core/settings.route.js";
import phonesRoute from "./phones/farm-accounts.route.js";
import farmRoute from "./reg/farm.route.js";
import internalRoute from "./reg/internal.route.js";
import { releaseStaleRegistrations } from "./reg/registration.service.js";
import { sipTranscriptionService } from "./reg/sip-transcription.service.js";
import runsRoute from "./runs/runs.route.js";
import workerRoute from "./runs/worker.route.js";

// Один процесс: API кабинета, ручки воркера и Asterisk, AudioSocket для
// звонков с кодом и уборщик. Собранный кабинет (web) отдаётся отсюда же

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.resolve(process.cwd(), "public");
const SWEEP_INTERVAL_MS = 60_000;

const app = new Hono();

app.onError((error, ctx) => {
  if (error instanceof HTTPException) {
    return ctx.json({ message: error.message }, error.status);
  }

  // Prisma: запись не найдена
  if ((error as { code?: string }).code === "P2025") {
    return ctx.json({ message: "Не найдено" }, 404);
  }

  console.error("[api] unhandled", error);

  return ctx.json({ message: error instanceof Error ? error.message : "Ошибка сервера" }, 500);
});

app.get("/api/health", (ctx) => ctx.json({ ok: true }));

for (const route of [
  authRoute,
  settingsRoute,
  phonesRoute,
  farmRoute,
  runsRoute,
  workerRoute,
  internalRoute,
]) {
  app.route("/api", route);
}

app.all("/api/*", (ctx) => ctx.json({ message: "Не найдено" }, 404));

// Кабинет: файлы сборки, остальное — index.html (маршруты React)
if (fs.existsSync(PUBLIC_DIR)) {
  const root = path.relative(process.cwd(), PUBLIC_DIR) || ".";
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

  app.use("/*", serveStatic({ root }));
  app.get("*", (ctx) => ctx.html(indexHtml));
}

const sweep = async () => {
  try {
    const released = await releaseStaleRegistrations();

    if (released) console.log(`[reg] stale registrations released: ${released}`);
  } catch (error) {
    console.error("[reg] sweep failed", error);
  }
};

const main = async () => {
  await ensureSettings();

  if (process.env.AUDIO_SOCKET_ENABLED !== "false") sipTranscriptionService.start();

  setInterval(() => void sweep(), SWEEP_INTERVAL_MS).unref();
  void sweep();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[api] listening on ${PORT}`);
  });
};

main().catch(async (error) => {
  console.error("[api] start failed", error);
  await dbClient.$disconnect();
  process.exit(1);
});
