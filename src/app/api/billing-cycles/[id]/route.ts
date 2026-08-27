import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { rollbackCycle } from "@/lib/monthly-closing";

// GET /api/billing-cycles/[id] — get a single billing cycle with its snapshot
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;
    const cycle = await db.billingCycle.findUnique({
      where: { id },
      include: { snapshot: true },
    });
    if (!cycle) return err("Billing cycle not found", 404);
    return ok(cycle);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/billing-cycles/[id]/rollback — rollback a cycle (only before bills published)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = body.reason as string | undefined;

    const existing = await db.billingCycle.findUnique({ where: { id } });
    if (!existing) return err("Billing cycle not found", 404);

    const result = await rollbackCycle(id);

    await logAudit({
      actorId: admin.id,
      action: result.success ? "MONTHLY_CLOSING_ROLLBACK" : "MONTHLY_CLOSING_ROLLBACK_FAILED",
      entity: "BillingCycle",
      entityId: id,
      oldValue: existing,
      newValue: result.success ? { status: "OPEN" } : { error: result.error },
      reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    if (!result.success) return err(result.error || "Rollback failed", 400);
    return ok({ rolledBack: true });
  } catch (e) {
    return handleApiError(e);
  }
}
