import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Archive users whose soft-delete grace period (7 days) has expired.
 *
 * DIR-7: Previously this hard-deleted the user with a cascading delete that
 * wiped ALL related records (bills, payments, ledger, meal entries, etc.).
 * That destroyed audit-trail data and broke historical reports. We now keep
 * the row and flip its status to ARCHIVED, preserving every related record
 * for compliance / reporting. `deletedAt` is also refreshed to the archival
 * moment so downstream filters that exclude soft-deleted users still work.
 *
 * Called on every GET /api/users to keep the deletion queue clean.
 */
export async function purgeExpiredUsers(): Promise<number> {
  try {
    const now = new Date();
    // Find users where deletedAt is set AND the 7-day grace period has passed
    const expired = await db.user.findMany({
      where: {
        deletedAt: { not: null, lt: now },
        // Skip users who have already been archived — keeps this idempotent
        // so repeated GET /api/users calls don't re-issue the same update.
        status: { not: "ARCHIVED" },
      },
      select: { id: true },
    });

    if (expired.length === 0) return 0;

    // Soft-archive: keep the row + all related data, just flip status.
    const result = await db.user.updateMany({
      where: {
        id: { in: expired.map((u) => u.id) },
      },
      data: {
        status: "ARCHIVED",
        deletedAt: now, // refresh timestamp to mark archival moment
      },
    });

    // Best-effort audit log per archived user. Failures here don't roll back
    // the archival — audit logging is fire-and-forget by design.
    await Promise.all(
      expired.map((u) =>
        logAudit({
          actorId: u.id,
          action: "USER_ARCHIVED",
          entity: "User",
          entityId: u.id,
          reason: "Soft-delete grace period (7 days) expired — record preserved.",
        })
      )
    );

    return result.count;
  } catch (e) {
    console.error("Failed to archive expired users:", e);
    return 0;
  }
}

/** Calculate the deletion date (7 days from now). */
export function getDeletionDate(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/** Format a countdown string (e.g., "5 days left", "12 hours left"). */
export function formatDeletionCountdown(deletedAt: Date): string {
  const now = new Date();
  const diff = deletedAt.getTime() - now.getTime();

  if (diff <= 0) return "Expiring soon";

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} left`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} left`;
  return "Less than 1 hour left";
}

/**
 * Permanently delete bills whose soft-delete grace period (7 days) has expired.
 * Called on every GET /api/bills to keep the deletion queue clean.
 */
export async function purgeExpiredBills(): Promise<number> {
  try {
    const now = new Date();
    const result = await db.bill.deleteMany({
      where: {
        deletedAt: { not: null, lt: now },
      },
    });
    return result.count;
  } catch (e) {
    console.error("Failed to purge expired bills:", e);
    return 0;
  }
}

/**
 * Permanently delete payments whose soft-delete grace period (7 days) has expired.
 * Called on every GET /api/payments to keep the deletion queue clean.
 */
export async function purgeExpiredPayments(): Promise<number> {
  try {
    const now = new Date();
    const result = await db.payment.deleteMany({
      where: {
        deletedAt: { not: null, lt: now },
      },
    });
    return result.count;
  } catch (e) {
    console.error("Failed to purge expired payments:", e);
    return 0;
  }
}

/**
 * Permanently delete expenses whose soft-delete grace period (7 days) has expired.
 * Called on every GET /api/expenses to keep the deletion queue clean.
 */
export async function purgeExpiredExpenses(): Promise<number> {
  try {
    const now = new Date();
    const result = await db.expense.deleteMany({
      where: {
        deletedAt: { not: null, lt: now },
      },
    });
    return result.count;
  } catch (e) {
    console.error("Failed to purge expired expenses:", e);
    return 0;
  }
}
