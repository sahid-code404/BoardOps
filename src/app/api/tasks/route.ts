import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";

// GET /api/tasks — list background tasks (admin only)
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const tasks = await db.backgroundTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });
    return ok(tasks);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  type: z.enum(["MONTHLY_CLOSING", "REPORT_EXPORT", "SESSION_CLEANUP", "BILL_GENERATION", "ANNOUNCEMENT_SCHEDULE"]),
  payload: z.record(z.string(), z.unknown()).optional(),
  scheduledFor: z.string().optional(),
});

// POST /api/tasks — create a new background task (admin only)
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const task = await db.backgroundTask.create({
      data: {
        type: data.type,
        status: "QUEUED",
        payload: data.payload ? JSON.stringify(data.payload) : null,
        triggeredBy: admin.id,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
      },
    });

    return ok(task, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
