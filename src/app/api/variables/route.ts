import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function GET() {
  try {
    await requireAuth();
    const vars = await db.variable.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return ok(vars);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  key: z.string().min(2).regex(/^[a-z0-9_.-]+$/i, "Use letters, numbers, dots, underscores, dashes"),
  name: z.string().min(2),
  description: z.string().optional(),
  type: z.enum(["NUMBER", "CURRENCY", "PERCENTAGE", "TEXT", "BOOLEAN"]).default("NUMBER"),
  value: z.string(),
  unit: z.string().optional(),
  category: z.string().default("GENERAL"),
});

export async function POST(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const existing = await db.variable.findUnique({ where: { key: data.key } });
    if (existing) return err("Variable with this key already exists", 409);

    const v = await db.variable.create({ data: { ...data, isSystem: false, isProtected: false, status: "ACTIVE" } });
    await logAudit({
      actorId: user.id,
      action: "CREATE",
      entity: "Variable",
      entityId: v.id,
      newValue: v,
    });
    return ok(v, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
