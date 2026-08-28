import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";

import type { BoardOpsDatabase } from "./db/client";
import {
  BillingCycle,
  Expense,
  Formula,
  MealConfiguration,
  MealEntry,
  Payment,
  User,
  Variable,
} from "./db/schema";
import { validateFormula } from "./formula-engine";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type ReadinessItem = {
  key: string;
  label: string;
  status: "ready" | "warning" | "error";
  detail: string;
  count?: number;
};

export type ReadinessResult = {
  month: number;
  year: number;
  periodLabel: string;
  items: ReadinessItem[];
  canClose: boolean;
  existingCycle?: { id: string; status: string } | null;
};

export function periodLabel(month: number, year: number): string {
  return `${MONTHS[month] ?? `Month ${month + 1}`} ${year}`;
}

export function normalizeBillingPeriod(month: number, year: number): { month: number; year: number } | null {
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return { month, year };
}

export function getBillingPeriodRange(month: number, year: number) {
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  };
}

function asCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getBillingReadiness(
  db: BoardOpsDatabase,
  month: number,
  year: number,
  now = new Date(),
): Promise<ReadinessResult> {
  const period = normalizeBillingPeriod(month, year);
  if (!period) throw new Error("INVALID_BILLING_PERIOD");

  const label = periodLabel(month, year);
  const { start, end } = getBillingPeriodRange(month, year);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const items: ReadinessItem[] = [];

  const [existingCycle] = await db
    .select({ id: BillingCycle.id, status: BillingCycle.status })
    .from(BillingCycle)
    .where(and(eq(BillingCycle.periodMonth, month), eq(BillingCycle.periodYear, year)))
    .limit(1);

  if (existingCycle) {
    if (existingCycle.status === "CLOSED") {
      items.push({
        key: "cycle",
        label: "Billing Cycle",
        status: "error",
        detail: "This period is already CLOSED. Corrections require adjustment entries.",
      });
    } else if (["BILLS_GENERATED", "SETTLED"].includes(existingCycle.status)) {
      items.push({
        key: "cycle",
        label: "Billing Cycle",
        status: "warning",
        detail: `Cycle is in progress (status: ${existingCycle.status}). Bills already generated — rollback to restart.`,
      });
    } else {
      items.push({
        key: "cycle",
        label: "Billing Cycle",
        status: "ready",
        detail: `Cycle started (status: ${existingCycle.status}).`,
      });
    }
  } else {
    items.push({
      key: "cycle",
      label: "Billing Cycle",
      status: "ready",
      detail: "No existing cycle — ready to start.",
    });
  }

  const [activeResidentRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(User)
    .where(and(eq(User.status, "ACTIVE"), eq(User.role, "USER"), isNull(User.deletedAt)));
  const activeResidents = asCount(activeResidentRow?.count);
  items.push({
    key: "residents",
    label: "Active Residents",
    status: activeResidents > 0 ? "ready" : "error",
    detail: activeResidents > 0
      ? `${activeResidents} resident(s) will be billed.`
      : "No active residents — cannot generate bills.",
    count: activeResidents,
  });

  const [mealEntryRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(MealEntry)
    .innerJoin(User, eq(MealEntry.userId, User.id))
    .where(
      and(
        gte(MealEntry.serviceDate, startIso),
        lte(MealEntry.serviceDate, endIso),
        sql`${MealEntry.status} in ('ON', 'LOCKED')`,
        eq(User.role, "USER"),
      ),
    );
  const [mealConfigRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(MealConfiguration)
    .where(eq(MealConfiguration.status, "ACTIVE"));
  const mealEntries = asCount(mealEntryRow?.count);
  const mealConfigs = asCount(mealConfigRow?.count);
  if (mealConfigs === 0) {
    items.push({
      key: "meals",
      label: "Meal Configuration",
      status: "error",
      detail: "No active meals configured. Configure meals first.",
    });
  } else if (mealEntries === 0) {
    items.push({
      key: "meals",
      label: "Meal Entries",
      status: "warning",
      detail: `No ON/LOCKED meal entries for ${label}. Bills will have ₹0 meal charges.`,
    });
  } else {
    items.push({
      key: "meals",
      label: "Meal Entries",
      status: "ready",
      detail: `${mealEntries} meal entry(ies) for ${label}.`,
      count: mealEntries,
    });
  }

  const [expenseRow] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${Expense.amount}), 0)`,
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
  const expenseCount = asCount(expenseRow?.count);
  const expenseTotal = Number(expenseRow?.total ?? 0) || 0;
  if (expenseCount === 0) {
    items.push({
      key: "expenses",
      label: "Expenses",
      status: "warning",
      detail: `No expenses recorded for ${label}. Meal charge may be ₹0.`,
    });
  } else {
    items.push({
      key: "expenses",
      label: "Expenses",
      status: "ready",
      detail: `${expenseCount} expense(s) totaling ₹${Math.round(expenseTotal).toLocaleString("en-IN")}.`,
      count: expenseCount,
    });
  }

  const [variableRow] = await db
    .select({
      count: sql<number>`count(*)`,
      systemCount: sql<number>`coalesce(sum(case when ${Variable.isSystem} = 1 then 1 else 0 end), 0)`,
    })
    .from(Variable)
    .where(eq(Variable.status, "ACTIVE"));
  const activeVars = asCount(variableRow?.count);
  const systemVars = asCount(variableRow?.systemCount);
  if (activeVars === 0) {
    items.push({
      key: "variables",
      label: "Variables",
      status: "error",
      detail: "No active variables. The formula engine needs variables to calculate charges.",
    });
  } else {
    items.push({
      key: "variables",
      label: "Variables",
      status: "ready",
      detail: `${activeVars} active variable(s) (${systemVars} system, ${activeVars - systemVars} custom).`,
      count: activeVars,
    });
  }

  const [mealChargeFormula] = await db
    .select({ expression: Formula.expression, version: Formula.version })
    .from(Formula)
    .where(and(eq(Formula.key, "formula.mealCharges"), eq(Formula.status, "ACTIVE")))
    .limit(1);
  if (!mealChargeFormula) {
    items.push({
      key: "formula",
      label: "Meal Charge Formula",
      status: "warning",
      detail: "No active formula.mealCharges formula. Bills will use the legacy rate×count calculation.",
    });
  } else {
    const validation = validateFormula(mealChargeFormula.expression);
    items.push(validation.valid
      ? {
          key: "formula",
          label: "Meal Charge Formula",
          status: "ready",
          detail: `formula.mealCharges v${mealChargeFormula.version} is valid.`,
        }
      : {
          key: "formula",
          label: "Meal Charge Formula",
          status: "warning",
          detail: `formula.mealCharges (v${mealChargeFormula.version}) is invalid: ${validation.error}. Bills will use the legacy rate×count calculation.`,
        });
  }

  const [pendingPaymentRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(Payment)
    .where(
      and(
        eq(Payment.status, "PENDING"),
        gte(Payment.createdAt, startIso),
        lte(Payment.createdAt, endIso),
      ),
    );
  const pendingPayments = asCount(pendingPaymentRow?.count);
  items.push({
    key: "payments",
    label: "Pending Payments",
    status: pendingPayments > 0 ? "warning" : "ready",
    detail: pendingPayments > 0
      ? `${pendingPayments} payment(s) pending approval. They will apply to the NEXT billing cycle if approved after closing.`
      : "No pending payments.",
    count: pendingPayments,
  });

  const currentPeriod = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const selectedPeriod = year * 12 + month;
  if (selectedPeriod >= currentPeriod) {
    items.unshift({
      key: "period",
      label: "Billing Period",
      status: "error",
      detail: `Cannot generate bills for ${label} — this month has not ended yet. Bills can only be generated for past months after the month is complete.`,
    });
  }

  const canClose = items.every((item) => item.status === "ready")
    && (!existingCycle || existingCycle.status !== "CLOSED");

  return {
    month,
    year,
    periodLabel: label,
    items,
    canClose,
    existingCycle: existingCycle ?? null,
  };
}
