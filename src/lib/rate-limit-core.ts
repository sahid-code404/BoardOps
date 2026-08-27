const WINDOW_MS = 60_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimiterBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Cloudflare-independent rate-limit adapter logic.
 *
 * Cloudflare's native Rate Limiting binding owns the distributed counter and
 * window. It intentionally exposes only success/failure, so `remaining` and
 * `resetAt` are compatibility fields for existing callers rather than exact
 * distributed counter metadata.
 */
export async function checkRateLimitWithBinding(
  binding: RateLimiterBinding,
  ip: string,
  action: string,
  now: () => number = Date.now
): Promise<RateLimitResult> {
  const key = `${action}:${ip || "unknown"}`;
  const result = await binding.limit({ key });

  return {
    allowed: result.success,
    remaining: result.success ? 1 : 0,
    resetAt: now() + WINDOW_MS,
  };
}

export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
