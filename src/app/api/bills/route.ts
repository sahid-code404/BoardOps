import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { purgeExpiredBills, getDeletionDate } from "@/lib/user-cleanup";
import { getReadiness } from "@/lib/monthly-closing";
import { generateBillsForPeriod } from "@/lib/bill-calculation";
import { runBackgroundTasks } from "@/lib/task-runner";

/** GET /api/bills — list bills (user sees own; admin sees all).
 *  Optional `month` and `year` query params filter by billing period.
 *  Optional `includeDeleted=true` shows soft-deleted bills (deletion queue).
 *  Soft-deleted bills (in 7-day queue) are excluded by default. */
export async function GET(req: Request) {
  try {
    // Purge bills whose 7-day grace period has expired
    await purgeExpiredBills();

    // MF-5: self-healing task runner — overdue transition + expired
    // restriction lift + expired-session cleanup. Awaits (3 updateMany
    // queries, all no-ops when nothing matches); errors are swallowed
    // inside the helper so the main request can never break from here.
    await runBackgroundTasks();

    // BLG-3: self-healing overdue transition. Any non-deleted GENERATED or
    // PARTIALLY_PAID bill whose due date has passed is flipped to OVERDUE.
    // Runs on every GET /api/bills — the updateMany is a no-op when nothing
    // matches, so this stays cheap. PAID/OVERDUE/VOID bills are skipped.
    await db.bill.updateMany({
      where: {
        status: { in: ["GENERATED", "PARTIALLY_PAID"] },
        dueDate: { lt: new Date() },
        deletedAt: null,
      },
      data: { status: "OVERDUE" },
    });

    const user = await requireAuth();
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 200);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";

    const where: Record<string, unknown> = {};
    if (!includeDeleted) {
      where.deletedAt = null;
    } else {
      where.deletedAt = { not: null };
    }
    if (user.role === "USER") {
      where.userId = user.id;
    }
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    if (month !== null && year) {
      where.periodMonth = Number(month);
      where.periodYear = Number(year);
    }

    // Exclude future-period bills (e.g. July 2027 when we're in June 2026).
    // Used by the Submit Payment dialog so users only see current/past bills.
    const excludeFuture = url.searchParams.get("future") === "false";
    if (excludeFuture) {
      const now = new Date();
      const currentPeriod = now.getFullYear() * 12 + now.getMonth();
      // periodMonth is 0-indexed (0=Jan), periodYear is the year
      where.AND = [
        { OR: [
          { periodYear: { lt: now.getFullYear() } },
          { periodYear: now.getFullYear(), periodMonth: { lte: now.getMonth() } },
        ]},
      ];
    }
    // Exclude bills for admin users — admins are not residents
    where.user = { role: "USER" };

    const bills = await db.bill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true, room: true, avatarUrl: true } } },
    });
    return ok(bills);
  } catch (e) {
    return handleApiError(e);
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** POST /api/bills/generate — generate or refresh bills for a billing period.
 *  Admins can run this multiple times. Existing non-void, non-deleted bills are
 *  re-calculated (meal charges updated from current meal entries) while payment
 *  history is preserved (paidAmount kept, dueAmount + status recomputed).
 *
 *  LB-1: This endpoint is the single authoritative bill-generation path. The
 *  monthly-closing workflow (`executeClosing`) calls the same shared
 *  `generateBillsForPeriod` helper so both paths produce identical charges.
 *  The readiness check below is the gatekeeper — bills cannot be generated
 *  until every readiness item is "ready" (no errors AND no warnings). */
export async function POST(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as { month?: number | string; year?: number | string; dueDate?: string };
    const month = Number(body.month ?? new Date().getMonth());
    const year = Number(body.year ?? new Date().getFullYear());
    const periodLabel = `${MONTHS[month] ?? `Month ${month + 1}`} ${year}`;

    // PRD: Bill generation requires ALL readiness items to be "ready" — no errors AND no warnings.
    // Admins must resolve all issues (missing expenses, invalid formula, pending payments, etc.)
    // before bills can be generated.
    const readiness = await getReadiness(month, year);
    if (!readiness.canClose) {
      const issues = readiness.items
        .filter((i) => i.status !== "ready")
        .map((i) => `${i.label}: ${i.detail}`);
      return err(
        `Cannot generate bills for ${periodLabel}. Resolve all issues first:\n${issues.join("\n")}`,
        422
      );
    }

    // Optional custom due date from the admin. If omitted, the shared helper
    // keeps existing bills' due dates and defaults new bills to the
    // `policy.billing.dueDateDay`-th of next month.
    const customDueDate = body.dueDate ? new Date(body.dueDate) : null;
    const dueDate = customDueDate && !isNaN(customDueDate.getTime())
      ? customDueDate
      : undefined;

    // LB-1: delegate the actual bill calculation to the shared helper so
    // POST /api/bills and executeClosing produce identical charges.
    const { created, updated, skipped } = await generateBillsForPeriod(
      month,
      year,
      { dueDate, adminId: user.id }
    );
    const generated = created + updated;

    await logAudit({
      actorId: user.id,
      action: "BILLS_GENERATED",
      entity: "Bill",
      newValue: { generated, created, updated, skipped, month, year },
    });
    return ok({ generated, created, updated, skipped, month, year });
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/bills — soft-delete all bills (schedule for permanent deletion after 7 days) */
export async function DELETE(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string }).reason;

    const where: Record<string, unknown> = { deletedAt: null };
    if (month !== null && year) {
      where.periodMonth = Number(month);
      where.periodYear = Number(year);
    }

    const deletionDate = getDeletionDate();
    const result = await db.bill.updateMany({
      where,
      data: { deletedAt: deletionDate, deletedBy: user.id, status: "DELETED", deletionReason: reason || null },
    });

    await logAudit({
      actorId: user.id,
      action: "BILLS_SOFT_DELETED_ALL",
      entity: "Bill",
      newValue: { scheduled: result.count, permanentDeletion: deletionDate, month, year, reason },
      reason,
    });

    return ok({ deleted: result.count, permanentDeletion: deletionDate.toISOString() });
  } catch (e) {
    return handleApiError(e);
  }
}
