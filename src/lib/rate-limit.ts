import "server-only";

import { env } from "cloudflare:workers";
import {
  checkRateLimitWithBinding,
  type RateLimitResult,
} from "@/lib/rate-limit-core";

/**
 * Distributed authentication rate limiting backed by Cloudflare's native
 * Rate Limiting binding. This works across Worker isolates and regions and
 * does not depend on an ephemeral filesystem.
 */
export async function checkRateLimit(
  ip: string,
  action: string
): Promise<RateLimitResult> {
  return checkRateLimitWithBinding(env.AUTH_RATE_LIMITER, ip, action);
}
