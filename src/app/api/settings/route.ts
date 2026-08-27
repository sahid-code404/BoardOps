import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const includePrivate = user.role === "ADMIN";

    const where = {
      ...(category ? { category } : {}),
      ...(includePrivate ? {} : { isPublic: true }),
    };
    const settings = await db.setting.findMany({ where, orderBy: { category: "asc" } });
    return ok(settings);
  } catch (e) {
    return handleApiError(e);
  }
}

const upsertSchema = z.object({
  key: z.string(),
  value: z.string(),
  category: z.string().default("GENERAL"),
  type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "JSON"]).default("TEXT"),
  description: z.string().optional(),
  isPublic: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    await requireRole("ADMIN");
    const body = await req.json();
    const data = upsertSchema.parse(body);
    const setting = await db.setting.upsert({
      where: { key: data.key },
      update: { value: data.value, category: data.category, type: data.type, description: data.description, isPublic: data.isPublic },
      create: data,
    });
    return ok(setting);
  } catch (e) {
    return handleApiError(e);
  }
}
