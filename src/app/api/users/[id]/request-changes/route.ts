import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

const ALLOWED_FIELDS = [
  "name",
  "institutionUserId",
  "phone",
  "email",
  "room",
  "gender",
] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

const schema = z.object({
  fields: z
    .array(z.string())
    .min(1, "Select at least one field to correct")
    .refine(
      (arr) => arr.every((f) => ALLOWED_FIELDS.includes(f as AllowedField)),
      "One or more selected fields are invalid"
    ),
  reason: z.string().min(3, "A reason is required (min 3 characters)"),
});

/**
 * PATCH /api/users/[id]/request-changes
 *
 * Admin-only: marks a PENDING user's registration as needing changes. Sets
 * `changesRequested` (JSON array of field keys) and `changesRequestReason`
 * on the user, updates the latest RegistrationRequest status to
 * CHANGES_REQUESTED, notifies the user, and logs an audit entry.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const { fields, reason } = schema.parse(body);

    const user = await db.user.findUnique({ where: { id } });
    if (!user) return err("User not found", 404);
    if (user.status !== "PENDING") {
      return err("Changes can only be requested for pending users", 422);
    }

    await db.user.update({
      where: { id },
      data: {
        changesRequested: JSON.stringify(fields),
        changesRequestReason: reason,
        changesRequestedAt: new Date(),
        changesRequestedBy: admin.id,
      },
    });

    // Update the latest RegistrationRequest for this user.
    const latest = await db.registrationRequest.findFirst({
      where: { userId: id },
      orderBy: { cycle: "desc" },
    });
    if (latest) {
      await db.registrationRequest.update({
        where: { id: latest.id },
        data: {
          status: "CHANGES_REQUESTED",
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          fieldsNeedingCorrection: JSON.stringify(fields),
          reason,
        },
      });
    }

    await createNotification({
      userId: id,
      title: "Changes requested for your registration",
      description: reason,
      type: "WARNING",
      priority: "HIGH",
      route: "registration-status",
    });

    await logAudit({
      actorId: admin.id,
      action: "USER_REQUEST_CHANGES",
      entity: "User",
      entityId: id,
      newValue: { fields, reason },
      reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ id, status: "PENDING", changesRequested: fields });
  } catch (e) {
    return handleApiError(e);
  }
}
