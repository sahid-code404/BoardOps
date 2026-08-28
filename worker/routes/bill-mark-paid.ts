import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { periodLabel } from "../billing-cycle-engine";
import { createDatabase } from "../db/client";
import { Bill, Payment } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type MarkPaidErrorStatus = 400 | 401 | 403 | 404 | 422;

const markPaidSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).default("CASH"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: MarkPaidErrorStatus) {
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

function createPaymentInsertStatement(
  c: Context<BoardOpsEnv>,
  input: {
    paymentId: string;
    billId: string;
    adminId: string;
    amount: number;
    method: string;
    reference: string | null;
    notes: string;
    now: string;
  },
) {
  return c.env.DB.prepare(`
    INSERT INTO "Payment" (
      "id", "userId", "billId", "amount", "method", "status", "reference",
      "notes", "approvedBy", "effectiveMonth", "effectiveYear", "updatedAt"
    )
    SELECT
      ?1,
      b."userId",
      b."id",
      ?2,
      ?3,
      'APPROVED',
      ?4,
      ?5,
      ?6,
      b."periodMonth",
      b."periodYear",
      ?7
    FROM "Bill" b
    WHERE b."id" = ?8
      AND b."deletedAt" IS NULL
      AND b."status" <> 'VOID'
      AND ?2 <= MAX(
        0,
        b."totalAmount" - MAX(0, COALESCE((
          SELECT SUM(CASE
            WHEN p."status" = 'APPROVED' THEN p."amount"
            WHEN p."status" = 'REFUNDED' THEN -p."amount"
            ELSE 0
          END)
          FROM "Payment" p
          WHERE p."billId" = b."id"
            AND p."deletedAt" IS NULL
            AND p."status" IN ('APPROVED', 'REFUNDED')
        ), 0))
      )
  `).bind(
    input.paymentId,
    input.amount,
    input.method,
    input.reference,
    input.notes,
    input.adminId,
    input.now,
    input.billId,
  );
}

function createLedgerCreditStatement(
  c: Context<BoardOpsEnv>,
  input: {
    paymentId: string;
    description: string;
    now: string;
  },
) {
  return c.env.DB.prepare(`
    INSERT INTO "LedgerEntry" (
      "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
      "description", "billingMonth", "billingYear", "createdAt"
    )
    SELECT
      ?1,
      p."userId",
      'DEPOSIT',
      p."amount",
      COALESCE((
        SELECT le."runningBalance"
        FROM "LedgerEntry" le
        WHERE le."userId" = p."userId"
        ORDER BY le."createdAt" DESC, le.rowid DESC
        LIMIT 1
      ), 0) + p."amount",
      'Payment',
      p."id",
      ?2,
      p."effectiveMonth",
      p."effectiveYear",
      ?3
    FROM "Payment" p
    WHERE p."id" = ?4
      AND p."status" = 'APPROVED'
      AND NOT EXISTS (
        SELECT 1
        FROM "LedgerEntry" le
        WHERE le."entityType" = 'Payment'
          AND le."entityId" = p."id"
      )
  `).bind(
    crypto.randomUUID(),
    input.description,
    input.now,
    input.paymentId,
  );
}

function createBillRecomputeStatement(c: Context<BoardOpsEnv>, billId: string, now: string) {
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

export function registerBillMarkPaidRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/bills/:id/mark-paid", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = markPaidSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid payment", 400);
    }

    const billId = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [bill] = await db.select().from(Bill).where(eq(Bill.id, billId)).limit(1);
    if (!bill) return failure(c, "Bill not found", 404);
    if (bill.deletedAt) return failure(c, "This bill is scheduled for deletion", 422);
    if (bill.status === "VOID") return failure(c, "Cannot mark a voided bill as paid", 422);

    const remainingDue = Math.max(0, bill.totalAmount - bill.paidAmount);
    if (parsed.data.amount > remainingDue) {
      return failure(
        c,
        `Amount ₹${Math.round(parsed.data.amount)} exceeds the remaining due of ₹${Math.round(remainingDue)}. The bill total is ₹${Math.round(bill.totalAmount)} and ₹${Math.round(bill.paidAmount)} is already paid.`,
        422,
      );
    }

    const paymentId = crypto.randomUUID();
    const now = new Date().toISOString();
    const notes = parsed.data.notes || `Marked as paid by admin (${admin.name})`;
    const description = `Bill payment recorded: ₹${Math.round(parsed.data.amount)} via ${parsed.data.method}`;
    const results = await c.env.DB.batch([
      createPaymentInsertStatement(c, {
        paymentId,
        billId,
        adminId: admin.id,
        amount: parsed.data.amount,
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        notes,
        now,
      }),
      createLedgerCreditStatement(c, { paymentId, description, now }),
      createBillRecomputeStatement(c, billId, now),
    ]);

    const insertChanges = Number(results[0]?.meta?.changes ?? 0);
    if (insertChanges === 0) {
      const [current] = await db.select().from(Bill).where(eq(Bill.id, billId)).limit(1);
      if (!current) return failure(c, "Bill not found", 404);
      if (current.deletedAt) return failure(c, "This bill is scheduled for deletion", 422);
      if (current.status === "VOID") return failure(c, "Cannot mark a voided bill as paid", 422);
      const currentDue = Math.max(0, current.totalAmount - current.paidAmount);
      return failure(
        c,
        `Amount ₹${Math.round(parsed.data.amount)} exceeds the remaining due of ₹${Math.round(currentDue)}.`,
        422,
      );
    }

    const [payment] = await db.select().from(Payment).where(eq(Payment.id, paymentId)).limit(1);
    if (!payment) throw new Error("Approved bill payment could not be reloaded");

    await createNotification(c, {
      userId: bill.userId,
      title: "Bill marked as paid",
      description: `Your ${periodLabel(bill.periodMonth, bill.periodYear)} bill has been marked as paid by an administrator (₹${Math.round(parsed.data.amount)} via ${parsed.data.method}).${parsed.data.notes ? ` Notes: ${parsed.data.notes}` : ""}`,
      type: "SUCCESS",
      priority: "HIGH",
      route: "billing",
    });

    await logAudit(c, {
      actorId: admin.id,
      action: "BILL_MARK_PAID",
      entity: "Bill",
      entityId: bill.id,
      newValue: {
        amount: parsed.data.amount,
        method: parsed.data.method,
        paymentId,
        ledgerCredited: true,
      },
      reason: parsed.data.notes ?? null,
    });

    const response = { payment: serializePayment(payment), billId: bill.id };
    return c.json<ApiSuccess<typeof response>>(
      { success: true, data: response, requestId: c.get("requestId") },
      201,
    );
  });
}
