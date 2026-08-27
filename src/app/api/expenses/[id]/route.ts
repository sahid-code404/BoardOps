import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getDeletionDate } from "@/lib/user-cleanup";
import { z } from "zod";

const editSchema = z.object({
  title: z.string().min(2, "Item name is required").optional(),
  category: z.string().min(2).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  description: z.string().nullable().optional(),
  expenseDate: z.string().transform((s) => new Date(s)).optional(),
  paidTo: z.string().nullable().optional(),
});

/** PUT /api/expenses/[id] — edit an expense (only if not locked and not in deletion queue) */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = editSchema.parse(body);

    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) return err("Expense not found", 404);

    // Can't edit if already in the deletion queue
    if (existing.deletedAt) return err("Expense is scheduled for deletion", 422);

    // Check if locked — can't edit if status is LOCKED or if the month has passed
    if (existing.status === "LOCKED") {
      return err("This expense is locked and cannot be edited", 422);
    }

    // Check if the expense's month is in the past (locked after month ends)
    const expDate = data.expenseDate || existing.expenseDate;
    const now = new Date();
    if (
      expDate.getFullYear() < now.getFullYear() ||
      (expDate.getFullYear() === now.getFullYear() && expDate.getMonth() < now.getMonth())
    ) {
      return err("Expenses from past months cannot be edited (locked)", 422);
    }

    const updated = await db.expense.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.expenseDate !== undefined && { expenseDate: data.expenseDate }),
        ...(data.paidTo !== undefined && { paidTo: data.paidTo }),
      },
    });

    await logAudit({
      actorId: user.id,
      action: "UPDATE",
      entity: "Expense",
      entityId: id,
      oldValue: existing,
      newValue: updated,
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/expenses/[id] — soft-delete a single expense (7-day grace period).
 *  Refuses if the expense is LOCKED or belongs to a past month (those are locked
 *  because bills may have been generated against them). */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string }).reason;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) return err("Expense not found", 404);
    if (existing.deletedAt) return err("Expense is already scheduled for deletion", 422);

    // Can't delete locked expenses
    if (existing.status === "LOCKED") {
      return err("This expense is locked and cannot be deleted", 422);
    }

    // Can't delete past-month expenses (locked after month ends)
    const now = new Date();
    if (
      existing.expenseDate.getFullYear() < now.getFullYear() ||
      (existing.expenseDate.getFullYear() === now.getFullYear() && existing.expenseDate.getMonth() < now.getMonth())
    ) {
      return err("Expenses from past months cannot be deleted (locked)", 422);
    }

    const deletionDate = getDeletionDate();
    await db.expense.update({
      where: { id },
      data: { deletedAt: deletionDate, deletedBy: user.id, status: "DELETED", deletionReason: reason || null },
    });
    await logAudit({
      actorId: user.id,
      action: "EXPENSE_SOFT_DELETE",
      entity: "Expense",
      entityId: id,
      oldValue: existing,
      newValue: { deletedAt: deletionDate, status: "DELETED", reason },
      reason,
    });
    return ok({ success: true, permanentDeletion: deletionDate.toISOString() });
  } catch (e) {
    return handleApiError(e);
  }
}
