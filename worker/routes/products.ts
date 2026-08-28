import { and, asc, eq, ne, or, sql } from "drizzle-orm";
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
import { Product, PurchaseItem, Unit } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type ProductErrorStatus = 400 | 401 | 403 | 404 | 409;

const createSchema = z.object({
  name: z.string().min(1, "Product name is required").max(100),
  category: z.string().min(1).default("GENERAL"),
  defaultUnitId: z.string().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().min(1).optional(),
  defaultUnitId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: ProductErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

function serializeUnit(record: typeof Unit.$inferSelect | null) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    isActive: record.isActive,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializeProduct(
  product: typeof Product.$inferSelect,
  defaultUnit: typeof Unit.$inferSelect | null,
) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    defaultUnitId: product.defaultUnitId,
    isActive: product.isActive,
    archivedAt: databaseDateToIso(product.archivedAt),
    createdAt: databaseDateToIso(product.createdAt),
    updatedAt: databaseDateToIso(product.updatedAt),
    defaultUnit: serializeUnit(defaultUnit),
  };
}

async function loadProduct(c: Context<BoardOpsEnv>, id: string) {
  const db = createDatabase(c.env.DB);
  const [row] = await db
    .select({ product: Product, unit: Unit })
    .from(Product)
    .leftJoin(Unit, eq(Product.defaultUnitId, Unit.id))
    .where(eq(Product.id, id))
    .limit(1);
  return row ?? null;
}

export function registerProductRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/products", async (c) => {
    const includeArchived = c.req.query("includeArchived") === "true";
    const category = c.req.query("category")?.trim() || null;
    const conditions = [];
    if (!includeArchived) conditions.push(eq(Product.isActive, true));
    if (category) conditions.push(eq(Product.category, category));

    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({ product: Product, unit: Unit })
      .from(Product)
      .leftJoin(Unit, eq(Product.defaultUnitId, Unit.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(Product.category), asc(Product.name));

    const response = rows.map((row) => serializeProduct(row.product, row.unit));
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/products", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid product", 400);
    }

    const slug = slugify(parsed.data.name);
    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select({ id: Product.id })
      .from(Product)
      .where(or(eq(Product.name, parsed.data.name), eq(Product.slug, slug)))
      .limit(1);
    if (existing) return failure(c, "A product with this name already exists", 409);

    if (parsed.data.defaultUnitId) {
      const [unit] = await db
        .select({ id: Unit.id })
        .from(Unit)
        .where(eq(Unit.id, parsed.data.defaultUnitId))
        .limit(1);
      if (!unit) return failure(c, "Default unit not found", 404);
    }

    const id = crypto.randomUUID();
    await db.insert(Product).values({
      id,
      name: parsed.data.name,
      slug,
      category: parsed.data.category,
      defaultUnitId: parsed.data.defaultUnitId ?? null,
      isActive: true,
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    });

    const row = await loadProduct(c, id);
    if (!row) return failure(c, "Product not found", 404);
    const response = serializeProduct(row.product, row.unit);

    await logAudit(c, {
      actorId: admin.id,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: id,
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

  app.patch("/api/products/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid product update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const existingRow = await loadProduct(c, id);
    if (!existingRow) return failure(c, "Product not found", 404);
    const existing = existingRow.product;

    let nextSlug: string | undefined;
    if (parsed.data.name && parsed.data.name !== existing.name) {
      nextSlug = slugify(parsed.data.name);
      const [duplicate] = await db
        .select({ id: Product.id })
        .from(Product)
        .where(
          and(
            ne(Product.id, id),
            or(eq(Product.name, parsed.data.name), eq(Product.slug, nextSlug)),
          ),
        )
        .limit(1);
      if (duplicate) return failure(c, "A product with this name already exists", 409);
    }

    if (parsed.data.defaultUnitId) {
      const [unit] = await db
        .select({ id: Unit.id })
        .from(Unit)
        .where(eq(Unit.id, parsed.data.defaultUnitId))
        .limit(1);
      if (!unit) return failure(c, "Default unit not found", 404);
    }

    const updates: Partial<typeof Product.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (nextSlug !== undefined) updates.slug = nextSlug;
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.defaultUnitId !== undefined) updates.defaultUnitId = parsed.data.defaultUnitId;
    if (parsed.data.isActive !== undefined) {
      updates.isActive = parsed.data.isActive;
      updates.archivedAt = parsed.data.isActive ? null : new Date().toISOString();
    }

    await db.update(Product).set(updates).where(eq(Product.id, id));
    const updatedRow = await loadProduct(c, id);
    if (!updatedRow) return failure(c, "Product not found", 404);

    const oldValue = serializeProduct(existingRow.product, existingRow.unit);
    const response = serializeProduct(updatedRow.product, updatedRow.unit);
    await logAudit(c, {
      actorId: admin.id,
      action: "PRODUCT_UPDATE",
      entity: "Product",
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

  app.delete("/api/products/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const existingRow = await loadProduct(c, id);
    if (!existingRow) return failure(c, "Product not found", 404);

    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(PurchaseItem)
      .where(eq(PurchaseItem.productId, id));
    const usageCount = Number(countRow?.value ?? 0);
    const oldValue = serializeProduct(existingRow.product, existingRow.unit);

    if (usageCount > 0) {
      await db
        .update(Product)
        .set({
          isActive: false,
          archivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(Product.id, id));
      const updatedRow = await loadProduct(c, id);
      if (!updatedRow) return failure(c, "Product not found", 404);

      await logAudit(c, {
        actorId: admin.id,
        action: "PRODUCT_ARCHIVE",
        entity: "Product",
        entityId: id,
        oldValue,
        newValue: serializeProduct(updatedRow.product, updatedRow.unit),
        reason: `Used by ${usageCount} purchase item(s) — archived instead of deleted`,
        ipAddress: getClientIp(c),
        userAgent: getUserAgent(c),
      });

      const response = { archived: true, usageCount };
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    await db.delete(Product).where(eq(Product.id, id));
    await logAudit(c, {
      actorId: admin.id,
      action: "PRODUCT_DELETE",
      entity: "Product",
      entityId: id,
      oldValue,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ deleted: true }>>({
      success: true,
      data: { deleted: true },
      requestId: c.get("requestId"),
    });
  });
}
