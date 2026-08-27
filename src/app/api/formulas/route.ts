import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { evaluateFormula, validateFormula, extractVarSlugs } from "@/lib/formula-engine";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// GET /api/formulas — list all formulas (with their versions)
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    await requireRole("ADMIN");
    const formulas = await db.formula.findMany({
      where: { status: "ACTIVE" },
      orderBy: { category: "asc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 5, // latest 5 versions for the version-history drawer
          include: { user: { select: { name: true, email: true } } },
        },
      },
    });
    return ok(formulas);
  } catch (e) {
    return handleApiError(e);
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/formulas — create a new formula
// ─────────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(2, "Name too short").max(100),
  key: z.string().min(3, "Key too short").max(80).regex(/^[a-zA-Z0-9_.-]+$/, "Key must be alphanumeric + . _ -"),
  description: z.string().optional(),
  expression: z.string().min(1, "Expression is required"),
  returnType: z.enum(["CURRENCY", "NUMBER", "PERCENTAGE"]).default("CURRENCY"),
  category: z.string().default("BILLING"),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    // Validate the expression syntax
    const validation = validateFormula(data.expression);
    if (!validation.valid) {
      return err(`Invalid formula: ${validation.error}`, 422);
    }

    // Check key uniqueness
    const existing = await db.formula.findUnique({ where: { key: data.key } });
    if (existing) return err("A formula with this key already exists", 409);

    // Verify all referenced variable slugs exist (warn but don't block — the admin
    // may create the variables after the formula)
    const slugs = extractVarSlugs(data.expression);
    const missingVars: string[] = [];
    for (const slug of slugs) {
      const v = await db.variable.findUnique({ where: { key: slug } });
      if (!v) missingVars.push(slug);
    }

    // Create the formula + first version in a transaction
    const formula = await db.$transaction(async (tx) => {
      const f = await tx.formula.create({
        data: {
          name: data.name,
          key: data.key,
          description: data.description ?? null,
          expression: data.expression,
          returnType: data.returnType,
          category: data.category,
          version: 1,
          status: "ACTIVE",
        },
      });
      await tx.formulaVersion.create({
        data: {
          formulaId: f.id,
          version: 1,
          expression: data.expression,
          changedBy: admin.id,
          changeNote: "Initial version",
        },
      });
      return f;
    });

    await logAudit({
      actorId: admin.id,
      action: "FORMULA_CREATE",
      entity: "Formula",
      entityId: formula.id,
      newValue: { name: data.name, key: data.key, expression: data.expression, slugs, missingVars },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ ...formula, referencedSlugs: slugs, missingVariables: missingVars });
  } catch (e) {
    return handleApiError(e);
  }
}
