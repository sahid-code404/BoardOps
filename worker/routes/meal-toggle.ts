import { eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { MealConfiguration, MealEntry } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { isLocked, isMealBeforeEnrollment } from "../meal-engine";
import { evaluateRestrictions } from "../restriction-engine";
import type { BoardOpsEnv } from "../types";

type ToggleErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const toggleSchema = z.object({
  entryId: z.string().min(1),
  status: z.enum(["ON", "OFF"]),
});

const bulkSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1),
  status: z.enum(["ON", "OFF"]),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: ToggleErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializeEntry(record: typeof MealEntry.$inferSelect) {
  return {
    id: record.id,
    userId: record.userId,
    mealId: record.mealId,
    serviceDate: databaseDateToIso(record.serviceDate),
    status: record.status,
    originalState: record.originalState,
    editableUntil: databaseDateToIso(record.editableUntil),
    locked: record.locked,
    notes: record.notes,
    updatedBy: record.updatedBy,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function asDate(value: unknown): Date | null {
  const iso = databaseDateToIso(value);
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function requireToggleUser(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  return { user, response: null } as const;
}

export function registerMealToggleRoutes(app: Hono<BoardOpsEnv>): void {
  app.patch("/api/meals/toggle", async (c) => {
    const access = await requireToggleUser(c);
    if (access.response) return access.response;
    const user = access.user!;

    const parsed = toggleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid meal toggle", 400);
    }

    const db = createDatabase(c.env.DB);
    const [row] = await db
      .select({ entry: MealEntry, meal: MealConfiguration })
      .from(MealEntry)
      .innerJoin(MealConfiguration, eq(MealEntry.mealId, MealConfiguration.id))
      .where(eq(MealEntry.id, parsed.data.entryId))
      .limit(1);
    if (!row) return failure(c, "Meal entry not found", 404);
    if (row.entry.userId !== user.id) {
      return failure(c, "This meal entry does not belong to you", 403);
    }

    const serviceDate = asDate(row.entry.serviceDate);
    const editableUntil = asDate(row.entry.editableUntil);
    const userCreatedAt = new Date(user.createdAt);
    if (!serviceDate || !editableUntil || Number.isNaN(userCreatedAt.getTime())) {
      return failure(c, "Meal entry has invalid dates", 422);
    }
    if (isMealBeforeEnrollment(serviceDate, userCreatedAt, row.meal)) {
      return failure(
        c,
        "This meal is before your enrollment or its cutoff has passed. Contact an administrator if a change is needed.",
        422,
      );
    }

    if (parsed.data.status === "ON") {
      const restriction = await evaluateRestrictions(db, user.id);
      if (!restriction.canBookMeals) {
        return failure(
          c,
          `Meal booking is restricted. ${restriction.restrictionReason || "Please contact the administrator."}`,
          403,
        );
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    if (row.entry.locked || isLocked(editableUntil, now)) {
      if (row.entry.status !== "LOCKED") {
        await db
          .update(MealEntry)
          .set({
            locked: true,
            status: row.entry.status === "ON" ? "LOCKED" : row.entry.status,
            updatedAt: nowIso,
          })
          .where(eq(MealEntry.id, row.entry.id));
      }
      return failure(
        c,
        row.entry.status === "LOCKED"
          ? "This meal is locked and cannot be changed"
          : "This meal's cutoff has passed. It is now locked.",
        422,
      );
    }

    if (row.entry.status === parsed.data.status) {
      const response = serializeEntry(row.entry);
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    const historyId = crypto.randomUUID();
    const updateStatement = c.env.DB.prepare(`
      UPDATE "MealEntry"
      SET "status" = ?, "originalState" = ?, "updatedBy" = ?, "updatedAt" = ?
      WHERE "id" = ?
        AND "userId" = ?
        AND "locked" = 0
        AND "status" = ?
    `).bind(
      parsed.data.status,
      parsed.data.status,
      user.id,
      nowIso,
      row.entry.id,
      user.id,
      row.entry.status,
    );
    const historyStatement = c.env.DB.prepare(`
      INSERT INTO "MealHistory" (
        "id", "mealEntryId", "mealId", "oldStatus", "newStatus", "changedBy", "triggerSource"
      )
      SELECT ?, "id", "mealId", ?, ?, ?, 'MANUAL'
      FROM "MealEntry"
      WHERE "id" = ?
        AND "status" = ?
        AND "originalState" = ?
        AND "updatedBy" = ?
        AND "updatedAt" = ?
    `).bind(
      historyId,
      row.entry.status,
      parsed.data.status,
      user.id,
      row.entry.id,
      parsed.data.status,
      parsed.data.status,
      user.id,
      nowIso,
    );

    const results = await c.env.DB.batch([updateStatement, historyStatement]);
    if (Number(results[0]?.meta?.changes ?? 0) === 0) {
      return failure(c, "Meal entry changed concurrently; refresh and try again", 409);
    }

    const [updated] = await db
      .select()
      .from(MealEntry)
      .where(eq(MealEntry.id, row.entry.id))
      .limit(1);
    if (!updated) return failure(c, "Meal entry not found", 404);

    await logAudit(c, {
      actorId: user.id,
      action: "MEAL_TOGGLE",
      entity: "MealEntry",
      entityId: row.entry.id,
      oldValue: { status: row.entry.status },
      newValue: { status: parsed.data.status },
    });

    const response = serializeEntry(updated);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/meals/toggle", async (c) => {
    const access = await requireToggleUser(c);
    if (access.response) return access.response;
    const user = access.user!;

    const parsed = bulkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid bulk meal toggle", 400);
    }

    const uniqueIds = Array.from(new Set(parsed.data.entryIds));
    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({ entry: MealEntry, meal: MealConfiguration })
      .from(MealEntry)
      .innerJoin(MealConfiguration, eq(MealEntry.mealId, MealConfiguration.id))
      .where(inArray(MealEntry.id, uniqueIds));
    const rowMap = new Map(rows.map((row) => [row.entry.id, row]));

    let restricted = false;
    if (parsed.data.status === "ON") {
      const restriction = await evaluateRestrictions(db, user.id);
      restricted = !restriction.canBookMeals;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const userCreatedAt = new Date(user.createdAt);
    const results = parsed.data.entryIds.map((id) => ({ id, success: false, error: undefined as string | undefined }));
    const valid: Array<{ id: string; mealId: string; oldStatus: string }> = [];
    const validIdSet = new Set<string>();

    for (let index = 0; index < parsed.data.entryIds.length; index += 1) {
      const id = parsed.data.entryIds[index];
      const row = rowMap.get(id);
      if (!row || row.entry.userId !== user.id) {
        results[index] = { id, success: false, error: "Not found" };
        continue;
      }
      const serviceDate = asDate(row.entry.serviceDate);
      const editableUntil = asDate(row.entry.editableUntil);
      if (!serviceDate || !editableUntil || Number.isNaN(userCreatedAt.getTime())) {
        results[index] = { id, success: false, error: "Invalid date" };
        continue;
      }
      if (row.entry.locked || isLocked(editableUntil, now)) {
        results[index] = { id, success: false, error: "Locked" };
        continue;
      }
      if (isMealBeforeEnrollment(serviceDate, userCreatedAt, row.meal)) {
        results[index] = { id, success: false, error: "Before enrollment" };
        continue;
      }
      if (restricted && parsed.data.status === "ON") {
        results[index] = { id, success: false, error: "Restricted" };
        continue;
      }
      if (row.entry.status === parsed.data.status) {
        results[index] = { id, success: true, error: undefined };
        continue;
      }
      if (!validIdSet.has(id)) {
        validIdSet.add(id);
        valid.push({ id, mealId: row.entry.mealId, oldStatus: row.entry.status });
      }
    }

    if (valid.length > 0) {
      const placeholders = valid.map(() => "?").join(", ");
      const updateStatement = c.env.DB.prepare(`
        UPDATE "MealEntry"
        SET "status" = ?, "originalState" = ?, "updatedBy" = ?, "updatedAt" = ?
        WHERE "id" IN (${placeholders})
          AND "userId" = ?
          AND "locked" = 0
      `).bind(
        parsed.data.status,
        parsed.data.status,
        user.id,
        nowIso,
        ...valid.map((entry) => entry.id),
        user.id,
      );

      const historyValues = valid.map(() => "(?, ?, ?, ?)").join(", ");
      const historyBindings = valid.flatMap((entry) => [
        crypto.randomUUID(),
        entry.id,
        entry.mealId,
        entry.oldStatus,
      ]);
      const historyStatement = c.env.DB.prepare(`
        WITH candidate("id", "mealEntryId", "mealId", "oldStatus") AS (
          VALUES ${historyValues}
        )
        INSERT INTO "MealHistory" (
          "id", "mealEntryId", "mealId", "oldStatus", "newStatus", "changedBy", "triggerSource"
        )
        SELECT
          candidate."id", candidate."mealEntryId", candidate."mealId", candidate."oldStatus",
          ?, ?, 'PRESET'
        FROM candidate
        INNER JOIN "MealEntry" entry ON entry."id" = candidate."mealEntryId"
        WHERE entry."status" = ?
          AND entry."originalState" = ?
          AND entry."updatedBy" = ?
          AND entry."updatedAt" = ?
      `).bind(
        ...historyBindings,
        parsed.data.status,
        user.id,
        parsed.data.status,
        parsed.data.status,
        user.id,
        nowIso,
      );
      await c.env.DB.batch([updateStatement, historyStatement]);

      const updatedRows = await db
        .select({ id: MealEntry.id, status: MealEntry.status, updatedAt: MealEntry.updatedAt })
        .from(MealEntry)
        .where(inArray(MealEntry.id, valid.map((entry) => entry.id)));
      const successfulIds = new Set(
        updatedRows
          .filter((entry) =>
            entry.status === parsed.data.status && databaseDateToIso(entry.updatedAt) === nowIso
          )
          .map((entry) => entry.id),
      );
      for (let index = 0; index < parsed.data.entryIds.length; index += 1) {
        const id = parsed.data.entryIds[index];
        if (successfulIds.has(id)) {
          results[index] = { id, success: true, error: undefined };
        } else if (validIdSet.has(id)) {
          results[index] = { id, success: false, error: "Changed concurrently" };
        }
      }
    }

    const response = { results };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
