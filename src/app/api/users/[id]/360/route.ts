import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { getResidentFundAccount, getLedgerHistory } from "@/lib/resident-fund";
import { evaluateRestrictions } from "@/lib/restriction-engine";

/**
 * GET /api/users/[id]/360 — Resident 360° View
 *
 * Returns a comprehensive unified view of a resident with all related data:
 *   - Profile (identity, contact, room, status, institution info)
 *   - Financial summary (Resident Fund Account: balance, dues, status)
 *   - Restriction evaluation (canBookMeals, grace period, exemptions)
 *   - Recent bills (last 5)
 *   - Recent payments (last 5)
 *   - Recent refunds (last 5)
 *   - Ledger entries (last 10)
 *   - Active restrictions
 *   - Meal stats (current month ON count, total consumed)
 *
 * This replaces the need for the admin to navigate to multiple pages.
 * PRD Module 14 — Resident Management (Resident 360° Workspace).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatarUrl: true,
        room: true,
        gender: true,
        emergencyContact: true,
        institutionName: true,
        institutionUserId: true,
        emailVerified: true,
        twoFactorEnabled: true,
        createdAt: true,
        lastLoginAt: true,
        changesRequested: true,
        changesRequestReason: true,
        rejectionReason: true,
        deletedAt: true,
      },
    });

    if (!user) return err("User not found", 404);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Run all queries in parallel for performance
    const [fundAccount, restrictionEval, bills, payments, refunds, ledger, activeRestrictions, mealStats, loginHistory] = await Promise.all([
      getResidentFundAccount(id),
      evaluateRestrictions(id),
      // Recent bills (last 5)
      db.bill.findMany({
        where: { userId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, billNumber: true, periodMonth: true, periodYear: true,
          mealCharges: true, otherCharges: true, totalAmount: true,
          paidAmount: true, dueAmount: true, previousDue: true,
          status: true, dueDate: true, generatedAt: true,
          formulaVersion: true,
        },
      }),
      // Recent payments (last 5)
      db.payment.findMany({
        where: { userId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, amount: true, method: true, status: true,
          reference: true, effectiveMonth: true, effectiveYear: true,
          createdAt: true, approvedBy: true,
        },
      }),
      // Recent refunds (last 5)
      db.refund.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, refundNumber: true, amount: true, paidAmount: true,
          remainingAmount: true, status: true, method: true,
          createdAt: true, completedAt: true,
        },
      }),
      // Ledger entries (last 10)
      getLedgerHistory(id, 10),
      // Active restrictions
      db.restriction.findMany({
        where: { userId: id, status: "ACTIVE" },
        orderBy: { appliedAt: "desc" },
        select: {
          id: true, type: true, reason: true, source: true, status: true,
          appliedAt: true, expiresAt: true, appliedBy: true,
        },
      }),
      // Current month meal stats
      db.mealEntry.aggregate({
        where: {
          userId: id,
          serviceDate: { gte: monthStart, lte: monthEnd },
          status: { in: ["ON", "LOCKED"] },
        },
        _count: true,
      }),
      // Recent login history (last 3)
      db.loginHistory.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, success: true, ipAddress: true, userAgent: true, createdAt: true, reason: true },
      }),
    ]);

    return ok({
      profile: user,
      fundAccount,
      restrictions: restrictionEval,
      activeRestrictions,
      recentBills: bills,
      recentPayments: payments,
      recentRefunds: refunds,
      ledger,
      mealStats: {
        currentMonthON: mealStats._count,
      },
      loginHistory,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
