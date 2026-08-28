import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { MealConfiguration, MealEntry, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { computeEditableUntil, isLocked, isMealBeforeEnrollment } from "../meal-engine";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type OverrideErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const overrideSchema = z.object({
  mealId: z.string().min(1),
  userId: z.string().min(1),
  serviceDate: z.string().min(1),
  action: z.enum(["TURN_ON", "TURN_OFF", "LOCK", "UNLOCK"]),
  reason: z.string().min(3, "Reason is required").max(500),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: OverrideErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function parseDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function serializeEntry(record: typeof MealEntry.$inferSelect) {
  return {
    ...record,
    serviceDate: databaseDateToIso(record.serviceDate),
    editableUntil: databaseDateToIso(record.editableUntil),
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function newStatusForAction(action: z.infer<typeof overrideSchema>["action"], currentStatus?: string) {
  switch (action) {
    case "TURN_ON": return "ON";
    case "TURN_OFF": return "OFF";
    case "LOCK": return "LOCKED";
    case "UNLOCK": return currentStatus === "LOCKED" ? "ON" : (currentStatus || "ON");
  }
}

export function registerMealOverrideRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/meals/override", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = overrideSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid meal override", 400);
    }

    const serviceDate = parseDateOnly(parsed.data.serviceDate);
    if (!serviceDate) return failure(c, "Invalid service date", 400);

    const db = createDatabase(c.env.DB);
    const [meal] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, parsed.data.mealId))
      .limit(1);
    if (!meal) return failure(c, "Meal not found", 404);

    const [targetUser] = await db
      .select({ id: User.id, createdAt: User.createdAt, status: User.status })
      .from(User)
      .where(eq(User.id, parsed.data.userId))
      .limit(1);
    if (!targetUser || targetUser.status !== "ACTIVE") {
      return failure(c, "User not found or not active", 404);
    }

    const createdAtIso = databaseDateToIso(targetUser.createdAt);
    if (!createdAtIso) return failure(c, "Target user has an invalid enrollment date", 422);
    const serviceDateObject = new Date(serviceDate);
    const createdAtObject = new Date(createdAtIso);
    const preEnrollment = isMealBeforeEnrollment(serviceDateObject, createdAtObject, meal);

    const [existing] = await db
      .select()
      .from(MealEntry)
      .where(
        and(
          eq(MealEntry.userId, parsed.data.userId),
          eq(MealEntry.mealId, parsed.data.mealId),
          eq(MealEntry.serviceDate, serviceDate),
        ),
      )
      .limit(1);

    const now = new Date().toISOString();
    const overrideId = crypto.randomUUID();

    if (!existing) {
      const entryId = crypto.randomUUID();
      const editableUntil = computeEditableUntil(meal, serviceDateObject).toISOString();
      const originalState = preEnrollment ? "OFF" : (meal.defaultState === "ON" ? "ON" : "OFF");
      const newStatus = newStatusForAction(parsed.data.action);
      const lockValue = parsed.data.action === "LOCK" ? 1 : 0;

      const insertEntry = c.env.DB.prepare(`
        INSERT INTO "MealEntry" (
          "id", "userId", "mealId", "serviceDate", "status", "originalState",
          "editableUntil", "locked", "updatedBy", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT("userId", "mealId", "serviceDate") DO NOTHING
      `).bind(
        entryId,
        parsed.data.userId,
        parsed.data.mealId,
        serviceDate,
        newStatus,
        originalState,
        editableUntil,
        lockValue,
        admin.id,
        now,
      );

      const insertOverride = c.env.DB.prepare(`
        INSERT INTO "MealOverride" (
          "id", "mealId", "userId", "serviceDate", "action", "reason", "adminId"
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM "MealEntry"
          WHERE "id" = ? AND "updatedAt" = ? AND "updatedBy" = ?
        )
      `).bind(
        overrideId,
        parsed.data.mealId,
        parsed.data.userId,
        serviceDate,
        parsed.data.action,
        parsed.data.reason,
        admin.id,
        entryId,
        now,
        admin.id,
      );

      const results = await c.env.DB.batch([insertEntry, insertOverride]);
      if (Number(results[0]?.meta?.changes ?? 0) === 0) {
        return failure(c, "Meal entry changed concurrently. Reload and try again.", 409);
      }

      const [created] = await db.select().from(MealEntry).where(eq(MealEntry.id, entryId)).limit(1);
      if (!created) return failure(c, "Meal entry not found after override", 404);
      const response = serializeEntry(created);

      await createNotification(c, {
        userId: parsed.data.userId,
        title: "Meal modified by Administrator",
        description: `${meal.displayName} on ${parsed.data.serviceDate} was changed (${parsed.data.action}). Reason: ${parsed.data.reason}`,
        type: "WARNING",
        priority: "HIGH",
        route: "meals",
      });
      await logAudit(c, {
        actorId: admin.id,
        action: "MEAL_OVERRIDE",
        entity: "MealEntry",
        entityId: entryId,
        newValue: { ...parsed.data, originalState, newStatus },
      });

      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    const editableUntilIso = databaseDateToIso(existing.editableUntil);
    if (!editableUntilIso) return failure(c, "Meal entry has an invalid cutoff", 422);
    if (!existing.locked && existing.status !== "LOCKED" && !isLocked(new Date(editableUntilIso))) {
      return failure(
        c,
        "This meal is not locked yet. The user can still change it before the cutoff. Admin override is only available after the meal is locked.",
        422,
      );
    }

    const oldStatus = existing.status;
    const originalState = existing.originalState || (meal.defaultState === "ON" ? "ON" : "OFF");
    const newStatus = newStatusForAction(parsed.data.action, existing.status);
    const newLocked = parsed.data.action === "LOCK"
      ? 1
      : parsed.data.action === "UNLOCK"
        ? 0
        : existing.locked ? 1 : 0;
    const historyId = crypto.randomUUID();
    const oldUpdatedAt = databaseDateToIso(existing.updatedAt);
    if (!oldUpdatedAt) return failure(c, "Meal entry has an invalid update timestamp", 422);

    const updateEntry = c.env.DB.prepare(`
      UPDATE "MealEntry"
      SET "status" = ?, "originalState" = ?, "locked" = ?, "updatedBy" = ?, "updatedAt" = ?
      WHERE "id" = ?
        AND "status" = ?
        AND "originalState" = ?
        AND "locked" = ?
        AND "updatedAt" = ?
    `).bind(
      newStatus,
      originalState,
      newLocked,
      admin.id,
      now,
      existing.id,
      existing.status,
      existing.originalState,
      existing.locked ? 1 : 0,
      oldUpdatedAt,
    );

    const insertOverride = c.env.DB.prepare(`
      INSERT INTO "MealOverride" (
        "id", "mealId", "userId", "serviceDate", "action", "reason", "adminId"
      )
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM "MealEntry"
        WHERE "id" = ? AND "updatedAt" = ? AND "updatedBy" = ?
      )
    `).bind(
      overrideId,
      parsed.data.mealId,
      parsed.data.userId,
      serviceDate,
      parsed.data.action,
      parsed.data.reason,
      admin.id,
      existing.id,
      now,
      admin.id,
    );

    const insertHistory = c.env.DB.prepare(`
      INSERT INTO "MealHistory" (
        "id", "mealEntryId", "mealId", "oldStatus", "newStatus",
        "changedBy", "reason", "triggerSource"
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, 'OVERRIDE'
      WHERE EXISTS (
        SELECT 1 FROM "MealEntry"
        WHERE "id" = ? AND "updatedAt" = ? AND "updatedBy" = ?
      )
    `).bind(
      historyId,
      existing.id,
      parsed.data.mealId,
      oldStatus,
      newStatus,
      admin.id,
      parsed.data.reason,
      existing.id,
      now,
      admin.id,
    );

    const results = await c.env.DB.batch([updateEntry, insertOverride, insertHistory]);
    if (Number(results[0]?.meta?.changes ?? 0) === 0) {
      return failure(c, "Meal entry changed concurrently. Reload and try again.", 409);
    }

    const [updated] = await db.select().from(MealEntry).where(eq(MealEntry.id, existing.id)).limit(1);
    if (!updated) return failure(c, "Meal entry not found after override", 404);
    const response = serializeEntry(updated);

    await createNotification(c, {
      userId: parsed.data.userId,
      title: "Meal modified by Administrator",
      description: `${meal.displayName} on ${parsed.data.serviceDate} was changed (${parsed.data.action}). Reason: ${parsed.data.reason}`,
      type: "WARNING",
      priority: "HIGH",
      route: "meals",
    });
    await logAudit(c, {
      actorId: admin.id,
      action: "MEAL_OVERRIDE",
      entity: "MealEntry",
      entityId: existing.id,
      oldValue: { status: oldStatus, originalState },
      newValue: { status: newStatus, action: parsed.data.action, reason: parsed.data.reason },
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
