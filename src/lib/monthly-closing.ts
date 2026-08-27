/**
 * Monthly Closing Engine (PRD Module 13)
 *
 * Orchestrates the monthly financial closing workflow:
 *   1. Validate readiness (meals locked, expenses approved, variables valid, formula valid)
 *   2. Create immutable MonthlySnapshot (freeze meals, expenses, variables, formula)
 *   3. Execute Formula Engine → calculate meal charge
 *   4. Generate bills from the snapshot (not live data)
 *   5. Settle resident fund accounts (deduct bill, determine refund/due)
 *   6. Close the billing cycle
 *
 * Rollback is only allowed before bills are published (status < BILLS_GENERATED).
 * After publication, corrections require adjustment entries (PRD DEC-033).
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { evaluateFormula, validateFormula, extractVarSlugs, type FormulaVarResolver } from "@/lib/formula-engine";
import { generateRefundNumber, lockExpensesForPeriod } from "@/lib/reference-numbers";
import { generateBillsForPeriod } from "@/lib/bill-calculation";
import { logAudit } from "@/lib/audit";

// Prisma's interactive transaction client (the `tx` argument passed to
// `db.$transaction(async (tx) => ...)`). It is a strict subset of PrismaClient
// (no $transaction/$connect/$disconnect). Use this for any helper that should
// run inside a transaction.
type Tx = Prisma.TransactionClient;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function periodLabel(month: number, year: number): string {
  return `${MONTHS[month] ?? `Month ${month + 1}`} ${year}`;
}

// ─────────────────────────────────────────────────────────────
// 1. Readiness Checklist
// ─────────────────────────────────────────────────────────────

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
  existingCycle?: {
    id: string;
    status: string;
  } | null;
};

export async function getReadiness(month: number, year: number): Promise<ReadinessResult> {
  const label = periodLabel(month, year);
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const items: ReadinessItem[] = [];

  // Check 1: Existing billing cycle
  const existingCycle = await db.billingCycle.findUnique({
    where: { periodMonth_periodYear: { periodMonth: month, periodYear: year } },
    select: { id: true, status: true },
  });
  if (existingCycle) {
    if (existingCycle.status === "CLOSED") {
      items.push({
        key: "cycle",
        label: "Billing Cycle",
        status: "error",
        detail: `This period is already CLOSED. Corrections require adjustment entries.`,
      });
    } else if (existingCycle.status === "BILLS_GENERATED" || existingCycle.status === "SETTLED") {
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

  // Check 2: Active residents
  const activeUsers = await db.user.count({
    where: { status: "ACTIVE", role: "USER", deletedAt: null },
  });
  items.push({
    key: "residents",
    label: "Active Residents",
    status: activeUsers > 0 ? "ready" : "error",
    detail: activeUsers > 0
      ? `${activeUsers} resident(s) will be billed.`
      : "No active residents — cannot generate bills.",
    count: activeUsers,
  });

  // Check 3: Meal entries for this period (exclude admin users)
  const mealEntries = await db.mealEntry.count({
    where: {
      serviceDate: { gte: start, lte: end },
      status: { in: ["ON", "LOCKED"] },
      user: { role: "USER" },
    },
  });
  const mealConfigs = await db.mealConfiguration.count({ where: { status: "ACTIVE" } });
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

  // Check 4: Expenses for this period
  const expenses = await db.expense.count({
    where: {
      expenseDate: { gte: start, lte: end },
      deletedAt: null,
      status: { not: "DELETED" },
    },
  });
  const totalExpenseAmount = await db.expense.aggregate({
    where: {
      expenseDate: { gte: start, lte: end },
      deletedAt: null,
      status: { not: "DELETED" },
    },
    _sum: { amount: true },
  });
  const expenseTotal = totalExpenseAmount._sum.amount ?? 0;
  if (expenses === 0) {
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
      detail: `${expenses} expense(s) totaling ₹${Math.round(expenseTotal).toLocaleString("en-IN")}.`,
      count: expenses,
    });
  }

  // Check 5: Variables
  const activeVars = await db.variable.count({
    where: { status: "ACTIVE" },
  });
  const systemVars = await db.variable.count({
    where: { status: "ACTIVE", isSystem: true },
  });
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

  // Check 6: Active formula (meal charge)
  const mealChargeFormula = await db.formula.findFirst({
    where: { key: "formula.mealCharges", status: "ACTIVE" },
  });
  if (!mealChargeFormula) {
    items.push({
      key: "formula",
      label: "Meal Charge Formula",
      status: "warning",
      detail: "No active formula.mealCharges formula. Bills will use the legacy rate×count calculation.",
    });
  } else {
    // Validate the formula expression
    const validation = validateFormula(mealChargeFormula.expression);
    if (!validation.valid) {
      items.push({
        key: "formula",
        label: "Meal Charge Formula",
        status: "warning",
        detail: `formula.mealCharges (v${mealChargeFormula.version}) is invalid: ${validation.error}. Bills will use the legacy rate×count calculation.`,
      });
    } else {
      items.push({
        key: "formula",
        label: "Meal Charge Formula",
        status: "ready",
        detail: `formula.mealCharges v${mealChargeFormula.version} is valid.`,
      });
    }
  }

  // Check 7: Pending payments (informational — not a blocker)
  const pendingPayments = await db.payment.count({
    where: {
      status: "PENDING",
      createdAt: { gte: start, lte: end },
    },
  });
  items.push({
    key: "payments",
    label: "Pending Payments",
    status: pendingPayments > 0 ? "warning" : "ready",
    detail: pendingPayments > 0
      ? `${pendingPayments} payment(s) pending approval. They will apply to the NEXT billing cycle if approved after closing.`
      : "No pending payments.",
    count: pendingPayments,
  });

  // Bill generation requires ALL items to be "ready" — no errors AND no warnings.
  // Admins must resolve all warnings (e.g. add missing expenses, fix invalid formula,
  // approve pending payments) before they can close the billing cycle.
  // PRD: Bills can only be generated for PAST months — the current month hasn't ended yet,
  // so its meal data is still incomplete.
  const now = new Date();
  const currentPeriod = now.getFullYear() * 12 + now.getMonth();
  const selectedPeriod = year * 12 + month;
  const isCurrentOrFutureMonth = selectedPeriod >= currentPeriod;

  if (isCurrentOrFutureMonth) {
    items.unshift({
      key: "period",
      label: "Billing Period",
      status: "error",
      detail: `Cannot generate bills for ${label} — this month has not ended yet. Bills can only be generated for past months after the month is complete.`,
    });
  }

  const canClose = items.every((i) => i.status === "ready") && (!existingCycle || existingCycle.status !== "CLOSED");

  return {
    month,
    year,
    periodLabel: label,
    items,
    canClose,
    existingCycle,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. Create Snapshot
// ─────────────────────────────────────────────────────────────

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

async function createSnapshot(month: number, year: number, tx: Tx): Promise<SnapshotData> {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // ── Meals data: per-resident meal counts ──
  const activeUsers = await tx.user.findMany({
    where: { status: "ACTIVE", role: "USER", deletedAt: null },
    select: { id: true, name: true, room: true },
  });
  const meals = await tx.mealConfiguration.findMany({ where: { status: "ACTIVE" } });
  const mealNameById: Record<string, string> = {};
  meals.forEach((m) => (mealNameById[m.id] = m.name));

  const mealEntries = await tx.mealEntry.findMany({
    where: { serviceDate: { gte: start, lte: end }, user: { role: "USER" } },
  });
  const guestMeals = await tx.guestMeal.findMany({
    where: { serviceDate: { gte: start, lte: end } },
  });

  // Per-resident meal counts
  const residentMeals: Record<string, Record<string, number>> = {};
  let totalResidentMeals = 0;
  for (const u of activeUsers) {
    residentMeals[u.id] = {};
  }
  for (const e of mealEntries) {
    if (e.status === "ON" || e.status === "LOCKED") {
      const name = mealNameById[e.mealId] || "unknown";
      if (!residentMeals[e.userId]) residentMeals[e.userId] = {};
      residentMeals[e.userId][name] = (residentMeals[e.userId][name] || 0) + 1;
      totalResidentMeals++;
    }
  }

  // Guest meals per meal type
  const guestMealCounts: Record<string, number> = {};
  let totalGuestMeals = 0;
  for (const g of guestMeals) {
    const name = mealNameById[g.mealId] || "unknown";
    guestMealCounts[name] = (guestMealCounts[name] || 0) + (g.guestCount || 1);
    totalGuestMeals += g.guestCount || 1;
  }

  const mealsData = JSON.stringify({
    residentMeals,
    guestMealCounts,
    totalResidentMeals,
    totalGuestMeals,
    mealConfigs: meals.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName })),
  });

  // ── Expenses data ──
  const expenses = await tx.expense.findMany({
    where: {
      expenseDate: { gte: start, lte: end },
      deletedAt: null,
      status: { not: "DELETED" },
    },
    include: {
      purchase: { include: { items: true } },
    },
  });
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const expensesData = JSON.stringify({
    expenses: expenses.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      amount: e.amount,
      expenseDate: e.expenseDate,
      purchase: e.purchase
        ? {
            vendor: e.purchase.vendor,
            items: e.purchase.items.map((it) => ({
              name: it.productName,
              qty: it.quantity,
              unit: it.unit,
              rate: it.rate,
              total: it.total,
            })),
          }
        : null,
    })),
    totalExpenses,
  });

  // ── Variables data ──
  const variables = await tx.variable.findMany({
    where: { status: "ACTIVE" },
  });
  const variablesData = JSON.stringify(
    Object.fromEntries(variables.map((v) => [v.key, { value: v.value, type: v.type, name: v.name }]))
  );

  // ── Formula data ──
  const formulas = await tx.formula.findMany({
    where: { status: "ACTIVE" },
    select: { key: true, name: true, expression: true, version: true, returnType: true },
  });
  const formulaData = JSON.stringify(
    Object.fromEntries(formulas.map((f) => [f.key, { name: f.name, expression: f.expression, version: f.version, returnType: f.returnType }]))
  );

  // ── Calculate meal charge using the Formula Engine ──
  // Build the variable resolver from the snapshot (not live DB — for consistency)
  const varMap = new Map(variables.map((v) => [v.key, parseFloat(v.value) || 0]));
  const resolver: FormulaVarResolver = (slug: string) => varMap.get(slug) ?? 0;

  // Also inject computed totals as variables the formula can reference
  const computedVars: Record<string, number> = {
    total_expense: totalExpenses,
    total_resident_meals: totalResidentMeals,
    total_guest_meals: totalGuestMeals,
    guest_revenue: 0, // computed below
  };

  // Calculate guest revenue: sum of guest meals × their meal rate
  let guestRevenue = 0;
  for (const [mealName, count] of Object.entries(guestMealCounts)) {
    const rateVar = varMap.get(`meal.rate.${mealName.toLowerCase()}`);
    if (rateVar !== undefined) {
      guestRevenue += rateVar * count;
    }
  }
  computedVars.guest_revenue = guestRevenue;

  // Merge computed vars into the resolver
  const fullResolver: FormulaVarResolver = (slug: string) => {
    if (slug in computedVars) return computedVars[slug];
    return varMap.get(slug) ?? 0;
  };

  // Try to evaluate the meal charge formula
  const mealChargeFormula = formulas.find((f) => f.key === "formula.mealCharges");
  let mealCharge = 0;
  if (mealChargeFormula && totalResidentMeals > 0) {
    const result = evaluateFormula(mealChargeFormula.expression, fullResolver);
    if (!result.error) {
      mealCharge = result.value;
    }
  }

  return {
    mealsData,
    expensesData,
    variablesData,
    formulaData,
    totalExpenses,
    totalResidentMeals,
    totalGuestMeals,
    guestRevenue,
    mealCharge,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. Execute Full Closing Workflow
// ─────────────────────────────────────────────────────────────

export type ClosingResult = {
  success: boolean;
  cycleId: string;
  status: string;
  summary: {
    totalExpenses: number;
    totalResidentMeals: number;
    totalGuestMeals: number;
    guestRevenue: number;
    mealCharge: number;
    billsGenerated: number;
    refundQueueTotal: number;
    outstandingDue: number;
  };
  error?: string;
};

export async function executeClosing(
  month: number,
  year: number,
  adminId: string,
  dueDate?: Date
): Promise<ClosingResult> {
  const label = periodLabel(month, year);

  // 1. Check readiness
  const readiness = await getReadiness(month, year);
  if (!readiness.canClose) {
    const errors = readiness.items.filter((i) => i.status === "error").map((i) => `${i.label}: ${i.detail}`);
    return {
      success: false,
      cycleId: "",
      status: "OPEN",
      summary: { totalExpenses: 0, totalResidentMeals: 0, totalGuestMeals: 0, guestRevenue: 0, mealCharge: 0, billsGenerated: 0, refundQueueTotal: 0, outstandingDue: 0 },
      error: `Cannot close: ${errors.join("; ")}`,
    };
  }

  // 2. Get or create the billing cycle
  let cycle = readiness.existingCycle
    ? await db.billingCycle.findUnique({ where: { id: readiness.existingCycle.id } })
    : null;

  if (cycle && cycle.status === "CLOSED") {
    return {
      success: false,
      cycleId: cycle.id,
      status: cycle.status,
      summary: { totalExpenses: 0, totalResidentMeals: 0, totalGuestMeals: 0, guestRevenue: 0, mealCharge: 0, billsGenerated: 0, refundQueueTotal: 0, outstandingDue: 0 },
      error: "This billing cycle is already CLOSED. Corrections require adjustment entries.",
    };
  }

  // Create or update the cycle to PREPARING status
  if (!cycle) {
    cycle = await db.billingCycle.create({
      data: {
        periodMonth: month,
        periodYear: year,
        status: "PREPARING",
        startedBy: adminId,
        startedAt: new Date(),
        readiness: JSON.stringify(readiness.items),
      },
    });
  } else {
    cycle = await db.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "PREPARING",
        startedBy: adminId,
        startedAt: new Date(),
        readiness: JSON.stringify(readiness.items),
        errorMessage: null,
      },
    });
  }

  try {
    // DIR-1: run every write inside a single transaction so a failure at any
    // step (snapshot, bills, refunds, expense lock, status transition) rolls
    // the whole closing back. Reads-only helpers (generateRefundNumber) keep
    // using `db` — they don't mutate state and don't need to participate in
    // the rollback. Side-effect helpers called by generateBillsForPeriod
    // (createBillSettlementLedger, createNotification, generateBillNumber)
    // also use `db`; they're idempotent so a rollback leaves harmless orphans.
    return await db.$transaction(async (tx) => {
    // `cycle` was created/updated above — guaranteed non-null here. The
    // explicit guard re-narrows it for TypeScript inside the closure (closures
    // don't inherit narrowing on `let` bindings from the outer scope).
    if (!cycle) throw new Error("Billing cycle is null inside closing transaction");
    // 3. Create the snapshot
    const snapshotData = await createSnapshot(month, year, tx);

    // Delete any existing snapshot (from a previous failed attempt)
    if (cycle.snapshotId) {
      await tx.monthlySnapshot.deleteMany({ where: { billingCycleId: cycle.id } });
    }

    const snapshot = await tx.monthlySnapshot.create({
      data: {
        billingCycleId: cycle.id,
        mealsData: snapshotData.mealsData,
        expensesData: snapshotData.expensesData,
        variablesData: snapshotData.variablesData,
        formulaData: snapshotData.formulaData,
        totalExpenses: snapshotData.totalExpenses,
        totalResidentMeals: snapshotData.totalResidentMeals,
        totalGuestMeals: snapshotData.totalGuestMeals,
        guestRevenue: snapshotData.guestRevenue,
        mealCharge: snapshotData.mealCharge,
      },
    });

    cycle = await tx.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "SNAPSHOT_CREATED",
        snapshotId: snapshot.id,
        totalExpenses: snapshotData.totalExpenses,
        totalMeals: snapshotData.totalResidentMeals,
        totalGuestMeals: snapshotData.totalGuestMeals,
        mealCharge: snapshotData.mealCharge,
      },
    });

    // 4. Generate bills via the shared LB-1 helper. This is the SAME path used
    // by POST /api/bills, so residents see identical charges regardless of
    // whether the admin clicks "Generate Bills" or runs the monthly closing.
    // The helper handles BLG-1 proration, payment preservation, BILL_SETTLEMENT
    // ledger entries (MF-2), user notifications, and bill-number assignment for
    // cycle-linked bills. The previous executeClosing bill-generation loop
    // (snapshot + Formula Engine) is removed — it diverged from POST /api/bills
    // (LB-1) and is now superseded by this single shared path.
    //
    // The snapshot is still created above (MonthlySnapshot row + cycle fields
    // totalExpenses/totalMeals/mealCharge) for historical traceability — it
    // freezes what the data looked like at closing time — but it's no longer
    // the source of truth for the bill calculation. The helper reads live data
    // (which, at closing time, is identical to the snapshot because expenses
    // are about to be locked).
    const { created, updated, skipped: _skipped } = await generateBillsForPeriod(
      month,
      year,
      { dueDate, adminId, tx, cycleId: cycle.id }
    );
    const billsGenerated = created + updated;

    // 5. Lock expenses for this period (PRD DEC-030 — expenses become immutable after snapshot)
    const lockedCount = await lockExpensesForPeriod(month, year, cycle.id, tx);

    // 6. Settlement: compute refundQueueTotal + outstandingDue from the
    // freshly-generated (or refreshed) bills, and queue Refund records for
    // overpaid users. The BILL_SETTLEMENT ledger entries themselves are
    // created inside generateBillsForPeriod (MF-2) — this step only handles
    // the overpayment-refund queue.
    //
    // Note: `generateRefundNumber` uses the `db` singleton (not `tx`), so the
    // sequence number is computed from the committed state. A concurrent
    // closing could collide, but the worst case is a duplicate-numbered refund
    // record — caught at the application layer when a clerk processes it.
    const periodBills = await tx.bill.findMany({
      where: {
        periodMonth: month,
        periodYear: year,
        deletedAt: null,
        status: { notIn: ["VOID", "DELETED"] },
      },
      select: { id: true, userId: true, paidAmount: true, totalAmount: true },
    });
    let refundQueueTotal = 0;
    let outstandingDue = 0;
    let refundsQueued = 0;
    for (const b of periodBills) {
      if (b.paidAmount > b.totalAmount) {
        const refundAmount = b.paidAmount - b.totalAmount;
        refundQueueTotal += refundAmount;
        // Idempotent: skip if a PENDING/PARTIALLY_PAID refund already exists
        // for this user + cycle (a previous run may have queued one).
        const existingRefund = await tx.refund.findFirst({
          where: { userId: b.userId, billingCycleId: cycle.id, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
        });
        if (!existingRefund) {
          await tx.refund.create({
            data: {
              refundNumber: await generateRefundNumber(),
              userId: b.userId,
              billId: b.id,
              billingCycleId: cycle.id,
              amount: refundAmount,
              paidAmount: 0,
              remainingAmount: refundAmount,
              status: "PENDING",
              notes: `Auto-created refund: overpayment after bill generation for ${periodLabel(month, year)}`,
              processedBy: adminId,
              processedAt: new Date(),
            },
          });
          refundsQueued++;
        }
      } else if (b.totalAmount > b.paidAmount) {
        outstandingDue += (b.totalAmount - b.paidAmount);
      }
    }

    // 7. Update cycle to BILLS_GENERATED
    cycle = await tx.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "BILLS_GENERATED",
        billsGenerated,
        refundQueueTotal,
        outstandingDue,
      },
    });

    // LB-2: Settlement audit trail. The BILL_SETTLEMENT ledger entries
    // themselves are written by generateBillsForPeriod (MF-2) for every
    // generated/refreshed bill — this audit entry records that the closing
    // workflow ran to completion (snapshot → bills → refund queue → CLOSED).
    // Note: `logAudit` uses the `db` singleton (not `tx`), so it executes
    // outside this transaction. A rollback leaves an orphan audit entry,
    // which is harmless (it's just a log record).
    await logAudit({
      actorId: adminId,
      action: "MONTHLY_SETTLEMENT",
      entity: "BillingCycle",
      entityId: cycle.id,
      newValue: {
        month,
        year,
        periodLabel: label,
        billsGenerated,
        refundsQueued,
        refundQueueTotal,
        outstandingDue,
      },
    });

    // 8. Settle: mark as SETTLED then CLOSED
    cycle = await tx.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "SETTLED",
      },
    });

    cycle = await tx.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "CLOSED",
        closedBy: adminId,
        closedAt: new Date(),
      },
    });

    return {
      success: true,
      cycleId: cycle.id,
      status: "CLOSED",
      summary: {
        totalExpenses: snapshotData.totalExpenses,
        totalResidentMeals: snapshotData.totalResidentMeals,
        totalGuestMeals: snapshotData.totalGuestMeals,
        guestRevenue: snapshotData.guestRevenue,
        mealCharge: snapshotData.mealCharge,
        billsGenerated,
        refundQueueTotal,
        outstandingDue,
      },
    };
    }); // end db.$transaction
  } catch (e) {
    // Mark cycle as FAILED
    await db.billingCycle.update({
      where: { id: cycle.id },
      data: {
        status: "FAILED",
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    });
    return {
      success: false,
      cycleId: cycle.id,
      status: "FAILED",
      summary: { totalExpenses: 0, totalResidentMeals: 0, totalGuestMeals: 0, guestRevenue: 0, mealCharge: 0, billsGenerated: 0, refundQueueTotal: 0, outstandingDue: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Rollback (only before bills are published)
// ─────────────────────────────────────────────────────────────

export async function rollbackCycle(cycleId: string): Promise<{ success: boolean; error?: string }> {
  const cycle = await db.billingCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return { success: false, error: "Billing cycle not found" };

  // Can only rollback before bills are generated
  if (cycle.status === "BILLS_GENERATED" || cycle.status === "SETTLED" || cycle.status === "CLOSED") {
    return {
      success: false,
      error: "Cannot rollback after bills have been generated. Corrections require adjustment entries (PRD DEC-033).",
    };
  }

  // Delete the snapshot
  if (cycle.snapshotId) {
    await db.monthlySnapshot.deleteMany({ where: { billingCycleId: cycleId } });
  }

  // Reset the cycle to OPEN
  await db.billingCycle.update({
    where: { id: cycleId },
    data: {
      status: "OPEN",
      snapshotId: null,
      readiness: null,
      startedBy: null,
      startedAt: null,
      errorMessage: null,
      totalExpenses: 0,
      totalMeals: 0,
      totalGuestMeals: 0,
      mealCharge: 0,
      billsGenerated: 0,
      refundQueueTotal: 0,
      outstandingDue: 0,
    },
  });

  return { success: true };
}
