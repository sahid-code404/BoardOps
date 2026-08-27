import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  institutionUserId: z.string().min(1, "Institution User ID is required").optional(),
  phone: z.string().min(8, "Enter a valid phone number").optional(),
  room: z.string().min(1, "Room number is required").optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
});

/**
 * POST /api/auth/resubmit
 *
 * Called when a user (whose registration had `changesRequested` set by an
 * admin) updates their fields and resubmits for review. Creates a new
 * RegistrationRequest (cycle = previous + 1), clears the changes-requested
 * state, and notifies all admins.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);
    const normalizedEmail = data.email.toLowerCase();

    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return err("User not found", 404);
    if (!user.changesRequested) {
      return err("No changes were requested for this account", 422);
    }

    // If the user is changing institutionUserId or phone, ensure uniqueness.
    if (data.institutionUserId && data.institutionUserId !== user.institutionUserId) {
      const taken = await db.user.findFirst({
        where: { institutionUserId: data.institutionUserId, NOT: { id: user.id } },
      });
      if (taken) return err("This Institution User ID is already taken", 409);
    }
    if (data.phone && data.phone !== user.phone) {
      const taken = await db.user.findFirst({
        where: { phone: data.phone, NOT: { id: user.id } },
      });
      if (taken) return err("This phone number is already registered", 409);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.institutionUserId !== undefined) updateData.institutionUserId = data.institutionUserId;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.room !== undefined) updateData.room = data.room;
    if (data.gender !== undefined) updateData.gender = data.gender ?? null;
    // Clear changes-requested state — user has now addressed the request.
    updateData.changesRequested = null;
    updateData.changesRequestReason = null;
    updateData.changesRequestedAt = null;
    updateData.changesRequestedBy = null;
    updateData.status = "PENDING";
    // Re-arm rejectionReason clearing for cleanliness — but only if it was set
    // by an earlier reject cycle that we're recovering from. We keep it
    // intact otherwise (the admin may want a history of why).
    if (user.rejectionReason && user.status === "ARCHIVED") {
      updateData.rejectionReason = null;
      updateData.deletedAt = null;
      updateData.deletedBy = null;
      updateData.deletionReason = null;
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: updateData,
    });

    // Find the previous cycle to compute the next cycle number.
    const previous = await db.registrationRequest.findFirst({
      where: { userId: user.id },
      orderBy: { cycle: "desc" },
      select: { cycle: true },
    });
    const nextCycle = (previous?.cycle ?? 0) + 1;

    // Mark the previous request as RESUBMITTED (audit trail), then create the
    // new PENDING_REVIEW request.
    if (previous) {
      await db.registrationRequest.updateMany({
        where: { userId: user.id, cycle: previous.cycle },
        data: { status: "RESUBMITTED" },
      });
    }
    await db.registrationRequest.create({
      data: {
        userId: user.id,
        cycle: nextCycle,
        status: "PENDING_REVIEW",
        fields: JSON.stringify({
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          room: updated.room,
          gender: updated.gender,
          institutionName: updated.institutionName,
          institutionUserId: updated.institutionUserId,
        }),
      },
    });

    // Notify all admins (SUPER_ADMIN or ADMIN) about the resubmission.
    const admins = await db.user.findMany({
      where: {
        role: { in: ["ADMIN", "SUPER_ADMIN"] },
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        createNotification({
          userId: a.id,
          title: "New registration resubmitted",
          description: `${updated.name} resubmitted their registration for review.`,
          type: "INFO",
          priority: "HIGH",
          route: "users",
        })
      )
    );

    await logAudit({
      actorId: user.id,
      action: "USER_RESUBMITTED",
      entity: "User",
      entityId: user.id,
      newValue: {
        cycle: nextCycle,
        changedFields: Object.keys(updateData).filter(
          (k) => !["changesRequested", "changesRequestReason", "changesRequestedAt", "changesRequestedBy"].includes(k)
        ),
      },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ userId: updated.id, status: "PENDING", cycle: nextCycle });
  } catch (e) {
    return handleApiError(e);
  }
}
