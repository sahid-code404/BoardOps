import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { GuestMeal, MealConfiguration, MealEntry, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { computeEditableUntil, isLocked, isOverridden, isPreRegistration } from "../meal-engine";
import type { BoardOpsEnv } from "../types";

type KitchenErrorStatus = 400 | 401;

function failure(c: Context<BoardOpsEnv>, error: string, status: KitchenErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function databaseDate(value: unknown): Date | null {
  const iso = databaseDateToIso(value);
  return iso ? new Date(iso) : null;
}

function entryIsLocked(
  entry: typeof MealEntry.$inferSelect,
  isPastDate: boolean,
  now: Date,
): boolean {
  if (isPastDate || entry.locked || entry.status === "LOCKED") return true;
  const editableUntil = databaseDate(entry.editableUntil);
  return editableUntil ? isLocked(editableUntil, now) : true;
}

function countsAsOn(
  entry: typeof MealEntry.$inferSelect,
  isPastDate: boolean,
  now: Date,
): boolean {
  if (entry.status !== "ON" && entry.status !== "LOCKED") return false;
  return entryIsLocked(entry, isPastDate, now) || isOverridden(entry);
}

function countsAsOff(
  entry: typeof MealEntry.$inferSelect,
  isPastDate: boolean,
  now: Date,
): boolean {
  if (entry.status !== "OFF") return false;
  return entryIsLocked(entry, isPastDate, now) && !isOverridden(entry);
}

export function registerKitchenRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/kitchen", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);
    if (user.role === "USER") {
      const response = { access: false };
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    const now = new Date();
    const requestedDate = c.req.query("date")?.trim();
    const target = requestedDate
      ? parseDateOnly(requestedDate)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (!target) return failure(c, "Invalid date", 400);

    const targetEnd = new Date(target);
    targetEnd.setUTCHours(23, 59, 59, 999);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const isPastDate = target.getTime() < today.getTime();
    const monthStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const db = createDatabase(c.env.DB);
    const [meals, dailyRows, guestMeals, monthRows, monthGuestMeals, activeResidents] = await Promise.all([
      db
        .select()
        .from(MealConfiguration)
        .where(eq(MealConfiguration.status, "ACTIVE"))
        .orderBy(asc(MealConfiguration.displayOrder), asc(MealConfiguration.createdAt)),
      db
        .select({ entry: MealEntry })
        .from(MealEntry)
        .innerJoin(User, eq(MealEntry.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            gte(MealEntry.serviceDate, target.toISOString()),
            lte(MealEntry.serviceDate, targetEnd.toISOString()),
          ),
        ),
      db
        .select()
        .from(GuestMeal)
        .where(
          and(
            gte(GuestMeal.serviceDate, target.toISOString()),
            lte(GuestMeal.serviceDate, targetEnd.toISOString()),
          ),
        ),
      db
        .select({ entry: MealEntry })
        .from(MealEntry)
        .innerJoin(User, eq(MealEntry.userId, User.id))
        .where(
          and(
            eq(User.role, "USER"),
            gte(MealEntry.serviceDate, monthStart.toISOString()),
            lte(MealEntry.serviceDate, monthEnd.toISOString()),
          ),
        ),
      db
        .select()
        .from(GuestMeal)
        .where(
          and(
            gte(GuestMeal.serviceDate, monthStart.toISOString()),
            lte(GuestMeal.serviceDate, monthEnd.toISOString()),
          ),
        ),
      db
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
        .orderBy(asc(User.name)),
    ]);

    const residentEntries = dailyRows.map((row) => row.entry);
    const monthEntries = monthRows.map((row) => row.entry);
    const counts = meals.map((meal) => {
      const mealEntries = residentEntries.filter((entry) => entry.mealId === meal.id);
      const on = mealEntries.filter((entry) => countsAsOn(entry, isPastDate, now)).length;
      const off = mealEntries.filter((entry) => countsAsOff(entry, isPastDate, now)).length;
      const guests = guestMeals
        .filter((entry) => entry.mealId === meal.id)
        .reduce((sum, entry) => sum + entry.guestCount, 0);
      return {
        id: meal.id,
        name: meal.name,
        displayName: meal.displayName,
        icon: meal.icon,
        color: meal.color,
        startTime: meal.startTime,
        endTime: meal.endTime,
        on,
        off,
        guests,
        total: on + guests,
      };
    });

    const monthOnEntries = monthEntries.filter((entry) => {
      if (entry.status !== "ON" && entry.status !== "LOCKED") return false;
      return entryIsLocked(entry, false, now) || isOverridden(entry);
    });
    const monthOffEntries = monthEntries.filter((entry) => {
      if (entry.status !== "OFF") return false;
      return entryIsLocked(entry, false, now) && !isOverridden(entry);
    });
    const monthGuests = monthGuestMeals.reduce((sum, entry) => sum + entry.guestCount, 0);
    const monthTotals = {
      meals: monthOnEntries.length + monthGuests,
      guests: monthGuests,
      off: monthOffEntries.length,
    };

    const userMealStatus = activeResidents.map((resident) => {
      const userEntries = residentEntries.filter((entry) => entry.userId === resident.id);
      const monthConsumed = monthOnEntries.filter((entry) => entry.userId === resident.id).length;
      const createdAt = databaseDate(resident.createdAt);
      const preRegistration = createdAt ? isPreRegistration(target, createdAt) : false;
      const residentMeals = meals.map((meal) => {
        const entry = userEntries.find((candidate) => candidate.mealId === meal.id);
        const effectivelyLocked = entry
          ? entryIsLocked(entry, isPastDate, now)
          : isLocked(computeEditableUntil(meal, target), now);
        const status = entry?.status ?? (preRegistration ? "OFF" : meal.defaultState);
        const originalState = entry?.originalState ?? (preRegistration ? "OFF" : meal.defaultState);
        const effectiveStatus = status === "LOCKED" ? "ON" : status;
        const overridden = entry ? effectiveStatus !== originalState : false;
        return {
          mealId: meal.id,
          mealName: meal.displayName,
          mealIcon: meal.icon,
          mealColor: meal.color,
          status,
          originalState,
          locked: effectivelyLocked,
          overridden,
        };
      });
      const onCount = residentMeals.filter((meal) =>
        (meal.status === "ON" || meal.status === "LOCKED") && (meal.locked || meal.overridden)
      ).length;
      const offCount = residentMeals.filter((meal) =>
        meal.status === "OFF" && meal.locked && !meal.overridden
      ).length;
      return {
        userId: resident.id,
        name: resident.name,
        email: resident.email,
        room: resident.room,
        avatarUrl: resident.avatarUrl,
        onCount,
        offCount,
        monthConsumed,
        meals: residentMeals,
        notEnrolled: preRegistration,
      };
    });

    const guestMealEntries = guestMeals.map((entry) => ({
      id: entry.id,
      mealId: entry.mealId,
      guestCount: entry.guestCount,
      notes: entry.notes,
      guestName: entry.guestName,
    }));
    const response = {
      date: target.toISOString(),
      counts,
      activeUsers: activeResidents.length,
      monthTotals,
      userMealStatus,
      guestMealEntries,
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
