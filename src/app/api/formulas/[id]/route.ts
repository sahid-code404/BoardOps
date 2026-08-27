import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { validateFormula, extractVarSlugs } from "@/lib/formula-engine";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional().nullable(),
  expression: z.string().min(1).optional(),
  returnType: z.enum(["CURRENCY", "NUMBER", "PERCENTAGE"]).optional(),
  category: z.string().optional(),
  changeNote: z.string().optional(), // required when expression changes — creates a new version
});

// PATCH /api/formulas/[id] — update a formula. If the expression changes, a new version is created.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await db.formula.findUnique({ where: { id } });
    if (!existing) return err("Formula not found", 404);

    // If the expression is changing, validate + version it
    if (data.expression && data.expression !== existing.expression) {
      const expression = data.expression;
      const validation = validateFormula(expression);
      if (!validation.valid) {
        return err(`Invalid formula: ${validation.error}`, 422);
      }
      if (!data.changeNote || !data.changeNote.trim()) {
        return err("A change note is required when updating the expression (creates a new version)", 400);
      }

      const changeNote = data.changeNote.trim();
      const newVersion = existing.version + 1;
      const slugs = extractVarSlugs(expression);
      const missingVars: string[] = [];
      for (const slug of slugs) {
        const v = await db.variable.findUnique({ where: { key: slug } });
        if (!v) missingVars.push(slug);
      }

      const updated = await db.$transaction(async (tx) => {
        // Archive the old version's status? No — keep all versions queryable.
        const f = await tx.formula.update({
          where: { id },
          data: {
            name: data.name ?? existing.name,
            description: data.description ?? existing.description,
            expression,
            returnType: data.returnType ?? existing.returnType,
            category: data.category ?? existing.category,
            version: newVersion,
          },
        });
        await tx.formulaVersion.create({
          data: {
            formulaId: id,
            version: newVersion,
            expression,
            changedBy: admin.id,
            changeNote,
          },
        });
        return f;
      });

      await logAudit({
        actorId: admin.id,
        action: "FORMULA_UPDATE_VERSION",
        entity: "Formula",
        entityId: id,
        oldValue: { version: existing.version, expression: existing.expression },
        newValue: { version: newVersion, expression, changeNote, slugs, missingVars },
        reason: changeNote,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      });

      return ok({ ...updated, referencedSlugs: slugs, missingVariables: missingVars });
    }

    // Non-expression update (name, description, category, returnType) — no new version
    const updated = await db.formula.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.returnType ? { returnType: data.returnType } : {}),
        ...(data.category ? { category: data.category } : {}),
      },
    });
    await logAudit({
      actorId: admin.id,
      action: "FORMULA_UPDATE_META",
      entity: "Formula",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/formulas/[id] — deactivate a formula (soft-delete; historical bills keep referencing their snapshot)
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.formula.findUnique({ where: { id } });
    if (!existing) return err("Formula not found", 404);

    // Soft-deactivate — never hard delete (historical bills reference formula versions)
    const updated = await db.formula.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    await logAudit({
      actorId: admin.id,
      action: "FORMULA_ARCHIVE",
      entity: "Formula",
      entityId: id,
      oldValue: existing,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });
    return ok({ archived: true });
  } catch (e) {
    return handleApiError(e);
  }
}
