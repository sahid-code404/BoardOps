import { describe, expect, test, vi } from "vitest";
import {
  checkRateLimitWithBinding,
  RATE_LIMIT_WINDOW_MS,
  type RateLimiterBinding,
} from "@/lib/rate-limit-core";

function bindingReturning(success: boolean) {
  const limit = vi.fn(async (_input: { key: string }) => ({ success }));
  const binding: RateLimiterBinding = { limit };
  return { binding, limit };
}

describe("rate-limit: Cloudflare binding adapter", () => {
  test("uses action and IP as the distributed limiter key", async () => {
    const { binding, limit } = bindingReturning(true);
    const result = await checkRateLimitWithBinding(
      binding,
      "203.0.113.10",
      "login",
      () => 1_700_000_000_000
    );
    expect(limit).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith({ key: "login:203.0.113.10" });
    expect(result.allowed).toBe(true);
  });

  test("maps Cloudflare success=true to an allowed compatibility result", async () => {
    const { binding } = bindingReturning(true);
    const now = 1_800_000_000_000;
    const result = await checkRateLimitWithBinding(binding, "198.51.100.4", "register", () => now);
    expect(result).toEqual({
      allowed: true,
      remaining: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  });

  test("maps Cloudflare success=false to a denied compatibility result", async () => {
    const { binding } = bindingReturning(false);
    const now = 1_900_000_000_000;
    const result = await checkRateLimitWithBinding(binding, "198.51.100.5", "verify-otp", () => now);
    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  });

  test("uses an explicit unknown-IP key instead of an empty key segment", async () => {
    const { binding, limit } = bindingReturning(true);
    await checkRateLimitWithBinding(binding, "", "forgot-password");
    expect(limit).toHaveBeenCalledWith({ key: "forgot-password:unknown" });
  });

  test("different actions produce distinct Cloudflare keys for the same IP", async () => {
    const { binding, limit } = bindingReturning(true);
    const ip = "192.0.2.44";
    await checkRateLimitWithBinding(binding, ip, "login");
    await checkRateLimitWithBinding(binding, ip, "register");
    expect(limit).toHaveBeenNthCalledWith(1, { key: `login:${ip}` });
    expect(limit).toHaveBeenNthCalledWith(2, { key: `register:${ip}` });
  });
});
