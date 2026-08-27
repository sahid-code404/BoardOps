import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";

/** POST /api/users/[id]/restore — restore a soft-deleted user from the deletion queue */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const user = await db.user.findUnique({ where: { id } });
    if (!user) return err("User not found", 404);
    if (!user.deletedAt) return err("This user is not in the deletion queue", 422);

    const restored = await db.user.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        room: true,
        gender: true,
        emergencyContact: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
        deletedAt: true,
        deletionReason: true,
      },
    });

    await createNotification({
      userId: id,
      title: "Account Restored",
      description: "Your account has been restored and is now active.",
      type: "SUCCESS",
      priority: "HIGH",
      route: "dashboard",
    });

    await logAudit({
      actorId: admin.id,
      action: "USER_RESTORE",
      entity: "User",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: user.deletedAt },
      newValue: { status: "ACTIVE" },
    });

    return ok(restored);
  } catch (e) {
    return handleApiError(e);
  }
}
