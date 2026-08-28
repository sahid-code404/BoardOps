import { and, desc, eq, type SQL } from "drizzle-orm";
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
import { Bill, Refund, RefundTransaction, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import { generateRefundNumber } from "../reference-numbers";
import type { BoardOpsEnv } from "../types";

type RefundErrorStatus = 400 | 401 | 403 | 404;

const createSchema = z.object({
  userId: z.string().min(1, "User is required"),
  billId: z.string().optional().nullable(),
  billingCycleId: z.string().optional().nullable(),
  amount: z.number().positive("Refund amount must be positive"),
  method: z.enum(["UPI", "CASH", "BANK_TRANSFER", "CHEQUE"]).optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: RefundErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireRefundAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function serializeRefund(record: typeof Refund.$inferSelect) {
  return {
    id: record.id,
    refundNumber: record.refundNumber,
    userId: record.userId,
    billId: record.billId,
    billingCycleId: record.billingCycleId,
    amount: record.amount,
    paidAmount: record.paidAmount,
    remainingAmount: record.remainingAmount,
    status: record.status,
    method: record.method,
    reference: record.reference,
    notes: record.notes,
    processedBy: record.processedBy,
    processedAt: databaseDateToIso(record.processedAt),
    completedAt: databaseDateToIso(record.completedAt),
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializeTransaction(record: typeof RefundTransaction.$inferSelect) {
  return {
    id: record.id,
    refundId: record.refundId,
    amount: record.amount,
    method: record.method,
    reference: record.reference,
    notes: record.notes,
    processedBy: record.processedBy,
    createdAt: databaseDateToIso(record.createdAt),
  };
}

async function loadRefund(c: Context<BoardOpsEnv>, id: string) {
  const db = createDatabase(c.env.DB);
  const [row] = await db
    .select({
      refund: Refund,
      userId: User.id,
      userName: User.name,
      userEmail: User.email,
      userRoom: User.room,
      userAvatarUrl: User.avatarUrl,
      billId: Bill.id,
      billNumber: Bill.billNumber,
      billMonth: Bill.periodMonth,
      billYear: Bill.periodYear,
    })
    .from(Refund)
    .innerJoin(User, eq(Refund.userId, User.id))
    .leftJoin(Bill, eq(Refund.billId, Bill.id))
    .where(eq(Refund.id, id))
    .limit(1);
  if (!row) return null;

  const transactions = await db
    .select()
    .from(RefundTransaction)
    .where(eq(RefundTransaction.refundId, id))
    .orderBy(desc(RefundTransaction.createdAt));

  return {
    ...serializeRefund(row.refund),
    user: {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      room: row.userRoom,
      avatarUrl: row.userAvatarUrl,
    },
    bill: row.billId
      ? {
          id: row.billId,
          billNumber: row.billNumber,
          periodMonth: row.billMonth,
          periodYear: row.billYear,
        }
      : null,
    transactions: transactions.map(serializeTransaction),
  };
}

export function registerRefundRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/refunds", async (c) => {
    const access = await requireRefundAdmin(c);
    if (access.response) return access.response;

    const requestedLimit = Number(c.req.query("limit") ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
      : 100;
    const status = c.req.query("status")?.trim() || null;
    const userId = c.req.query("userId")?.trim() || null;
    const conditions: SQL[] = [];
    if (status) conditions.push(eq(Refund.status, status));
    if (userId) conditions.push(eq(Refund.userId, userId));

    const db = createDatabase(c.env.DB);
    const baseRows = await db
      .select({ id: Refund.id })
      .from(Refund)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(Refund.createdAt))
      .limit(limit);

    const response = [];
    for (const row of baseRows) {
      const refund = await loadRefund(c, row.id);
      if (refund) response.push(refund);
    }

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/refunds/:id", async (c) => {
    const access = await requireRefundAdmin(c);
    if (access.response) return access.response;

    const refund = await loadRefund(c, c.req.param("id"));
    if (!refund) return failure(c, "Refund not found", 404);

    return c.json<ApiSuccess<typeof refund>>({
      success: true,
      data: refund,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/refunds", async (c) => {
    const access = await requireRefundAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid refund", 400);
    }

    const db = createDatabase(c.env.DB);
    const [resident] = await db
      .select({ id: User.id, name: User.name, email: User.email })
      .from(User)
      .where(eq(User.id, parsed.data.userId))
      .limit(1);
    if (!resident) return failure(c, "User not found", 404);

    const refundNumber = await generateRefundNumber(db);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(Refund).values({
      id,
      refundNumber,
      userId: parsed.data.userId,
      billId: parsed.data.billId ?? null,
      billingCycleId: parsed.data.billingCycleId ?? null,
      amount: parsed.data.amount,
      paidAmount: 0,
      remainingAmount: parsed.data.amount,
      status: "PENDING",
      method: parsed.data.method ?? null,
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      processedBy: admin.id,
      processedAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(Refund).where(eq(Refund.id, id)).limit(1);
    if (!created) throw new Error("Refund insert did not return a persisted row");
    const response = {
      ...serializeRefund(created),
      user: resident,
    };

    await logAudit(c, {
      actorId: admin.id,
      action: "REFUND_CREATE",
      entity: "Refund",
      entityId: id,
      newValue: {
        refundNumber,
        amount: parsed.data.amount,
        userId: parsed.data.userId,
        billId: parsed.data.billId ?? null,
      },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    await createNotification(c, {
      userId: parsed.data.userId,
      title: "Refund initiated",
      description: `Your refund of ₹${Math.round(parsed.data.amount).toLocaleString("en-IN")} (${refundNumber}) has been initiated and is pending processing.`,
      type: "INFO",
      priority: "HIGH",
      route: "payments",
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
