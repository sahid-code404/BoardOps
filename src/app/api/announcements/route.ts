import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

/**
 * GET /api/announcements
 * - Admin: sees all announcements (DRAFT + PUBLISHED + ARCHIVED)
 * - User: sees only PUBLISHED announcements targeted to ALL or RESIDENTS,
 *   that haven't expired yet.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Number(url.searchParams.get("limit") || 50);

    const where: Record<string, unknown> = {};

    if (user.role === "USER") {
      // Residents see published, non-expired, targeted to ALL or RESIDENTS
      where.status = "PUBLISHED";
      where.targetAudience = { in: ["ALL", "RESIDENTS"] };
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    } else {
      // Admin can filter by status
      if (status) where.status = status;
    }

    const announcements = await db.announcement.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return ok(announcements);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  body: z.string().min(5, "Body must be at least 5 characters").max(5000),
  type: z.enum(["INFO", "WARNING", "MAINTENANCE", "EVENT"]).default("INFO"),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  targetAudience: z.enum(["ALL", "RESIDENTS", "ADMINS"]).default("ALL"),
  isPinned: z.boolean().default(true),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).default("PUBLISHED"),
  expiresAt: z.string().optional().nullable(), // ISO date string
});

/**
 * POST /api/announcements — create an announcement (admin only)
 * When status=PUBLISHED, also sends personal notifications to all targeted users.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const publishedAt = data.status === "PUBLISHED" ? new Date() : null;

    const announcement = await db.announcement.create({
      data: {
        title: data.title,
        body: data.body,
        type: data.type,
        priority: data.priority,
        targetAudience: data.targetAudience,
        isPinned: data.isPinned,
        status: data.status,
        publishedAt,
        expiresAt,
        createdBy: admin.id,
      },
      include: { user: { select: { name: true } } },
    });

    // If published, send personal notifications to all targeted users
    if (data.status === "PUBLISHED") {
      const targetWhere: Record<string, unknown> = {
        deletedAt: null,
        status: "ACTIVE",
      };
      if (data.targetAudience === "RESIDENTS") {
        targetWhere.role = "USER";
      } else if (data.targetAudience === "ADMINS") {
        targetWhere.role = { in: ["ADMIN", "SUPER_ADMIN"] };
      }

      const targetUsers = await db.user.findMany({
        where: targetWhere,
        select: { id: true },
      });

      // Create notifications in bulk
      if (targetUsers.length > 0) {
        await db.notification.createMany({
          data: targetUsers.map((u) => ({
            userId: u.id,
            title: `📢 ${announcement.title}`,
            description: announcement.body.slice(0, 200),
            type: data.type === "WARNING" ? "WARNING" : data.type === "MAINTENANCE" ? "WARNING" : "INFO",
            priority: data.priority,
            route: "announcements",
          })),
        });
      }
    }

    await logAudit({
      actorId: admin.id,
      action: "ANNOUNCEMENT_CREATE",
      entity: "Announcement",
      entityId: announcement.id,
      newValue: { title: data.title, status: data.status, targetAudience: data.targetAudience },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(announcement, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
