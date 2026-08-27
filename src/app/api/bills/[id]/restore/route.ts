import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

/** POST /api/bills/[id]/restore — restore a soft-deleted bill from the deletion queue */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const bill = await db.bill.findUnique({ where: { id } });
    if (!bill) return err("Bill not found", 404);
    if (!bill.deletedAt) return err("This bill is not in the deletion queue", 422);

    const restored = await db.bill.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedBy: null,
        status: "GENERATED",
      },
      include: { user: { select: { name: true, email: true, room: true, avatarUrl: true } } },
    });

    await logAudit({
      actorId: admin.id,
      action: "BILL_RESTORE",
      entity: "Bill",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: bill.deletedAt },
      newValue: { status: "GENERATED" },
    });

    return ok(restored);
  } catch (e) {
    return handleApiError(e);
  }
}
