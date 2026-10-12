import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { factory } from "../core/factory.js";
import { requireInternalToken } from "../core/internal-token.js";
import {
  AllRegistrationLinesBusyError,
  NoFreeRegistrationNumbersError,
  NoRegistrationResourcesError,
  RegistrationNumberNotFoundError,
  assignRegistrationResources,
  completeRegistration,
  getRegistrationAvailability,
  getRegistrationEmailCode,
  getRegistrationStatus,
  getRegistrationTranscription,
  markNoCall,
  markRegistrationNumberInvalid,
  markWrongEmail,
  releaseRegistration,
} from "./registration.service.js";
import { checkSipCall } from "./sip-transcription.service.js";
import { markAsteriskSeen, renderPjsipTrunks } from "./asterisk-config.js";

// Машинные ручки реги. Контракт /internal/registration/* совпадает с tg-regs
// (TG_REGS_INTEGRATION_CONTRACT.md). Доступ — общий токен INTERNAL_TOKEN в
// заголовке X-Internal-Token; Asterisk в dialplan заголовки не шлёт, ему ?token=

const app = factory.createApp().basePath("/internal");

app.use("/registration/*", requireInternalToken);
app.use("/asterisk/*", requireInternalToken);

const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new HTTPException(400, {
      message: JSON.stringify({ error: "validation_error", issues: result.error.issues }),
    });
  }

  return result.data;
};

const phoneSchema = z.string().regex(/^7\d{10}$/);

const assignSchema = z
  .object({
    externalAgentId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    phoneNumber: phoneSchema.optional(),
  })
  .refine((value) => value.externalAgentId || value.agentId, {
    message: "externalAgentId or agentId is required",
  });

const releaseSchema = z.object({
  accountId: z.string().min(1),
  reason: z.enum(["email_rejected", "expired", "canceled", "other"]),
});

const accountIdSchema = z.object({ accountId: z.string().min(1) });

const markNumberInvalidSchema = z
  .object({ phoneNumber: phoneSchema.optional(), trunkPhoneId: z.string().min(1).optional() })
  .refine((value) => value.phoneNumber || value.trunkPhoneId, {
    message: "phoneNumber or trunkPhoneId is required",
  });

const completeSchema = z.object({
  accountId: z.string().min(1),
  accountCreatedAt: z.string().optional().nullable(),
});

// «2026-09-29» — полночь UTC, остальное — как есть
const parseCreatedAt = (value: string | null | undefined) => {
  if (!value) return null;

  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);

  if (Number.isNaN(date.getTime())) {
    throw new HTTPException(400, { message: "Invalid accountCreatedAt" });
  }

  return date;
};

app.get("/registration/available", async (ctx) =>
  ctx.json(await getRegistrationAvailability()),
);

app.post("/registration/assign", async (ctx) => {
  const input = parse(assignSchema, await ctx.req.json());

  try {
    const account = await assignRegistrationResources(
      input.externalAgentId ?? input.agentId!,
      input.phoneNumber,
    );

    return ctx.json(account, 201);
  } catch (error) {
    if (
      error instanceof NoRegistrationResourcesError ||
      error instanceof AllRegistrationLinesBusyError ||
      error instanceof NoFreeRegistrationNumbersError
    ) {
      return ctx.json({ error: error.message }, 409);
    }

    throw error;
  }
});

app.post("/registration/release", async (ctx) => {
  const input = parse(releaseSchema, await ctx.req.json());
  await releaseRegistration(input.accountId, input.reason);

  return ctx.json({ ok: true });
});

app.post("/registration/mark-no-call", async (ctx) => {
  const input = parse(accountIdSchema, await ctx.req.json());
  await markNoCall(input.accountId);

  return ctx.json({ ok: true });
});

app.post("/registration/mark-number-invalid", async (ctx) => {
  const input = parse(markNumberInvalidSchema, await ctx.req.json());

  try {
    await markRegistrationNumberInvalid(input);
  } catch (error) {
    if (error instanceof RegistrationNumberNotFoundError) {
      return ctx.json({ error: error.message }, 404);
    }

    throw error;
  }

  return ctx.json({ ok: true });
});

app.post("/registration/mark-wrong-email", async (ctx) => {
  const input = parse(accountIdSchema, await ctx.req.json());
  await markWrongEmail(input.accountId);

  return ctx.json({ ok: true });
});

app.post("/registration/complete", async (ctx) => {
  const input = parse(completeSchema, await ctx.req.json());
  await completeRegistration(input.accountId, parseCreatedAt(input.accountCreatedAt));

  return ctx.json({ ok: true });
});

app.get("/registration/email-code", async (ctx) => {
  const input = parse(accountIdSchema, { accountId: ctx.req.query("accountId") });
  const result = await getRegistrationEmailCode(input.accountId);

  return result ? ctx.json(result) : ctx.body(null, 204);
});

app.get("/registration/transcription", async (ctx) => {
  const input = parse(accountIdSchema, { accountId: ctx.req.query("accountId") });
  const result = await getRegistrationTranscription(input.accountId);

  if (!result) return ctx.body(null, 204);
  if ("error" in result) return ctx.json(result, 422);

  return ctx.json(result);
});

app.get("/registration/status", async (ctx) => {
  const input = parse(accountIdSchema, { accountId: ctx.req.query("accountId") });
  const result = await getRegistrationStatus(input.accountId);

  if (!result) return ctx.json({ error: "account_not_found" }, 404);

  return ctx.json(result);
});

// Asterisk: брать ли входящий звонок. Ответ — голый текст ok/reject (CURL в dialplan)
app.get("/asterisk/check-call", async (ctx) => {
  const result = await checkSipCall({
    caller: ctx.req.query("caller"),
    did: ctx.req.query("did"),
    uuid: ctx.req.query("uuid"),
  }).catch((error) => {
    console.error("[reg] check-call failed", error);
    return "reject" as const;
  });

  return ctx.text(result);
});

// Asterisk: транки для pjsip.conf. Забирает сам и перечитывает при изменении
app.get("/asterisk/pjsip", async (ctx) => {
  const config = await renderPjsipTrunks();
  await markAsteriskSeen("config", config.hash);

  ctx.header("X-Config-Hash", config.hash);

  return ctx.text(config.text);
});

export default app;
