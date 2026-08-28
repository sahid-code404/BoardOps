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
import {
  Bill,
  BillingCycle,
  LedgerEntry,
  Notification,
  Payment,
  Restriction,
  User,
  Variable,
} from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import {
  getEffectiveBillingPeriod,
  getLedgerTargetBalance,
  getPaymentLedgerIntent,
  resolvePaymentTarget,
  type PaymentTargetStatus,
} from "../payment-state";
import type { BoardOpsEnv } from "../types";

type PaymentErrorStatus = 400 | 401 | 403 | 404 | 422;

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

async function getApprovalPeriod(c: Context<BoardOpsEnv>) {
  const now = new Date();
  const currentMonth = now.getUTCMonth();
  const currentYear = now.getUTCFullYear();
  const db = createDatabase(c.env.DB);
  const [cycle] = await db
    .select({ status: BillingCycle.status })
    .from(BillingCycle)
    .where(
      and(
        eq(BillingCycle.periodMonth, currentMonth),
        eq(BillingCycle.periodYear, currentYear),
      ),
    )
    .limit(1);

  return getEffectiveBillingPeriod(now, cycle?.status);
}

function createLedgerNormalizationStatement(
  c: Context<BoardOpsEnv>,
  payment: typeof Payment.$inferSelect,
  targetStatus: string,
  period: { month: number; year: number } | null,
  now: string,
  description?: string,
) {
  const targetBalance = getLedgerTargetBalance(targetStatus, payment.amount);
  const defaultDescription = targetStatus === "APPROVED"
    ? getPaymentLedgerIntent("APPROVED", payment.amount, payment.method).description
    : getPaymentLedgerIntent("REJECTED", payment.amount, payment.method).description;

  return c.env.DB.prepare(`
    WITH current_state AS (
      SELECT COALESCE(SUM(le."amount"), 0) AS net
      FROM "LedgerEntry" le
      WHERE le."entityType" = 'Payment'
        AND le."entityId" = ?1
    ),
    correction AS (
      SELECT ?2 - net AS amount
      FROM current_state
    )
    INSERT INTO "LedgerEntry" (
      "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
      "description", "billingMonth", "billingYear", "createdAt"
    )
    SELECT
      ?3,
      p."userId",
      CASE WHEN ?4 = 1 AND correction.amount > 0 THEN 'DEPOSIT' ELSE 'ADJUSTMENT' END,
      correction.amount,
      COALESCE((
        SELECT le."runningBalance"
        FROM "LedgerEntry" le
        WHERE le."userId" = p."userId"
        ORDER BY le."createdAt" DESC, le.rowid DESC
        LIMIT 1
      ), 0) + correction.amount,
      'Payment',
      p."id",
      ?5,
      ?6,
      ?7,
      ?8
    FROM "Payment" p
    CROSS JOIN correction
    WHERE p."id" = ?1
      AND ABS(correction.amount) > 0.000001
  `).bind(
    payment.id,
    targetBalance,
    crypto.randomUUID(),
    targetStatus === "APPROVED" ? 1 : 0,
    description ?? defaultDescription,
    period?.month ?? null,
    period?.year ?? null,
    now,
  );
}

function createPaymentStatusStatement(
  c: Context<BoardOpsEnv>,
  paymentId: string,
  adminId: string,
  targetStatus: PaymentTargetStatus,
  period: { month: number; year: number } | null,
  now: string,
) {
  if (targetStatus === "APPROVED" && period) {
    return c.env.DB.prepare(`
      UPDATE "Payment"
      SET "status" = 'APPROVED',
          "approvedBy" = ?1,
          "effectiveMonth" = ?2,
          "effectiveYear" = ?3,
          "updatedAt" = ?4
      WHERE "id" = ?5
        AND "deletedAt" IS NULL
        AND "status" <> 'APPROVED'
    `).bind(adminId, period.month, period.year, now, paymentId);
  }

  return c.env.DB.prepare(`
    UPDATE "Payment"
    SET "status" = 'REJECTED',
        "approvedBy" = ?1,
        "updatedAt" = ?2
    WHERE "id" = ?3
      AND "deletedAt" IS NULL
      AND "status" <> 'REJECTED'
  `).bind(adminId, now, paymentId);
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

async function maybeLiftFinancialRestriction(
  c: Context<BoardOpsEnv>,
  userId: string,
): Promise<boolean> {
  const db = createDatabase(c.env.DB);
  const [enabledVar] = await db
    .select({ value: Variable.value })
    .from(Variable)
    .where(eq(Variable.key, "policy.lowBalance.enabled"))
    .limit(1);
  if (enabledVar?.value === "false") return false;

  const [requiredVar] = await db
    .select({ value: Variable.value })
    .from(Variable)
    .where(eq(Variable.key, "policy.lowBalance.requiredBalance"))
    .limit(1);
  const parsedRequired = requiredVar ? Number.parseFloat(requiredVar.value) : Number.NaN;
  const requiredBalance = Number.isFinite(parsedRequired) && parsedRequired !== 0
    ? parsedRequired
    : 1000;

  const [lastLedger] = await db
    .select({ runningBalance: LedgerEntry.runningBalance })
    .from(LedgerEntry)
    .where(eq(LedgerEntry.userId, userId))
    .orderBy(desc(LedgerEntry.createdAt))
    .limit(1);
  const availableBalance = Math.max(0, lastLedger?.runningBalance ?? 0);
  if (availableBalance < requiredBalance) return false;

  const restrictions = await db
    .select()
    .from(Restriction)
    .where(
      and(
        eq(Restriction.userId, userId),
        eq(Restriction.type, "FINANCIAL"),
        eq(Restriction.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(Restriction.appliedAt));

  const hasExemption = restrictions.some(
    (restriction) =>
      restriction.source === "MANUAL" && restriction.reason.includes("EXEMPTION"),
  );
  if (hasExemption) return false;

  const automatic = restrictions.find((restriction) => restriction.source === "AUTOMATIC");
  if (!automatic) return false;

  const now = new Date().toISOString();
  await db
    .update(Restriction)
    .set({
      status: "LIFTED",
      liftedAt: now,
      liftReason: `Balance restored to ₹${Math.round(availableBalance)} (≥ required ₹${requiredBalance}).`,
      updatedAt: now,
    })
    .where(and(eq(Restriction.id, automatic.id), eq(Restriction.status, "ACTIVE")));

  return true;
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

  app.patch("/api/payments/:id", async (c) => {
    const access = await requirePaymentAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { action?: unknown };
    const targetStatus = resolvePaymentTarget(body.action);
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!existing) return failure(c, "Payment not found", 404);
    if (existing.deletedAt) return failure(c, "Payment is scheduled for deletion", 422);
    if (existing.status === targetStatus) {
      return c.json<ApiSuccess<ReturnType<typeof serializePayment>>>({
        success: true,
        data: serializePayment(existing),
        requestId: c.get("requestId"),
      });
    }

    if (targetStatus === "APPROVED" && existing.billId) {
      const [bill] = await db
        .select({ status: Bill.status, deletedAt: Bill.deletedAt })
        .from(Bill)
        .where(eq(Bill.id, existing.billId))
        .limit(1);
      if (!bill || bill.status === "VOID" || bill.status === "DELETED" || bill.deletedAt) {
        return failure(c, "Cannot approve payment for a voided or deleted bill", 422);
      }
    }

    const period = targetStatus === "APPROVED" ? await getApprovalPeriod(c) : null;
    const now = new Date().toISOString();
    const statements = [
      createLedgerNormalizationStatement(c, existing, targetStatus, period, now),
      createPaymentStatusStatement(c, id, admin.id, targetStatus, period, now),
    ];
    if (existing.billId) {
      statements.push(createBillRecomputeStatement(c, existing.billId, now));
    }

    const results = await c.env.DB.batch(statements);
    const paymentUpdateChanges = Number(results[1]?.meta?.changes ?? 0);
    const [updated] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!updated) return failure(c, "Payment not found", 404);

    if (paymentUpdateChanges === 0) {
      return c.json<ApiSuccess<ReturnType<typeof serializePayment>>>({
        success: true,
        data: serializePayment(updated),
        requestId: c.get("requestId"),
      });
    }

    let restrictionLifted = false;
    if (targetStatus === "APPROVED") {
      restrictionLifted = await maybeLiftFinancialRestriction(c, existing.userId);
      if (restrictionLifted) {
        await createNotification(c, {
          userId: existing.userId,
          title: "Meal restriction lifted",
          description:
            "Your available balance has been restored. Meal booking is now enabled. Please review and re-book any future meals that were turned off.",
          type: "SUCCESS",
          priority: "HIGH",
          route: "user-meals",
        });
      }
    }

    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    await createNotification(c, {
      userId: existing.userId,
      title: `Payment ${targetStatus.toLowerCase()}`,
      description: targetStatus === "APPROVED"
        ? `Your payment of ₹${existing.amount} via ${existing.method} has been approved. ${period ? `Effective billing cycle: ${monthNames[period.month]} ${period.year}.` : ""}`
        : `Your payment of ₹${existing.amount} via ${existing.method} has been rejected.`,
      type: targetStatus === "APPROVED" ? "SUCCESS" : "WARNING",
      priority: "HIGH",
      route: "billing",
    });

    await logAudit(c, {
      actorId: admin.id,
      action: `PAYMENT_${targetStatus}`,
      entity: "Payment",
      entityId: id,
      oldValue: serializePayment(existing),
      newValue: {
        ...serializePayment(updated),
        effectiveMonth: period?.month ?? updated.effectiveMonth,
        effectiveYear: period?.year ?? updated.effectiveYear,
        restrictionLifted,
      },
    });

    return c.json<ApiSuccess<ReturnType<typeof serializePayment>>>({
      success: true,
      data: serializePayment(updated),
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/payments/:id", async (c) => {
    const access = await requirePaymentAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!existing) return failure(c, "Payment not found", 404);
    if (existing.deletedAt) {
      return failure(c, "Payment is already scheduled for deletion", 422);
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const deletionDate = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const statements = [
      createLedgerNormalizationStatement(
        c,
        existing,
        "DELETED",
        null,
        now,
        `Payment scheduled for deletion: ledger normalized for ₹${Math.round(existing.amount).toLocaleString("en-IN")}`,
      ),
      c.env.DB.prepare(`
        UPDATE "Payment"
        SET "deletedAt" = ?1,
            "deletedBy" = ?2,
            "deletionReason" = ?3,
            "status" = 'DELETED',
            "updatedAt" = ?4
        WHERE "id" = ?5
          AND "deletedAt" IS NULL
      `).bind(deletionDate, admin.id, body.reason ?? null, now, id),
    ];
    if (existing.billId) {
      statements.push(createBillRecomputeStatement(c, existing.billId, now));
    }

    const results = await c.env.DB.batch(statements);
    const updateChanges = Number(results[1]?.meta?.changes ?? 0);
    if (updateChanges === 0) {
      return failure(c, "Payment is already scheduled for deletion", 422);
    }

    await logAudit(c, {
      actorId: admin.id,
      action: "PAYMENT_SOFT_DELETE",
      entity: "Payment",
      entityId: id,
      oldValue: serializePayment(existing),
      newValue: { deletedAt: deletionDate, status: "DELETED", reason: body.reason },
      reason: body.reason,
    });

    const response = { success: true as const, permanentDeletion: deletionDate };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/payments/:id/restore", async (c) => {
    const access = await requirePaymentAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!existing) return failure(c, "Payment not found", 404);
    if (!existing.deletedAt) {
      return failure(c, "This payment is not in the deletion queue", 422);
    }

    const now = new Date().toISOString();
    const statements = [
      createLedgerNormalizationStatement(
        c,
        existing,
        "PENDING",
        null,
        now,
        "Payment restored to pending: ledger normalized",
      ),
      c.env.DB.prepare(`
        UPDATE "Payment"
        SET "deletedAt" = NULL,
            "deletedBy" = NULL,
            "deletionReason" = NULL,
            "status" = 'PENDING',
            "updatedAt" = ?1
        WHERE "id" = ?2
          AND "deletedAt" IS NOT NULL
      `).bind(now, id),
    ];
    if (existing.billId) {
      statements.push(createBillRecomputeStatement(c, existing.billId, now));
    }

    const results = await c.env.DB.batch(statements);
    const updateChanges = Number(results[1]?.meta?.changes ?? 0);
    if (updateChanges === 0) {
      return failure(c, "This payment is not in the deletion queue", 422);
    }

    const [restored] = await db.select().from(Payment).where(eq(Payment.id, id)).limit(1);
    if (!restored) return failure(c, "Payment not found", 404);
    const [resident] = await db
      .select({ name: User.name, email: User.email, room: User.room, avatarUrl: User.avatarUrl })
      .from(User)
      .where(eq(User.id, restored.userId))
      .limit(1);
    const response = {
      ...serializePayment(restored),
      user: resident ?? null,
    };

    await logAudit(c, {
      actorId: admin.id,
      action: "PAYMENT_RESTORE",
      entity: "Payment",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: databaseDateToIso(existing.deletedAt) },
      newValue: { status: "PENDING" },
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
