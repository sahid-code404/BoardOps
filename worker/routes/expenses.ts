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

type ExpenseErrorStatus = 400 | 401 | 403;

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

    const expenseDate = new Date(parsed.data.expenseDate);
    if (Number.isNaN(expenseDate.getTime())) return failure(c, "Invalid expense date", 400);

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
}
