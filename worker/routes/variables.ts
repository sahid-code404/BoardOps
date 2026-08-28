import { asc, eq } from "drizzle-orm";
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
import { Variable } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type VariableErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const variableType = z.enum(["NUMBER", "CURRENCY", "PERCENTAGE", "TEXT", "BOOLEAN"]);

const createSchema = z.object({
  key: z
    .string()
    .min(2)
    .regex(/^[a-z0-9_.-]+$/i, "Use letters, numbers, dots, underscores, dashes"),
  name: z.string().min(2),
  description: z.string().optional(),
  type: variableType.default("NUMBER"),
  value: z.string(),
  unit: z.string().optional(),
  category: z.string().default("GENERAL"),
});

const updateSchema = z.object({
  name: z.string().optional(),
  value: z.string(),
  description: z.string().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: VariableErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializeVariable(record: typeof Variable.$inferSelect) {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    type: record.type,
    value: record.value,
    unit: record.unit,
    category: record.category,
    isSystem: record.isSystem,
    isProtected: record.isProtected,
    status: record.status,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

async function requireActiveUser(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  return { user, response: null } as const;
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const access = await requireActiveUser(c);
  if (access.response) return access;
  if (access.user!.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return access;
}

export function registerVariableRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/variables", async (c) => {
    const access = await requireActiveUser(c);
    if (access.response) return access.response;

    const db = createDatabase(c.env.DB);
    const records = await db
      .select()
      .from(Variable)
      .where(eq(Variable.status, "ACTIVE"))
      .orderBy(asc(Variable.category), asc(Variable.name));
    const response = records.map(serializeVariable);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/variables", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid variable", 400);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: Variable.id })
      .from(Variable)
      .where(eq(Variable.key, parsed.data.key))
      .limit(1);
    if (existing) return failure(c, "Variable with this key already exists", 409);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(Variable).values({
      id,
      key: parsed.data.key,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      value: parsed.data.value,
      unit: parsed.data.unit ?? null,
      category: parsed.data.category,
      isSystem: false,
      isProtected: false,
      status: "ACTIVE",
      updatedAt: now,
    });

    const [created] = await db.select().from(Variable).where(eq(Variable.id, id)).limit(1);
    if (!created) return failure(c, "Variable not found", 404);
    const response = serializeVariable(created);

    await logAudit(c, {
      actorId: admin.id,
      action: "CREATE",
      entity: "Variable",
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

  app.put("/api/variables/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid variable update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Variable).where(eq(Variable.id, id)).limit(1);
    if (!existing) return failure(c, "Variable not found", 404);

    const updates: Partial<typeof Variable.$inferInsert> = {
      value: parsed.data.value,
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit;
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;

    await db.update(Variable).set(updates).where(eq(Variable.id, id));
    const [updated] = await db.select().from(Variable).where(eq(Variable.id, id)).limit(1);
    if (!updated) return failure(c, "Variable not found", 404);

    const oldValue = serializeVariable(existing);
    const response = serializeVariable(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "UPDATE",
      entity: "Variable",
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

  app.delete("/api/variables/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Variable).where(eq(Variable.id, id)).limit(1);
    if (!existing) return failure(c, "Variable not found", 404);
    if (existing.isProtected) {
      return failure(c, "System-protected variables cannot be deleted", 422);
    }

    await db
      .update(Variable)
      .set({ status: "ARCHIVED", updatedAt: new Date().toISOString() })
      .where(eq(Variable.id, id));

    await logAudit(c, {
      actorId: admin.id,
      action: "ARCHIVE",
      entity: "Variable",
      entityId: id,
      oldValue: serializeVariable(existing),
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });
}
