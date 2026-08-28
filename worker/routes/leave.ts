import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { LeaveApplication, MealConfiguration, Notification, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type LeaveErrorStatus = 400 | 401;

const createSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(3).max(500),
  mealType: z.enum(["ALL", "SPECIFIC"]).default("ALL"),
  mealIds: z.array(z.string()).optional().default([]),
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
}
