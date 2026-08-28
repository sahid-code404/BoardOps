import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Bill, Expense, Payment, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type FundsErrorStatus = 400 | 401 | 403;

function failure(c: Context<BoardOpsEnv>, error: string, status: FundsErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function parsePeriod(c: Context<BoardOpsEnv>): { month: number; year: number } | null {
  const now = new Date();
  const month = Number(c.req.query("month") ?? now.getUTCMonth());
  const year = Number(c.req.query("year") ?? now.getUTCFullYear());

  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return { month, year };
}

export function registerFundsRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/funds", async (c) => {
    const admin = await getAuthUser(c);
    if (!admin || admin.status !== "ACTIVE") return failure(c, "Not authenticated", 401);
    if (admin.role !== "ADMIN") return failure(c, "Forbidden", 403);

    const period = parsePeriod(c);
    if (!period) return failure(c, "Invalid month or year", 400);
    const { month, year } = period;

    const monthStartDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const monthEndDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const monthStart = monthStartDate.toISOString();
    const monthEnd = monthEndDate.toISOString();
    const db = createDatabase(c.env.DB);

    const approvedPayments = await db
      .select({ amount: Payment.amount })
      .from(Payment)
      .innerJoin(User, eq(Payment.userId, User.id))
      .where(
        and(
          eq(Payment.status, "APPROVED"),
          gte(Payment.createdAt, monthStart),
          lte(Payment.createdAt, monthEnd),
          isNull(Payment.deletedAt),
          eq(User.role, "USER"),
        ),
      );
    const totalDeposit = approvedPayments.reduce((sum, payment) => sum + payment.amount, 0);

    const expenses = await db
      .select({ amount: Expense.amount })
      .from(Expense)
      .where(
        and(
          gte(Expense.expenseDate, monthStart),
          lte(Expense.expenseDate, monthEnd),
          isNull(Expense.deletedAt),
        ),
      );
    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const remainingFund = totalDeposit - totalExpenses;

    const refundedPayments = await db
      .select({ amount: Payment.amount })
      .from(Payment)
      .innerJoin(User, eq(Payment.userId, User.id))
      .where(
        and(
          eq(Payment.status, "REFUNDED"),
          gte(Payment.createdAt, monthStart),
          lte(Payment.createdAt, monthEnd),
          isNull(Payment.deletedAt),
          eq(User.role, "USER"),
        ),
      );
    const totalRefunded = refundedPayments.reduce((sum, payment) => sum + payment.amount, 0);

    const residents = await db
      .select({
        id: User.id,
        name: User.name,
        email: User.email,
        room: User.room,
        avatarUrl: User.avatarUrl,
        createdAt: User.createdAt,
      })
      .from(User)
      .where(and(eq(User.status, "ACTIVE"), eq(User.role, "USER")))
      .orderBy(asc(User.name));

    const bills = await db
      .select({
        id: Bill.id,
        userId: Bill.userId,
        totalAmount: Bill.totalAmount,
        paidAmount: Bill.paidAmount,
        dueAmount: Bill.dueAmount,
      })
      .from(Bill)
      .where(
        and(
          eq(Bill.periodMonth, month),
          eq(Bill.periodYear, year),
          ne(Bill.status, "VOID"),
          isNull(Bill.deletedAt),
        ),
      );

    const userPayments = await db
      .select({ userId: Payment.userId, amount: Payment.amount })
      .from(Payment)
      .where(
        and(
          eq(Payment.status, "APPROVED"),
          gte(Payment.createdAt, monthStart),
          lte(Payment.createdAt, monthEnd),
          isNull(Payment.deletedAt),
        ),
      );

    const now = new Date();
    const isCurrentMonth = now.getUTCFullYear() === year && now.getUTCMonth() === month;
    const periodEnd = isCurrentMonth ? now : monthEndDate;
    const dayMs = 24 * 60 * 60 * 1000;

    const residentsWithDays = residents.map((resident) => {
      const createdIso = databaseDateToIso(resident.createdAt);
      const createdAt = createdIso ? new Date(createdIso) : monthStartDate;
      const start = createdAt > monthStartDate ? createdAt : monthStartDate;
      let daysEnrolled = 0;
      if (start <= periodEnd) {
        daysEnrolled = Math.max(1, Math.ceil((periodEnd.getTime() - start.getTime()) / dayMs));
      }
      return { ...resident, daysEnrolled };
    });

    const totalEnrolledDays = residentsWithDays.reduce(
      (sum, resident) => sum + resident.daysEnrolled,
      0,
    );
    const fallbackPerUser = totalExpenses / (residents.length || 1);

    const users = residentsWithDays.map((resident) => {
      const residentBills = bills.filter((bill) => bill.userId === resident.id);
      const billTotal = residentBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const billDue = residentBills.reduce((sum, bill) => sum + bill.dueAmount, 0);
      const deposit = userPayments
        .filter((payment) => payment.userId === resident.id)
        .reduce((sum, payment) => sum + payment.amount, 0);
      const needToPay = Math.max(0, billDue);
      const hasBills = residentBills.length > 0;
      const perUserExpense =
        totalEnrolledDays > 0
          ? totalExpenses * (resident.daysEnrolled / totalEnrolledDays)
          : fallbackPerUser;
      const deficit = Math.max(0, perUserExpense - deposit);

      return {
        userId: resident.id,
        name: resident.name,
        email: resident.email,
        room: resident.room,
        avatarUrl: resident.avatarUrl,
        billTotal,
        deposit,
        needToPay,
        deficit,
        hasBills,
      };
    });

    const response = {
      totalDeposit,
      totalExpenses,
      remainingFund,
      totalRefunded,
      month,
      year,
      users,
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
