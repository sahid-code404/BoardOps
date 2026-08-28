import {
  and,
  asc,
  desc,
  eq,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Context, Hono } from "hono";

import {
  databaseDateToIso,
  getAuthUser,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { AuditLog, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type AuditErrorStatus = 401 | 403;

function failure(c: Context<BoardOpsEnv>, error: string, status: AuditErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function parseJsonText(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function registerAuditLogRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/audit-logs", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);
    if (user.role !== "ADMIN") return failure(c, "Forbidden", 403);

    const limit = boundedInteger(c.req.query("limit"), 50, 1, 200);
    const offset = boundedInteger(c.req.query("offset"), 0, 0, 1_000_000_000);
    const entity = c.req.query("entity")?.trim() || null;
    const entityId = c.req.query("entityId")?.trim() || null;
    const action = c.req.query("action")?.trim() || null;
    const actorId = c.req.query("actorId")?.trim() || null;
    const search = c.req.query("search")?.trim() || null;

    const conditions: SQL[] = [];
    if (entity) conditions.push(eq(AuditLog.entity, entity));
    if (entityId) conditions.push(eq(AuditLog.entityId, entityId));
    if (action) conditions.push(like(AuditLog.action, `%${action}%`));
    if (actorId) conditions.push(eq(AuditLog.actorId, actorId));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          like(AuditLog.action, pattern),
          like(AuditLog.entity, pattern),
          like(AuditLog.reason, pattern),
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const db = createDatabase(c.env.DB);

    const rows = await db
      .select({
        log: AuditLog,
        actorId: User.id,
        actorName: User.name,
        actorEmail: User.email,
        actorAvatarUrl: User.avatarUrl,
      })
      .from(AuditLog)
      .leftJoin(User, eq(AuditLog.actorId, User.id))
      .where(where)
      .orderBy(desc(AuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(AuditLog)
      .where(where);
    const total = Number(countRow?.value ?? 0);

    const entities = await db
      .selectDistinct({ entity: AuditLog.entity })
      .from(AuditLog)
      .orderBy(asc(AuditLog.entity));
    const actions = await db
      .selectDistinct({ action: AuditLog.action })
      .from(AuditLog)
      .orderBy(asc(AuditLog.action));

    const logs = rows.map((row) => ({
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
      actor:
        row.actorId && row.actorName && row.actorEmail
          ? {
              id: row.actorId,
              name: row.actorName,
              email: row.actorEmail,
              avatarUrl: row.actorAvatarUrl,
            }
          : null,
    }));

    const response = {
      logs,
      total,
      pagination: {
        limit,
        offset,
        hasMore: offset + logs.length < total,
      },
      filters: {
        entities: entities.map((item) => item.entity),
        actions: actions.map((item) => item.action),
      },
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
