import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/lib/session";

const updateSchema = z.object({
  category: z.enum(["WEIGHT", "VOLUME", "QUANTITY", "OTHER"]).optional(),
  isActive: z.boolean().optional(),
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

    const existing = await db.unit.findUnique({ where: { id } });
    if (!existing) return err("Unit not found", 404);

    const unit = await db.unit.update({ where: { id }, data });
    await logAudit({
      actorId: admin.id,
      action: "UNIT_UPDATE",
      entity: "Unit",
      entityId: id,
      oldValue: existing,
      newValue: data,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(unit);
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

    const existing = await db.unit.findUnique({ where: { id } });
    if (!existing) return err("Unit not found", 404);

    // Check if any products use this unit as default
    const productsUsing = await db.product.count({ where: { defaultUnitId: id } });
    if (productsUsing > 0) {
      return err(`Cannot delete: ${productsUsing} product(s) use this unit as their default. Reassign them first.`, 409);
    }

    // Soft-deactivate instead of hard delete (units may be referenced by historical purchase items)
    const unit = await db.unit.update({ where: { id }, data: { isActive: false } });
    await logAudit({
      actorId: admin.id,
      action: "UNIT_DEACTIVATE",
      entity: "Unit",
      entityId: id,
      oldValue: existing,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(unit);
  } catch (e) {
    return handleApiError(e);
  }
}
