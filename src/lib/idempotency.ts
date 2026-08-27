/**
 * Idempotency Helper (PRD API Specification #24)
 *
 * Prevents duplicate processing of financial operations. If a client sends
 * the same request twice (e.g. due to a network retry), the second request
 * is a no-op and returns the original result.
 *
 * Usage in an API route:
 *   const idempotencyKey = req.headers.get("x-idempotency-key");
 *   if (idempotencyKey) {
 *     const cached = await checkIdempotency(idempotencyKey);
 *     if (cached) return ok(cached.result);
 *   }
 *   // ... do the work ...
 *   if (idempotencyKey) {
 *     await storeIdempotency(idempotencyKey, result);
 *   }
 *
 * The idempotency record is stored in the Setting table with a special key
 * prefix `idem:` and expires after 24 hours.
 */

import { db } from "@/lib/db";

const IDEMPOTENCY_PREFIX = "idem:";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type IdempotencyRecord = {
  result: unknown;
  createdAt: string;
};

/**
 * Check if an idempotency key has already been processed.
 * Returns the cached result if found (and not expired), null otherwise.
 */
export async function checkIdempotency(key: string): Promise<IdempotencyRecord | null> {
  const record = await db.setting.findUnique({
    where: { key: `${IDEMPOTENCY_PREFIX}${key}` },
  });
  if (!record) return null;

  // Check expiry
  const createdAt = new Date(record.updatedAt);
  if (Date.now() - createdAt.getTime() > IDEMPOTENCY_TTL_MS) {
    // Expired — delete and return null
    await db.setting.delete({ where: { key: record.key } }).catch(() => {});
    return null;
  }

  try {
    return { result: JSON.parse(record.value), createdAt: record.updatedAt.toISOString() };
  } catch {
    return null;
  }
}

/**
 * Store an idempotency key + result. If the key already exists, it's a no-op.
 */
export async function storeIdempotency(key: string, result: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key: `${IDEMPOTENCY_PREFIX}${key}` },
    update: {}, // no-op if already exists (don't overwrite the original result)
    create: {
      key: `${IDEMPOTENCY_PREFIX}${key}`,
      value: JSON.stringify(result),
      category: "IDEMPOTENCY",
      type: "JSON",
      description: `Idempotency record for key: ${key}`,
      isPublic: false,
    },
  });
}

/**
 * Clean up expired idempotency records. Called periodically.
 */
export async function cleanupExpiredIdempotency(): Promise<number> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  const result = await db.setting.deleteMany({
    where: {
      key: { startsWith: IDEMPOTENCY_PREFIX },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}
