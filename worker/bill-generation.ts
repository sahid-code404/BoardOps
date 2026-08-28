import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  sql,
} from "drizzle-orm";

import { computeProrationFactor } from "./bill-proration";
import { getBillingPeriodRange, normalizeBillingPeriod, periodLabel } from "./billing-cycle-engine";
import { createDatabase } from "./db/client";
import {
  Bill,
  Expense,
  GuestMeal,
  MealConfiguration,
  MealEntry,
  User,
  Variable,
} from "./db/schema";
import {
  formatReferenceNumber,
  getNextReferenceSequence,
  getReferencePrefix,
} from "./reference-numbers";

const BILLING_VARIABLE_KEYS = [
  "billing.roomRent",
  "billing.cleaningCharges",
  "billing.guestMealCharge",
  "policy.billing.dueDateDay",
  "system.billNumberFormat",
] as const;

export type GenerateBillsOptions = {
  adminId: string;
  dueDate?: Date;
  cycleId?: string;
  now?: Date;
};

export type BillGenerationEvent = {
  userId: string;
  userName: string;
  kind: "created" | "increased";
  totalAmount: number;
  delta: number;
  dueDate: string;
};

export type GenerateBillsResult = {
  created: number;
  updated: number;
  skipped: number;
  totalExpenses: number;
  totalResidentMeals: number;
  totalGuestMeals: number;
  guestRevenue: number;
  perMealCharge: number;
  events: BillGenerationEvent[];
};

export function calculateBillAmounts(input: {
  residentMealCount: number;
  perMealCharge: number;
  roomRent: number;
  cleaning: number;
  prorationFactor: number;
}) {
  const mealCharges = Math.round(input.residentMealCount * input.perMealCharge);
  const otherCharges = input.roomRent + input.cleaning;
  const proratedOtherCharges = Math.round(otherCharges * input.prorationFactor);
  return {
    mealCharges,
    otherCharges,
    proratedOtherCharges,
    totalAmount: mealCharges + proratedOtherCharges,
  };
}

export function getBillLedgerTarget(totalAmount: number): number {
  return -totalAmount;
}

function numericVariable(value: string | undefined, fallback = 0): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dueDateForPeriod(month: number, year: number, day: number): Date {
  return new Date(Date.UTC(year, month + 1, day, 0, 0, 0, 0));
}

function createBillUpsertStatement(
  binding: D1Database,
  input: {
    id: string;
    billNumber: string | null;
    userId: string;
    month: number;
    year: number;
    mealCharges: number;
    otherCharges: number;
    totalAmount: number;
    generatedAt: string;
    dueDate: string;
    snapshot: string;
    cycleId: string | null;
    customDueDate: boolean;
  },
) {
  return binding.prepare(`
    INSERT INTO "Bill" (
      "id", "billNumber", "userId", "periodMonth", "periodYear",
      "mealCharges", "otherCharges", "adjustments", "totalAmount",
      "paidAmount", "dueAmount", "previousDue", "status", "generatedAt",
      "dueDate", "snapshot", "billingCycleId", "updatedAt"
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5,
      ?6, ?7, 0, ?8,
      0, ?8, 0, 'GENERATED', ?9,
      ?10, ?11, ?12, ?13
    )
    ON CONFLICT ("userId", "periodMonth", "periodYear") DO UPDATE SET
      "billNumber" = COALESCE("Bill"."billNumber", excluded."billNumber"),
      "mealCharges" = excluded."mealCharges",
      "otherCharges" = excluded."otherCharges",
      "totalAmount" = excluded."totalAmount",
      "paidAmount" = MAX(0, COALESCE((
        SELECT SUM(CASE
          WHEN p."status" = 'APPROVED' THEN p."amount"
          WHEN p."status" = 'REFUNDED' THEN -p."amount"
          ELSE 0
        END)
        FROM "Payment" p
        WHERE p."billId" = "Bill"."id"
          AND p."deletedAt" IS NULL
          AND p."status" IN ('APPROVED', 'REFUNDED')
      ), 0)),
      "dueAmount" = MAX(0, excluded."totalAmount" - MAX(0, COALESCE((
        SELECT SUM(CASE
          WHEN p."status" = 'APPROVED' THEN p."amount"
          WHEN p."status" = 'REFUNDED' THEN -p."amount"
          ELSE 0
        END)
        FROM "Payment" p
        WHERE p."billId" = "Bill"."id"
          AND p."deletedAt" IS NULL
          AND p."status" IN ('APPROVED', 'REFUNDED')
      ), 0))),
      "status" = CASE
        WHEN excluded."totalAmount" > 0 AND MAX(0, COALESCE((
          SELECT SUM(CASE
            WHEN p."status" = 'APPROVED' THEN p."amount"
            WHEN p."status" = 'REFUNDED' THEN -p."amount"
            ELSE 0
          END)
          FROM "Payment" p
          WHERE p."billId" = "Bill"."id"
            AND p."deletedAt" IS NULL
            AND p."status" IN ('APPROVED', 'REFUNDED')
        ), 0)) >= excluded."totalAmount" THEN 'PAID'
        WHEN MAX(0, COALESCE((
          SELECT SUM(CASE
            WHEN p."status" = 'APPROVED' THEN p."amount"
            WHEN p."status" = 'REFUNDED' THEN -p."amount"
            ELSE 0
          END)
          FROM "Payment" p
          WHERE p."billId" = "Bill"."id"
            AND p."deletedAt" IS NULL
            AND p."status" IN ('APPROVED', 'REFUNDED')
        ), 0)) > 0 THEN 'PARTIALLY_PAID'
        ELSE 'GENERATED'
      END,
      "generatedAt" = excluded."generatedAt",
      "dueDate" = CASE
        WHEN ?14 = 1 THEN excluded."dueDate"
        ELSE COALESCE("Bill"."dueDate", excluded."dueDate")
      END,
      "snapshot" = excluded."snapshot",
      "billingCycleId" = CASE
        WHEN excluded."billingCycleId" IS NULL THEN "Bill"."billingCycleId"
        ELSE excluded."billingCycleId"
      END,
      "updatedAt" = excluded."updatedAt"
    WHERE "Bill"."status" <> 'VOID'
      AND "Bill"."deletedAt" IS NULL
  `).bind(
    input.id,
    input.billNumber,
    input.userId,
    input.month,
    input.year,
    input.mealCharges,
    input.otherCharges,
    input.totalAmount,
    input.generatedAt,
    input.dueDate,
    input.snapshot,
    input.cycleId,
    input.generatedAt,
    input.customDueDate ? 1 : 0,
  );
}

function createBillLedgerNormalizationStatement(
  binding: D1Database,
  input: {
    userId: string;
    month: number;
    year: number;
    description: string;
    now: string;
  },
) {
  return binding.prepare(`
    WITH current_bill AS (
      SELECT b."id", b."userId", b."totalAmount"
      FROM "Bill" b
      WHERE b."userId" = ?1
        AND b."periodMonth" = ?2
        AND b."periodYear" = ?3
        AND b."deletedAt" IS NULL
        AND b."status" <> 'VOID'
      LIMIT 1
    ),
    current_state AS (
      SELECT COALESCE(SUM(le."amount"), 0) AS net
      FROM "LedgerEntry" le
      JOIN current_bill cb
        ON le."entityType" = 'Bill'
       AND le."entityId" = cb."id"
    ),
    correction AS (
      SELECT cb."id", cb."userId", (-cb."totalAmount") - cs.net AS amount
      FROM current_bill cb
      CROSS JOIN current_state cs
    )
    INSERT INTO "LedgerEntry" (
      "id", "userId", "type", "amount", "runningBalance", "entityType",
      "entityId", "description", "billingMonth", "billingYear", "createdAt"
    )
    SELECT
      ?4,
      correction."userId",
      'BILL_SETTLEMENT',
      correction.amount,
      COALESCE((
        SELECT le."runningBalance"
        FROM "LedgerEntry" le
        WHERE le."userId" = correction."userId"
        ORDER BY le."createdAt" DESC, le.rowid DESC
        LIMIT 1
      ), 0) + correction.amount,
      'Bill',
      correction."id",
      ?5,
      ?2,
      ?3,
      ?6
    FROM correction
    WHERE ABS(correction.amount) > 0.000001
  `).bind(
    input.userId,
    input.month,
    input.year,
    crypto.randomUUID(),
    input.description,
    input.now,
  );
}

export async function generateBillsForPeriod(
  binding: D1Database,
  month: number,
  year: number,
  options: GenerateBillsOptions,
): Promise<GenerateBillsResult> {
  if (!normalizeBillingPeriod(month, year)) {
    throw new Error("INVALID_BILLING_PERIOD");
  }

  const nowDate = options.now ?? new Date();
  if (Number.isNaN(nowDate.getTime())) throw new Error("INVALID_GENERATION_DATE");
  if (options.dueDate && Number.isNaN(options.dueDate.getTime())) {
    throw new Error("INVALID_DUE_DATE");
  }

  const now = nowDate.toISOString();
  const db = createDatabase(binding);
  const { start, end } = getBillingPeriodRange(month, year);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [variableRows, residents, expenseRow, mealConfigs, confirmedMeals, guestMeals] = await Promise.all([
    db
      .select({ key: Variable.key, value: Variable.value })
      .from(Variable)
      .where(inArray(Variable.key, [...BILLING_VARIABLE_KEYS])),
    db
      .select({
        id: User.id,
        name: User.name,
        createdAt: User.createdAt,
      })
      .from(User)
      .where(and(eq(User.status, "ACTIVE"), eq(User.role, "USER"), isNull(User.deletedAt))),
    db
      .select({ total: sql<number>`coalesce(sum(${Expense.amount}), 0)` })
      .from(Expense)
      .where(
        and(
          gte(Expense.expenseDate, startIso),
          lte(Expense.expenseDate, endIso),
          isNull(Expense.deletedAt),
          ne(Expense.status, "DELETED"),
        ),
      ),
    db.select({ id: MealConfiguration.id, name: MealConfiguration.name }).from(MealConfiguration),
    db
      .select({ userId: MealEntry.userId, mealId: MealEntry.mealId })
      .from(MealEntry)
      .innerJoin(User, eq(MealEntry.userId, User.id))
      .where(
        and(
          gte(MealEntry.serviceDate, startIso),
          lte(MealEntry.serviceDate, endIso),
          inArray(MealEntry.status, ["ON", "LOCKED"]),
          eq(User.role, "USER"),
        ),
      ),
    db
      .select({ guestCount: GuestMeal.guestCount })
      .from(GuestMeal)
      .where(and(gte(GuestMeal.serviceDate, startIso), lte(GuestMeal.serviceDate, endIso))),
  ]);

  if (residents.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      totalExpenses: Number(expenseRow[0]?.total ?? 0) || 0,
      totalResidentMeals: confirmedMeals.length,
      totalGuestMeals: guestMeals.reduce((sum, meal) => sum + (meal.guestCount || 1), 0),
      guestRevenue: 0,
      perMealCharge: 0,
      events: [],
    };
  }

  const variables = new Map(variableRows.map((row) => [row.key, row.value]));
  const roomRent = numericVariable(variables.get("billing.roomRent"));
  const cleaning = numericVariable(variables.get("billing.cleaningCharges"));
  const guestChargePerMeal = numericVariable(variables.get("billing.guestMealCharge"));
  const parsedDueDateDay = Number.parseInt(variables.get("policy.billing.dueDateDay") ?? "10", 10);
  const dueDateDay = Number.isFinite(parsedDueDateDay) && parsedDueDateDay > 0 ? parsedDueDateDay : 10;
  const defaultDueDate = dueDateForPeriod(month, year, dueDateDay);
  const effectiveNewDueDate = options.dueDate ?? defaultDueDate;

  const totalExpenses = Number(expenseRow[0]?.total ?? 0) || 0;
  const totalResidentMeals = confirmedMeals.length;
  const totalGuestMeals = guestMeals.reduce((sum, meal) => sum + (meal.guestCount || 1), 0);
  const guestRevenue = totalGuestMeals * guestChargePerMeal;
  const perMealCharge = totalResidentMeals > 0
    ? Math.max(0, (totalExpenses - guestRevenue) / totalResidentMeals)
    : 0;

  const mealNameById = new Map(mealConfigs.map((meal) => [meal.id, meal.name]));
  const countsByUser = new Map<string, Record<string, number>>();
  for (const entry of confirmedMeals) {
    const counts = countsByUser.get(entry.userId) ?? {};
    const name = mealNameById.get(entry.mealId) ?? "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
    countsByUser.set(entry.userId, counts);
  }

  const residentIds = residents.map((resident) => resident.id);
  const existingBills = await db
    .select({
      id: Bill.id,
      userId: Bill.userId,
      status: Bill.status,
      deletedAt: Bill.deletedAt,
      totalAmount: Bill.totalAmount,
      dueDate: Bill.dueDate,
      billNumber: Bill.billNumber,
    })
    .from(Bill)
    .where(
      and(
        inArray(Bill.userId, residentIds),
        eq(Bill.periodMonth, month),
        eq(Bill.periodYear, year),
      ),
    );
  const existingByUser = new Map(existingBills.map((bill) => [bill.userId, bill]));

  let nextBillSequence = 1;
  if (options.cycleId) {
    const prefix = getReferencePrefix("bill");
    const referenceRows = await db
      .select({ billNumber: Bill.billNumber })
      .from(Bill)
      .where(like(Bill.billNumber, `${prefix}-${nowDate.getUTCFullYear()}-%`));
    nextBillSequence = getNextReferenceSequence(
      referenceRows.map((row) => row.billNumber),
      "bill",
      nowDate,
    );
  }
  const billNumberFormat = variables.get("system.billNumberFormat") ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const events: BillGenerationEvent[] = [];
  const statements: D1PreparedStatement[] = [];
  const label = periodLabel(month, year);

  for (const resident of residents) {
    const existing = existingByUser.get(resident.id);
    if (existing && (existing.status === "VOID" || existing.deletedAt)) {
      skipped += 1;
      continue;
    }

    const counts = countsByUser.get(resident.id) ?? {};
    const residentMealCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const proration = computeProrationFactor(new Date(String(resident.createdAt)), month, year);
    const amounts = calculateBillAmounts({
      residentMealCount,
      perMealCharge,
      roomRent,
      cleaning,
      prorationFactor: proration.factor,
    });

    let billNumber = existing?.billNumber ?? null;
    if (options.cycleId && !billNumber) {
      billNumber = formatReferenceNumber("bill", nextBillSequence, nowDate, billNumberFormat);
      nextBillSequence += 1;
    }

    const snapshot = JSON.stringify({
      counts,
      residentMealCount,
      perMealCharge,
      mealCharges: amounts.mealCharges,
      roomRent,
      cleaning,
      otherCharges: amounts.otherCharges,
      proratedOtherCharges: amounts.proratedOtherCharges,
      prorationFactor: proration.factor,
      daysEnrolled: proration.daysEnrolled,
      daysInMonth: proration.daysInMonth,
      totalExpenses,
      guestRevenue,
      totalResidentMeals,
      totalGuestMeals,
      generatedBy: options.adminId,
      ...(options.cycleId ? { billingCycleId: options.cycleId } : {}),
    });

    const dueDate = options.dueDate
      ? options.dueDate.toISOString()
      : existing?.dueDate
        ? String(existing.dueDate)
        : effectiveNewDueDate.toISOString();

    statements.push(
      createBillUpsertStatement(binding, {
        id: existing?.id ?? crypto.randomUUID(),
        billNumber,
        userId: resident.id,
        month,
        year,
        mealCharges: amounts.mealCharges,
        otherCharges: amounts.proratedOtherCharges,
        totalAmount: amounts.totalAmount,
        generatedAt: now,
        dueDate,
        snapshot,
        cycleId: options.cycleId ?? null,
        customDueDate: !!options.dueDate,
      }),
      createBillLedgerNormalizationStatement(binding, {
        userId: resident.id,
        month,
        year,
        description: `Bill for ${label}`,
        now,
      }),
    );

    if (existing) {
      updated += 1;
      if (amounts.totalAmount > existing.totalAmount) {
        events.push({
          userId: resident.id,
          userName: resident.name,
          kind: "increased",
          totalAmount: amounts.totalAmount,
          delta: amounts.totalAmount - existing.totalAmount,
          dueDate,
        });
      }
    } else {
      created += 1;
      events.push({
        userId: resident.id,
        userName: resident.name,
        kind: "created",
        totalAmount: amounts.totalAmount,
        delta: amounts.totalAmount,
        dueDate,
      });
    }
  }

  if (statements.length > 0) {
    await binding.batch(statements);
  }

  return {
    created,
    updated,
    skipped,
    totalExpenses,
    totalResidentMeals,
    totalGuestMeals,
    guestRevenue,
    perMealCharge,
    events,
  };
}
