import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Formula, FormulaVersion, User, Variable } from "../db/schema";
import { extractVarSlugs, validateFormula } from "../formula-engine";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type FormulaErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const createSchema = z.object({
  name: z.string().min(2, "Name too short").max(100),
  key: z
    .string()
    .min(3, "Key too short")
    .max(80)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Key must be alphanumeric + . _ -"),
  description: z.string().optional(),
  expression: z.string().min(1, "Expression is required"),
  returnType: z.enum(["CURRENCY", "NUMBER", "PERCENTAGE"]).default("CURRENCY"),
  category: z.string().default("BILLING"),
});

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional().nullable(),
  expression: z.string().min(1).optional(),
  returnType: z.enum(["CURRENCY", "NUMBER", "PERCENTAGE"]).optional(),
  category: z.string().optional(),
  changeNote: z.string().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: FormulaErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function serializeFormula(record: typeof Formula.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    key: record.key,
    description: record.description,
    expression: record.expression,
    returnType: record.returnType,
    category: record.category,
    status: record.status,
    version: record.version,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializeVersion(
  record: typeof FormulaVersion.$inferSelect,
  user: Pick<typeof User.$inferSelect, "name" | "email"> | null,
) {
  return {
    id: record.id,
    formulaId: record.formulaId,
    version: record.version,
    expression: record.expression,
    changedBy: record.changedBy,
    changeNote: record.changeNote,
    createdAt: databaseDateToIso(record.createdAt),
    user,
  };
}

async function findMissingVariables(
  c: Context<BoardOpsEnv>,
  slugs: string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];
  const db = createDatabase(c.env.DB);
  const rows = await db
    .select({ key: Variable.key })
    .from(Variable)
    .where(inArray(Variable.key, slugs));
  const existing = new Set(rows.map((row) => row.key));
  return slugs.filter((slug) => !existing.has(slug));
}

export function registerFormulaRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/formulas", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const db = createDatabase(c.env.DB);
    const formulas = await db
      .select()
      .from(Formula)
      .where(eq(Formula.status, "ACTIVE"))
      .orderBy(asc(Formula.category));

    if (formulas.length === 0) {
      return c.json<ApiSuccess<never[]>>({
        success: true,
        data: [],
        requestId: c.get("requestId"),
      });
    }

    const formulaIds = formulas.map((formula) => formula.id);
    const versions = await db
      .select()
      .from(FormulaVersion)
      .where(inArray(FormulaVersion.formulaId, formulaIds))
      .orderBy(desc(FormulaVersion.version));

    const changedByIds = Array.from(
      new Set(versions.map((version) => version.changedBy).filter((id): id is string => !!id)),
    );
    const users = new Map<string, { name: string; email: string }>();
    if (changedByIds.length > 0) {
      const userRows = await db
        .select({ id: User.id, name: User.name, email: User.email })
        .from(User)
        .where(inArray(User.id, changedByIds));
      for (const row of userRows) users.set(row.id, { name: row.name, email: row.email });
    }

    const versionsByFormula = new Map<string, ReturnType<typeof serializeVersion>[]>();
    for (const version of versions) {
      const list = versionsByFormula.get(version.formulaId) ?? [];
      if (list.length >= 5) continue;
      list.push(
        serializeVersion(
          version,
          version.changedBy ? users.get(version.changedBy) ?? null : null,
        ),
      );
      versionsByFormula.set(version.formulaId, list);
    }

    const response = formulas.map((formula) => ({
      ...serializeFormula(formula),
      versions: versionsByFormula.get(formula.id) ?? [],
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/formulas", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid formula", 400);
    }
    const data = parsed.data;

    const validation = validateFormula(data.expression);
    if (!validation.valid) {
      return failure(c, `Invalid formula: ${validation.error}`, 422);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: Formula.id })
      .from(Formula)
      .where(eq(Formula.key, data.key))
      .limit(1);
    if (existing) return failure(c, "A formula with this key already exists", 409);

    const slugs = extractVarSlugs(data.expression);
    const missingVars = await findMissingVariables(c, slugs);
    const formulaId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO "Formula" ("id","name","key","description","expression","returnType","category","status","version","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        formulaId,
        data.name,
        data.key,
        data.description ?? null,
        data.expression,
        data.returnType,
        data.category,
        "ACTIVE",
        1,
        now,
      ),
      c.env.DB.prepare(
        'INSERT INTO "FormulaVersion" ("id","formulaId","version","expression","changedBy","changeNote") VALUES (?,?,?,?,?,?)',
      ).bind(versionId, formulaId, 1, data.expression, admin.id, "Initial version"),
    ]);

    const [created] = await db.select().from(Formula).where(eq(Formula.id, formulaId)).limit(1);
    if (!created) throw new Error("Formula batch committed without a formula row");
    const response = {
      ...serializeFormula(created),
      referencedSlugs: slugs,
      missingVariables: missingVars,
    };

    await logAudit(c, {
      actorId: admin.id,
      action: "FORMULA_CREATE",
      entity: "Formula",
      entityId: formulaId,
      newValue: {
        name: data.name,
        key: data.key,
        expression: data.expression,
        slugs,
        missingVars,
      },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.patch("/api/formulas/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid formula update", 400);
    }
    const data = parsed.data;
    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Formula).where(eq(Formula.id, id)).limit(1);
    if (!existing) return failure(c, "Formula not found", 404);

    if (data.expression && data.expression !== existing.expression) {
      const expression = data.expression;
      const validation = validateFormula(expression);
      if (!validation.valid) {
        return failure(c, `Invalid formula: ${validation.error}`, 422);
      }
      if (!data.changeNote || !data.changeNote.trim()) {
        return failure(
          c,
          "A change note is required when updating the expression (creates a new version)",
          400,
        );
      }

      const changeNote = data.changeNote.trim();
      const newVersion = existing.version + 1;
      const slugs = extractVarSlugs(expression);
      const missingVars = await findMissingVariables(c, slugs);
      const versionId = crypto.randomUUID();
      const now = new Date().toISOString();

      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE "Formula" SET "name"=?,"description"=?,"expression"=?,"returnType"=?,"category"=?,"version"=?,"updatedAt"=? WHERE "id"=?',
        ).bind(
          data.name ?? existing.name,
          data.description ?? existing.description,
          expression,
          data.returnType ?? existing.returnType,
          data.category ?? existing.category,
          newVersion,
          now,
          id,
        ),
        c.env.DB.prepare(
          'INSERT INTO "FormulaVersion" ("id","formulaId","version","expression","changedBy","changeNote") VALUES (?,?,?,?,?,?)',
        ).bind(versionId, id, newVersion, expression, admin.id, changeNote),
      ]);

      const [updated] = await db.select().from(Formula).where(eq(Formula.id, id)).limit(1);
      if (!updated) throw new Error("Formula version batch committed without a formula row");
      const response = {
        ...serializeFormula(updated),
        referencedSlugs: slugs,
        missingVariables: missingVars,
      };

      await logAudit(c, {
        actorId: admin.id,
        action: "FORMULA_UPDATE_VERSION",
        entity: "Formula",
        entityId: id,
        oldValue: { version: existing.version, expression: existing.expression },
        newValue: { version: newVersion, expression, changeNote, slugs, missingVars },
        reason: changeNote,
        ipAddress: getClientIp(c),
        userAgent: getUserAgent(c),
      });

      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    const updates: Partial<typeof Formula.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.returnType !== undefined) updates.returnType = data.returnType;
    if (data.category !== undefined) updates.category = data.category;

    await db.update(Formula).set(updates).where(eq(Formula.id, id));
    const [updated] = await db.select().from(Formula).where(eq(Formula.id, id)).limit(1);
    if (!updated) return failure(c, "Formula not found", 404);
    const oldValue = serializeFormula(existing);
    const response = serializeFormula(updated);

    await logAudit(c, {
      actorId: admin.id,
      action: "FORMULA_UPDATE_META",
      entity: "Formula",
      entityId: id,
      oldValue,
      newValue: response,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/formulas/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Formula).where(eq(Formula.id, id)).limit(1);
    if (!existing) return failure(c, "Formula not found", 404);

    await db
      .update(Formula)
      .set({ status: "ARCHIVED", updatedAt: new Date().toISOString() })
      .where(eq(Formula.id, id));
    const [updated] = await db.select().from(Formula).where(eq(Formula.id, id)).limit(1);
    if (!updated) return failure(c, "Formula not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: "FORMULA_ARCHIVE",
      entity: "Formula",
      entityId: id,
      oldValue: serializeFormula(existing),
      newValue: serializeFormula(updated),
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ archived: true }>>({
      success: true,
      data: { archived: true },
      requestId: c.get("requestId"),
    });
  });
}
