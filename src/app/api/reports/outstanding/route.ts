import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

/**
 * GET /api/reports/outstanding?month=X&year=Y
 * Outstanding due report: per-resident current bill, previous due, total outstanding,
 * days outstanding, status.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const bills = await db.bill.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["VOID", "DELETED"] },
        dueAmount: { gt: 0 },
        user: { role: "USER" }, // Exclude admin users
        OR: [
          { periodYear: { lt: year } },
          { periodYear: year, periodMonth: { lte: month } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
      },
      orderBy: { dueAmount: "desc" },
    });

    const now = new Date();
    const rows = bills.map((b) => {
      const daysOutstanding = b.dueDate
        ? Math.max(0, Math.floor((now.getTime() - new Date(b.dueDate).getTime()) / (24 * 60 * 60 * 1000)))
        : 0;
      return {
        userId: b.user.id,
        userName: b.user.name,
        userEmail: b.user.email,
        room: b.user.room,
        billNumber: b.billNumber,
        period: `${b.periodMonth + 1}/${b.periodYear}`,
        currentBill: b.totalAmount,
        paidAmount: b.paidAmount,
        dueAmount: b.dueAmount,
        previousDue: b.previousDue,
        totalOutstanding: b.dueAmount + b.previousDue,
        daysOutstanding,
        status: b.status,
        dueDate: b.dueDate,
      };
    });

    const totalOutstanding = rows.reduce((s, r) => s + r.totalOutstanding, 0);
    const totalCurrentDue = rows.reduce((s, r) => s + r.dueAmount, 0);
    const totalPreviousDue = rows.reduce((s, r) => s + r.previousDue, 0);

    return ok({
      period: { month, year },
      summary: {
        totalOutstanding,
        totalCurrentDue,
        totalPreviousDue,
        residentCount: new Set(rows.map((r) => r.userId)).size,
        billCount: rows.length,
        avgDaysOutstanding: rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + r.daysOutstanding, 0) / rows.length)
          : 0,
      },
      rows,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
