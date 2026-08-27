import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;

    const purchase = await db.purchase.findUnique({
      where: { id },
      include: {
        items: true,
        expense: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!purchase) return err("Purchase not found", 404);
    return ok(purchase);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const { action, reason } = body as { action: "SOFT_DELETE" | "RESTORE"; reason?: string };

    const existing = await db.purchase.findUnique({ where: { id } });
    if (!existing) return err("Purchase not found", 404);

    if (action === "SOFT_DELETE") {
      if (!reason) return err("Deletion reason is required", 400);
      // Soft-delete both the purchase and its linked expense
      const [purchase] = await db.$transaction([
        db.purchase.update({
          where: { id },
          data: {
            status: "DELETED",
            deletedAt: new Date(),
            deletedBy: admin.id,
            deletionReason: reason,
          },
        }),
        ...(existing.expenseId
          ? [db.expense.update({
              where: { id: existing.expenseId },
              data: {
                status: "DELETED",
                deletedAt: new Date(),
                deletedBy: admin.id,
                deletionReason: reason,
              },
            })]
          : []),
      ]);
      await logAudit({
        actorId: admin.id,
        action: "PURCHASE_SOFT_DELETE",
        entity: "Purchase",
        entityId: id,
        oldValue: existing,
        newValue: { status: "DELETED" },
        reason,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      });
      return ok(purchase);
    }

    if (action === "RESTORE") {
      const [purchase] = await db.$transaction([
        db.purchase.update({
          where: { id },
          data: {
            status: "APPROVED",
            deletedAt: null,
            deletedBy: null,
            deletionReason: null,
          },
        }),
        ...(existing.expenseId
          ? [db.expense.update({
              where: { id: existing.expenseId },
              data: {
                status: "APPROVED",
                deletedAt: null,
                deletedBy: null,
                deletionReason: null,
              },
            })]
          : []),
      ]);
      await logAudit({
        actorId: admin.id,
        action: "PURCHASE_RESTORE",
        entity: "Purchase",
        entityId: id,
        oldValue: existing,
        newValue: { status: "APPROVED" },
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      });
      return ok(purchase);
    }

    return err("Invalid action. Use SOFT_DELETE or RESTORE.", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
