import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

const schema = z.object({
  reason: z.string().min(3, "A reason is required (min 3 characters)"),
});

/**
 * PATCH /api/users/[id]/reject
 *
 * Admin-only: rejects a PENDING user's registration. The user is moved to
 * ARCHIVED status (per PRD — preserves the application for audit), with
 * `rejectionReason`, soft-delete metadata (`deletedAt`, `deletedBy`,
 * `deletionReason`) set so it appears in the deletion queue too. The latest
 * RegistrationRequest is marked REJECTED with the admin's reason.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const { reason } = schema.parse(body);

    const user = await db.user.findUnique({ where: { id } });
    if (!user) return err("User not found", 404);
    if (user.status !== "PENDING") {
      return err("Only pending users can be rejected", 422);
    }

    const now = new Date();

    await db.user.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        rejectionReason: reason,
        deletedAt: now,
        deletedBy: admin.id,
        deletionReason: `Rejected: ${reason}`,
      },
    });

    const latest = await db.registrationRequest.findFirst({
      where: { userId: id },
      orderBy: { cycle: "desc" },
    });
    if (latest) {
      await db.registrationRequest.update({
        where: { id: latest.id },
        data: {
          status: "REJECTED",
          reviewedBy: admin.id,
          reviewedAt: now,
          reason,
        },
      });
    }

    await createNotification({
      userId: id,
      title: "Registration rejected",
      description: reason,
      type: "DANGER",
      priority: "HIGH",
      route: "registration-status",
    });

    await logAudit({
      actorId: admin.id,
      action: "USER_REJECTED",
      entity: "User",
      entityId: id,
      oldValue: { status: user.status },
      newValue: { status: "ARCHIVED", reason },
      reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ id, status: "ARCHIVED" });
  } catch (e) {
    return handleApiError(e);
  }
}
