import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

/** POST /api/payments/[id]/restore — restore a soft-deleted payment from the deletion queue */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) return err("Payment not found", 404);
    if (!payment.deletedAt) return err("This payment is not in the deletion queue", 422);

    // Restored payments revert to PENDING status (since the prior status is unknown
    // after deletion — safer than assuming APPROVED, which would re-apply to bills).
    const restored = await db.payment.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        status: "PENDING",
      },
      include: { user: { select: { name: true, email: true, room: true, avatarUrl: true } } },
    });

    await logAudit({
      actorId: admin.id,
      action: "PAYMENT_RESTORE",
      entity: "Payment",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: payment.deletedAt },
      newValue: { status: "PENDING" },
    });

    return ok(restored);
  } catch (e) {
    return handleApiError(e);
  }
}
