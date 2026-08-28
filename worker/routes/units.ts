import { asc, eq, sql } from "drizzle-orm";
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
import { Product, Unit } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type UnitErrorStatus = 400 | 401 | 403 | 404 | 409;

const categorySchema = z.enum(["WEIGHT", "VOLUME", "QUANTITY", "OTHER"]);
const createSchema = z.object({
  name: z.string().min(1, "Unit name is required").max(20),
  category: categorySchema.default("QUANTITY"),
  isActive: z.boolean().default(true),
});
const updateSchema = z.object({
  category: categorySchema.optional(),
  isActive: z.boolean().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: UnitErrorStatus) {
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

function serializeUnit(record: typeof Unit.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    isActive: record.isActive,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

export function registerUnitRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/units", async (c) => {
    const db = createDatabase(c.env.DB);
    const units = await db
      .select()
      .from(Unit)
      .orderBy(asc(Unit.category), asc(Unit.name));
    const response = units.map(serializeUnit);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/units", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid unit", 400);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: Unit.id })
      .from(Unit)
      .where(eq(Unit.name, parsed.data.name))
      .limit(1);
    if (existing) return failure(c, "A unit with this name already exists", 409);

    const id = crypto.randomUUID();
    await db.insert(Unit).values({
      id,
      name: parsed.data.name,
      category: parsed.data.category,
      isActive: parsed.data.isActive,
      updatedAt: new Date().toISOString(),
    });
    const [created] = await db.select().from(Unit).where(eq(Unit.id, id)).limit(1);
    if (!created) return failure(c, "Unit not found", 404);
    const response = serializeUnit(created);

    await logAudit(c, {
      actorId: admin.id,
      action: "UNIT_CREATE",
      entity: "Unit",
      entityId: id,
      newValue: parsed.data,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.patch("/api/units/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid unit update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Unit).where(eq(Unit.id, id)).limit(1);
    if (!existing) return failure(c, "Unit not found", 404);

    const updates: Partial<typeof Unit.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

    await db.update(Unit).set(updates).where(eq(Unit.id, id));
    const [updated] = await db.select().from(Unit).where(eq(Unit.id, id)).limit(1);
    if (!updated) return failure(c, "Unit not found", 404);
    const response = serializeUnit(updated);

    await logAudit(c, {
      actorId: admin.id,
      action: "UNIT_UPDATE",
      entity: "Unit",
      entityId: id,
      oldValue: serializeUnit(existing),
      newValue: parsed.data,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/units/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Unit).where(eq(Unit.id, id)).limit(1);
    if (!existing) return failure(c, "Unit not found", 404);

    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(Product)
      .where(eq(Product.defaultUnitId, id));
    const productsUsing = Number(countRow?.value ?? 0);
    if (productsUsing > 0) {
      return failure(
        c,
        `Cannot delete: ${productsUsing} product(s) use this unit as their default. Reassign them first.`,
        409,
      );
    }

    await db
      .update(Unit)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(Unit.id, id));
    const [updated] = await db.select().from(Unit).where(eq(Unit.id, id)).limit(1);
    if (!updated) return failure(c, "Unit not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: "UNIT_DEACTIVATE",
      entity: "Unit",
      entityId: id,
      oldValue: serializeUnit(existing),
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = serializeUnit(updated);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
