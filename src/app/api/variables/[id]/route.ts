import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const schema = z.object({
      name: z.string().optional(),
      value: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    });
    const data = schema.parse(body);

    const existing = await db.variable.findUnique({ where: { id } });
    if (!existing) return err("Variable not found", 404);
    if (existing.isProtected && data.value !== existing.value) {
      // allow update of value but keep protected flag
    }

    const updated = await db.variable.update({ where: { id }, data });
    await logAudit({
      actorId: user.id,
      action: "UPDATE",
      entity: "Variable",
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
    const existing = await db.variable.findUnique({ where: { id } });
    if (!existing) return err("Variable not found", 404);
    if (existing.isProtected) return err("System-protected variables cannot be deleted", 422);

    await db.variable.update({ where: { id }, data: { status: "ARCHIVED" } });
    await logAudit({
      actorId: user.id,
      action: "ARCHIVE",
      entity: "Variable",
      entityId: id,
      oldValue: existing,
    });
    return ok({ success: true });
  } catch (e) {
    return handleApiError(e);
  }
}
