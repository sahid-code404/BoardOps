import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

/**
 * GET /api/reports/financial?month=X&year=Y
 * Returns the monthly financial summary: total expenses, purchases, deposits,
 * guest revenue, meal charge, total bills, refund total, outstanding due,
 * net financial position. Supports comparison with previous month.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const prevStart = new Date(year, month - 1, 1);
    const prevEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const [
      expenses, purchases, deposits, bills, refunds, prevExpenses, prevDeposits,
    ] = await Promise.all([
      // Current month expenses
      db.expense.findMany({
        where: { expenseDate: { gte: start, lte: end }, deletedAt: null, status: { not: "DELETED" } },
        select: { amount: true, category: true },
      }),
      // Current month purchases
      db.purchase.aggregate({
        where: { purchaseDate: { gte: start, lte: end }, deletedAt: null },
        _sum: { totalAmount: true }, _count: true,
      }),
      // Current month deposits (approved payments — exclude admin users)
      db.payment.aggregate({
        where: { status: "APPROVED", createdAt: { gte: start, lte: end }, deletedAt: null, user: { role: "USER" } },
        _sum: { amount: true }, _count: true,
      }),
      // Current month bills (exclude admin users)
      db.bill.findMany({
        where: { periodMonth: month, periodYear: year, deletedAt: null, user: { role: "USER" } },
        select: { totalAmount: true, paidAmount: true, dueAmount: true, status: true },
      }),
      // Refunds
      db.refund.aggregate({
        where: { createdAt: { gte: start, lte: end } },
        _sum: { amount: true, paidAmount: true }, _count: true,
      }),
      // Previous month expenses (for comparison)
      db.expense.aggregate({
        where: { expenseDate: { gte: prevStart, lte: prevEnd }, deletedAt: null, status: { not: "DELETED" } },
        _sum: { amount: true },
      }),
      // Previous month deposits
      db.payment.aggregate({
        where: { status: "APPROVED", createdAt: { gte: prevStart, lte: prevEnd }, deletedAt: null },
        _sum: { amount: true },
      }),
    ]);

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalBills = bills.reduce((s, b) => s + b.totalAmount, 0);
    const totalCollected = bills.reduce((s, b) => s + b.paidAmount, 0);
    const outstandingDue = bills.reduce((s, b) => s + b.dueAmount, 0);

    // Expense breakdown by category
    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
    }

    return ok({
      period: { month, year },
      summary: {
        totalExpenses,
        totalPurchases: purchases._sum.totalAmount ?? 0,
        purchaseCount: purchases._count,
        totalDeposits: deposits._sum.amount ?? 0,
        depositCount: deposits._count,
        totalBills,
        totalCollected,
        outstandingDue,
        refundTotal: refunds._sum.amount ?? 0,
        refundPaid: refunds._sum.paidAmount ?? 0,
        refundCount: refunds._count,
        netPosition: (deposits._sum.amount ?? 0) - totalExpenses,
      },
      expenseByCategory: Object.entries(expenseByCategory)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      billStatusBreakdown: {
        GENERATED: bills.filter((b) => b.status === "GENERATED").length,
        PARTIALLY_PAID: bills.filter((b) => b.status === "PARTIALLY_PAID").length,
        PAID: bills.filter((b) => b.status === "PAID").length,
        OVERDUE: bills.filter((b) => b.status === "OVERDUE").length,
        VOID: bills.filter((b) => b.status === "VOID").length,
      },
      comparison: {
        prevExpenses: prevExpenses._sum.amount ?? 0,
        prevDeposits: prevDeposits._sum.amount ?? 0,
        expenseChange: totalExpenses - (prevExpenses._sum.amount ?? 0),
        depositChange: (deposits._sum.amount ?? 0) - (prevDeposits._sum.amount ?? 0),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
