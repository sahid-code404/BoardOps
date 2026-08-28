import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import type { BoardOpsDatabase } from "../db/client";
import { createDatabase } from "../db/client";
import { Bill, Payment, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type PaymentRefundErrorStatus = 400 | 401 | 403 | 404 | 422;

type CreditSnapshot = {
  credit: number;
  totalApproved: number;
  totalBilled: number;
  totalRefunded: number;
};

type RefundCandidate = {
  id: string;
  totalAmount: number;
  paidAmount: number;
  createdAt: string | number | Date;
};

const refundSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  billId: z.string().optional(),
  notes: z.string().optional(),
});

function failure(
  c: Context<BoardOpsEnv>,
  error: string,
  status: PaymentRefundErrorStatus,
) {
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

function calculateCredit(
  totalApproved: number,
  totalBilled: number,
  totalRefunded: number,
): number {
  return Math.max(0, totalApproved - totalBilled - totalRefunded);
}

async function getCreditSnapshot(
  db: BoardOpsDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<CreditSnapshot> {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const [paymentTotals] = await db
    .select({
      totalApproved: sql<number>`coalesce(sum(case when ${Payment.status} = 'APPROVED' then ${Payment.amount} else 0 end), 0)`,
      totalRefunded: sql<number>`coalesce(sum(case when ${Payment.status} = 'REFUNDED' then ${Payment.amount} else 0 end), 0)`,
    })
    .from(Payment)
    .where(
      and(
        eq(Payment.userId, userId),
        isNull(Payment.deletedAt),
        inArray(Payment.status, ["APPROVED", "REFUNDED"]),
      ),
    );

  const [billTotals] = await db
    .select({
      totalBilled: sql<number>`coalesce(sum(${Bill.totalAmount}), 0)`,
    })
    .from(Bill)
    .where(
      and(
        eq(Bill.userId, userId),
        isNull(Bill.deletedAt),
        notInArray(Bill.status, ["VOID", "DELETED"]),
        or(
          lt(Bill.periodYear, currentYear),
          and(eq(Bill.periodYear, currentYear), lte(Bill.periodMonth, currentMonth)),
        ),
      ),
    );

  const totalApproved = Number(paymentTotals?.totalApproved ?? 0);
  const totalRefunded = Number(paymentTotals?.totalRefunded ?? 0);
  const totalBilled = Number(billTotals?.totalBilled ?? 0);
  return {
    credit: calculateCredit(totalApproved, totalBilled, totalRefunded),
    totalApproved,
    totalBilled,
    totalRefunded,
  };
}

function dateOrderValue(value: RefundCandidate["createdAt"]): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function selectRefundBill(candidates: RefundCandidate[]): string | null {
  if (candidates.length === 0) return null;

  const overpaid = candidates
    .map((candidate) => ({
      ...candidate,
      overpay: candidate.paidAmount - candidate.totalAmount,
    }))
    .filter((candidate) => candidate.overpay > 0)
    .sort((a, b) => {
      if (b.overpay !== a.overpay) return b.overpay - a.overpay;
      return dateOrderValue(b.createdAt) - dateOrderValue(a.createdAt);
    });
  if (overpaid[0]) return overpaid[0].id;

  return [...candidates]
    .sort((a, b) => dateOrderValue(b.createdAt) - dateOrderValue(a.createdAt))[0]?.id ?? null;
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

function createBillRecomputeStatement(
  c: Context<BoardOpsEnv>,
  billId: string,
  now: string,
) {
  return c.env.DB.prepare(`
    WITH payment_totals AS (
      SELECT MAX(
        0,
        COALESCE(SUM(
          CASE
            WHEN "status" = 'APPROVED' THEN "amount"
            WHEN "status" = 'REFUNDED' THEN -"amount"
            ELSE 0
          END
        ), 0)
      ) AS paid
      FROM "Payment"
      WHERE "billId" = ?1
        AND "deletedAt" IS NULL
        AND "status" IN ('APPROVED', 'REFUNDED')
    )
    UPDATE "Bill"
    SET "paidAmount" = (SELECT paid FROM payment_totals),
        "dueAmount" = MAX(0, "totalAmount" - (SELECT paid FROM payment_totals)),
        "status" = CASE
          WHEN "status" IN ('VOID', 'DELETED') THEN "status"
          WHEN "totalAmount" > 0 AND (SELECT paid FROM payment_totals) >= "totalAmount" THEN 'PAID'
          WHEN (SELECT paid FROM payment_totals) > 0 THEN 'PARTIALLY_PAID'
          ELSE 'GENERATED'
        END,
        "updatedAt" = ?2
    WHERE "id" = ?1
  `).bind(billId, now);
}

export function registerPaymentRefundRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/payments/refund", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentYear = now.getUTCFullYear();
    const db = createDatabase(c.env.DB);

    const [currentPeriod] = await db
      .select({ count: sql<number>`count(*)` })
      .from(Bill)
      .where(
        and(
          eq(Bill.periodMonth, currentMonth),
          eq(Bill.periodYear, currentYear),
          isNull(Bill.deletedAt),
          notInArray(Bill.status, ["VOID", "DELETED"]),
        ),
      );
    if (Number(currentPeriod?.count ?? 0) === 0) {
      return c.json<ApiSuccess<never[]>>({
        success: true,
        data: [],
        requestId: c.get("requestId"),
      });
    }

    const residents = await db
      .select({
        id: User.id,
        name: User.name,
        email: User.email,
        avatarUrl: User.avatarUrl,
        room: User.room,
      })
      .from(User)
      .where(and(eq(User.status, "ACTIVE"), eq(User.role, "USER")))
      .orderBy(User.name);

    const response: Array<{
      userId: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      room: string | null;
      creditAmount: number;
      breakdown: { totalApproved: number; totalBilled: number; totalRefunded: number };
    }> = [];

    for (const resident of residents) {
      const credit = await getCreditSnapshot(db, resident.id, now);
      if (credit.credit <= 0) continue;
      response.push({
        userId: resident.id,
        name: resident.name,
        email: resident.email,
        avatarUrl: resident.avatarUrl,
        room: resident.room,
        creditAmount: credit.credit,
        breakdown: {
          totalApproved: credit.totalApproved,
          totalBilled: credit.totalBilled,
          totalRefunded: credit.totalRefunded,
        },
      });
    }
    response.sort((a, b) => b.creditAmount - a.creditAmount);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/payments/refund", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = refundSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid refund", 400);
    }

    const db = createDatabase(c.env.DB);
    const [resident] = await db
      .select({ id: User.id, name: User.name })
      .from(User)
      .where(
        and(
          eq(User.id, parsed.data.userId),
          eq(User.role, "USER"),
          eq(User.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!resident) return failure(c, "User not found", 404);

    const candidates = await db
      .select({
        id: Bill.id,
        totalAmount: Bill.totalAmount,
        paidAmount: Bill.paidAmount,
        createdAt: Bill.createdAt,
      })
      .from(Bill)
      .where(
        and(
          eq(Bill.userId, parsed.data.userId),
          isNull(Bill.deletedAt),
          notInArray(Bill.status, ["VOID", "DELETED"]),
        ),
      )
      .orderBy(desc(Bill.createdAt));

    let billId = parsed.data.billId ?? null;
    if (billId) {
      const selected = candidates.find((candidate) => candidate.id === billId);
      if (!selected) {
        return failure(c, "Refund bill must belong to the user and be active", 422);
      }
    } else {
      billId = selectRefundBill(candidates);
    }

    const paymentId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const currentYear = nowDate.getUTCFullYear();
    const currentMonth = nowDate.getUTCMonth();
    const description = `Refund processed: -₹${Math.round(parsed.data.amount).toLocaleString("en-IN")}`;

    const statements = [
      c.env.DB.prepare(`
        INSERT INTO "Payment" (
          "id", "userId", "billId", "amount", "method", "status", "reference", "notes",
          "approvedBy", "createdAt", "updatedAt"
        )
        SELECT
          ?1,
          u."id",
          ?2,
          ?3,
          'REFUND',
          'REFUNDED',
          'REFUND',
          ?4,
          ?5,
          ?6,
          ?6
        FROM "User" u
        WHERE u."id" = ?7
          AND u."role" = 'USER'
          AND u."status" = 'ACTIVE'
          AND ?3 <= MAX(
            0,
            COALESCE((
              SELECT SUM(p."amount")
              FROM "Payment" p
              WHERE p."userId" = u."id"
                AND p."deletedAt" IS NULL
                AND p."status" = 'APPROVED'
            ), 0)
            - COALESCE((
              SELECT SUM(b."totalAmount")
              FROM "Bill" b
              WHERE b."userId" = u."id"
                AND b."deletedAt" IS NULL
                AND b."status" NOT IN ('VOID', 'DELETED')
                AND (
                  b."periodYear" < ?8
                  OR (b."periodYear" = ?8 AND b."periodMonth" <= ?9)
                )
            ), 0)
            - COALESCE((
              SELECT SUM(p."amount")
              FROM "Payment" p
              WHERE p."userId" = u."id"
                AND p."deletedAt" IS NULL
                AND p."status" = 'REFUNDED'
            ), 0)
          )
      `).bind(
        paymentId,
        billId,
        parsed.data.amount,
        parsed.data.notes ?? "Refund of excess deposit",
        admin.id,
        now,
        parsed.data.userId,
        currentYear,
        currentMonth,
      ),
      c.env.DB.prepare(`
        INSERT INTO "LedgerEntry" (
          "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
          "description", "billingMonth", "billingYear", "createdAt"
        )
        SELECT
          ?1,
          p."userId",
          'REFUND',
          -p."amount",
          COALESCE((
            SELECT le."runningBalance"
            FROM "LedgerEntry" le
            WHERE le."userId" = p."userId"
            ORDER BY le."createdAt" DESC, le.rowid DESC
            LIMIT 1
          ), 0) - p."amount",
          'Payment',
          p."id",
          ?2,
          NULL,
          NULL,
          ?3
        FROM "Payment" p
        WHERE p."id" = ?4
          AND p."status" = 'REFUNDED'
      `).bind(ledgerId, description, now, paymentId),
    ];
    if (billId) statements.push(createBillRecomputeStatement(c, billId, now));

    const results = await c.env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes ?? 0) === 0) {
      const credit = await getCreditSnapshot(db, parsed.data.userId, nowDate);
      return failure(
        c,
        `User only has ₹${Math.round(credit.credit)} credit (requested ₹${Math.round(parsed.data.amount)})`,
        422,
      );
    }

    const [payment] = await db
      .select()
      .from(Payment)
      .where(eq(Payment.id, paymentId))
      .limit(1);
    if (!payment) throw new Error("Refund payment insert did not return a persisted row");
    const response = serializePayment(payment);

    await createNotification(c, {
      userId: parsed.data.userId,
      title: "Refund processed",
      description: `₹${Math.round(parsed.data.amount)} has been refunded to your account${parsed.data.notes ? ` — ${parsed.data.notes}` : ""}.`,
      type: "INFO",
      priority: "HIGH",
      route: "billing",
    });

    await logAudit(c, {
      actorId: admin.id,
      action: "PAYMENT_REFUND",
      entity: "Payment",
      entityId: paymentId,
      newValue: {
        userId: parsed.data.userId,
        amount: parsed.data.amount,
        billId,
        ledgerId,
      },
    });

    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });
}
