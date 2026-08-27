import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { getReadiness, executeClosing, periodLabel } from "@/lib/monthly-closing";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";

// GET /api/billing-cycles — list all billing cycles
export async function GET() {
  try {
    await requireRole("ADMIN");
    const cycles = await db.billingCycle.findMany({
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      take: 50,
    });
    return ok(cycles);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/billing-cycles/readiness — get the readiness checklist for a month/year
// (kept under billing-cycles for grouping; uses the readiness helper)
// NOTE: This is actually a GET with query params — see readiness/route.ts

// POST /api/billing-cycles/close — execute the full monthly closing workflow
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as { month?: number | string; year?: number | string; dueDate?: string };
    const month = Number(body.month ?? new Date().getMonth());
    const year = Number(body.year ?? new Date().getFullYear());
    const dueDate = body.dueDate ? new Date(body.dueDate) : undefined;

    const result = await executeClosing(month, year, admin.id, dueDate);

    await logAudit({
      actorId: admin.id,
      action: result.success ? "MONTHLY_CLOSING_COMPLETED" : "MONTHLY_CLOSING_FAILED",
      entity: "BillingCycle",
      entityId: result.cycleId || undefined,
      newValue: result.success
        ? { period: periodLabel(month, year), status: "CLOSED", summary: result.summary }
        : { period: periodLabel(month, year), error: result.error },
      reason: result.error,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    if (!result.success) {
      return ok(result, 422); // Return 422 but with the error in the body so the frontend can show it
    }

    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
