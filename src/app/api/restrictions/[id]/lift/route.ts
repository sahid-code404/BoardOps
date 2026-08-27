import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { liftRestriction } from "@/lib/restriction-engine";
import { z } from "zod";

const liftSchema = z.object({
  reason: z.string().min(5, "Lift reason must be at least 5 characters"),
});

// POST /api/restrictions/[id]/lift — lift a restriction (admin only)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = liftSchema.parse(body);

    const existing = await db.restriction.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!existing) return err("Restriction not found", 404);
    if (existing.status === "LIFTED") return err("Restriction is already lifted", 400);

    const updated = await liftRestriction(id, admin.id, data.reason);
    if (!updated) return err("Failed to lift restriction", 500);

    await logAudit({
      actorId: admin.id,
      action: "RESTRICTION_LIFT",
      entity: "Restriction",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      reason: data.reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
