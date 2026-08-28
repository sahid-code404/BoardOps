import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  type SQL,
} from "drizzle-orm";
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
import {
  Expense,
  Institution,
  Product,
  Purchase,
  PurchaseItem,
  User,
} from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type PurchaseErrorStatus = 400 | 401 | 403 | 404;

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productName: z.string().min(1, "Product name is required"),
  category: z.string().default("GENERAL"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required"),
  rate: z.number().min(0).default(0),
  total: z.number().min(0),
  notes: z.string().optional().nullable(),
});

const createSchema = z.object({
  vendor: z.string().min(1, "Vendor is required").max(200),
  purchaseDate: z.string(),
  items: z.array(itemSchema).min(1, "At least one item is required"),
  receiptUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: PurchaseErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requirePurchaseAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function parseLegacyMonthRange(
  monthValue: string,
  yearValue: string,
): { start: string; end: string } | null {
  const month = Number(monthValue);
  const year = Number(yearValue);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString(),
  };
}

function serializePurchase(record: typeof Purchase.$inferSelect) {
  return {
    id: record.id,
    vendor: record.vendor,
    purchaseDate: databaseDateToIso(record.purchaseDate),
    totalAmount: record.totalAmount,
    receiptUrl: record.receiptUrl,
    notes: record.notes,
    expenseId: record.expenseId,
    createdBy: record.createdBy,
    status: record.status,
    deletedAt: databaseDateToIso(record.deletedAt),
    deletedBy: record.deletedBy,
    deletionReason: record.deletionReason,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializePurchaseItem(record: typeof PurchaseItem.$inferSelect) {
  return {
    id: record.id,
    purchaseId: record.purchaseId,
    productId: record.productId,
    productName: record.productName,
    category: record.category,
    quantity: record.quantity,
    unit: record.unit,
    rate: record.rate,
    total: record.total,
    notes: record.notes,
    createdAt: databaseDateToIso(record.createdAt),
  };
}

function serializeExpense(record: typeof Expense.$inferSelect) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    category: record.category,
    quantity: record.quantity,
    unit: record.unit,
    amount: record.amount,
    currency: record.currency,
    expenseDate: databaseDateToIso(record.expenseDate),
    paidTo: record.paidTo,
    receiptUrl: record.receiptUrl,
    status: record.status,
    createdBy: record.createdBy,
    lockedAt: databaseDateToIso(record.lockedAt),
    lockedByCycleId: record.lockedByCycleId,
    deletedAt: databaseDateToIso(record.deletedAt),
    deletedBy: record.deletedBy,
    deletionReason: record.deletionReason,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

export function registerPurchaseRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/purchases", async (c) => {
    const access = await requirePurchaseAdmin(c);
    if (access.response) return access.response;

    const requestedLimit = Number(c.req.query("limit") ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
      : 100;
    const includeDeleted = c.req.query("includeDeleted") === "true";
    const conditions: SQL[] = [];
    if (!includeDeleted) conditions.push(isNull(Purchase.deletedAt));

    const month = c.req.query("month");
    const year = c.req.query("year");
    if (month && year) {
      const range = parseLegacyMonthRange(month, year);
      if (!range) return failure(c, "Invalid month or year", 400);
      conditions.push(gte(Purchase.purchaseDate, range.start), lt(Purchase.purchaseDate, range.end));
    }

    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({
        purchase: Purchase,
        userId: User.id,
        userName: User.name,
        userEmail: User.email,
      })
      .from(Purchase)
      .leftJoin(User, eq(Purchase.createdBy, User.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(Purchase.purchaseDate))
      .limit(limit);

    const ids = rows.map((row) => row.purchase.id);
    const itemRows = ids.length > 0
      ? await db
          .select()
          .from(PurchaseItem)
          .where(inArray(PurchaseItem.purchaseId, ids))
          .orderBy(PurchaseItem.createdAt)
      : [];
    const itemsByPurchase = new Map<string, ReturnType<typeof serializePurchaseItem>[]>();
    for (const item of itemRows) {
      const items = itemsByPurchase.get(item.purchaseId) ?? [];
      items.push(serializePurchaseItem(item));
      itemsByPurchase.set(item.purchaseId, items);
    }

    const response = rows.map((row) => ({
      ...serializePurchase(row.purchase),
      items: itemsByPurchase.get(row.purchase.id) ?? [],
      user: row.userId
        ? { id: row.userId, name: row.userName, email: row.userEmail }
        : null,
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/purchases", async (c) => {
    const access = await requirePurchaseAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid purchase", 400);
    }

    const purchaseDate = new Date(parsed.data.purchaseDate);
    if (Number.isNaN(purchaseDate.getTime())) {
      return failure(c, "Invalid purchase date", 400);
    }

    const db = createDatabase(c.env.DB);
    const productIds = Array.from(
      new Set(
        parsed.data.items
          .map((item) => item.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (productIds.length > 0) {
      const products = await db
        .select({ id: Product.id })
        .from(Product)
        .where(inArray(Product.id, productIds));
      const found = new Set(products.map((product) => product.id));
      const missing = parsed.data.items.find(
        (item) => item.productId && !found.has(item.productId),
      );
      if (missing) return failure(c, `Product not found: ${missing.productName}`, 404);
    }

    const [institution] = await db
      .select({ currency: Institution.currency })
      .from(Institution)
      .limit(1);
    const currency = institution?.currency || "INR";
    const totalAmount = parsed.data.items.reduce((sum, item) => sum + item.total, 0);
    const expenseId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const itemIds = parsed.data.items.map(() => crypto.randomUUID());
    const now = new Date().toISOString();
    const purchaseDateIso = purchaseDate.toISOString();

    const statements = [
      c.env.DB.prepare(`
        INSERT INTO "Expense" (
          "id", "title", "description", "category", "quantity", "unit", "amount", "currency",
          "expenseDate", "paidTo", "receiptUrl", "status", "createdBy", "createdAt", "updatedAt"
        ) VALUES (?1, ?2, ?3, 'PURCHASE', 1, 'purchase', ?4, ?5, ?6, ?7, ?8, 'APPROVED', ?9, ?10, ?10)
      `).bind(
        expenseId,
        `Purchase: ${parsed.data.vendor}`,
        parsed.data.notes || `${parsed.data.items.length} item(s) from ${parsed.data.vendor}`,
        totalAmount,
        currency,
        purchaseDateIso,
        parsed.data.vendor,
        parsed.data.receiptUrl ?? null,
        admin.id,
        now,
      ),
      c.env.DB.prepare(`
        INSERT INTO "Purchase" (
          "id", "vendor", "purchaseDate", "totalAmount", "receiptUrl", "notes", "expenseId",
          "createdBy", "status", "createdAt", "updatedAt"
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'APPROVED', ?9, ?9)
      `).bind(
        purchaseId,
        parsed.data.vendor,
        purchaseDateIso,
        totalAmount,
        parsed.data.receiptUrl ?? null,
        parsed.data.notes ?? null,
        expenseId,
        admin.id,
        now,
      ),
      ...parsed.data.items.map((item, index) =>
        c.env.DB.prepare(`
          INSERT INTO "PurchaseItem" (
            "id", "purchaseId", "productId", "productName", "category", "quantity", "unit",
            "rate", "total", "notes", "createdAt"
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        `).bind(
          itemIds[index],
          purchaseId,
          item.productId ?? null,
          item.productName,
          item.category,
          item.quantity,
          item.unit,
          item.rate,
          item.total,
          item.notes ?? null,
          now,
        ),
      ),
    ];
    await c.env.DB.batch(statements);

    const [purchase] = await db
      .select()
      .from(Purchase)
      .where(eq(Purchase.id, purchaseId))
      .limit(1);
    const [expense] = await db
      .select()
      .from(Expense)
      .where(eq(Expense.id, expenseId))
      .limit(1);
    const items = await db
      .select()
      .from(PurchaseItem)
      .where(eq(PurchaseItem.purchaseId, purchaseId))
      .orderBy(PurchaseItem.createdAt);
    if (!purchase || !expense) {
      throw new Error("Purchase transaction did not persist its linked records");
    }

    const response = {
      ...serializePurchase(purchase),
      items: items.map(serializePurchaseItem),
      expense: serializeExpense(expense),
    };

    await logAudit(c, {
      actorId: admin.id,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: purchaseId,
      newValue: {
        vendor: parsed.data.vendor,
        totalAmount,
        itemCount: parsed.data.items.length,
        expenseId,
      },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      200,
    );
  });
}
