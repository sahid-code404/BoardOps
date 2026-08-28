import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Holiday, MealConfiguration, MealEntry } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import {
  computeEditableUntil,
  getRegistrationDate,
  isLocked,
  isMealBeforeEnrollment,
  isOverridden,
} from "../meal-engine";
import type { BoardOpsEnv } from "../types";

type MealEntryErrorStatus = 400 | 401;

type DateRange = {
  startIso: string;
  endIso: string;
  dates: Date[];
};

type MissingEntry = {
  id: string;
  userId: string;
  mealId: string;
  serviceDate: string;
  status: string;
  originalState: string;
  editableUntil: string;
  locked: number;
  updatedAt: string;
};

function failure(c: Context<BoardOpsEnv>, error: string, status: MealEntryErrorStatus) {
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

function buildRequestRange(c: Context<BoardOpsEnv>): DateRange | null {
  const specificDate = c.req.query("date")?.trim();
  if (specificDate) {
    const date = parseDateOnly(specificDate);
    if (!date) return null;
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return {
      startIso: date.toISOString(),
      endIso: end.toISOString(),
      dates: [date],
    };
  }

  const now = new Date();
  const month = Number(c.req.query("month") ?? now.getUTCMonth());
  const year = Number(c.req.query("year") ?? now.getUTCFullYear());
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;

  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const dates: Date[] = [];
  for (let day = 1; day <= end.getUTCDate(); day += 1) {
    dates.push(new Date(Date.UTC(year, month, day, 0, 0, 0, 0)));
  }

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dates,
  };
}

function dateKey(value: unknown): string | null {
  const iso = databaseDateToIso(value);
  return iso ? iso.slice(0, 10) : null;
}

function entryKey(mealId: string, value: unknown): string | null {
  const day = dateKey(value);
  return day ? `${mealId}_${day}` : null;
}

function serializeMeal(record: typeof MealConfiguration.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    displayName: record.displayName,
    description: record.description,
    icon: record.icon,
    color: record.color,
    mealType: record.mealType,
    status: record.status,
    displayOrder: record.displayOrder,
    defaultState: record.defaultState,
    defaultVisibility: record.defaultVisibility,
    cutoffStrategy: record.cutoffStrategy,
    cutoffOffsetMinutes: record.cutoffOffsetMinutes,
    cutoffTime: record.cutoffTime,
    startTime: record.startTime,
    endTime: record.endTime,
    notes: record.notes,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function prepareIdMutation(
  c: Context<BoardOpsEnv>,
  ids: string[],
  kind: "SELF_HEAL" | "LOCK" | "UNLOCK",
  now: string,
) {
  const placeholders = ids.map(() => "?").join(", ");
  const mutation = kind === "SELF_HEAL"
    ? `"status" = 'OFF', "originalState" = 'OFF', "locked" = 1`
    : kind === "LOCK"
      ? `"locked" = 1, "status" = CASE WHEN "status" = 'ON' THEN 'LOCKED' ELSE "status" END`
      : `"locked" = 0, "status" = CASE WHEN "status" = 'LOCKED' THEN 'ON' ELSE "status" END`;

  return c.env.DB.prepare(`
    UPDATE "MealEntry"
    SET ${mutation}, "updatedAt" = ?
    WHERE "id" IN (${placeholders})
  `).bind(now, ...ids);
}

function prepareMissingEntryStatements(
  c: Context<BoardOpsEnv>,
  rows: MissingEntry[],
) {
  const statements = [];
  const chunkSize = 20;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const bindings = chunk.flatMap((row) => [
      row.id,
      row.userId,
      row.mealId,
      row.serviceDate,
      row.status,
      row.originalState,
      row.editableUntil,
      row.locked,
      row.updatedAt,
    ]);
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO "MealEntry" (
          "id", "userId", "mealId", "serviceDate", "status", "originalState",
          "editableUntil", "locked", "updatedAt"
        ) VALUES ${placeholders}
        ON CONFLICT("userId", "mealId", "serviceDate") DO NOTHING
      `).bind(...bindings),
    );
  }
  return statements;
}

export function registerMealEntryRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/meals/entries", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const range = buildRequestRange(c);
    if (!range) return failure(c, "Invalid date, month, or year", 400);

    const db = createDatabase(c.env.DB);
    const [meals, existingEntries, holidays] = await Promise.all([
      db
        .select()
        .from(MealConfiguration)
        .where(eq(MealConfiguration.status, "ACTIVE"))
        .orderBy(asc(MealConfiguration.displayOrder), asc(MealConfiguration.createdAt)),
      db
        .select()
        .from(MealEntry)
        .where(
          and(
            eq(MealEntry.userId, user.id),
            gte(MealEntry.serviceDate, range.startIso),
            lte(MealEntry.serviceDate, range.endIso),
          ),
        ),
      db
        .select({ startDate: Holiday.startDate, endDate: Holiday.endDate })
        .from(Holiday)
        .where(
          and(
            eq(Holiday.status, "ACTIVE"),
            eq(Holiday.mealsDisabled, true),
            lte(Holiday.startDate, range.endIso),
            gte(Holiday.endDate, range.startIso),
          ),
        ),
    ]);

    const holidayRanges = holidays.flatMap((holiday) => {
      const startIso = databaseDateToIso(holiday.startDate);
      const endIso = databaseDateToIso(holiday.endDate);
      if (!startIso || !endIso) return [];
      const start = new Date(startIso);
      const end = new Date(endIso);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);
      return [{ start: start.getTime(), end: end.getTime() }];
    });
    const isHolidayDisabled = (date: Date) => {
      const timestamp = date.getTime();
      return holidayRanges.some((holiday) => timestamp >= holiday.start && timestamp <= holiday.end);
    };

    const mealMap = new Map(meals.map((meal) => [meal.id, meal]));
    const entryMap = new Map<string, typeof MealEntry.$inferSelect>();
    for (const entry of existingEntries) {
      const key = entryKey(entry.mealId, entry.serviceDate);
      if (key) entryMap.set(key, entry);
    }

    const userCreatedAt = new Date(user.createdAt);
    const now = new Date();
    const nowIso = now.toISOString();
    const selfHealIds: string[] = [];
    const lockIds: string[] = [];
    const unlockIds: string[] = [];
    const missingEntries: MissingEntry[] = [];

    for (const entry of existingEntries) {
      const meal = mealMap.get(entry.mealId);
      if (!meal || entry.updatedBy) continue;
      const serviceIso = databaseDateToIso(entry.serviceDate);
      if (!serviceIso) continue;
      if (!isMealBeforeEnrollment(new Date(serviceIso), userCreatedAt, meal)) continue;
      if (
        entry.status === "ON" ||
        entry.status === "LOCKED" ||
        !entry.locked ||
        entry.originalState !== "OFF"
      ) {
        selfHealIds.push(entry.id);
      }
    }

    for (const meal of meals) {
      for (const serviceDate of range.dates) {
        if (isMealBeforeEnrollment(serviceDate, userCreatedAt, meal)) continue;
        if (isHolidayDisabled(serviceDate)) continue;

        const key = `${meal.id}_${serviceDate.toISOString().slice(0, 10)}`;
        const entry = entryMap.get(key);
        if (!entry) {
          const editableUntil = computeEditableUntil(meal, serviceDate);
          missingEntries.push({
            id: crypto.randomUUID(),
            userId: user.id,
            mealId: meal.id,
            serviceDate: serviceDate.toISOString(),
            status: meal.defaultState,
            originalState: meal.defaultState,
            editableUntil: editableUntil.toISOString(),
            locked: isLocked(editableUntil, now) ? 1 : 0,
            updatedAt: nowIso,
          });
          continue;
        }

        const editableUntilIso = databaseDateToIso(entry.editableUntil);
        if (!editableUntilIso) continue;
        const shouldLock = isLocked(new Date(editableUntilIso), now);
        if (shouldLock && (!entry.locked || entry.status === "ON")) {
          lockIds.push(entry.id);
        } else if (!shouldLock && (entry.locked || entry.status === "LOCKED")) {
          unlockIds.push(entry.id);
        }
      }
    }

    const statements = [];
    if (selfHealIds.length > 0) {
      statements.push(prepareIdMutation(c, selfHealIds, "SELF_HEAL", nowIso));
    }
    if (lockIds.length > 0) {
      statements.push(prepareIdMutation(c, lockIds, "LOCK", nowIso));
    }
    if (unlockIds.length > 0) {
      statements.push(prepareIdMutation(c, unlockIds, "UNLOCK", nowIso));
    }
    statements.push(...prepareMissingEntryStatements(c, missingEntries));
    if (statements.length > 0) await c.env.DB.batch(statements);

    const entries = await db
      .select()
      .from(MealEntry)
      .where(
        and(
          eq(MealEntry.userId, user.id),
          gte(MealEntry.serviceDate, range.startIso),
          lte(MealEntry.serviceDate, range.endIso),
        ),
      );
    const finalMap = new Map<string, typeof MealEntry.$inferSelect>();
    for (const entry of entries) {
      const key = entryKey(entry.mealId, entry.serviceDate);
      if (key) finalMap.set(key, entry);
    }

    type ResponseEntry = {
      id: string;
      mealId: string;
      mealName: string;
      mealDisplayName: string;
      mealIcon: string;
      mealColor: string;
      serviceDate: string;
      status: string;
      originalState: string;
      overridden: boolean;
      editableUntil: string;
      locked: boolean;
      preRegistration: boolean;
      startTime: string;
      endTime: string;
      mealType: string;
    };
    const byDate: Record<string, ResponseEntry[]> = {};

    for (const meal of meals) {
      for (const serviceDate of range.dates) {
        const key = `${meal.id}_${serviceDate.toISOString().slice(0, 10)}`;
        const entry = finalMap.get(key);
        if (!entry) continue;

        const overridden = isOverridden(entry);
        const preRegistration = isMealBeforeEnrollment(serviceDate, userCreatedAt, meal);
        if (preRegistration && !overridden) continue;

        const serviceDateIso = databaseDateToIso(entry.serviceDate);
        const editableUntilIso = databaseDateToIso(entry.editableUntil);
        if (!serviceDateIso || !editableUntilIso) continue;

        const day = serviceDate.toISOString().slice(0, 10);
        if (!byDate[day]) byDate[day] = [];
        byDate[day].push({
          id: entry.id,
          mealId: meal.id,
          mealName: meal.name,
          mealDisplayName: meal.displayName,
          mealIcon: meal.icon,
          mealColor: meal.color,
          serviceDate: serviceDateIso,
          status: entry.status,
          originalState: entry.originalState,
          overridden,
          editableUntil: editableUntilIso,
          locked: entry.locked,
          preRegistration,
          startTime: meal.startTime,
          endTime: meal.endTime,
          mealType: meal.mealType,
        });
      }
    }

    const response = {
      meals: meals.map(serializeMeal),
      byDate,
      registrationDate: getRegistrationDate(userCreatedAt).toISOString(),
    };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
