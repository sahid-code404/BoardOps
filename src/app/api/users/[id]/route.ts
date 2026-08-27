import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { hashPassword } from "@/lib/auth";
import { getDeletionDate } from "@/lib/user-cleanup";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["APPROVE", "SUSPEND", "ACTIVATE", "DEACTIVATE", "ARCHIVE", "RESTORE", "ASSIGN_ROLE"]),
  role: z.string().optional(),
  reason: z.string().optional(),
});

const editSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  email: z.string().email("Invalid email").optional(),
  phone: z.string().min(8, "Invalid phone").optional().nullable(),
  room: z.string().max(20).optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  emergencyContact: z.string().max(30).optional().nullable(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const { action, role, reason } = actionSchema.parse(body);

    const user = await db.user.findUnique({ where: { id } });
    if (!user) return err("User not found", 404);

    let newStatus = user.status;
    let newRole = user.role;
    let notifyType: "SUCCESS" | "WARNING" | "DANGER" | "INFO" = "INFO";
    let notifyTitle = "";
    let notifyDesc = "";

    switch (action) {
      case "APPROVE":
        newStatus = "ACTIVE";
        notifyType = "SUCCESS";
        notifyTitle = "Account Approved";
        notifyDesc = "Your account has been approved. Welcome to BoardOps!";
        break;
      case "SUSPEND":
        newStatus = "SUSPENDED";
        notifyType = "DANGER";
        notifyTitle = "Account Suspended";
        notifyDesc = reason || "Your account has been suspended. Contact administration.";
        break;
      case "ACTIVATE":
        newStatus = "ACTIVE";
        notifyType = "SUCCESS";
        notifyTitle = "Account Activated";
        notifyDesc = "Your account is now active.";
        break;
      case "DEACTIVATE":
        newStatus = "INACTIVE";
        notifyType = "WARNING";
        notifyTitle = "Account Deactivated";
        notifyDesc = reason || "Your account has been deactivated.";
        break;
      case "ARCHIVE":
        newStatus = "ARCHIVED";
        notifyType = "WARNING";
        notifyTitle = "Account Archived";
        notifyDesc = reason || "Your account has been archived.";
        break;
      case "RESTORE":
        newStatus = "ACTIVE";
        notifyType = "SUCCESS";
        notifyTitle = "Account Restored";
        notifyDesc = "Your account has been restored.";
        break;
      case "ASSIGN_ROLE":
        if (!role) return err("Role is required", 400);
        // Prevent the last admin from demoting themselves — system would collapse
        if (user.role === "ADMIN" && role !== "ADMIN") {
          const adminCount = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE", deletedAt: null } });
          if (adminCount <= 1) {
            return err("Cannot demote the last remaining admin. Promote another user to admin first.", 422);
          }
        }
        newRole = role;
        notifyType = "INFO";
        notifyTitle = "Role Updated";
        notifyDesc = `Your role is now ${role}.`;
        break;
    }

    const updated = await db.user.update({
      where: { id },
      data: { status: newStatus, role: newRole },
    });

    // PRD Module 03 — DEC-015: keep the RegistrationRequest history complete.
    // On APPROVE / REJECT-equivalent actions, update the latest request so the
    // review cycle has a final status (APPROVED / etc.).
    if (action === "APPROVE" || action === "ARCHIVE" || action === "DEACTIVATE") {
      const latest = await db.registrationRequest.findFirst({
        where: { userId: id },
        orderBy: { cycle: "desc" },
      });
      if (latest && latest.status === "PENDING_REVIEW") {
        await db.registrationRequest.update({
          where: { id: latest.id },
          data: {
            status: action === "APPROVE" ? "APPROVED" : "REJECTED",
            reviewedBy: admin.id,
            reviewedAt: new Date(),
            reason,
          },
        });
      }
    }

    if (notifyTitle) {
      await createNotification({
        userId: id,
        title: notifyTitle,
        description: notifyDesc,
        type: notifyType,
        priority: "HIGH",
        route: "dashboard",
      });
    }

    await logAudit({
      actorId: admin.id,
      action: `USER_${action}`,
      entity: "User",
      entityId: id,
      oldValue: { status: user.status, role: user.role },
      newValue: { status: newStatus, role: newRole, reason },
      reason,
    });

    return ok({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status,
    });
  } catch (e) {
    return handleApiError(e);
  }
}

/** PUT /api/users/[id] — admin edits a user's credentials */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = editSchema.parse(body);

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) return err("User not found", 404);

    // Check email uniqueness if being changed
    if (data.email && data.email !== existing.email) {
      const emailExists = await db.user.findUnique({ where: { email: data.email } });
      if (emailExists) return err("This email is already in use", 409);
    }

    // Check phone uniqueness if being changed
    if (data.phone && data.phone !== existing.phone) {
      const phoneExists = await db.user.findFirst({
        where: { phone: data.phone, NOT: { id } },
      });
      if (phoneExists) return err("This phone number is already in use", 409);
    }

    // Build update data — only include provided fields
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone || null;
    if (data.room !== undefined) updateData.room = data.room || null;
    if (data.gender !== undefined) updateData.gender = data.gender || null;
    if (data.emergencyContact !== undefined) updateData.emergencyContact = data.emergencyContact || null;
    if (data.password) updateData.passwordHash = hashPassword(data.password);

    const updated = await db.user.update({
      where: { id },
      data: updateData,
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
      },
    });

    // Notify the user that their account was updated
    await createNotification({
      userId: id,
      title: "Account Updated",
      description: data.password
        ? "Your account credentials have been updated by an administrator, including a new password."
        : "Your account details have been updated by an administrator.",
      type: "INFO",
      priority: "HIGH",
      route: "profile",
    });

    await logAudit({
      actorId: admin.id,
      action: "USER_EDIT",
      entity: "User",
      entityId: id,
      oldValue: {
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
        room: existing.room,
      },
      newValue: {
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        room: updated.room,
        passwordChanged: !!data.password,
      },
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

const deleteSchema = z.object({
  reason: z.string().min(3, "A reason is required for deletion"),
});

/** DELETE /api/users/[id] — soft-delete user (enters 7-day restoration queue) */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { reason } = deleteSchema.parse(body);

    const user = await db.user.findUnique({ where: { id } });
    if (!user) return err("User not found", 404);
    if (user.deletedAt) return err("This user is already in the deletion queue", 422);
    if (user.role === "ADMIN" && admin.role === "ADMIN") {
      return err("Admins cannot delete other admins", 403);
    }

    const deletionDate = getDeletionDate();

    const updated = await db.user.update({
      where: { id },
      data: {
        deletedAt: deletionDate,
        deletedBy: admin.id,
        deletionReason: reason,
        status: "ARCHIVED",
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

    // Revoke all active sessions immediately
    await db.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await createNotification({
      userId: id,
      title: "Account Scheduled for Deletion",
      description: `Your account is scheduled for permanent deletion in 7 days. Reason: ${reason}. Contact an administrator if you believe this is a mistake.`,
      type: "DANGER",
      priority: "URGENT",
      route: "profile",
    });

    await logAudit({
      actorId: admin.id,
      action: "USER_DELETE",
      entity: "User",
      entityId: id,
      oldValue: { status: user.status },
      newValue: { status: "ARCHIVED", deletedAt: deletionDate, reason },
      reason,
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
