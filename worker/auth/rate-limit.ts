import type { Context } from "hono";

import type { BoardOpsEnv } from "../types";

const WINDOW_MS = 60_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export async function checkRateLimit(
  c: Context<BoardOpsEnv>,
  ip: string,
  action: string,
): Promise<RateLimitResult> {
  const key = `${action}:${ip || "unknown"}`;
  const result = await c.env.AUTH_RATE_LIMITER.limit({ key });

  return {
    allowed: result.success,
    remaining: result.success ? 1 : 0,
    resetAt: Date.now() + WINDOW_MS,
  };
}
