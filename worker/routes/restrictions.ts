import { and, desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Restriction, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { evaluateRestrictions } from "../restriction-engine";
import type { BoardOpsEnv } from "../types";

type RestrictionErrorStatus = 400 | 401 | 403 | 404 | 409;

const createSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(["FINANCIAL", "ADMINISTRATIVE"]),
  reason: z.string().min(5, "Reason must be at least 5 characters").max(500),
  isExemption: z.boolean().default(false),
  expiresAt: z.string().optional().nullable(),
});

const liftSchema = z.object({
  reason: z.string().min(5, "Lift reason must be at least 5 characters").max(500),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: RestrictionErrorStatus) {
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

function parseOptionalDate(value: string | null | undefined): string | null | "INVALID" {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "INVALID" : date.toISOString();
}

function serializeRestriction(record: typeof Restriction.$inferSelect) {
  return {
    ...record,
    appliedAt: databaseDateToIso(record.appliedAt),
    expiresAt: databaseDateToIso(record.expiresAt),
    liftedAt: databaseDateToIso(record.liftedAt),
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

export function registerRestrictionRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/restrictions", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const status = c.req.query("status") || "ACTIVE";
    const type = c.req.query("type") || null;
    const parsedLimit = Number(c.req.query("limit") || 100);
    const limit = Number.isFinite(parsedLimit) ? Math.min(500, Math.max(1, Math.trunc(parsedLimit))) : 100;
    const db = createDatabase(c.env.DB);

    const rows = type
      ? await db
          .select({
            restriction: Restriction,
            userId: User.id,
            userName: User.name,
            userEmail: User.email,
            userRoom: User.room,
            userAvatarUrl: User.avatarUrl,
          })
          .from(Restriction)
          .innerJoin(User, eq(Restriction.userId, User.id))
          .where(and(eq(Restriction.status, status), eq(Restriction.type, type)))
          .orderBy(desc(Restriction.appliedAt))
          .limit(limit)
      : await db
          .select({
            restriction: Restriction,
            userId: User.id,
            userName: User.name,
            userEmail: User.email,
            userRoom: User.room,
            userAvatarUrl: User.avatarUrl,
          })
          .from(Restriction)
          .innerJoin(User, eq(Restriction.userId, User.id))
          .where(eq(Restriction.status, status))
          .orderBy(desc(Restriction.appliedAt))
          .limit(limit);

    const response = rows.map((row) => ({
      ...serializeRestriction(row.restriction),
      user: userShape(row),
    }));
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/restrictions", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid restriction", 400);
    }
    const expiresAt = parseOptionalDate(parsed.data.expiresAt);
    if (expiresAt === "INVALID") return failure(c, "Invalid restriction expiry", 400);

    const db = createDatabase(c.env.DB);
    const [target] = await db
      .select({ id: User.id })
      .from(User)
      .where(eq(User.id, parsed.data.userId))
      .limit(1);
    if (!target) return failure(c, "User not found", 404);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const isFinancialExemption = parsed.data.isExemption && parsed.data.type === "FINANCIAL";

    if (isFinancialExemption) {
      const liftAutomatic = c.env.DB.prepare(`
        UPDATE "Restriction"
        SET "status" = 'LIFTED', "liftedBy" = ?, "liftedAt" = ?,
            "liftReason" = ?, "updatedAt" = ?
        WHERE "userId" = ? AND "type" = 'FINANCIAL'
          AND "source" = 'AUTOMATIC' AND "status" = 'ACTIVE'
      `).bind(
        admin.id,
        now,
        `Exempted by admin: ${parsed.data.reason}`,
        now,
        parsed.data.userId,
      );
      const createExemption = c.env.DB.prepare(`
        INSERT INTO "Restriction" (
          "id", "userId", "type", "reason", "source", "status",
          "appliedBy", "expiresAt", "updatedAt"
        ) VALUES (?, ?, 'FINANCIAL', ?, 'MANUAL', 'ACTIVE', ?, ?, ?)
      `).bind(
        id,
        parsed.data.userId,
        `EXEMPTION: ${parsed.data.reason}`,
        admin.id,
        expiresAt,
        now,
      );
      await c.env.DB.batch([liftAutomatic, createExemption]);
    } else {
      await c.env.DB.prepare(`
        INSERT INTO "Restriction" (
          "id", "userId", "type", "reason", "source", "status",
          "appliedBy", "expiresAt", "updatedAt"
        ) VALUES (?, ?, 'ADMINISTRATIVE', ?, 'MANUAL', 'ACTIVE', ?, ?, ?)
      `).bind(
        id,
        parsed.data.userId,
        parsed.data.reason,
        admin.id,
        expiresAt,
        now,
      ).run();
    }

    const [createdRow] = await db
      .select({
        restriction: Restriction,
        userId: User.id,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
        userAvatarUrl: User.avatarUrl,
      })
      .from(Restriction)
      .innerJoin(User, eq(Restriction.userId, User.id))
      .where(eq(Restriction.id, id))
      .limit(1);
    if (!createdRow) return failure(c, "Restriction not found after creation", 404);

    const response = {
      ...serializeRestriction(createdRow.restriction),
      user: userShape(createdRow),
    };
    await logAudit(c, {
      actorId: admin.id,
      action: isFinancialExemption ? "RESTRICTION_EXEMPTION" : "RESTRICTION_APPLY",
      entity: "Restriction",
      entityId: id,
      newValue: {
        type: parsed.data.type,
        reason: parsed.data.reason,
        userId: parsed.data.userId,
        isExemption: parsed.data.isExemption,
      },
      reason: parsed.data.reason,
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.get("/api/restrictions/user/:userId", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);
    const userId = c.req.param("userId");
    if (user.role === "USER" && userId !== user.id) {
      return failure(c, "You can only view your own restrictions", 403);
    }

    const db = createDatabase(c.env.DB);
    const response = await evaluateRestrictions(db, userId);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/restrictions/:id/lift", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;
    const parsed = liftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid lift request", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Restriction).where(eq(Restriction.id, id)).limit(1);
    if (!existing) return failure(c, "Restriction not found", 404);
    if (existing.status === "LIFTED") return failure(c, "Restriction is already lifted", 400);

    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(`
      UPDATE "Restriction"
      SET "status" = 'LIFTED', "liftedBy" = ?, "liftedAt" = ?,
          "liftReason" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "status" <> 'LIFTED'
    `).bind(admin.id, now, parsed.data.reason, now, id).run();
    if (Number(result.meta?.changes ?? 0) === 0) {
      return failure(c, "Restriction changed concurrently. Reload and try again.", 409);
    }

    const [updated] = await db.select().from(Restriction).where(eq(Restriction.id, id)).limit(1);
    if (!updated) return failure(c, "Restriction not found", 404);
    const response = serializeRestriction(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "RESTRICTION_LIFT",
      entity: "Restriction",
      entityId: id,
      oldValue: serializeRestriction(existing),
      newValue: response,
      reason: parsed.data.reason,
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
