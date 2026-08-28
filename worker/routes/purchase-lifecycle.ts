import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Expense, Purchase, PurchaseItem, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type PurchaseLifecycleErrorStatus = 400 | 401 | 403 | 404;

const DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function failure(
  c: Context<BoardOpsEnv>,
  error: string,
  status: PurchaseLifecycleErrorStatus,
) {
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

async function loadPurchase(c: Context<BoardOpsEnv>, id: string) {
  const db = createDatabase(c.env.DB);
  const [row] = await db
    .select({
      purchase: Purchase,
      userId: User.id,
      userName: User.name,
      userEmail: User.email,
    })
    .from(Purchase)
    .leftJoin(User, eq(Purchase.createdBy, User.id))
    .where(eq(Purchase.id, id))
    .limit(1);
  if (!row) return null;

  const items = await db
    .select()
    .from(PurchaseItem)
    .where(eq(PurchaseItem.purchaseId, id))
    .orderBy(PurchaseItem.createdAt);
  const [expense] = row.purchase.expenseId
    ? await db
        .select()
        .from(Expense)
        .where(eq(Expense.id, row.purchase.expenseId))
        .limit(1)
    : [];

  return {
    ...serializePurchase(row.purchase),
    items: items.map(serializePurchaseItem),
    expense: expense ? serializeExpense(expense) : null,
    user: row.userId
      ? { id: row.userId, name: row.userName, email: row.userEmail }
      : null,
  };
}

export function registerPurchaseLifecycleRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/purchases/:id", async (c) => {
    const access = await requirePurchaseAdmin(c);
    if (access.response) return access.response;

    const response = await loadPurchase(c, c.req.param("id"));
    if (!response) return failure(c, "Purchase not found", 404);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.patch("/api/purchases/:id", async (c) => {
    const access = await requirePurchaseAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: unknown;
      reason?: unknown;
    };
    const action = body.action;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (action !== "SOFT_DELETE" && action !== "RESTORE") {
      return failure(c, "Invalid action. Use SOFT_DELETE or RESTORE.", 400);
    }
    if (action === "SOFT_DELETE" && !reason) {
      return failure(c, "Deletion reason is required", 400);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select()
      .from(Purchase)
      .where(eq(Purchase.id, id))
      .limit(1);
    if (!existing) return failure(c, "Purchase not found", 404);

    if (existing.expenseId) {
      const [linkedExpense] = await db
        .select({ id: Expense.id })
        .from(Expense)
        .where(eq(Expense.id, existing.expenseId))
        .limit(1);
      if (!linkedExpense) {
        return failure(c, "Linked expense is missing; purchase state was not changed", 400);
      }
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const deletionDeadline = new Date(nowDate.getTime() + DELETE_GRACE_MS).toISOString();
    const targetStatus = action === "SOFT_DELETE" ? "DELETED" : "APPROVED";
    const deletedAt = action === "SOFT_DELETE" ? deletionDeadline : null;
    const deletedBy = action === "SOFT_DELETE" ? admin.id : null;
    const deletionReason = action === "SOFT_DELETE" ? reason : null;

    const statements = [
      c.env.DB.prepare(`
        UPDATE "Purchase"
        SET "status" = ?1,
            "deletedAt" = ?2,
            "deletedBy" = ?3,
            "deletionReason" = ?4,
            "updatedAt" = ?5
        WHERE "id" = ?6
      `).bind(targetStatus, deletedAt, deletedBy, deletionReason, now, id),
    ];
    if (existing.expenseId) {
      statements.push(
        c.env.DB.prepare(`
          UPDATE "Expense"
          SET "status" = ?1,
              "deletedAt" = ?2,
              "deletedBy" = ?3,
              "deletionReason" = ?4,
              "updatedAt" = ?5
          WHERE "id" = ?6
        `).bind(
          targetStatus,
          deletedAt,
          deletedBy,
          deletionReason,
          now,
          existing.expenseId,
        ),
      );
    }

    const results = await c.env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes ?? 0) === 0) {
      return failure(c, "Purchase not found", 404);
    }
    if (existing.expenseId && Number(results[1]?.meta?.changes ?? 0) === 0) {
      throw new Error("Linked purchase expense changed unexpectedly during lifecycle update");
    }

    const response = await loadPurchase(c, id);
    if (!response) return failure(c, "Purchase not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: action === "SOFT_DELETE" ? "PURCHASE_SOFT_DELETE" : "PURCHASE_RESTORE",
      entity: "Purchase",
      entityId: id,
      oldValue: serializePurchase(existing),
      newValue: action === "SOFT_DELETE"
        ? { status: "DELETED", deletedAt: deletionDeadline }
        : { status: "APPROVED" },
      reason: action === "SOFT_DELETE" ? reason : null,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
