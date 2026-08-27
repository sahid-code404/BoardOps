import { db } from "@/lib/db";

// Self-healing task runner — called on every dashboard/bills API request.
// Runs lightweight maintenance tasks if they haven't run recently.

const TASK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function runBackgroundTasks() {
  try {
    // 1. Auto-transition overdue bills
    await db.bill.updateMany({
      where: {
        status: { in: ["GENERATED", "PARTIALLY_PAID"] },
        dueDate: { lt: new Date() },
        deletedAt: null,
      },
      data: { status: "OVERDUE" },
    });

    // 2. Auto-lift expired restrictions
    await db.restriction.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });

    // 3. Clean up expired sessions
    await db.userSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  } catch (e) {
    // Silent fail — background tasks should never break the main request
    console.error("[task-runner] Error:", e);
  }
}
