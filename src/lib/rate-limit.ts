import "server-only";

import { env } from "cloudflare:workers";

const WINDOW_MS = 60_000;

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Distributed authentication rate limiting backed by Cloudflare's native
 * Rate Limiting binding. Unlike the old /tmp JSON store, this works across
 * Worker isolates and regions and does not depend on an ephemeral filesystem.
 *
 * The current callers only consume `allowed`. `remaining` and `resetAt` are
 * retained for source compatibility; the Workers binding deliberately does
 * not expose an exact distributed counter/reset timestamp.
 */
export async function checkRateLimit(
  ip: string,
  action: string
): Promise<RateLimitResult> {
  const key = `${action}:${ip || "unknown"}`;
  const result = await env.AUTH_RATE_LIMITER.limit({ key });

  return {
    allowed: result.success,
    remaining: result.success ? 1 : 0,
    resetAt: Date.now() + WINDOW_MS,
  };
}
