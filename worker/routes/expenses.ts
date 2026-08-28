import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
} from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Expense, Institution, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type ExpenseErrorStatus = 400 | 401 | 403 | 404 | 422;

const createSchema = z.object({
  title: z.string().min(2, "Item name is required"),
  category: z.string().min(2, "Category is required").default("GENERAL"),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1, "Unit is required").default("piece"),
  amount: z.number().positive("Cost must be positive"),
  description: z.string().optional(),
  expenseDate: z.string().min(1),
  paidTo: z.string().optional(),
});

const editSchema = z.object({
  title: z.string().min(2, "Item name is required").optional(),
  category: z.string().min(2).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  description: z.string().nullable().optional(),
  expenseDate: z.string().optional(),
  paidTo: z.string().nullable().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: ExpenseErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
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

function parseMonthRange(monthValue: string, yearValue: string): { start: string; end: string } | null {
  const month = Number(monthValue);
  const year = Number(yearValue);
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString(),
  };
}

function parseExpenseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPastMonth(date: Date, now = new Date()): boolean {
  return (
    date.getUTCFullYear() < now.getUTCFullYear() ||
    (date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() < now.getUTCMonth())
  );
}

async function purgeExpiredExpenses(c: Context<BoardOpsEnv>): Promise<void> {
  try {
    const db = createDatabase(c.env.DB);
    await db
      .delete(Expense)
      .where(and(isNotNull(Expense.deletedAt), lt(Expense.deletedAt, new Date().toISOString())));
  } catch (error) {
    console.error("Failed to purge expired expenses", error);
  }
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

export function registerExpenseRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/expenses", async (c) => {
    await purgeExpiredExpenses(c);

    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const requestedLimit = Number(c.req.query("limit") ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, Math.trunc(requestedLimit)))
      : 200;
    const category = c.req.query("category")?.trim() || null;
    const includeDeleted = c.req.query("includeDeleted") === "true";
    const conditions: SQL[] = [
      includeDeleted ? isNotNull(Expense.deletedAt) : isNull(Expense.deletedAt),
    ];
    if (category) conditions.push(eq(Expense.category, category));
    if (user.role === "USER") conditions.push(eq(Expense.status, "APPROVED"));

    const month = c.req.query("month");
    const year = c.req.query("year");
    if (month !== undefined && year) {
      const range = parseMonthRange(month, year);
      if (!range) return failure(c, "Invalid month or year", 400);
      conditions.push(gte(Expense.expenseDate, range.start), lte(Expense.expenseDate, range.end));
    }

    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({ expense: Expense, creatorName: User.name })
      .from(Expense)
      .leftJoin(User, eq(Expense.createdBy, User.id))
      .where(and(...conditions))
      .orderBy(desc(Expense.expenseDate))
      .limit(limit);

    const response = rows.map((row) => ({
      ...serializeExpense(row.expense),
      user: row.creatorName ? { name: row.creatorName } : null,
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/expenses", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid expense", 400);
    }

    const expenseDate = parseExpenseDate(parsed.data.expenseDate);
    if (!expenseDate) return failure(c, "Invalid expense date", 400);

    const db = createDatabase(c.env.DB);
    const [institution] = await db.select({ currency: Institution.currency }).from(Institution).limit(1);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(Expense).values({
      id,
      title: parsed.data.title,
      category: parsed.data.category,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      amount: parsed.data.amount,
      description: parsed.data.description || null,
      expenseDate: expenseDate.toISOString(),
      paidTo: parsed.data.paidTo || null,
      status: "APPROVED",
      createdBy: admin.id,
      currency: institution?.currency || "INR",
      updatedAt: now,
    });

    const [expense] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
    if (!expense) throw new Error("Expense insert did not return a persisted row");
    const response = serializeExpense(expense);

    await logAudit(c, {
      actorId: admin.id,
      action: "CREATE",
      entity: "Expense",
      entityId: id,
      newValue: response,
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });

  app.put("/api/expenses/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid expense update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
    if (!existing) return failure(c, "Expense not found", 404);
    if (existing.deletedAt) return failure(c, "Expense is scheduled for deletion", 422);
    if (existing.status === "LOCKED") {
      return failure(c, "This expense is locked and cannot be edited", 422);
    }

    const existingDate = new Date(String(existing.expenseDate));
    const requestedDate = parsed.data.expenseDate
      ? parseExpenseDate(parsed.data.expenseDate)
      : existingDate;
    if (!requestedDate || Number.isNaN(requestedDate.getTime())) {
      return failure(c, "Invalid expense date", 400);
    }
    if (isPastMonth(requestedDate)) {
      return failure(c, "Expenses from past months cannot be edited (locked)", 422);
    }

    const updates: Partial<typeof Expense.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.quantity !== undefined) updates.quantity = parsed.data.quantity;
    if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit;
    if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.expenseDate !== undefined) updates.expenseDate = requestedDate.toISOString();
    if (parsed.data.paidTo !== undefined) updates.paidTo = parsed.data.paidTo;

    await db.update(Expense).set(updates).where(eq(Expense.id, id));
    const [updated] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
    if (!updated) return failure(c, "Expense not found", 404);

    const oldValue = serializeExpense(existing);
    const response = serializeExpense(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "UPDATE",
      entity: "Expense",
      entityId: id,
      oldValue,
      newValue: response,
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/expenses/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason;
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
    if (!existing) return failure(c, "Expense not found", 404);
    if (existing.deletedAt) {
      return failure(c, "Expense is already scheduled for deletion", 422);
    }
    if (existing.status === "LOCKED") {
      return failure(c, "This expense is locked and cannot be deleted", 422);
    }

    const existingDate = new Date(String(existing.expenseDate));
    if (Number.isNaN(existingDate.getTime()) || isPastMonth(existingDate)) {
      return failure(c, "Expenses from past months cannot be deleted (locked)", 422);
    }

    const deletionDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .update(Expense)
      .set({
        deletedAt: deletionDate,
        deletedBy: admin.id,
        status: "DELETED",
        deletionReason: reason || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(Expense.id, id));

    await logAudit(c, {
      actorId: admin.id,
      action: "EXPENSE_SOFT_DELETE",
      entity: "Expense",
      entityId: id,
      oldValue: serializeExpense(existing),
      newValue: { deletedAt: deletionDate, status: "DELETED", reason },
      reason,
    });

    const response = { success: true as const, permanentDeletion: deletionDate };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/expenses/:id/restore", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
    if (!existing) return failure(c, "Expense not found", 404);
    if (!existing.deletedAt) {
      return failure(c, "This expense is not in the deletion queue", 422);
    }

    const now = new Date().toISOString();
    const result = await db
      .update(Expense)
      .set({
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        status: "APPROVED",
        updatedAt: now,
      })
      .where(and(eq(Expense.id, id), isNotNull(Expense.deletedAt)));

    if (Number(result.meta?.changes ?? 0) === 0) {
      const [fresh] = await db.select().from(Expense).where(eq(Expense.id, id)).limit(1);
      if (!fresh) return failure(c, "Expense not found", 404);
      return failure(c, "This expense is not in the deletion queue", 422);
    }

    const [restoredRow] = await db
      .select({ expense: Expense, creatorName: User.name })
      .from(Expense)
      .leftJoin(User, eq(Expense.createdBy, User.id))
      .where(eq(Expense.id, id))
      .limit(1);
    if (!restoredRow) return failure(c, "Expense not found", 404);
    const response = {
      ...serializeExpense(restoredRow.expense),
      user: restoredRow.creatorName ? { name: restoredRow.creatorName } : null,
    };

    await logAudit(c, {
      actorId: admin.id,
      action: "EXPENSE_RESTORE",
      entity: "Expense",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: databaseDateToIso(existing.deletedAt) },
      newValue: { status: "APPROVED" },
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
