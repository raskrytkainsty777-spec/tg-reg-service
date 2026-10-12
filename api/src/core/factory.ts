import { createFactory } from "hono/factory";

export type Variables = { login: string };

export const factory = createFactory<{ Variables: Variables }>();
