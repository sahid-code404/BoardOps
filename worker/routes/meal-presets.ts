import { asc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { MealConfiguration, MealPreset, MealPresetItem } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

function failure(c: Context<BoardOpsEnv>, error: string, status: 401) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
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

export function registerMealPresetRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/meals/presets", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const db = createDatabase(c.env.DB);
    const presets = await db.select().from(MealPreset).orderBy(asc(MealPreset.name));
    const itemRows = await db
      .select({
        id: MealPresetItem.id,
        presetId: MealPresetItem.presetId,
        mealId: MealPresetItem.mealId,
        state: MealPresetItem.state,
        meal: MealConfiguration,
      })
      .from(MealPresetItem)
      .innerJoin(MealConfiguration, eq(MealPresetItem.mealId, MealConfiguration.id));

    const itemsByPreset = new Map<string, Array<{
      id: string;
      presetId: string;
      mealId: string;
      state: string;
      meal: ReturnType<typeof serializeMeal>;
    }>>();

    for (const row of itemRows) {
      const items = itemsByPreset.get(row.presetId) ?? [];
      items.push({
        id: row.id,
        presetId: row.presetId,
        mealId: row.mealId,
        state: row.state,
        meal: serializeMeal(row.meal),
      });
      itemsByPreset.set(row.presetId, items);
    }

    const response = presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      isSystem: preset.isSystem,
      createdAt: databaseDateToIso(preset.createdAt),
      updatedAt: databaseDateToIso(preset.updatedAt),
      items: itemsByPreset.get(preset.id) ?? [],
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
