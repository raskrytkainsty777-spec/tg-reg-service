import { dbClient } from "../core/db.js";

// Итог запуска считается по телефонам. Воркер зовёт finish в конце;
// force — закрыть, даже если какие-то телефоны так и остались в очереди

export const finishRunIfDone = async (runId: string, force = false) => {
  const run = await dbClient.regRun.findUnique({
    where: { id: runId },
    include: { phones: { select: { status: true } } },
  });

  if (!run || !["running", "canceling"].includes(run.status)) return;

  const left = run.phones.filter((item) => item.status === "pending" || item.status === "running");

  if (left.length && !force) return;

  if (left.length) {
    await dbClient.regRunPhone.updateMany({
      where: { runId, status: { in: ["pending", "running"] } },
      data: {
        status: "skipped",
        error: run.status === "canceling" ? "запуск остановлен" : null,
        finishedAt: new Date(),
      },
    });
  }

  const failed = run.phones.some((item) => item.status === "failed");

  await dbClient.regRun.update({
    where: { id: runId },
    data: {
      status: run.status === "canceling" ? "canceled" : failed ? "done_with_errors" : "done",
      finishedAt: new Date(),
    },
  });
};

type RunStep = { name: string; status: string; detail: string; at: string };

export const listRuns = async (take = 20) => {
  const runs = await dbClient.regRun.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      phones: {
        include: {
          phone: {
            select: { profileName: true, accountPhone: true, accountUsername: true },
          },
        },
        orderBy: { phone: { profileName: "asc" } },
      },
    },
  });

  return runs.map((run) => {
    const finished = run.phones.filter((item) => ["ok", "failed", "skipped"].includes(item.status));

    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      groupName: run.groupName,
      concurrency: run.concurrency,
      errorsPerPhone: run.errorsPerPhone,
      total: run.phones.length,
      done: finished.length,
      ok: run.phones.filter((item) => item.status === "ok").length,
      failed: run.phones.filter((item) => item.status === "failed").length,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      phones: run.phones.map((item) => ({
        id: item.id,
        phoneId: item.phoneId,
        profileName: item.phone.profileName,
        status: item.status,
        error: item.error,
        lastStep: item.lastStep,
        account: item.phone.accountPhone
          ? { phone: item.phone.accountPhone, username: item.phone.accountUsername }
          : null,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        steps: (Array.isArray(item.steps) ? item.steps : []) as RunStep[],
      })),
    };
  });
};
