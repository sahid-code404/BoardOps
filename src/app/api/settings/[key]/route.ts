import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ key: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { key } = await ctx.params;
    const existing = await db.setting.findUnique({ where: { key } });
    if (!existing) return err("Setting not found", 404);
    await db.setting.delete({ where: { key } });
    await logAudit({
      actorId: user.id,
      action: "DELETE",
      entity: "Setting",
      entityId: key,
      oldValue: existing,
    });
    return ok({ success: true });
  } catch (e) {
    return handleApiError(e);
  }
}
