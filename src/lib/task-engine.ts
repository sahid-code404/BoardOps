/**
 * Background Task Engine (PRD Engineering Improvement)
 *
 * Creates and tracks async tasks. In a production system these would be
 * processed by a job queue (BullMQ, etc.) — here we track them in the DB
 * and process them synchronously when triggered, but the task record
 * provides a persistent audit trail + status tracking.
 *
 * Task types:
 *   - MONTHLY_CLOSING — runs the full closing workflow
 *   - REPORT_EXPORT — generates a large CSV export
 *   - SESSION_CLEANUP — purges expired sessions
 *   - BILL_GENERATION — generates bills for a period
 *   - ANNOUNCEMENT_SCHEDULE — publishes a scheduled announcement
 */

import { db } from "@/lib/db";

export type TaskType =
  | "MONTHLY_CLOSING"
  | "REPORT_EXPORT"
  | "SESSION_CLEANUP"
  | "BILL_GENERATION"
  | "ANNOUNCEMENT_SCHEDULE";

export type TaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type BackgroundTask = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  payload: string | null;
  result: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  scheduledFor: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  triggeredBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Create a new background task record. */
export async function createTask(input: {
  type: TaskType;
  payload?: Record<string, unknown>;
  triggeredBy?: string;
  scheduledFor?: Date;
  maxRetries?: number;
}): Promise<string> {
  const task = await db.backgroundTask.create({
    data: {
      type: input.type,
      status: "QUEUED",
      payload: input.payload ? JSON.stringify(input.payload) : null,
      triggeredBy: input.triggeredBy ?? null,
      scheduledFor: input.scheduledFor ?? null,
      maxRetries: input.maxRetries ?? 3,
    },
  });
  return task.id;
}

/** Mark a task as running. */
export async function startTask(taskId: string): Promise<void> {
  await db.backgroundTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0 },
  });
}

/** Update task progress (0-100). */
export async function updateProgress(taskId: string, progress: number): Promise<void> {
  await db.backgroundTask.update({
    where: { id: taskId },
    data: { progress: Math.min(100, Math.max(0, progress)) },
  });
}

/** Mark a task as completed with a result. */
export async function completeTask(taskId: string, result?: Record<string, unknown>): Promise<void> {
  await db.backgroundTask.update({
    where: { id: taskId },
    data: {
      status: "COMPLETED",
      progress: 100,
      result: result ? JSON.stringify(result) : null,
      finishedAt: new Date(),
    },
  });
}

/** Mark a task as failed with an error message. */
export async function failTask(taskId: string, error: string): Promise<void> {
  const task = await db.backgroundTask.findUnique({ where: { id: taskId } });
  if (!task) return;

  await db.backgroundTask.update({
    where: { id: taskId },
    data: {
      status: task.retryCount < task.maxRetries ? "QUEUED" : "FAILED",
      errorMessage: error,
      retryCount: task.retryCount + 1,
      finishedAt: task.retryCount < task.maxRetries ? null : new Date(),
    },
  });
}

/** Cancel a queued task. */
export async function cancelTask(taskId: string): Promise<void> {
  await db.backgroundTask.update({
    where: { id: taskId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

/**
 * Run a task with automatic status tracking + error handling.
 * The executor function receives (taskId) and can call updateProgress.
 */
export async function runTask(
  taskId: string,
  executor: (taskId: string) => Promise<Record<string, unknown>>
): Promise<void> {
  await startTask(taskId);
  try {
    const result = await executor(taskId);
    await completeTask(taskId, result);
  } catch (e) {
    await failTask(taskId, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Session cleanup — purge expired sessions.
 * Returns the count of purged sessions.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.userSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null } },
      ],
    },
  });
  return result.count;
}
