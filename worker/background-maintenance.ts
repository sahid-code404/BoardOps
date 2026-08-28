import type { D1Database } from "@cloudflare/workers-types";

/**
 * Lightweight self-healing maintenance used by high-traffic read surfaces.
 * Every statement is idempotent and the entire batch is best-effort: a
 * maintenance failure must never make the primary dashboard request fail.
 */
export async function runBackgroundMaintenance(db: D1Database, now = new Date()): Promise<void> {
  const nowIso = now.toISOString();
  try {
    await db.batch([
      db.prepare(`
        UPDATE "Bill"
        SET "status" = 'OVERDUE', "updatedAt" = ?1
        WHERE "status" IN ('GENERATED', 'PARTIALLY_PAID')
          AND "dueDate" < ?1
          AND "deletedAt" IS NULL
      `).bind(nowIso),
      db.prepare(`
        UPDATE "Restriction"
        SET "status" = 'EXPIRED', "updatedAt" = ?1
        WHERE "status" = 'ACTIVE'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" < ?1
      `).bind(nowIso),
      db.prepare(`
        DELETE FROM "UserSession"
        WHERE "expiresAt" < ?1
      `).bind(nowIso),
    ]);
  } catch (error) {
    console.error("[background-maintenance] Error", error);
  }
}
