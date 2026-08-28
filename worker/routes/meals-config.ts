import { asc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { MealConfiguration } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type MealConfigErrorStatus = 400 | 401 | 403 | 404 | 409;

const createSchema = z.object({
  name: z.string().min(2),
  displayName: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().default("🍽️"),
  color: z.string().default("#8b5cf6"),
  mealType: z.string().default("REGULAR"),
  displayOrder: z.number().default(0),
  defaultState: z.enum(["ON", "OFF"]).default("ON"),
  defaultVisibility: z.enum(["VISIBLE", "HIDDEN"]).default("VISIBLE"),
  cutoffStrategy: z.enum(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]).default("SAME_DAY"),
  cutoffTime: z.string().default("16:00"),
  cutoffOffsetMinutes: z.number().default(0),
  startTime: z.string().default("08:00"),
  endTime: z.string().default("10:00"),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  displayName: z.string().min(2).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  mealType: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  displayOrder: z.number().optional(),
  defaultState: z.enum(["ON", "OFF"]).optional(),
  defaultVisibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
  cutoffStrategy: z.enum(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]).optional(),
  cutoffTime: z.string().optional(),
  cutoffOffsetMinutes: z.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  notes: z.string().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: MealConfigErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
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

function serializeMeal(record: typeof MealConfiguration.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    displayName: record.displayName,
    description: record.description,
    icon: record.icon,
    color: record.color,
    mealType: record.mealType,
    status: record.status,
    displayOrder: record.displayOrder,
    defaultState: record.defaultState,
    defaultVisibility: record.defaultVisibility,
    cutoffStrategy: record.cutoffStrategy,
    cutoffOffsetMinutes: record.cutoffOffsetMinutes,
    cutoffTime: record.cutoffTime,
    startTime: record.startTime,
    endTime: record.endTime,
    notes: record.notes,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

export function registerMealConfigurationRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/meals/config", async (c) => {
    const access = await requireActiveUser(c);
    if (access.response) return access.response;
    const user = access.user!;
    const db = createDatabase(c.env.DB);

    const records = user.role === "ADMIN"
      ? await db
          .select()
          .from(MealConfiguration)
          .orderBy(
            asc(MealConfiguration.status),
            asc(MealConfiguration.displayOrder),
            asc(MealConfiguration.createdAt),
          )
      : await db
          .select()
          .from(MealConfiguration)
          .where(eq(MealConfiguration.status, "ACTIVE"))
          .orderBy(
            asc(MealConfiguration.status),
            asc(MealConfiguration.displayOrder),
            asc(MealConfiguration.createdAt),
          );

    const response = records.map(serializeMeal);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/meals/config", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid meal configuration", 400);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: MealConfiguration.id })
      .from(MealConfiguration)
      .where(eq(MealConfiguration.name, parsed.data.name))
      .limit(1);
    if (existing) return failure(c, "A meal with this name already exists", 409);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(MealConfiguration).values({
      id,
      name: parsed.data.name,
      displayName: parsed.data.displayName,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon,
      color: parsed.data.color,
      mealType: parsed.data.mealType,
      status: "ACTIVE",
      displayOrder: parsed.data.displayOrder,
      defaultState: parsed.data.defaultState,
      defaultVisibility: parsed.data.defaultVisibility,
      cutoffStrategy: parsed.data.cutoffStrategy,
      cutoffOffsetMinutes: parsed.data.cutoffOffsetMinutes,
      cutoffTime: parsed.data.cutoffTime,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      notes: parsed.data.notes ?? null,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, id))
      .limit(1);
    if (!created) return failure(c, "Meal not found", 404);
    const response = serializeMeal(created);

    await logAudit(c, {
      actorId: admin.id,
      action: "CREATE",
      entity: "MealConfiguration",
      entityId: id,
      newValue: response,
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.get("/api/meals/config/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [meal] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, id))
      .limit(1);
    if (!meal) return failure(c, "Meal not found", 404);

    const response = serializeMeal(meal);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.put("/api/meals/config/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid meal configuration update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, id))
      .limit(1);
    if (!existing) return failure(c, "Meal not found", 404);

    const updates: Partial<typeof MealConfiguration.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;
    if (parsed.data.mealType !== undefined) updates.mealType = parsed.data.mealType;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.displayOrder !== undefined) updates.displayOrder = parsed.data.displayOrder;
    if (parsed.data.defaultState !== undefined) updates.defaultState = parsed.data.defaultState;
    if (parsed.data.defaultVisibility !== undefined) {
      updates.defaultVisibility = parsed.data.defaultVisibility;
    }
    if (parsed.data.cutoffStrategy !== undefined) updates.cutoffStrategy = parsed.data.cutoffStrategy;
    if (parsed.data.cutoffTime !== undefined) updates.cutoffTime = parsed.data.cutoffTime;
    if (parsed.data.cutoffOffsetMinutes !== undefined) {
      updates.cutoffOffsetMinutes = parsed.data.cutoffOffsetMinutes;
    }
    if (parsed.data.startTime !== undefined) updates.startTime = parsed.data.startTime;
    if (parsed.data.endTime !== undefined) updates.endTime = parsed.data.endTime;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

    await db.update(MealConfiguration).set(updates).where(eq(MealConfiguration.id, id));
    const [updated] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, id))
      .limit(1);
    if (!updated) return failure(c, "Meal not found", 404);

    const oldValue = serializeMeal(existing);
    const response = serializeMeal(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "UPDATE",
      entity: "MealConfiguration",
      entityId: id,
      oldValue,
      newValue: response,
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/meals/config/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select()
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, id))
      .limit(1);
    if (!existing) return failure(c, "Meal not found", 404);

    await db.delete(MealConfiguration).where(eq(MealConfiguration.id, id));
    await logAudit(c, {
      actorId: admin.id,
      action: "DELETE",
      entity: "MealConfiguration",
      entityId: id,
      oldValue: serializeMeal(existing),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });
}
