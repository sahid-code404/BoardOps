// File-based persistent rate limiter.
//
// Tracks requests per IP + action and persists state to a JSON file so that
// rate-limit counters survive server restarts (the previous in-memory
// implementation reset on every restart, allowing an attacker to bypass the
// limit by simply waiting for the dev server to reload).
//
// Behaviour:
//   - Read the file on every check (cheap; the file is tiny).
//   - Mutate the in-memory copy.
//   - Write back, throttled to once every 5s to keep disk I/O bounded.
//   - Clean up expired entries on every write.
//
// Same API as the previous implementation:
//   checkRateLimit(ip, action): { allowed, remaining, resetAt }

import { existsSync, readFileSync, writeFileSync } from "fs";

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5; // 5 attempts per minute per IP per action
const STORE_PATH = "/tmp/boardops-rate-limit.json";
const WRITE_THROTTLE_MS = 5_000; // only flush to disk at most once every 5s

type RateRecord = { count: number; resetAt: number };
type RateStore = Record<string, RateRecord>;

/**
 * Most recently mutated store. Captured by deferred-write closures so that
 * when a throttled write eventually fires, it persists the latest state
 * rather than a stale snapshot.
 */
let latestStore: RateStore | null = null;
let lastWriteAt = 0;
let writePending = false;

function readStore(): RateStore {
  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as RateStore;
      }
    }
  } catch (e) {
    console.error("[rate-limit] Failed to read store:", e);
  }
  return {};
}

function writeStore(store: RateStore) {
  latestStore = store;
  const now = Date.now();

  // Clean up expired entries on every write attempt.
  for (const key of Object.keys(store)) {
    if (store[key].resetAt < now) delete store[key];
  }

  if (now - lastWriteAt < WRITE_THROTTLE_MS) {
    // Throttled — schedule a deferred write so the latest state still lands on disk.
    if (!writePending) {
      writePending = true;
      const delay = WRITE_THROTTLE_MS - (now - lastWriteAt);
      const timer = setTimeout(() => {
        writePending = false;
        if (!latestStore) return;
        try {
          writeFileSync(STORE_PATH, JSON.stringify(latestStore));
          lastWriteAt = Date.now();
        } catch (e) {
          console.error("[rate-limit] Failed to persist store:", e);
        }
      }, delay);
      // Don't keep the event loop alive just for this write.
      if (typeof timer.unref === "function") timer.unref();
    }
    return;
  }

  try {
    writeFileSync(STORE_PATH, JSON.stringify(store));
    lastWriteAt = now;
  } catch (e) {
    console.error("[rate-limit] Failed to persist store:", e);
  }
}

export function checkRateLimit(
  ip: string,
  action: string
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `${ip}:${action}`;
  const now = Date.now();
  const store = readStore();
  const existing = store[key];

  if (!existing || existing.resetAt < now) {
    store[key] = { count: 1, resetAt: now + WINDOW_MS };
    writeStore(store);
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, resetAt: now + WINDOW_MS };
  }

  if (existing.count >= MAX_ATTEMPTS) {
    // Even on a denied request we persist so other instances see the same state.
    writeStore(store);
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  writeStore(store);
  return { allowed: true, remaining: MAX_ATTEMPTS - existing.count, resetAt: existing.resetAt };
}
