import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional().nullable(),
  type: z.enum(["HOLIDAY", "FESTIVAL", "SPECIAL_MEAL", "BILLING_DAY", "REFUND_DAY", "MAINTENANCE"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  mealsDisabled: z.boolean().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await db.holiday.findUnique({ where: { id } });
    if (!existing) return err("Holiday not found", 404);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.mealsDisabled !== undefined) updateData.mealsDisabled = data.mealsDisabled;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.startDate) {
      const d = new Date(data.startDate);
      if (isNaN(d.getTime())) return err("Invalid start date", 400);
      updateData.startDate = d;
    }
    if (data.endDate) {
      const d = new Date(data.endDate);
      if (isNaN(d.getTime())) return err("Invalid end date", 400);
      updateData.endDate = d;
    }

    // Validate date range
    const start = updateData.startDate as Date || existing.startDate;
    const end = updateData.endDate as Date || existing.endDate;
    if (end < start) return err("End date cannot be before start date", 400);

    const updated = await db.holiday.update({ where: { id }, data: updateData });

    await logAudit({
      actorId: admin.id,
      action: "HOLIDAY_UPDATE",
      entity: "Holiday",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.holiday.findUnique({ where: { id } });
    if (!existing) return err("Holiday not found", 404);

    // Soft-archive instead of hard delete (historical records may reference it)
    const updated = await db.holiday.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });

    await logAudit({
      actorId: admin.id,
      action: "HOLIDAY_ARCHIVE",
      entity: "Holiday",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ archived: true });
  } catch (e) {
    return handleApiError(e);
  }
}
