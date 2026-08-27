import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/lib/session";

const createSchema = z.object({
  name: z.string().min(1, "Unit name is required").max(20),
  category: z.enum(["WEIGHT", "VOLUME", "QUANTITY", "OTHER"]).default("QUANTITY"),
  isActive: z.boolean().default(true),
});

export async function GET() {
  try {
    const units = await db.unit.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return ok(units);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const existing = await db.unit.findUnique({ where: { name: data.name } });
    if (existing) return err("A unit with this name already exists", 409);

    const unit = await db.unit.create({ data });
    await logAudit({
      actorId: admin.id,
      action: "UNIT_CREATE",
      entity: "Unit",
      entityId: unit.id,
      newValue: data,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(unit);
  } catch (e) {
    return handleApiError(e);
  }
}
