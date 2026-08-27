import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(5).max(5000).optional(),
  type: z.enum(["INFO", "WARNING", "MAINTENANCE", "EVENT"]).optional(),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).optional(),
  targetAudience: z.enum(["ALL", "RESIDENTS", "ADMINS"]).optional(),
  isPinned: z.boolean().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  expiresAt: z.string().optional().nullable(),
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

    const existing = await db.announcement.findUnique({ where: { id } });
    if (!existing) return err("Announcement not found", 404);

    // PRD: Published announcements cannot be edited. Corrections require a new version.
    if (existing.status === "PUBLISHED" && (data.title || data.body)) {
      return err("Published announcements cannot be edited. Archive this one and create a new announcement to issue a correction.", 422);
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.body !== undefined) updateData.body = data.body;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.targetAudience !== undefined) updateData.targetAudience = data.targetAudience;
    if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === "PUBLISHED" && !existing.publishedAt) {
        updateData.publishedAt = new Date();
      }
      if (data.status === "ARCHIVED") {
        updateData.isPinned = false;
      }
    }
    if (data.expiresAt !== undefined) {
      updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    const updated = await db.announcement.update({
      where: { id },
      data: updateData,
      include: { user: { select: { name: true } } },
    });

    await logAudit({
      actorId: admin.id,
      action: "ANNOUNCEMENT_UPDATE",
      entity: "Announcement",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(updated);
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

    const existing = await db.announcement.findUnique({ where: { id } });
    if (!existing) return err("Announcement not found", 404);

    // Archive instead of hard delete (preserves communication history)
    const updated = await db.announcement.update({
      where: { id },
      data: { status: "ARCHIVED", isPinned: false },
    });

    await logAudit({
      actorId: admin.id,
      action: "ANNOUNCEMENT_ARCHIVE",
      entity: "Announcement",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ archived: true });
  } catch (e) {
    return handleApiError(e);
  }
}
