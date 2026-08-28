import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  notInArray,
} from "drizzle-orm";

import { generateBillsForPeriod, type BillGenerationEvent } from "./bill-generation";
import {
  getBillingPeriodRange,
  getBillingReadiness,
  normalizeBillingPeriod,
  periodLabel,
} from "./billing-cycle-engine";
import { createDatabase, type BoardOpsDatabase } from "./db/client";
import {
  Bill,
  BillingCycle,
  Expense,
  Formula,
  GuestMeal,
  MealConfiguration,
  MealEntry,
  MonthlySnapshot,
  Refund,
  User,
  Variable,
} from "./db/schema";
import {
  formatReferenceNumber,
  getNextReferenceSequence,
} from "./reference-numbers";

export type ClosingSummary = {
  totalExpenses: number;
  totalResidentMeals: number;
  totalGuestMeals: number;
  guestRevenue: number;
  mealCharge: number;
  billsGenerated: number;
  refundQueueTotal: number;
  outstandingDue: number;
};

export type ClosingResult = {
  success: boolean;
  cycleId: string;
  status: string;
  summary: ClosingSummary;
  billEvents: BillGenerationEvent[];
  refundsQueued: number;
  error?: string;
};

type SettlementBill = {
  id: string;
  userId: string;
  totalAmount: number;
  paidAmount: number;
};

export type SettlementPlan = {
  refundQueueTotal: number;
  outstandingDue: number;
  overpayments: Array<{ billId: string; userId: string; amount: number }>;
};

type SnapshotData = {
  mealsData: string;
  expensesData: string;
  variablesData: string;
  formulaData: string;
  totalExpenses: number;
  totalResidentMeals: number;
  totalGuestMeals: number;
  guestRevenue: number;
  mealCharge: number;
};

const EMPTY_SUMMARY: ClosingSummary = {
  totalExpenses: 0,
  totalResidentMeals: 0,
  totalGuestMeals: 0,
  guestRevenue: 0,
  mealCharge: 0,
  billsGenerated: 0,
  refundQueueTotal: 0,
  outstandingDue: 0,
};

export function calculateSettlement(rows: SettlementBill[]): SettlementPlan {
  let refundQueueTotal = 0;
  let outstandingDue = 0;
  const overpayments: SettlementPlan["overpayments"] = [];

  for (const bill of rows) {
    const paid = Math.max(0, bill.paidAmount);
    if (paid > bill.totalAmount) {
      const amount = paid - bill.totalAmount;
      refundQueueTotal += amount;
      overpayments.push({ billId: bill.id, userId: bill.userId, amount });
    } else if (bill.totalAmount > paid) {
      outstandingDue += bill.totalAmount - paid;
    }
  }

  return { refundQueueTotal, outstandingDue, overpayments };
}

async function buildSnapshotData(
  db: BoardOpsDatabase,
  month: number,
  year: number,
): Promise<SnapshotData> {
  const { start, end } = getBillingPeriodRange(month, year);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const residents = await db
    .select({ id: User.id, name: User.name, room: User.room })
    .from(User)
    .where(and(eq(User.status, "ACTIVE"), eq(User.role, "USER"), isNull(User.deletedAt)));
  const meals = await db
    .select({ id: MealConfiguration.id, name: MealConfiguration.name, displayName: MealConfiguration.displayName })
    .from(MealConfiguration)
    .where(eq(MealConfiguration.status, "ACTIVE"));
  const entries = await db
    .select({
      userId: MealEntry.userId,
      mealId: MealEntry.mealId,
      status: MealEntry.status,
      serviceDate: MealEntry.serviceDate,
    })
    .from(MealEntry)
    .innerJoin(User, eq(MealEntry.userId, User.id))
    .where(
      and(
        gte(MealEntry.serviceDate, startIso),
        lte(MealEntry.serviceDate, endIso),
        eq(User.role, "USER"),
      ),
    );
  const guests = await db
    .select({
      mealId: GuestMeal.mealId,
      guestCount: GuestMeal.guestCount,
      serviceDate: GuestMeal.serviceDate,
    })
    .from(GuestMeal)
    .where(and(gte(GuestMeal.serviceDate, startIso), lte(GuestMeal.serviceDate, endIso)));
  const expenses = await db
    .select({
      id: Expense.id,
      title: Expense.title,
      category: Expense.category,
      amount: Expense.amount,
      expenseDate: Expense.expenseDate,
      paidTo: Expense.paidTo,
      receiptUrl: Expense.receiptUrl,
    })
    .from(Expense)
    .where(
      and(
        gte(Expense.expenseDate, startIso),
        lte(Expense.expenseDate, endIso),
        isNull(Expense.deletedAt),
        ne(Expense.status, "DELETED"),
      ),
    );
  const variables = await db
    .select({
      key: Variable.key,
      value: Variable.value,
      type: Variable.type,
      name: Variable.name,
    })
    .from(Variable)
    .where(eq(Variable.status, "ACTIVE"));
  const formulas = await db
    .select({
      key: Formula.key,
      name: Formula.name,
      expression: Formula.expression,
      version: Formula.version,
      returnType: Formula.returnType,
    })
    .from(Formula)
    .where(eq(Formula.status, "ACTIVE"));

  const mealNameById = new Map(meals.map((meal) => [meal.id, meal.name]));
  const residentMeals: Record<string, Record<string, number>> = {};
  for (const resident of residents) residentMeals[resident.id] = {};

  let totalResidentMeals = 0;
  for (const entry of entries) {
    if (entry.status !== "ON" && entry.status !== "LOCKED") continue;
    const mealName = mealNameById.get(entry.mealId) ?? "unknown";
    residentMeals[entry.userId] ??= {};
    residentMeals[entry.userId][mealName] = (residentMeals[entry.userId][mealName] ?? 0) + 1;
    totalResidentMeals += 1;
  }

  const guestMealCounts: Record<string, number> = {};
  let totalGuestMeals = 0;
  for (const guest of guests) {
    const mealName = mealNameById.get(guest.mealId) ?? "unknown";
    const count = guest.guestCount || 1;
    guestMealCounts[mealName] = (guestMealCounts[mealName] ?? 0) + count;
    totalGuestMeals += count;
  }

  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const variableMap = new Map(variables.map((variable) => [variable.key, Number.parseFloat(variable.value) || 0]));
  const guestCharge = variableMap.get("billing.guestMealCharge") ?? 0;
  const guestRevenue = totalGuestMeals * guestCharge;
  const mealCharge = totalResidentMeals > 0
    ? Math.max(0, (totalExpenses - guestRevenue) / totalResidentMeals)
    : 0;

  return {
    mealsData: JSON.stringify({
      residentMeals,
      guestMealCounts,
      totalResidentMeals,
      totalGuestMeals,
      residents,
      mealConfigs: meals,
    }),
    expensesData: JSON.stringify({ expenses, totalExpenses }),
    variablesData: JSON.stringify(
      Object.fromEntries(variables.map((variable) => [
        variable.key,
        { value: variable.value, type: variable.type, name: variable.name },
      ])),
    ),
    formulaData: JSON.stringify(
      Object.fromEntries(formulas.map((formula) => [
        formula.key,
        {
          name: formula.name,
          expression: formula.expression,
          version: formula.version,
          returnType: formula.returnType,
        },
      ])),
    ),
    totalExpenses,
    totalResidentMeals,
    totalGuestMeals,
    guestRevenue,
    mealCharge,
  };
}

async function ensurePreparingCycle(
  db: BoardOpsDatabase,
  month: number,
  year: number,
  adminId: string,
  readiness: unknown,
  now: string,
) {
  const [existing] = await db
    .select()
    .from(BillingCycle)
    .where(and(eq(BillingCycle.periodMonth, month), eq(BillingCycle.periodYear, year)))
    .limit(1);

  if (existing) {
    if (existing.status === "CLOSED") return existing;
    if (["BILLS_GENERATED", "SETTLED", "SNAPSHOT_CREATED"].includes(existing.status)) {
      return existing;
    }
    await db
      .update(BillingCycle)
      .set({
        status: "PREPARING",
        startedBy: adminId,
        startedAt: now,
        readiness: JSON.stringify(readiness),
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(BillingCycle.id, existing.id));
    return { ...existing, status: "PREPARING", startedBy: adminId, startedAt: now, updatedAt: now };
  }

  const id = crypto.randomUUID();
  await db.insert(BillingCycle).values({
    id,
    periodMonth: month,
    periodYear: year,
    status: "PREPARING",
    readiness: JSON.stringify(readiness),
    startedBy: adminId,
    startedAt: now,
    totalExpenses: 0,
    totalMeals: 0,
    totalGuestMeals: 0,
    mealCharge: 0,
    billsGenerated: 0,
    refundQueueTotal: 0,
    outstandingDue: 0,
    updatedAt: now,
  });
  const [created] = await db.select().from(BillingCycle).where(eq(BillingCycle.id, id)).limit(1);
  if (!created) throw new Error("Billing cycle could not be created");
  return created;
}

async function persistSnapshotAndLockExpenses(
  binding: D1Database,
  cycleId: string,
  month: number,
  year: number,
  snapshot: SnapshotData,
  now: string,
): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const { start, end } = getBillingPeriodRange(month, year);
  await binding.batch([
    binding.prepare(`DELETE FROM "MonthlySnapshot" WHERE "billingCycleId" = ?1`).bind(cycleId),
    binding.prepare(`
      INSERT INTO "MonthlySnapshot" (
        "id", "billingCycleId", "mealsData", "expensesData", "variablesData", "formulaData",
        "totalExpenses", "totalResidentMeals", "totalGuestMeals", "guestRevenue", "mealCharge"
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `).bind(
      snapshotId,
      cycleId,
      snapshot.mealsData,
      snapshot.expensesData,
      snapshot.variablesData,
      snapshot.formulaData,
      snapshot.totalExpenses,
      snapshot.totalResidentMeals,
      snapshot.totalGuestMeals,
      snapshot.guestRevenue,
      snapshot.mealCharge,
    ),
    binding.prepare(`
      UPDATE "BillingCycle"
      SET "status" = 'SNAPSHOT_CREATED',
          "snapshotId" = ?1,
          "totalExpenses" = ?2,
          "totalMeals" = ?3,
          "totalGuestMeals" = ?4,
          "mealCharge" = ?5,
          "errorMessage" = NULL,
          "updatedAt" = ?6
      WHERE "id" = ?7
        AND "status" IN ('OPEN', 'PREPARING', 'SNAPSHOT_CREATED')
    `).bind(
      snapshotId,
      snapshot.totalExpenses,
      snapshot.totalResidentMeals,
      snapshot.totalGuestMeals,
      snapshot.mealCharge,
      now,
      cycleId,
    ),
    binding.prepare(`
      UPDATE "Expense"
      SET "status" = 'LOCKED',
          "lockedAt" = ?1,
          "lockedByCycleId" = ?2,
          "updatedAt" = ?1
      WHERE "expenseDate" >= ?3
        AND "expenseDate" <= ?4
        AND "deletedAt" IS NULL
        AND "status" <> 'DELETED'
        AND "lockedAt" IS NULL
    `).bind(now, cycleId, start.toISOString(), end.toISOString()),
  ]);
  return snapshotId;
}

async function settleCycle(
  binding: D1Database,
  db: BoardOpsDatabase,
  cycleId: string,
  month: number,
  year: number,
  adminId: string,
  billGeneration: Awaited<ReturnType<typeof generateBillsForPeriod>>,
  nowDate: Date,
): Promise<{ plan: SettlementPlan; refundsQueued: number }> {
  const bills = await db
    .select({
      id: Bill.id,
      userId: Bill.userId,
      totalAmount: Bill.totalAmount,
      paidAmount: Bill.paidAmount,
    })
    .from(Bill)
    .where(
      and(
        eq(Bill.periodMonth, month),
        eq(Bill.periodYear, year),
        eq(Bill.billingCycleId, cycleId),
        isNull(Bill.deletedAt),
        notInArray(Bill.status, ["VOID", "DELETED"]),
      ),
    );
  const plan = calculateSettlement(bills);

  const activeRefunds = await db
    .select({ userId: Refund.userId })
    .from(Refund)
    .where(
      and(
        eq(Refund.billingCycleId, cycleId),
        inArray(Refund.status, ["PENDING", "PARTIALLY_PAID"]),
      ),
    );
  const activeRefundUsers = new Set(activeRefunds.map((refund) => refund.userId));
  const toQueue = plan.overpayments.filter((item) => !activeRefundUsers.has(item.userId));

  let nextRefundSequence = 1;
  let refundFormat: string | null = null;
  if (toQueue.length > 0) {
    const year = nowDate.getUTCFullYear();
    const [formatRow] = await db
      .select({ value: Variable.value })
      .from(Variable)
      .where(eq(Variable.key, "system.refundNumberFormat"))
      .limit(1);
    refundFormat = formatRow?.value?.trim() || null;
    const existing = await db
      .select({ value: Refund.refundNumber })
      .from(Refund)
      .where(like(Refund.refundNumber, `REF-${year}-%`));
    nextRefundSequence = getNextReferenceSequence(
      existing.map((row) => row.value),
      "refund",
      nowDate,
    );
  }

  const now = nowDate.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const item of toQueue) {
    const refundNumber = formatReferenceNumber(
      "refund",
      nextRefundSequence++,
      nowDate,
      refundFormat,
    );
    statements.push(
      binding.prepare(`
        INSERT INTO "Refund" (
          "id", "refundNumber", "userId", "billId", "billingCycleId", "amount",
          "paidAmount", "remainingAmount", "status", "notes", "processedBy", "processedAt", "updatedAt"
        )
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0, ?6, 'PENDING', ?7, ?8, ?9, ?9
        WHERE NOT EXISTS (
          SELECT 1
          FROM "Refund"
          WHERE "userId" = ?3
            AND "billingCycleId" = ?5
            AND "status" IN ('PENDING', 'PARTIALLY_PAID')
        )
      `).bind(
        crypto.randomUUID(),
        refundNumber,
        item.userId,
        item.billId,
        cycleId,
        item.amount,
        `Auto-created refund: overpayment after bill generation for ${periodLabel(month, year)}`,
        adminId,
        now,
      ),
    );
  }

  statements.push(
    binding.prepare(`
      UPDATE "BillingCycle"
      SET "status" = 'BILLS_GENERATED',
          "totalExpenses" = ?1,
          "totalMeals" = ?2,
          "totalGuestMeals" = ?3,
          "mealCharge" = ?4,
          "billsGenerated" = ?5,
          "refundQueueTotal" = ?6,
          "outstandingDue" = ?7,
          "errorMessage" = NULL,
          "updatedAt" = ?8
      WHERE "id" = ?9
        AND "status" IN ('SNAPSHOT_CREATED', 'BILLS_GENERATED')
    `).bind(
      billGeneration.totalExpenses,
      billGeneration.totalResidentMeals,
      billGeneration.totalGuestMeals,
      billGeneration.perMealCharge,
      billGeneration.created + billGeneration.updated,
      plan.refundQueueTotal,
      plan.outstandingDue,
      now,
      cycleId,
    ),
  );

  const results = await binding.batch(statements);
  const refundsQueued = results
    .slice(0, Math.max(0, results.length - 1))
    .reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  return { plan, refundsQueued };
}

async function finalizeCycle(
  binding: D1Database,
  cycleId: string,
  adminId: string,
  now: string,
): Promise<void> {
  await binding.batch([
    binding.prepare(`
      UPDATE "BillingCycle"
      SET "status" = 'SETTLED', "updatedAt" = ?1
      WHERE "id" = ?2 AND "status" = 'BILLS_GENERATED'
    `).bind(now, cycleId),
    binding.prepare(`
      UPDATE "BillingCycle"
      SET "status" = 'CLOSED',
          "closedBy" = ?1,
          "closedAt" = ?2,
          "errorMessage" = NULL,
          "updatedAt" = ?2
      WHERE "id" = ?3 AND "status" IN ('BILLS_GENERATED', 'SETTLED')
    `).bind(adminId, now, cycleId),
  ]);
}

async function recordClosingError(
  db: BoardOpsDatabase,
  cycleId: string,
  message: string,
): Promise<void> {
  try {
    await db
      .update(BillingCycle)
      .set({ errorMessage: message, updatedAt: new Date().toISOString() })
      .where(eq(BillingCycle.id, cycleId));
  } catch (error) {
    console.error("Failed to record billing closing error", error);
  }
}

function summaryFromCycle(cycle: typeof BillingCycle.$inferSelect): ClosingSummary {
  return {
    totalExpenses: cycle.totalExpenses,
    totalResidentMeals: cycle.totalMeals,
    totalGuestMeals: cycle.totalGuestMeals,
    guestRevenue: 0,
    mealCharge: cycle.mealCharge,
    billsGenerated: cycle.billsGenerated,
    refundQueueTotal: cycle.refundQueueTotal,
    outstandingDue: cycle.outstandingDue,
  };
}

export async function executeClosing(
  binding: D1Database,
  month: number,
  year: number,
  adminId: string,
  dueDate?: Date,
  nowDate: Date = new Date(),
): Promise<ClosingResult> {
  const period = normalizeBillingPeriod(month, year);
  if (!period) {
    return {
      success: false,
      cycleId: "",
      status: "OPEN",
      summary: EMPTY_SUMMARY,
      billEvents: [],
      refundsQueued: 0,
      error: "Invalid month or year",
    };
  }
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return {
      success: false,
      cycleId: "",
      status: "OPEN",
      summary: EMPTY_SUMMARY,
      billEvents: [],
      refundsQueued: 0,
      error: "Invalid due date",
    };
  }

  const db = createDatabase(binding);
  const [existingBeforeReadiness] = await db
    .select()
    .from(BillingCycle)
    .where(and(eq(BillingCycle.periodMonth, month), eq(BillingCycle.periodYear, year)))
    .limit(1);

  if (existingBeforeReadiness?.status === "CLOSED") {
    return {
      success: false,
      cycleId: existingBeforeReadiness.id,
      status: "CLOSED",
      summary: summaryFromCycle(existingBeforeReadiness),
      billEvents: [],
      refundsQueued: 0,
      error: "This billing cycle is already CLOSED. Corrections require adjustment entries.",
    };
  }

  if (existingBeforeReadiness && ["BILLS_GENERATED", "SETTLED"].includes(existingBeforeReadiness.status)) {
    const now = nowDate.toISOString();
    await finalizeCycle(binding, existingBeforeReadiness.id, adminId, now);
    const [closed] = await db.select().from(BillingCycle).where(eq(BillingCycle.id, existingBeforeReadiness.id)).limit(1);
    if (!closed) throw new Error("Billing cycle disappeared during finalization");
    return {
      success: true,
      cycleId: closed.id,
      status: closed.status,
      summary: summaryFromCycle(closed),
      billEvents: [],
      refundsQueued: 0,
    };
  }

  const readiness = await getBillingReadiness(db, month, year, nowDate);
  if (!readiness.canClose) {
    const issues = readiness.items
      .filter((item) => item.status !== "ready")
      .map((item) => `${item.label}: ${item.detail}`);
    return {
      success: false,
      cycleId: readiness.existingCycle?.id ?? "",
      status: readiness.existingCycle?.status ?? "OPEN",
      summary: EMPTY_SUMMARY,
      billEvents: [],
      refundsQueued: 0,
      error: `Cannot close: ${issues.join("; ")}`,
    };
  }

  const now = nowDate.toISOString();
  const cycle = await ensurePreparingCycle(db, month, year, adminId, readiness.items, now);
  const cycleId = cycle.id;

  try {
    let currentStatus = cycle.status;
    if (currentStatus !== "SNAPSHOT_CREATED") {
      const snapshot = await buildSnapshotData(db, month, year);
      await persistSnapshotAndLockExpenses(binding, cycleId, month, year, snapshot, now);
      currentStatus = "SNAPSHOT_CREATED";
    }

    const billGeneration = await generateBillsForPeriod(binding, month, year, {
      adminId,
      dueDate,
      cycleId,
      now: nowDate,
    });
    const settlement = await settleCycle(
      binding,
      db,
      cycleId,
      month,
      year,
      adminId,
      billGeneration,
      nowDate,
    );
    await finalizeCycle(binding, cycleId, adminId, now);

    const [closed] = await db.select().from(BillingCycle).where(eq(BillingCycle.id, cycleId)).limit(1);
    if (!closed) throw new Error("Billing cycle disappeared after closing");
    const summary: ClosingSummary = {
      totalExpenses: billGeneration.totalExpenses,
      totalResidentMeals: billGeneration.totalResidentMeals,
      totalGuestMeals: billGeneration.totalGuestMeals,
      guestRevenue: billGeneration.guestRevenue,
      mealCharge: billGeneration.perMealCharge,
      billsGenerated: billGeneration.created + billGeneration.updated,
      refundQueueTotal: settlement.plan.refundQueueTotal,
      outstandingDue: settlement.plan.outstandingDue,
    };
    return {
      success: true,
      cycleId,
      status: closed.status,
      summary,
      billEvents: billGeneration.events,
      refundsQueued: settlement.refundsQueued,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordClosingError(db, cycleId, message);
    const [failedCycle] = await db.select().from(BillingCycle).where(eq(BillingCycle.id, cycleId)).limit(1);
    return {
      success: false,
      cycleId,
      status: failedCycle?.status ?? cycle.status,
      summary: failedCycle ? summaryFromCycle(failedCycle) : EMPTY_SUMMARY,
      billEvents: [],
      refundsQueued: 0,
      error: message,
    };
  }
}
