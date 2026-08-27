import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { cancelTask } from "@/lib/task-engine";

// GET /api/tasks/[id] — get a single task
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;
    const task = await db.backgroundTask.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!task) return err("Task not found", 404);
    return ok(task);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/tasks/[id]/cancel — cancel a queued task
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const existing = await db.backgroundTask.findUnique({ where: { id } });
    if (!existing) return err("Task not found", 404);
    if (existing.status === "COMPLETED" || existing.status === "FAILED") {
      return err("Cannot cancel a completed/failed task", 400);
    }
    if (existing.status === "CANCELLED") return err("Task already cancelled", 400);
    await cancelTask(id);
    return ok({ cancelled: true });
  } catch (e) {
    return handleApiError(e);
  }
}
