import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";

// GET /api/refunds/[id] — get a single refund with its transaction history
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;

    const refund = await db.refund.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
        bill: { select: { id: true, billNumber: true, periodMonth: true, periodYear: true } },
        transactions: {
          orderBy: { createdAt: "desc" },
          include: { processedBy: { select: { name: true } } },
        },
      },
    });
    if (!refund) return err("Refund not found", 404);
    return ok(refund);
  } catch (e) {
    return handleApiError(e);
  }
}
