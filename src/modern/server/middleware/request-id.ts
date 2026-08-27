import { createMiddleware } from "hono/factory";
import type { ModernVariables } from "@modern/server/bindings";

export const requestIdMiddleware = createMiddleware<{
  Variables: ModernVariables;
}>(async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});
