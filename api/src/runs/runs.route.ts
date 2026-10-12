import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { requireAuth } from "../core/auth.js";
import { dbClient } from "../core/db.js";
import { factory } from "../core/factory.js";
import { listRuns } from "./runs.service.js";

// Запуски регистрации из кабинета. Запуск только встаёт в очередь —
// забирает и крутит его воркер

const app = factory.createApp().basePath("/runs");

app.use("/*", requireAuth);
app.use("/", requireAuth);

app.get("/", async (ctx) => ctx.json({ items: await listRuns() }));

const createSchema = z.object({
  // registration — новые аккаунты на пустых телефонах;
  // restore — повторный вход в вылетевшие аккаунты отмеченных телефонов
  kind: z.enum(["registration", "restore"]).default("registration"),
  groupId: z.string().nullable().optional(),
  phoneIds: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(20).default(2),
  errorsPerPhone: z.number().int().min(1).max(50).default(8),
});

app.post("/", async (ctx) => {
  const parsed = createSchema.safeParse(await ctx.req.json().catch(() => ({})));

  if (!parsed.success) throw new HTTPException(400, { message: "Неверные параметры запуска" });

  const input = parsed.data;
  const group = input.groupId
    ? await dbClient.farmGroup.findUnique({ where: { id: input.groupId } })
    : null;

  if (input.groupId && !group) throw new HTTPException(400, { message: "Группа не найдена" });

  const restore = input.kind === "restore";

  if (restore && !input.phoneIds?.length) {
    throw new HTTPException(400, { message: "Отметьте телефоны, на которых восстановить вход" });
  }

  // Регистрируем только телефоны без аккаунта, восстанавливаем — только с аккаунтом
  const phones = await dbClient.farmPhone.findMany({
    where: {
      geelarkId: { not: null },
      accountPhone: restore ? { not: null } : null,
      ...(input.phoneIds?.length ? { id: { in: input.phoneIds } } : {}),
      ...(group ? { groupId: group.id } : {}),
    },
    select: { id: true },
    orderBy: { profileName: "asc" },
  });

  if (!phones.length) {
    throw new HTTPException(400, {
      message: restore
        ? "У отмеченных телефонов нет аккаунта — восстанавливать нечего"
        : group
          ? `В группе «${group.name}» нет телефонов без аккаунта`
          : "Нет телефонов без аккаунта",
    });
  }

  // Телефон, который уже стоит в другом незавершённом запуске, не берём
  const busy = new Set(
    (
      await dbClient.regRunPhone.findMany({
        where: {
          phoneId: { in: phones.map((phone) => phone.id) },
          status: { in: ["pending", "running"] },
          run: { status: { in: ["queued", "running", "canceling"] } },
        },
        select: { phoneId: true },
      })
    ).map((item) => item.phoneId),
  );
  const free = phones.filter((phone) => !busy.has(phone.id));

  if (!free.length) {
    throw new HTTPException(400, { message: "Все эти телефоны уже стоят в другом запуске" });
  }

  const run = await dbClient.regRun.create({
    data: {
      kind: input.kind,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      concurrency: input.concurrency,
      errorsPerPhone: input.errorsPerPhone,
      phones: { create: free.map((phone) => ({ phoneId: phone.id })) },
    },
  });

  const [view] = (await listRuns(50)).filter((item) => item.id === run.id);

  return ctx.json(view, 201);
});

app.post("/:id/cancel", async (ctx) => {
  const id = ctx.req.param("id");
  const run = await dbClient.regRun.findUniqueOrThrow({ where: { id } });

  if (run.status === "queued") {
    await dbClient.regRun.update({
      where: { id },
      data: { status: "canceled", finishedAt: new Date() },
    });
    await dbClient.regRunPhone.updateMany({
      where: { runId: id, status: "pending" },
      data: { status: "skipped", error: "запуск остановлен", finishedAt: new Date() },
    });
  } else if (run.status === "running") {
    // Воркер увидит отметку и погасит телефоны сам
    await dbClient.regRun.update({ where: { id }, data: { status: "canceling" } });
  }

  return ctx.json({ ok: true });
});

export default app;
