import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { createTask, runTask, cleanupExpiredSessions } from "@/lib/task-engine";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";

/**
 * POST /api/tasks/cleanup — trigger an immediate session cleanup task.
 * Creates a BackgroundTask record + runs the cleanup synchronously.
 */
export async function POST() {
  try {
    const admin = await requireRole("ADMIN");

    const taskId = await createTask({
      type: "SESSION_CLEANUP",
      triggeredBy: admin.id,
    });

    await runTask(taskId, async () => {
      const purgedCount = await cleanupExpiredSessions();
      return { purgedSessions: purgedCount };
    });

    // Fetch the final result
    const { db } = await import("@/lib/db");
    const task = await db.backgroundTask.findUnique({ where: { id: taskId } });

    await logAudit({
      actorId: admin.id,
      action: "SESSION_CLEANUP",
      entity: "BackgroundTask",
      entityId: taskId,
      newValue: { purged: task?.result },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    if (task?.status === "FAILED") {
      return err(task.errorMessage || "Cleanup failed", 500);
    }

    return ok({ taskId, result: task?.result ? JSON.parse(task.result) : null });
  } catch (e) {
    return handleApiError(e);
  }
}
