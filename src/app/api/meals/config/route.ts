import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function GET() {
  try {
    const user = await requireAuth();
    // Admins see all meals (including archived); users see only active
    const meals = await db.mealConfiguration.findMany({
      where: user.role === "ADMIN" ? undefined : { status: "ACTIVE" },
      orderBy: [{ status: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return ok(meals);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  displayName: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().default("🍽️"),
  color: z.string().default("#8b5cf6"),
  mealType: z.string().default("REGULAR"),
  displayOrder: z.number().default(0),
  defaultState: z.enum(["ON", "OFF"]).default("ON"),
  defaultVisibility: z.enum(["VISIBLE", "HIDDEN"]).default("VISIBLE"),
  cutoffStrategy: z.enum(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]).default("SAME_DAY"),
  cutoffTime: z.string().default("16:00"),
  cutoffOffsetMinutes: z.number().default(0),
  startTime: z.string().default("08:00"),
  endTime: z.string().default("10:00"),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const existing = await db.mealConfiguration.findFirst({ where: { name: data.name } });
    if (existing) return err("A meal with this name already exists", 409);

    const meal = await db.mealConfiguration.create({ data: { ...data, status: "ACTIVE" } });
    await logAudit({
      actorId: user.id,
      action: "CREATE",
      entity: "MealConfiguration",
      entityId: meal.id,
      newValue: meal,
    });
    return ok(meal, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
