import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;
    const meal = await db.mealConfiguration.findUnique({ where: { id } });
    if (!meal) return err("Meal not found", 404);
    return ok(meal);
  } catch (e) {
    return handleApiError(e);
  }
}

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

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await db.mealConfiguration.findUnique({ where: { id } });
    if (!existing) return err("Meal not found", 404);

    const updated = await db.mealConfiguration.update({
      where: { id },
      data,
    });
    await logAudit({
      actorId: user.id,
      action: "UPDATE",
      entity: "MealConfiguration",
      entityId: id,
      oldValue: existing,
      newValue: updated,
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const existing = await db.mealConfiguration.findUnique({ where: { id } });
    if (!existing) return err("Meal not found", 404);

    // Hard delete — cascade removes related meal entries, history, overrides, guest meals, preset items
    await db.mealConfiguration.delete({ where: { id } });

    await logAudit({
      actorId: user.id,
      action: "DELETE",
      entity: "MealConfiguration",
      entityId: id,
      oldValue: existing,
    });
    return ok({ success: true });
  } catch (e) {
    return handleApiError(e);
  }
}
