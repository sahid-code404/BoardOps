import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/lib/session";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().min(1).optional(),
  defaultUnitId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return err("Product not found", 404);

    // Check name uniqueness if changing
    if (data.name && data.name !== existing.name) {
      const nameExists = await db.product.findFirst({
        where: { name: data.name, NOT: { id } },
      });
      if (nameExists) return err("A product with this name already exists", 409);
    }

    if (data.defaultUnitId) {
      const unit = await db.unit.findUnique({ where: { id: data.defaultUnitId } });
      if (!unit) return err("Default unit not found", 404);
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.name) updateData.slug = slugify(data.name);
    if (data.isActive === false) updateData.archivedAt = new Date();
    if (data.isActive === true) updateData.archivedAt = null;

    const product = await db.product.update({
      where: { id },
      data: updateData,
      include: { defaultUnit: true },
    });
    await logAudit({
      actorId: admin.id,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: id,
      oldValue: existing,
      newValue: product,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(product);
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

    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return err("Product not found", 404);

    // Check if product is referenced by any purchase items
    const usageCount = await db.purchaseItem.count({ where: { productId: id } });
    if (usageCount > 0) {
      // Soft-archive instead of hard delete (historical purchases reference it)
      const product = await db.product.update({
        where: { id },
        data: { isActive: false, archivedAt: new Date() },
      });
      await logAudit({
        actorId: admin.id,
        action: "PRODUCT_ARCHIVE",
        entity: "Product",
        entityId: id,
        oldValue: existing,
        newValue: product,
        reason: `Used by ${usageCount} purchase item(s) — archived instead of deleted`,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      });
      return ok({ archived: true, usageCount });
    }

    // Not used — hard delete
    await db.product.delete({ where: { id } });
    await logAudit({
      actorId: admin.id,
      action: "PRODUCT_DELETE",
      entity: "Product",
      entityId: id,
      oldValue: existing,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
