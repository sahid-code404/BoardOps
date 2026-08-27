import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/lib/session";

const createSchema = z.object({
  name: z.string().min(1, "Product name is required").max(100),
  category: z.string().min(1).default("GENERAL"),
  defaultUnitId: z.string().optional().nullable(),
});

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const category = url.searchParams.get("category");

    const products = await db.product.findMany({
      where: {
        ...(includeArchived ? {} : { isActive: true }),
        ...(category ? { category } : {}),
      },
      include: { defaultUnit: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return ok(products);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const slug = slugify(data.name);
    const existing = await db.product.findFirst({
      where: { OR: [{ name: data.name }, { slug }] },
    });
    if (existing) return err("A product with this name already exists", 409);

    if (data.defaultUnitId) {
      const unit = await db.unit.findUnique({ where: { id: data.defaultUnitId } });
      if (!unit) return err("Default unit not found", 404);
    }

    const product = await db.product.create({
      data: {
        name: data.name,
        slug,
        category: data.category,
        defaultUnitId: data.defaultUnitId ?? null,
      },
      include: { defaultUnit: true },
    });
    await logAudit({
      actorId: admin.id,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: product.id,
      newValue: product,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(product);
  } catch (e) {
    return handleApiError(e);
  }
}
