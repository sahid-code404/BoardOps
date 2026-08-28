import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Payment } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type PaymentEditErrorStatus = 400 | 401 | 403 | 404 | 422;

const editSchema = z.object({
  amount: z.number().positive().optional(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).optional(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  action: z.enum(["EDIT", "VOID"]).optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: PaymentEditErrorStatus) {
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

async function requirePaymentAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function createPersistedLedgerNormalizationStatement(
  c: Context<BoardOpsEnv>,
  paymentId: string,
  description: string,
  now: string,
) {
  return c.env.DB.prepare(`
    WITH payment_state AS (
      SELECT
        p."id",
        p."userId",
        p."status",
        p."amount",
        p."effectiveMonth",
        p."effectiveYear",
        CASE WHEN p."status" = 'APPROVED' THEN p."amount" ELSE 0 END AS target
      FROM "Payment" p
      WHERE p."id" = ?1
    ),
    current_state AS (
      SELECT COALESCE(SUM(le."amount"), 0) AS net
      FROM "LedgerEntry" le
      WHERE le."entityType" = 'Payment'
        AND le."entityId" = ?1
    ),
    correction AS (
      SELECT payment_state.*, payment_state.target - current_state.net AS correctionAmount
      FROM payment_state
      CROSS JOIN current_state
    )
    INSERT INTO "LedgerEntry" (
      "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
      "description", "billingMonth", "billingYear", "createdAt"
    )
    SELECT
      ?2,
      correction."userId",
      CASE
        WHEN correction."status" = 'APPROVED' AND correction.correctionAmount > 0 THEN 'DEPOSIT'
        ELSE 'ADJUSTMENT'
      END,
      correction.correctionAmount,
      COALESCE((
        SELECT le."runningBalance"
        FROM "LedgerEntry" le
        WHERE le."userId" = correction."userId"
        ORDER BY le."createdAt" DESC, le.rowid DESC
        LIMIT 1
      ), 0) + correction.correctionAmount,
      'Payment',
      correction."id",
      ?3,
      CASE WHEN correction."status" = 'APPROVED' THEN correction."effectiveMonth" ELSE NULL END,
      CASE WHEN correction."status" = 'APPROVED' THEN correction."effectiveYear" ELSE NULL END,
      ?4
    FROM correction
    WHERE ABS(correction.correctionAmount) > 0.000001
  `).bind(paymentId, crypto.randomUUID(), description, now);
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

function createEditStatement(
  c: Context<BoardOpsEnv>,
  id: string,
  data: z.infer<typeof editSchema>,
  now: string,
) {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];

  const add = (column: string, value: string | number | null) => {
    values.push(value);
    assignments.push(`"${column}" = ?${values.length}`);
  };

  if (data.amount !== undefined) add("amount", data.amount);
  if (data.method !== undefined) add("method", data.method);
  if (data.reference !== undefined) add("reference", data.reference);
  if (data.notes !== undefined) add("notes", data.notes);
  add("updatedAt", now);

  values.push(id);
  const idParameter = values.length;
  const amountGuard = data.amount !== undefined
    ? ` AND NOT ("status" = 'APPROVED' AND "billId" IS NOT NULL)`
    : "";

  return c.env.DB.prepare(`
    UPDATE "Payment"
    SET ${assignments.join(", ")}
    WHERE "id" = ?${idParameter}
      AND "deletedAt" IS NULL
      AND "status" NOT IN ('VOID', 'DELETED')
      ${amountGuard}
  `).bind(...values);
}

export function registerPaymentEditRoutes(app: Hono<BoardOpsEnv>): void {
  app.put("/api/payments/:id", async (c) => {
    const access = await requirePaymentAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid payment update", 400);
    }

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!existing) return failure(c, "Payment not found", 404);
    if (existing.deletedAt) return failure(c, "Payment is scheduled for deletion", 422);

    const now = new Date().toISOString();

    if (parsed.data.action === "VOID") {
      if (existing.status === "VOID") return failure(c, "Payment is already void", 422);
      if (existing.status === "DELETED") {
        return failure(c, "Payment is scheduled for deletion", 422);
      }

      const statements = [
        c.env.DB.prepare(`
          UPDATE "Payment"
          SET "status" = 'VOID', "updatedAt" = ?1
          WHERE "id" = ?2
            AND "deletedAt" IS NULL
            AND "status" NOT IN ('VOID', 'DELETED')
        `).bind(now, id),
        createPersistedLedgerNormalizationStatement(
          c,
          id,
          `Payment voided: ledger normalized for ₹${Math.round(existing.amount).toLocaleString("en-IN")}`,
          now,
        ),
      ];
      if (existing.billId) statements.push(createBillRecomputeStatement(c, existing.billId, now));

      const results = await c.env.DB.batch(statements);
      const updateChanges = Number(results[0]?.meta?.changes ?? 0);
      const [updated] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
      if (!updated) return failure(c, "Payment not found", 404);
      if (updateChanges === 0) {
        if (updated.deletedAt || updated.status === "DELETED") {
          return failure(c, "Payment is scheduled for deletion", 422);
        }
        return failure(c, "Payment is already void", 422);
      }

      await createNotification(c, {
        userId: updated.userId,
        title: "Payment voided",
        description: `Your payment of ₹${updated.amount} via ${updated.method} has been voided by an administrator.`,
        type: "WARNING",
        priority: "HIGH",
        route: "billing",
      });

      await logAudit(c, {
        actorId: admin.id,
        action: "PAYMENT_VOID",
        entity: "Payment",
        entityId: id,
        oldValue: serializePayment(existing),
        newValue: serializePayment(updated),
      });

      return c.json<ApiSuccess<ReturnType<typeof serializePayment>>>({
        success: true,
        data: serializePayment(updated),
        requestId: c.get("requestId"),
      });
    }

    if (existing.status === "VOID") return failure(c, "Cannot edit a voided payment", 422);
    if (existing.status === "DELETED") {
      return failure(c, "Payment is scheduled for deletion", 422);
    }

    const hasEditableField =
      parsed.data.amount !== undefined ||
      parsed.data.method !== undefined ||
      parsed.data.reference !== undefined ||
      parsed.data.notes !== undefined;
    if (!hasEditableField) return failure(c, "No editable fields provided", 422);

    if (parsed.data.amount !== undefined && existing.status === "APPROVED" && existing.billId) {
      return failure(
        c,
        "Cannot edit amount on an approved payment linked to a bill. Void it and submit a new payment instead.",
        422,
      );
    }

    const statements = [
      createEditStatement(c, id, parsed.data, now),
      createPersistedLedgerNormalizationStatement(
        c,
        id,
        parsed.data.amount !== undefined
          ? `Payment amount edited: ledger normalized from ₹${Math.round(existing.amount).toLocaleString("en-IN")} to the persisted amount`
          : "Payment edited: ledger consistency verified",
        now,
      ),
    ];
    if (existing.billId) statements.push(createBillRecomputeStatement(c, existing.billId, now));

    const results = await c.env.DB.batch(statements);
    const updateChanges = Number(results[0]?.meta?.changes ?? 0);
    const [updated] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!updated) return failure(c, "Payment not found", 404);

    if (updateChanges === 0) {
      if (updated.deletedAt || updated.status === "DELETED") {
        return failure(c, "Payment is scheduled for deletion", 422);
      }
      if (updated.status === "VOID") return failure(c, "Cannot edit a voided payment", 422);
      if (parsed.data.amount !== undefined && updated.status === "APPROVED" && updated.billId) {
        return failure(
          c,
          "Cannot edit amount on an approved payment linked to a bill. Void it and submit a new payment instead.",
          422,
        );
      }
      return failure(c, "No editable fields provided", 422);
    }

    await logAudit(c, {
      actorId: admin.id,
      action: "PAYMENT_EDIT",
      entity: "Payment",
      entityId: id,
      oldValue: serializePayment(existing),
      newValue: serializePayment(updated),
    });

    return c.json<ApiSuccess<ReturnType<typeof serializePayment>>>({
      success: true,
      data: serializePayment(updated),
      requestId: c.get("requestId"),
    });
  });
}
