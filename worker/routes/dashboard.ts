import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { runBackgroundMaintenance } from "../background-maintenance";
import { createDatabase } from "../db/client";
import {
  AuditLog,
  Bill,
  Expense,
  GuestMeal,
  MealConfiguration,
  MealEntry,
  Notification,
  User,
  Variable,
} from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { computeEditableUntil, isLocked, isOverridden } from "../meal-engine";
import type { BoardOpsEnv } from "../types";

type DashboardErrorStatus = 401;

type CountableEntry = {
  status: string;
  originalState: string;
  locked: boolean;
  editableUntil: unknown;
};

function failure(c: Context<BoardOpsEnv>, error: string, status: DashboardErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function valueAsDate(value: unknown): Date {
  const iso = databaseDateToIso(value);
  return iso ? new Date(iso) : new Date(Number.NaN);
}

function countsAsOn(entry: CountableEntry, now: Date): boolean {
  if (entry.status !== "ON" && entry.status !== "LOCKED") return false;
  const editableUntil = valueAsDate(entry.editableUntil);
  const entryLocked =
    (!Number.isNaN(editableUntil.getTime()) && isLocked(editableUntil, now)) ||
    entry.locked ||
    entry.status === "LOCKED";
  return entryLocked || isOverridden(entry);
}

function countsAsOff(entry: CountableEntry, now: Date): boolean {
  if (entry.status !== "OFF") return false;
  const editableUntil = valueAsDate(entry.editableUntil);
  const entryLocked =
    (!Number.isNaN(editableUntil.getTime()) && isLocked(editableUntil, now)) || entry.locked;
  return entryLocked && !isOverridden(entry);
}

function parseJsonText(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function registerDashboardRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/dashboard", async (c) => {
    const now = new Date();
    await runBackgroundMaintenance(c.env.DB, now);

    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const db = createDatabase(c.env.DB);
    const isAdmin = user.role === "ADMIN";
    const today = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ));
    const todayEnd = new Date(today);
    todayEnd.setUTCHours(23, 59, 59, 999);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endOfMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ));
    const trendStart = new Date(today);
    trendStart.setUTCDate(trendStart.getUTCDate() - 6);

    const [
      meals,
      todaysEntries,
      todayResidentEntries,
      monthResidentEntries,
      trendResidentEntries,
      totalUsersRow,
      pendingUsersRow,
      totalExpensesRow,
      pendingBillsRow,
      guestMeals,
      guestChargeVar,
      expenseCategories,
      unreadRow,
    ] = await Promise.all([
      db
        .select()
        .from(MealConfiguration)
        .where(eq(MealConfiguration.status, "ACTIVE"))
        .orderBy(asc(MealConfiguration.displayOrder)),
      db
        .select()
        .from(MealEntry)
        .where(
          and(
            eq(MealEntry.userId, user.id),
            gte(MealEntry.serviceDate, today.toISOString()),
            lte(MealEntry.serviceDate, todayEnd.toISOString()),
          ),
        ),
      db
        .select({
          status: MealEntry.status,
          originalState: MealEntry.originalState,
          locked: MealEntry.locked,
          editableUntil: MealEntry.editableUntil,
        })
        .from(MealEntry)
        .innerJoin(User, eq(MealEntry.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            gte(MealEntry.serviceDate, today.toISOString()),
            lte(MealEntry.serviceDate, todayEnd.toISOString()),
          ),
        ),
      db
        .select({
          status: MealEntry.status,
          originalState: MealEntry.originalState,
          locked: MealEntry.locked,
          editableUntil: MealEntry.editableUntil,
        })
        .from(MealEntry)
        .innerJoin(User, eq(MealEntry.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            gte(MealEntry.serviceDate, startOfMonth.toISOString()),
            lte(MealEntry.serviceDate, endOfMonth.toISOString()),
          ),
        ),
      db
        .select({
          serviceDate: MealEntry.serviceDate,
          status: MealEntry.status,
          originalState: MealEntry.originalState,
          locked: MealEntry.locked,
          editableUntil: MealEntry.editableUntil,
        })
        .from(MealEntry)
        .innerJoin(User, eq(MealEntry.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            gte(MealEntry.serviceDate, trendStart.toISOString()),
            lte(MealEntry.serviceDate, todayEnd.toISOString()),
          ),
        ),
      db
        .select({ value: sql<number>`count(*)` })
        .from(User)
        .where(and(eq(User.status, "ACTIVE"), isNull(User.deletedAt))),
      db
        .select({ value: sql<number>`count(*)` })
        .from(User)
        .where(and(eq(User.status, "PENDING"), isNull(User.deletedAt))),
      db
        .select({ value: sql<number>`coalesce(sum(${Expense.amount}), 0)` })
        .from(Expense)
        .where(
          and(
            eq(Expense.status, "APPROVED"),
            gte(Expense.expenseDate, startOfMonth.toISOString()),
            lte(Expense.expenseDate, endOfMonth.toISOString()),
          ),
        ),
      db
        .select({ value: sql<number>`count(*)` })
        .from(Bill)
        .innerJoin(User, eq(Bill.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            inArray(Bill.status, ["GENERATED", "PARTIALLY_PAID", "OVERDUE"]),
          ),
        ),
      db
        .select({ guestCount: GuestMeal.guestCount })
        .from(GuestMeal)
        .where(
          and(
            gte(GuestMeal.serviceDate, startOfMonth.toISOString()),
            lte(GuestMeal.serviceDate, endOfMonth.toISOString()),
          ),
        ),
      db
        .select({ value: Variable.value })
        .from(Variable)
        .where(eq(Variable.key, "guest_meal_rate"))
        .limit(1),
      db
        .select({
          category: Expense.category,
          amount: sql<number>`coalesce(sum(${Expense.amount}), 0)`,
        })
        .from(Expense)
        .where(
          and(
            eq(Expense.status, "APPROVED"),
            gte(Expense.expenseDate, startOfMonth.toISOString()),
            lte(Expense.expenseDate, endOfMonth.toISOString()),
          ),
        )
        .groupBy(Expense.category),
      db
        .select({ value: sql<number>`count(*)` })
        .from(Notification)
        .where(and(eq(Notification.userId, user.id), isNull(Notification.readAt))),
    ]);

    const entryByMeal = new Map(todaysEntries.map((entry) => [entry.mealId, entry]));
    const todayMeals = meals.map((meal) => {
      const entry = entryByMeal.get(meal.id);
      const computedEditableUntil = entry
        ? valueAsDate(entry.editableUntil)
        : computeEditableUntil(meal, today);
      const editableUntil = Number.isNaN(computedEditableUntil.getTime())
        ? computeEditableUntil(meal, today)
        : computedEditableUntil;
      return {
        id: meal.id,
        name: meal.name,
        displayName: meal.displayName,
        icon: meal.icon,
        color: meal.color,
        startTime: meal.startTime,
        endTime: meal.endTime,
        status: entry?.status ?? meal.defaultState,
        locked: isLocked(editableUntil, now),
        editableUntil: editableUntil.toISOString(),
      };
    });

    const todayOnCount = todayResidentEntries.filter((entry) => countsAsOn(entry, now)).length;
    const todayOffCount = todayResidentEntries.filter((entry) => countsAsOff(entry, now)).length;
    const totalResidentMeals = monthResidentEntries.filter((entry) => countsAsOn(entry, now)).length;
    const totalGuestMeals = guestMeals.reduce(
      (sum, guest) => sum + (guest.guestCount || 1),
      0,
    );
    const guestRate = Number.parseFloat(guestChargeVar[0]?.value ?? "0") || 0;
    const guestRevenue = totalGuestMeals * guestRate;
    const totalExpenses = Number(totalExpensesRow[0]?.value ?? 0);
    const currentMealCharge = totalResidentMeals > 0
      ? Math.max(0, (totalExpenses - guestRevenue) / totalResidentMeals)
      : 0;

    const trendBuckets = new Map<string, { on: number; off: number }>();
    for (const entry of trendResidentEntries) {
      const iso = databaseDateToIso(entry.serviceDate);
      if (!iso) continue;
      const key = iso.slice(0, 10);
      const bucket = trendBuckets.get(key) ?? { on: 0, off: 0 };
      if (countsAsOn(entry, now)) bucket.on += 1;
      if (countsAsOff(entry, now)) bucket.off += 1;
      trendBuckets.set(key, bucket);
    }
    const trend: { date: string; on: number; off: number }[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setUTCDate(day.getUTCDate() - offset);
      const key = dateKey(day);
      const bucket = trendBuckets.get(key) ?? { on: 0, off: 0 };
      trend.push({ date: key, on: bucket.on, off: bucket.off });
    }

    let recentActivity: Array<{
      id: string;
      actorId: string | null;
      action: string;
      entity: string;
      entityId: string | null;
      oldValue: unknown;
      newValue: unknown;
      ipAddress: string | null;
      userAgent: string | null;
      reason: string | null;
      createdAt: string | null;
      actor: { name: string; email: string } | null;
    }> = [];
    if (isAdmin) {
      const activityRows = await db
        .select({
          log: AuditLog,
          actorName: User.name,
          actorEmail: User.email,
          actorUserId: User.id,
        })
        .from(AuditLog)
        .leftJoin(User, eq(AuditLog.actorId, User.id))
        .orderBy(desc(AuditLog.createdAt))
        .limit(6);
      recentActivity = activityRows.map((row) => ({
        id: row.log.id,
        actorId: row.log.actorId,
        action: row.log.action,
        entity: row.log.entity,
        entityId: row.log.entityId,
        oldValue: parseJsonText(row.log.oldValue),
        newValue: parseJsonText(row.log.newValue),
        ipAddress: row.log.ipAddress,
        userAgent: row.log.userAgent,
        reason: row.log.reason,
        createdAt: databaseDateToIso(row.log.createdAt),
        actor: row.actorUserId && row.actorName && row.actorEmail
          ? { name: row.actorName, email: row.actorEmail }
          : null,
      }));
    }

    const response = {
      todayMeals,
      kpis: {
        totalUsers: Number(totalUsersRow[0]?.value ?? 0),
        pendingUsers: Number(pendingUsersRow[0]?.value ?? 0),
        todayOnCount,
        todayOffCount,
        totalExpenses,
        pendingBills: Number(pendingBillsRow[0]?.value ?? 0),
        currentMealCharge,
        totalResidentMeals,
      },
      trend,
      expenseBreakdown: expenseCategories.map((item) => ({
        category: item.category,
        amount: Number(item.amount ?? 0),
      })),
      unreadNotifications: Number(unreadRow[0]?.value ?? 0),
      recentActivity,
      isAdmin,
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
