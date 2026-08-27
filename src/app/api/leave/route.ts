import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { createNotification } from "@/lib/notify";
import { z } from "zod";

/**
 * Leave Application API
 *
 * GET /api/leave
 *   - Regular users see their own applications
 *   - Admins see all applications
 *
 * POST /api/leave
 *   - Creates a new leave application with status "PENDING"
 *   - Notifies all admins
 */

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export async function GET() {
  try {
    const user = await requireAuth();
    const where = user.role === "USER" ? { userId: user.id } : undefined;
    const applications = await db.leaveApplication.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(applications);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(3).max(500),
  mealType: z.enum(["ALL", "SPECIFIC"]).default("ALL"),
  mealIds: z.array(z.string()).optional().default([]),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const data = createSchema.parse(body);

    const start = parseDateStr(data.startDate);
    const end = parseDateStr(data.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (end < start) {
      return err("End date must be on or after start date", 400);
    }

    // If SPECIFIC meals are selected, validate that the mealIds exist
    if (data.mealType === "SPECIFIC") {
      if (!data.mealIds || data.mealIds.length === 0) {
        return err("Select at least one meal when meal type is SPECIFIC", 400);
      }
      const validMeals = await db.mealConfiguration.findMany({
        where: { id: { in: data.mealIds }, status: "ACTIVE" },
        select: { id: true },
      });
      if (validMeals.length !== data.mealIds.length) {
        return err("One or more selected meals are invalid or inactive", 400);
      }
    }

    const application = await db.leaveApplication.create({
      data: {
        userId: user.id,
        startDate: start,
        endDate: end,
        reason: data.reason,
        mealType: data.mealType,
        mealIds: JSON.stringify(data.mealIds || []),
        status: "PENDING",
      },
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
      },
    });

    // Notify all admins
    const admins = await db.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        createNotification({
          userId: a.id,
          title: "New leave application",
          description: `${user.name} applied for leave from ${data.startDate} to ${data.endDate}.`,
          type: "INFO",
          priority: "NORMAL",
          route: "/kitchen",
        })
      )
    );

    return ok(application, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
