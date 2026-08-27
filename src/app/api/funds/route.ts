import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

/** GET /api/funds — admin-only overview of funds for the selected month.
 *  Returns KPI totals + per-user breakdown (deposit paid, bill total, amount to pay). */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");

    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // ── KPI totals ──

    const approvedPayments = await db.payment.findMany({
      where: {
        status: "APPROVED",
        createdAt: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
        user: { role: "USER" }, // Exclude admin users
      },
      select: { amount: true },
    });
    const totalDeposit = approvedPayments.reduce((s, p) => s + p.amount, 0);

    const expenses = await db.expense.findMany({
      where: {
        expenseDate: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
      },
      select: { amount: true },
    });
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const remainingFund = totalDeposit - totalExpenses;

    const refundedPayments = await db.payment.findMany({
      where: {
        status: "REFUNDED",
        createdAt: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
        user: { role: "USER" }, // Exclude admin users
      },
      select: { amount: true },
    });
    const totalRefunded = refundedPayments.reduce((s, p) => s + p.amount, 0);

    // ── Per-user breakdown ──
    // Get all active residents
    const residents = await db.user.findMany({
      where: { status: "ACTIVE", role: "USER" },
      select: { id: true, name: true, email: true, room: true, avatarUrl: true, createdAt: true },
      orderBy: { name: "asc" },
    });

    // Get bills for this month (excluding VOID; soft-deleted excluded so we
    // don't count bills pending permanent deletion).
    const bills = await db.bill.findMany({
      where: {
        periodMonth: month,
        periodYear: year,
        status: { notIn: ["VOID"] },
        deletedAt: null,
      },
      select: { id: true, userId: true, totalAmount: true, paidAmount: true, dueAmount: true },
    });

    // Get ALL approved, non-deleted payments for this month grouped by user.
    // This is the single source of truth for a user's deposit — a payment is
    // counted once regardless of whether it's linked to a bill or not.
    // (Previously the code added billPaid + directDeposit, which double-counted
    //  bill-linked payments since billPaid is itself derived from those same
    //  payments.)
    const userPayments = await db.payment.findMany({
      where: {
        status: "APPROVED",
        createdAt: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
      },
      select: { userId: true, amount: true },
    });

    // ── LB-6: Prorated expense share ──
    // Instead of an equal split (totalExpenses / residentCount), each
    // resident's share is weighted by how many days they were enrolled in
    // the month. A resident who joined on the 20th pays proportionally less
    // than one who was there all month. `daysEnrolled` runs from the user's
    // registration date to the end of the month (or today for the current
    // month) — clamped to a minimum of 1 day so a brand-new joiner still
    // gets a non-zero share on their first day.
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
    // Upper bound for the enrollment window — end of month for past months,
    // "right now" for the current month.
    const periodEnd = isCurrentMonth ? now : monthEnd;
    const DAY_MS = 24 * 60 * 60 * 1000;

    const residentsWithDays = residents.map((u) => {
      // Enrollment starts at registration date (or month-start if the user
      // was registered before this month).
      const start = u.createdAt > monthStart ? u.createdAt : monthStart;
      let days = 0;
      if (start <= periodEnd) {
        days = Math.max(1, Math.ceil((periodEnd.getTime() - start.getTime()) / DAY_MS));
      }
      return { ...u, daysEnrolled: days };
    });

    const totalEnrolledDays = residentsWithDays.reduce((s, u) => s + u.daysEnrolled, 0);
    // Fallback: equal split when no one was enrolled (edge case: all
    // residents registered after the end of the month).
    const fallbackPerUser = totalExpenses / (residents.length || 1);

    // Build per-user data.
    // Per-user deficit = user's prorated share of expenses − user's deposit.
    // This is calculated instantly from actual expenses + payments — no bill
    // generation needed. Each resident gets a prorated share of the month's
    // expenses based on days enrolled. If they paid less than their share,
    // they have a deficit.
    const userBreakdown = residentsWithDays.map((u) => {
      const userBills = bills.filter((b) => b.userId === u.id);
      const billTotal = userBills.reduce((s, b) => s + b.totalAmount, 0);
      const billDue = userBills.reduce((s, b) => s + b.dueAmount, 0);

      // Deposit = sum of the user's approved, non-deleted payments this month.
      const deposit = userPayments
        .filter((p) => p.userId === u.id)
        .reduce((s, p) => s + p.amount, 0);

      const needToPay = Math.max(0, billDue);
      const hasBills = userBills.length > 0;

      // Prorated share — weighted by daysEnrolled. Falls back to equal split
      // when totalEnrolledDays is 0 so we never divide by zero.
      const perUserExpense =
        totalEnrolledDays > 0
          ? totalExpenses * (u.daysEnrolled / totalEnrolledDays)
          : fallbackPerUser;

      // Deficit = user's share of expenses − user's deposit.
      // Instant calculation — doesn't depend on bill generation.
      // Default 0 when no expenses or when deposit covers the share.
      const deficit = Math.max(0, perUserExpense - deposit);

      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        room: u.room,
        avatarUrl: u.avatarUrl,
        billTotal,
        deposit,
        needToPay,
        deficit,
        hasBills,
      };
    });

    return ok({
      totalDeposit,
      totalExpenses,
      remainingFund,
      totalRefunded,
      month,
      year,
      users: userBreakdown,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
