import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { LeaveApplication, MealConfiguration, Notification, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import {
  buildInclusiveUtcDates,
  buildLeaveMealRows,
  parseLeaveMealIds,
  type LeaveMealConfig,
  type LeaveMealRow,
} from "../leave-state";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type LeaveErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const createSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(3).max(500),
  mealType: z.enum(["ALL", "SPECIFIC"]).default("ALL"),
  mealIds: z.array(z.string()).optional().default([]),
});

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNotes: z.string().max(500).optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: LeaveErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function parseDateOnly(value: string, endOfDay = false): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(
    Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0),
  );
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function serializeLeave(record: typeof LeaveApplication.$inferSelect) {
  return {
    id: record.id,
    userId: record.userId,
    startDate: databaseDateToIso(record.startDate),
    endDate: databaseDateToIso(record.endDate),
    reason: record.reason,
    status: record.status,
    approvedBy: record.approvedBy,
    mealType: record.mealType,
    mealIds: record.mealIds,
    adminNotes: record.adminNotes,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function userShape(row: {
  userId: string;
  userName: string;
  userEmail: string;
  userRoom: string | null;
  userAvatarUrl: string | null;
}) {
  return {
    id: row.userId,
    name: row.userName,
    email: row.userEmail,
    room: row.userRoom,
    avatarUrl: row.userAvatarUrl,
  };
}

async function requireLeaveAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function createLeaveMealUpsertStatement(
  c: Context<BoardOpsEnv>,
  rows: LeaveMealRow[],
  applicationId: string,
  userId: string,
  adminId: string,
  decisionTimestamp: string,
) {
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const note = `Leave application ${applicationId} approved`;
  const bindings: Array<string | number> = rows.flatMap((row) => [
    row.id,
    userId,
    row.mealId,
    row.serviceDate,
    "OFF",
    "OFF",
    row.editableUntil,
    1,
    note,
    adminId,
    decisionTimestamp,
  ]);
  bindings.push(applicationId, adminId, decisionTimestamp);

  return c.env.DB.prepare(`
    WITH candidate(
      "id", "userId", "mealId", "serviceDate", "status", "originalState",
      "editableUntil", "locked", "notes", "updatedBy", "updatedAt"
    ) AS (
      VALUES ${placeholders}
    )
    INSERT INTO "MealEntry" (
      "id", "userId", "mealId", "serviceDate", "status", "originalState",
      "editableUntil", "locked", "notes", "updatedBy", "updatedAt"
    )
    SELECT
      candidate."id", candidate."userId", candidate."mealId", candidate."serviceDate",
      candidate."status", candidate."originalState", candidate."editableUntil",
      candidate."locked", candidate."notes", candidate."updatedBy", candidate."updatedAt"
    FROM candidate
    WHERE EXISTS (
      SELECT 1
      FROM "LeaveApplication" leave
      WHERE leave."id" = ?
        AND leave."status" = 'APPROVED'
        AND leave."approvedBy" = ?
        AND leave."updatedAt" = ?
    )
    ON CONFLICT("userId", "mealId", "serviceDate") DO UPDATE SET
      "status" = excluded."status",
      "originalState" = excluded."originalState",
      "locked" = excluded."locked",
      "notes" = excluded."notes",
      "updatedBy" = excluded."updatedBy",
      "updatedAt" = excluded."updatedAt"
  `).bind(...bindings);
}

export function registerLeaveRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/leave", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const db = createDatabase(c.env.DB);
    const rows = user.role === "USER"
      ? await db
          .select({
            leave: LeaveApplication,
            userId: User.id,
            userName: User.name,
            userEmail: User.email,
            userRoom: User.room,
            userAvatarUrl: User.avatarUrl,
          })
          .from(LeaveApplication)
          .innerJoin(User, eq(LeaveApplication.userId, User.id))
          .where(eq(LeaveApplication.userId, user.id))
          .orderBy(desc(LeaveApplication.createdAt))
      : await db
          .select({
            leave: LeaveApplication,
            userId: User.id,
            userName: User.name,
            userEmail: User.email,
            userRoom: User.room,
            userAvatarUrl: User.avatarUrl,
          })
          .from(LeaveApplication)
          .innerJoin(User, eq(LeaveApplication.userId, User.id))
          .orderBy(desc(LeaveApplication.createdAt));

    const response = rows.map((row) => ({
      ...serializeLeave(row.leave),
      user: userShape(row),
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/leave", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid leave application", 400);
    }

    const startDate = parseDateOnly(parsed.data.startDate, false);
    const endDate = parseDateOnly(parsed.data.endDate, true);
    if (!startDate || !endDate) return failure(c, "Invalid leave date", 400);
    if (Date.parse(endDate) < Date.parse(startDate)) {
      return failure(c, "End date must be on or after start date", 400);
    }

    const db = createDatabase(c.env.DB);
    if (parsed.data.mealType === "SPECIFIC") {
      if (parsed.data.mealIds.length === 0) {
        return failure(c, "Select at least one meal when meal type is SPECIFIC", 400);
      }
      const uniqueMealIds = Array.from(new Set(parsed.data.mealIds));
      const validMeals = await db
        .select({ id: MealConfiguration.id })
        .from(MealConfiguration)
        .where(
          and(
            inArray(MealConfiguration.id, uniqueMealIds),
            eq(MealConfiguration.status, "ACTIVE"),
          ),
        );
      if (validMeals.length !== uniqueMealIds.length || uniqueMealIds.length !== parsed.data.mealIds.length) {
        return failure(c, "One or more selected meals are invalid or inactive", 400);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(LeaveApplication).values({
      id,
      userId: user.id,
      startDate,
      endDate,
      reason: parsed.data.reason,
      status: "PENDING",
      mealType: parsed.data.mealType,
      mealIds: JSON.stringify(parsed.data.mealIds),
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(LeaveApplication)
      .where(eq(LeaveApplication.id, id))
      .limit(1);
    if (!created) throw new Error("Leave application insert did not return a persisted row");

    const admins = await db
      .select({ id: User.id })
      .from(User)
      .where(
        and(
          inArray(User.role, ["ADMIN", "SUPER_ADMIN"]),
          eq(User.status, "ACTIVE"),
        ),
      );
    if (admins.length > 0) {
      await db.insert(Notification).values(
        admins.map((admin) => ({
          id: crypto.randomUUID(),
          userId: admin.id,
          title: "New leave application",
          description: `${user.name} applied for leave from ${parsed.data.startDate} to ${parsed.data.endDate}.`,
          type: "INFO",
          priority: "NORMAL",
          route: "/kitchen",
        })),
      );
    }

    const response = {
      ...serializeLeave(created),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        room: user.room,
        avatarUrl: user.avatarUrl,
      },
    };

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.patch("/api/leave/:id", async (c) => {
    const access = await requireLeaveAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid leave decision", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [row] = await db
      .select({
        leave: LeaveApplication,
        userId: User.id,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
        userAvatarUrl: User.avatarUrl,
      })
      .from(LeaveApplication)
      .innerJoin(User, eq(LeaveApplication.userId, User.id))
      .where(eq(LeaveApplication.id, id))
      .limit(1);
    if (!row) return failure(c, "Leave application not found", 404);
    if (row.leave.status !== "PENDING") {
      return failure(c, `Application already ${row.leave.status.toLowerCase()}`, 409);
    }

    const startDate = databaseDateToIso(row.leave.startDate);
    const endDate = databaseDateToIso(row.leave.endDate);
    if (!startDate || !endDate) return failure(c, "Leave application has invalid dates", 422);

    let mealRows: LeaveMealRow[] = [];
    if (parsed.data.status === "APPROVED") {
      const targetMealIds = parseLeaveMealIds(row.leave.mealType, row.leave.mealIds);
      let meals: LeaveMealConfig[] = [];
      if (row.leave.mealType === "SPECIFIC") {
        if (targetMealIds.length > 0) {
          meals = await db
            .select({
              id: MealConfiguration.id,
              cutoffStrategy: MealConfiguration.cutoffStrategy,
              cutoffTime: MealConfiguration.cutoffTime,
              cutoffOffsetMinutes: MealConfiguration.cutoffOffsetMinutes,
            })
            .from(MealConfiguration)
            .where(
              and(
                eq(MealConfiguration.status, "ACTIVE"),
                inArray(MealConfiguration.id, targetMealIds),
              ),
            );
        }
      } else {
        meals = await db
          .select({
            id: MealConfiguration.id,
            cutoffStrategy: MealConfiguration.cutoffStrategy,
            cutoffTime: MealConfiguration.cutoffTime,
            cutoffOffsetMinutes: MealConfiguration.cutoffOffsetMinutes,
          })
          .from(MealConfiguration)
          .where(eq(MealConfiguration.status, "ACTIVE"));
      }

      const dates = buildInclusiveUtcDates(startDate, endDate);
      if (dates.length === 0) return failure(c, "Leave application has invalid dates", 422);
      mealRows = buildLeaveMealRows(meals, dates);
    }

    const decisionTimestamp = new Date().toISOString();
    const decisionStatement = c.env.DB.prepare(`
      UPDATE "LeaveApplication"
      SET "status" = ?, "approvedBy" = ?, "adminNotes" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "status" = 'PENDING'
    `).bind(
      parsed.data.status,
      admin.id,
      parsed.data.adminNotes ?? null,
      decisionTimestamp,
      id,
    );

    const statements = [decisionStatement];
    if (parsed.data.status === "APPROVED" && mealRows.length > 0) {
      statements.push(
        createLeaveMealUpsertStatement(
          c,
          mealRows,
          id,
          row.leave.userId,
          admin.id,
          decisionTimestamp,
        ),
      );
    }

    const results = await c.env.DB.batch(statements);
    const decisionChanges = Number(results[0]?.meta?.changes ?? 0);
    if (decisionChanges === 0) {
      const [current] = await db
        .select({ status: LeaveApplication.status })
        .from(LeaveApplication)
        .where(eq(LeaveApplication.id, id))
        .limit(1);
      if (!current) return failure(c, "Leave application not found", 404);
      return failure(c, `Application already ${current.status.toLowerCase()}`, 409);
    }

    const [updated] = await db
      .select()
      .from(LeaveApplication)
      .where(eq(LeaveApplication.id, id))
      .limit(1);
    if (!updated) return failure(c, "Leave application not found", 404);

    await createNotification(c, {
      userId: row.leave.userId,
      title: `Leave ${parsed.data.status.toLowerCase()}`,
      description: parsed.data.status === "APPROVED"
        ? `Your leave application from ${startDate.slice(0, 10)} to ${endDate.slice(0, 10)} has been approved.`
        : "Your leave application has been rejected.",
      type: parsed.data.status === "APPROVED" ? "SUCCESS" : "WARNING",
      priority: "NORMAL",
    });

    const response = {
      ...serializeLeave(updated),
      user: userShape(row),
    };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
