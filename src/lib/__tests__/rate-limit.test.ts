/// <reference types="bun-types" />
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { rmSync } from "fs";
import { checkRateLimit } from "@/lib/rate-limit";

// The rate limiter persists state to `/tmp/boardops-rate-limit.json` and reads
// it back on every call, so each test must start from a clean file. Module-
// level state (`lastWriteAt`, `latestStore`, `writePending`) persists across
// tests within the same Bun process — we work around that by always using
// fresh, far-apart timestamps per test so the 5s write-throttle always flushes
// immediately (no deferred writes to leak between tests).
//
// `Date.now()` is mocked so we can advance time past the 60s rate-limit window
// without actually waiting.

const STORE_PATH = "/tmp/boardops-rate-limit.json";

const realDateNow = Date.now;
let mockTime = 1_700_000_000_000;

function setTime(t: number) {
  mockTime = t;
}

beforeAll(() => {
  Date.now = () => mockTime;
});

afterAll(() => {
  Date.now = realDateNow;
  rmSync(STORE_PATH, { force: true });
});

beforeEach(() => {
  // Clean slate for every test — no carry-over from prior test runs.
  rmSync(STORE_PATH, { force: true });
});

afterEach(() => {
  rmSync(STORE_PATH, { force: true });
});

describe("rate-limit: checkRateLimit", () => {
  test("full lifecycle: 5 allowed → 6th denied → reset after window", () => {
    const ip = "203.0.113.1";
    const action = "login";
    const START = 1_700_000_000_000;
    const WINDOW_MS = 60_000;

    // ── 1st request — opens a fresh window, count=1, remaining=4 ──
    setTime(START);
    let r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
    expect(r.resetAt).toBe(START + WINDOW_MS);

    // Advance >5s between calls so the write-throttle always flushes to disk
    // immediately (otherwise deferred writes would leave readStore() stale).

    setTime(START + 6_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(3);

    setTime(START + 12_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);

    setTime(START + 18_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);

    // ── 5th request — count=5, allowed but remaining=0 ──
    setTime(START + 24_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);

    // ── 6th request — count >= MAX_ATTEMPTS → denied ──
    setTime(START + 30_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    // Window hasn't moved — the denied branch preserves the original resetAt.
    expect(r.resetAt).toBe(START + WINDOW_MS);

    // ── Still inside the window — another request is also denied ──
    setTime(START + 45_000);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);

    // ── Window expires (60s + 1ms) — fresh window, allowed again ──
    setTime(START + WINDOW_MS + 1);
    r = checkRateLimit(ip, action);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
    // resetAt advances to now + WINDOW_MS.
    expect(r.resetAt).toBe(START + WINDOW_MS + 1 + WINDOW_MS);
  });

  test("different IPs are tracked independently", () => {
    const START = 1_800_000_000_000;

    setTime(START);
    let rA = checkRateLimit("10.0.0.1", "login");
    expect(rA.allowed).toBe(true);
    expect(rA.remaining).toBe(4);

    // A different IP starts with a fresh window — IP A's count doesn't bleed.
    setTime(START + 6_000);
    let rB = checkRateLimit("10.0.0.2", "login");
    expect(rB.allowed).toBe(true);
    expect(rB.remaining).toBe(4);

    // IP A's next request increments its OWN count.
    setTime(START + 12_000);
    rA = checkRateLimit("10.0.0.1", "login");
    expect(rA.allowed).toBe(true);
    expect(rA.remaining).toBe(3);
  });

  test("different actions are tracked independently", () => {
    const START = 1_900_000_000_000;

    setTime(START);
    let r1 = checkRateLimit("10.1.1.1", "login");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);

    // Same IP, different action → fresh window.
    setTime(START + 6_000);
    let r2 = checkRateLimit("10.1.1.1", "register");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(4);

    // Back to the original action → its count picks up where it left off.
    setTime(START + 12_000);
    let r3 = checkRateLimit("10.1.1.1", "login");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(3);
  });

  test("a denied request does NOT consume the window's resetAt", () => {
    // When the limiter denies a request it returns the original resetAt
    // (the window doesn't slide forward just because the user kept hammering).
    const START = 2_000_000_000_000;
    const WINDOW_MS = 60_000;

    setTime(START);
    for (let i = 0; i < 5; i++) {
      setTime(START + i * 6_000);
      const r = checkRateLimit("10.2.2.2", "login");
      expect(r.allowed).toBe(true);
    }

    // 6th — denied, resetAt should still be START + WINDOW_MS
    setTime(START + 30_000);
    const denied = checkRateLimit("10.2.2.2", "login");
    expect(denied.allowed).toBe(false);
    expect(denied.resetAt).toBe(START + WINDOW_MS);

    // 7th — still denied, same resetAt
    setTime(START + 40_000);
    const denied2 = checkRateLimit("10.2.2.2", "login");
    expect(denied2.allowed).toBe(false);
    expect(denied2.resetAt).toBe(START + WINDOW_MS);
  });
});
