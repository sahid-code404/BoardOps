import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

// GET /api/holidays — list holidays (admin only)
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "ACTIVE";
    const type = url.searchParams.get("type");
    const limit = Number(url.searchParams.get("limit") || 100);

    const where: Record<string, unknown> = { status };
    if (type) where.type = type;

    const holidays = await db.holiday.findMany({
      where,
      orderBy: { startDate: "asc" },
      take: limit,
    });
    return ok(holidays);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(2, "Name is required").max(100),
  description: z.string().optional().nullable(),
  type: z.enum(["HOLIDAY", "FESTIVAL", "SPECIAL_MEAL", "BILLING_DAY", "REFUND_DAY", "MAINTENANCE"]).default("HOLIDAY"),
  startDate: z.string(), // ISO date
  endDate: z.string(), // ISO date
  mealsDisabled: z.boolean().default(true),
});

// POST /api/holidays — create a holiday (admin only)
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (isNaN(startDate.getTime())) return err("Invalid start date", 400);
    if (isNaN(endDate.getTime())) return err("Invalid end date", 400);
    if (endDate < startDate) return err("End date cannot be before start date", 400);

    const holiday = await db.holiday.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        type: data.type,
        startDate,
        endDate,
        mealsDisabled: data.mealsDisabled,
        createdBy: admin.id,
      },
    });

    await logAudit({
      actorId: admin.id,
      action: "HOLIDAY_CREATE",
      entity: "Holiday",
      entityId: holiday.id,
      newValue: holiday,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(holiday, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
