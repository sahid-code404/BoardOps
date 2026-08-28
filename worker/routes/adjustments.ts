import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Adjustment, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { generateAdjustmentNumber } from "../reference-numbers";
import type { BoardOpsEnv } from "../types";

type AdjustmentErrorStatus = 400 | 401 | 403;

const entityTypeSchema = z.enum(["Payment", "Refund", "Bill", "Expense"]);
const createSchema = z.object({
  userId: z.string().optional().nullable(),
  entityType: entityTypeSchema,
  entityId: z.string().min(1),
  amount: z.number(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
  notes: z.string().optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: AdjustmentErrorStatus) {
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
  return { user, response: null } as const;
}

function serializeUser(user: Pick<typeof User.$inferSelect, "id" | "name" | "email"> | null) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

function serializeAdjustment(
  record: typeof Adjustment.$inferSelect,
  users: Map<string, Pick<typeof User.$inferSelect, "id" | "name" | "email">>,
) {
  return {
    id: record.id,
    adjustmentNumber: record.adjustmentNumber,
    userId: record.userId,
    entityType: record.entityType,
    entityId: record.entityId,
    amount: record.amount,
    reason: record.reason,
    notes: record.notes,
    createdBy: record.createdBy,
    createdAt: databaseDateToIso(record.createdAt),
    user: serializeUser(record.userId ? users.get(record.userId) ?? null : null),
    creator: serializeUser(record.createdBy ? users.get(record.createdBy) ?? null : null),
  };
}

async function loadUsersForAdjustments(
  c: Context<BoardOpsEnv>,
  records: Array<typeof Adjustment.$inferSelect>,
) {
  const ids = Array.from(
    new Set(
      records.flatMap((record) => [record.userId, record.createdBy]).filter((id): id is string => !!id),
    ),
  );
  const users = new Map<string, Pick<typeof User.$inferSelect, "id" | "name" | "email">>();
  if (ids.length === 0) return users;

  const db = createDatabase(c.env.DB);
  const rows = await db
    .select({ id: User.id, name: User.name, email: User.email })
    .from(User)
    .where(inArray(User.id, ids));
  for (const row of rows) users.set(row.id, row);
  return users;
}

export function registerAdjustmentRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/adjustments", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const userId = c.req.query("userId")?.trim() || null;
    const entityType = c.req.query("entityType")?.trim() || null;
    const entityId = c.req.query("entityId")?.trim() || null;
    const requestedLimit = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
      : 50;

    const conditions = [];
    if (userId) conditions.push(eq(Adjustment.userId, userId));
    if (entityType) conditions.push(eq(Adjustment.entityType, entityType));
    if (entityId) conditions.push(eq(Adjustment.entityId, entityId));

    const db = createDatabase(c.env.DB);
    const records = conditions.length > 0
      ? await db
          .select()
          .from(Adjustment)
          .where(and(...conditions))
          .orderBy(desc(Adjustment.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(Adjustment)
          .orderBy(desc(Adjustment.createdAt))
          .limit(limit);

    const users = await loadUsersForAdjustments(c, records);
    const response = records.map((record) => serializeAdjustment(record, users));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/adjustments", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid adjustment", 400);
    }

    const db = createDatabase(c.env.DB);
    const adjustmentNumber = await generateAdjustmentNumber(db);
    const id = crypto.randomUUID();
    await db.insert(Adjustment).values({
      id,
      adjustmentNumber,
      userId: parsed.data.userId ?? null,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      createdBy: admin.id,
    });

    const [created] = await db
      .select()
      .from(Adjustment)
      .where(eq(Adjustment.id, id))
      .limit(1);
    if (!created) throw new Error("Adjustment insert did not return a persisted row");

    const users = await loadUsersForAdjustments(c, [created]);
    const response = serializeAdjustment(created, users);
    await logAudit(c, {
      actorId: admin.id,
      action: "ADJUSTMENT_CREATE",
      entity: "Adjustment",
      entityId: id,
      newValue: {
        adjustmentNumber,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
      },
      reason: parsed.data.reason,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
