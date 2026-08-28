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
import { Notification, Payment, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type PaymentErrorStatus = 400 | 401;

const createSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).default("CASH"),
  billId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: PaymentErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializePayment(record: typeof Payment.$inferSelect) {
  return {
    id: record.id,
    userId: record.userId,
    billId: record.billId,
    amount: record.amount,
    method: record.method,
    status: record.status,
    reference: record.reference,
    notes: record.notes,
    approvedBy: record.approvedBy,
    effectiveMonth: record.effectiveMonth,
    effectiveYear: record.effectiveYear,
    deletedAt: databaseDateToIso(record.deletedAt),
    deletedBy: record.deletedBy,
    deletionReason: record.deletionReason,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function parseDayRange(value: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    return null;
  }
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
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

async function purgeExpiredPayments(c: Context<BoardOpsEnv>): Promise<void> {
  try {
    const db = createDatabase(c.env.DB);
    await db
      .delete(Payment)
      .where(and(isNotNull(Payment.deletedAt), lt(Payment.deletedAt, new Date().toISOString())));
  } catch (error) {
    console.error("Failed to purge expired payments", error);
  }
}

export function registerPaymentRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/payments", async (c) => {
    await purgeExpiredPayments(c);

    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const requestedLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
      : 20;
    const includeDeleted = c.req.query("includeDeleted") === "true";

    const conditions: SQL[] = [
      includeDeleted ? isNotNull(Payment.deletedAt) : isNull(Payment.deletedAt),
      eq(User.role, "USER"),
    ];
    if (user.role === "USER") conditions.push(eq(Payment.userId, user.id));

    const date = c.req.query("date")?.trim();
    let dateRange = date ? parseDayRange(date) : null;
    if (date && !dateRange) return failure(c, "Invalid date", 400);

    const month = c.req.query("month");
    const year = c.req.query("year");
    if (month !== undefined && year) {
      const monthRange = parseMonthRange(month, year);
      if (!monthRange) return failure(c, "Invalid month or year", 400);
      dateRange = monthRange;
    }
    if (dateRange) {
      conditions.push(gte(Payment.createdAt, dateRange.start), lte(Payment.createdAt, dateRange.end));
    }

    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({
        payment: Payment,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
        userAvatarUrl: User.avatarUrl,
      })
      .from(Payment)
      .innerJoin(User, eq(Payment.userId, User.id))
      .where(and(...conditions))
      .orderBy(desc(Payment.createdAt))
      .limit(limit);

    const response = rows.map((row) => ({
      ...serializePayment(row.payment),
      user: {
        name: row.userName,
        email: row.userEmail,
        room: row.userRoom,
        avatarUrl: row.userAvatarUrl,
      },
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/payments", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid payment", 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = createDatabase(c.env.DB);
    await db.insert(Payment).values({
      id,
      userId: user.id,
      billId: parsed.data.billId ?? null,
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      status: "PENDING",
      updatedAt: now,
    });

    const [payment] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!payment) throw new Error("Payment insert did not return a persisted row");

    const admins = await db
      .select({ id: User.id })
      .from(User)
      .where(and(eq(User.role, "ADMIN"), eq(User.status, "ACTIVE")));
    if (admins.length > 0) {
      await db.insert(Notification).values(
        admins.map((admin) => ({
          id: crypto.randomUUID(),
          userId: admin.id,
          title: "New payment submitted",
          description: `${user.name} submitted a payment of ₹${parsed.data.amount} via ${parsed.data.method}.`,
          type: "INFO",
          priority: "NORMAL",
          route: "payments",
        })),
      );
    }

    const response = serializePayment(payment);
    await logAudit(c, {
      actorId: user.id,
      action: "PAYMENT_SUBMITTED",
      entity: "Payment",
      entityId: id,
      newValue: response,
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });
}
