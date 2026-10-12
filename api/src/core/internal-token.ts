import { timingSafeEqual } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";

// Машинные ручки (воркер, Asterisk) — по общему токену INTERNAL_TOKEN.
// Asterisk в dialplan заголовки не шлёт, ему можно ?token=

export const internalToken = () => process.env.INTERNAL_TOKEN?.trim() ?? "";

const tokenMatches = (provided: string | undefined) => {
  const expected = internalToken();

  if (!expected || !provided) return false;

  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
};

export const requireInternalToken: MiddlewareHandler = async (ctx, next) => {
  const provided = ctx.req.header("X-Internal-Token") ?? ctx.req.query("token");

  if (!tokenMatches(provided)) throw new HTTPException(401, { message: "Unauthorized" });

  await next();
};
