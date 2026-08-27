import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getDeletionDate } from "@/lib/user-cleanup";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;
    const bill = await db.bill.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true, room: true } },
        payments: true,
      },
    });
    if (!bill) return err("Bill not found", 404);
    return ok(bill);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/bills/[id] — soft-delete a single bill (7-day grace period) */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string }).reason;
    const existing = await db.bill.findUnique({ where: { id } });
    if (!existing) return err("Bill not found", 404);
    if (existing.deletedAt) return err("Bill is already scheduled for deletion", 422);

    const deletionDate = getDeletionDate();
    await db.bill.update({
      where: { id },
      data: { deletedAt: deletionDate, deletedBy: user.id, status: "DELETED", deletionReason: reason || null },
    });
    await logAudit({
      actorId: user.id,
      action: "BILL_SOFT_DELETE",
      entity: "Bill",
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
