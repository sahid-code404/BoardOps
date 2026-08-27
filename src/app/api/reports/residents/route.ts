import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { getResidentFundAccount } from "@/lib/resident-fund";

/**
 * GET /api/reports/residents
 * Resident financial report: per-resident current bill, outstanding due,
 * refund pending, fund balance, financial status.
 */
export async function GET() {
  try {
    await requireRole("ADMIN");

    const users = await db.user.findMany({
      where: { role: "USER", deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, email: true, room: true, avatarUrl: true },
      orderBy: { name: "asc" },
    });

    // Get fund accounts in parallel
    const accounts = await Promise.all(
      users.map((u) => getResidentFundAccount(u.id))
    );

    const rows = users.map((u, i) => {
      const fa = accounts[i];
      return {
        userId: u.id,
        userName: u.name,
        userEmail: u.email,
        room: u.room,
        availableBalance: fa?.availableBalance ?? 0,
        pendingDeposits: fa?.pendingDeposits ?? 0,
        refundPending: fa?.refundPending ?? 0,
        outstandingDue: fa?.outstandingDue ?? 0,
        previousDue: fa?.previousDue ?? 0,
        totalDeposited: fa?.totalDeposited ?? 0,
        totalBilled: fa?.totalBilled ?? 0,
        totalRefunded: fa?.totalRefunded ?? 0,
        financialStatus: fa?.financialStatus ?? "HEALTHY",
      };
    });

    const totalBalance = rows.reduce((s, r) => s + r.availableBalance, 0);
    const totalDue = rows.reduce((s, r) => s + r.outstandingDue, 0);
    const totalDeposited = rows.reduce((s, r) => s + r.totalDeposited, 0);
    const totalBilled = rows.reduce((s, r) => s + r.totalBilled, 0);

    return ok({
      summary: {
        residentCount: rows.length,
        totalBalance,
        totalDue,
        totalDeposited,
        totalBilled,
        healthyCount: rows.filter((r) => r.financialStatus === "HEALTHY").length,
        lowBalanceCount: rows.filter((r) => r.financialStatus === "LOW_BALANCE").length,
        overdueCount: rows.filter((r) => r.financialStatus === "OVERDUE").length,
        restrictedCount: rows.filter((r) => r.financialStatus === "RESTRICTED").length,
        exemptedCount: rows.filter((r) => r.financialStatus === "EXEMPTED").length,
      },
      rows,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
