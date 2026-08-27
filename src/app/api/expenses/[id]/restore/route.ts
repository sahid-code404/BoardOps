import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

/** POST /api/expenses/[id]/restore — restore a soft-deleted expense from the deletion queue.
 *  Restored expenses revert to APPROVED status (their default operational state). */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) return err("Expense not found", 404);
    if (!expense.deletedAt) return err("This expense is not in the deletion queue", 422);

    const restored = await db.expense.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        status: "APPROVED",
      },
      include: { user: { select: { name: true } } },
    });

    await logAudit({
      actorId: admin.id,
      action: "EXPENSE_RESTORE",
      entity: "Expense",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: expense.deletedAt },
      newValue: { status: "APPROVED" },
    });

    return ok(restored);
  } catch (e) {
    return handleApiError(e);
  }
}
