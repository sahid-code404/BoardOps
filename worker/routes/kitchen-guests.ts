import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { GuestMeal, MealConfiguration } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type KitchenGuestErrorStatus = 400 | 401 | 403 | 404;

const createSchema = z.object({
  mealId: z.string().min(1),
  guestCount: z.number().int().min(1).max(100).default(1),
  notes: z.string().optional(),
  serviceDate: z.string().min(1),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: KitchenGuestErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireKitchenAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function parseDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function serializeGuestMeal(record: typeof GuestMeal.$inferSelect) {
  return {
    id: record.id,
    mealId: record.mealId,
    userId: record.userId,
    guestName: record.guestName,
    guestCount: record.guestCount,
    serviceDate: databaseDateToIso(record.serviceDate),
    notes: record.notes,
    createdAt: databaseDateToIso(record.createdAt),
  };
}

export function registerKitchenGuestRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/kitchen", async (c) => {
    const access = await requireKitchenAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid guest meal", 400);
    }
    const serviceDate = parseDateOnly(parsed.data.serviceDate);
    if (!serviceDate) return failure(c, "Invalid service date", 400);

    const db = createDatabase(c.env.DB);
    const [meal] = await db
      .select({ id: MealConfiguration.id, displayName: MealConfiguration.displayName, status: MealConfiguration.status })
      .from(MealConfiguration)
      .where(eq(MealConfiguration.id, parsed.data.mealId))
      .limit(1);
    if (!meal || meal.status !== "ACTIVE") {
      return failure(c, "Meal not found or inactive", 404);
    }

    const id = crypto.randomUUID();
    await db.insert(GuestMeal).values({
      id,
      mealId: meal.id,
      userId: admin.id,
      guestName: `Guest (${meal.displayName})`,
      guestCount: parsed.data.guestCount,
      serviceDate,
      notes: parsed.data.notes ?? null,
    });
    const [created] = await db.select().from(GuestMeal).where(eq(GuestMeal.id, id)).limit(1);
    if (!created) return failure(c, "Guest meal not found", 404);

    const response = serializeGuestMeal(created);
    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.delete("/api/kitchen", async (c) => {
    const access = await requireKitchenAdmin(c);
    if (access.response) return access.response;

    const body = (await c.req.json().catch(() => ({}))) as { guestMealId?: unknown };
    const guestMealId = typeof body.guestMealId === "string" ? body.guestMealId.trim() : "";
    if (!guestMealId) return failure(c, "guestMealId is required", 400);

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: GuestMeal.id })
      .from(GuestMeal)
      .where(eq(GuestMeal.id, guestMealId))
      .limit(1);
    if (!existing) return failure(c, "Guest meal not found", 404);

    await db.delete(GuestMeal).where(eq(GuestMeal.id, guestMealId));
    const response = { deleted: true };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
