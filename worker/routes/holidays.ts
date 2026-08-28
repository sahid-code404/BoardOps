import { and, asc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
  type SessionUser,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Holiday } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type HolidayErrorStatus = 400 | 401 | 403 | 404;

const holidayType = z.enum([
  "HOLIDAY",
  "FESTIVAL",
  "SPECIAL_MEAL",
  "BILLING_DAY",
  "REFUND_DAY",
  "MAINTENANCE",
]);

const createSchema = z.object({
  name: z.string().min(2, "Name is required").max(100),
  description: z.string().optional().nullable(),
  type: holidayType.default("HOLIDAY"),
  startDate: z.string(),
  endDate: z.string(),
  mealsDisabled: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional().nullable(),
  type: holidayType.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  mealsDisabled: z.boolean().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: HolidayErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user: user as SessionUser, response: null } as const;
}

function parseDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeHoliday(record: typeof Holiday.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    type: record.type,
    startDate: databaseDateToIso(record.startDate),
    endDate: databaseDateToIso(record.endDate),
    mealsDisabled: record.mealsDisabled,
    status: record.status,
    createdBy: record.createdBy,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

export function registerHolidayRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/holidays", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const status = c.req.query("status")?.trim() || "ACTIVE";
    const type = c.req.query("type")?.trim() || null;
    const requestedLimit = Number(c.req.query("limit") ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
      : 100;
    const db = createDatabase(c.env.DB);

    const holidays = type
      ? await db
          .select()
          .from(Holiday)
          .where(and(eq(Holiday.status, status), eq(Holiday.type, type)))
          .orderBy(asc(Holiday.startDate))
          .limit(limit)
      : await db
          .select()
          .from(Holiday)
          .where(eq(Holiday.status, status))
          .orderBy(asc(Holiday.startDate))
          .limit(limit);

    const response = holidays.map(serializeHoliday);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/holidays", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid holiday", 400);
    }

    const startDate = parseDate(parsed.data.startDate);
    if (!startDate) return failure(c, "Invalid start date", 400);
    const endDate = parseDate(parsed.data.endDate);
    if (!endDate) return failure(c, "Invalid end date", 400);
    if (Date.parse(endDate) < Date.parse(startDate)) {
      return failure(c, "End date cannot be before start date", 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = createDatabase(c.env.DB);
    await db.insert(Holiday).values({
      id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      startDate,
      endDate,
      mealsDisabled: parsed.data.mealsDisabled,
      status: "ACTIVE",
      createdBy: admin.id,
      updatedAt: now,
    });

    const [created] = await db.select().from(Holiday).where(eq(Holiday.id, id)).limit(1);
    if (!created) return failure(c, "Holiday not found", 404);
    const response = serializeHoliday(created);

    await logAudit(c, {
      actorId: admin.id,
      action: "HOLIDAY_CREATE",
      entity: "Holiday",
      entityId: id,
      newValue: response,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.patch("/api/holidays/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid holiday update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Holiday).where(eq(Holiday.id, id)).limit(1);
    if (!existing) return failure(c, "Holiday not found", 404);

    const updates: Partial<typeof Holiday.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.type !== undefined) updates.type = parsed.data.type;
    if (parsed.data.mealsDisabled !== undefined) updates.mealsDisabled = parsed.data.mealsDisabled;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;

    if (parsed.data.startDate !== undefined) {
      const value = parseDate(parsed.data.startDate);
      if (!value) return failure(c, "Invalid start date", 400);
      updates.startDate = value;
    }
    if (parsed.data.endDate !== undefined) {
      const value = parseDate(parsed.data.endDate);
      if (!value) return failure(c, "Invalid end date", 400);
      updates.endDate = value;
    }

    const startDate = updates.startDate ?? databaseDateToIso(existing.startDate);
    const endDate = updates.endDate ?? databaseDateToIso(existing.endDate);
    if (!startDate || !endDate || Date.parse(endDate) < Date.parse(startDate)) {
      return failure(c, "End date cannot be before start date", 400);
    }

    await db.update(Holiday).set(updates).where(eq(Holiday.id, id));
    const [updated] = await db.select().from(Holiday).where(eq(Holiday.id, id)).limit(1);
    if (!updated) return failure(c, "Holiday not found", 404);

    const oldValue = serializeHoliday(existing);
    const response = serializeHoliday(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "HOLIDAY_UPDATE",
      entity: "Holiday",
      entityId: id,
      oldValue,
      newValue: response,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/holidays/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Holiday).where(eq(Holiday.id, id)).limit(1);
    if (!existing) return failure(c, "Holiday not found", 404);

    await db
      .update(Holiday)
      .set({ status: "ARCHIVED", updatedAt: new Date().toISOString() })
      .where(eq(Holiday.id, id));
    const [updated] = await db.select().from(Holiday).where(eq(Holiday.id, id)).limit(1);
    if (!updated) return failure(c, "Holiday not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: "HOLIDAY_ARCHIVE",
      entity: "Holiday",
      entityId: id,
      oldValue: serializeHoliday(existing),
      newValue: serializeHoliday(updated),
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ archived: true }>>({
      success: true,
      data: { archived: true },
      requestId: c.get("requestId"),
    });
  });
}
