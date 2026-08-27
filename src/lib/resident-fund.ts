/**
 * Resident Fund Account Engine (PRD Module 08)
 *
 * The Resident Fund Account is the financial backbone for each resident.
 * It tracks:
 *   - Available balance (credits - debits)
 *   - Pending deposits (PENDING payments)
 *   - Refund pending (PENDING/PARTIALLY_PAID refunds)
 *   - Outstanding due (unpaid bill amounts)
 *   - Financial status (Healthy | Low Balance | Restricted | Exempted | Overdue)
 *
 * All balances are derived from LedgerEntry records — the single source of truth.
 * No balance is stored directly; it's always computed from the ledger.
 *
 * PRD DEC-032: Fund accounts can never become negative. Outstanding dues are
 * tracked separately.
 */

import { db } from "@/lib/db";

export type FinancialStatus = "HEALTHY" | "LOW_BALANCE" | "RESTRICTED" | "EXEMPTED" | "OVERDUE";

export type ResidentFundAccount = {
  userId: string;
  userName: string;
  userEmail: string;
  room: string | null;
  avatarUrl: string | null;
  // Available balance = sum of all ledger entries (credits - debits)
  availableBalance: number;
  // Pending deposits = sum of PENDING payments
  pendingDeposits: number;
  // Refund pending = sum of PENDING + PARTIALLY_PAID refunds (remaining amounts)
  refundPending: number;
  // Outstanding due = sum of dueAmount from all non-void, non-deleted bills
  outstandingDue: number;
  // Previous due = sum of dueAmount from bills in previous periods
  previousDue: number;
  // Financial status (derived)
  financialStatus: FinancialStatus;
  // Totals for display
  totalDeposited: number; // sum of all APPROVED payments ever
  totalBilled: number;    // sum of all bill totalAmounts ever
  totalRefunded: number;  // sum of all COMPLETED refunds ever
  // Ledger entry count (for the UI to show "X transactions")
  ledgerEntryCount: number;
};

/**
 * Get the effective billing cycle for a payment being approved NOW.
 * PRD: If the current period's billing cycle is already CLOSED, the payment
 * applies to the NEXT cycle. Otherwise it applies to the current cycle.
 */
export async function getEffectiveBillingCycle(): Promise<{ month: number; year: number }> {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Check if the current period's billing cycle is CLOSED
  const currentCycle = await db.billingCycle.findUnique({
    where: { periodMonth_periodYear: { periodMonth: currentMonth, periodYear: currentYear } },
    select: { status: true },
  });

  if (currentCycle?.status === "CLOSED") {
    // Current cycle is closed → payment applies to next month
    if (currentMonth === 11) {
      return { month: 0, year: currentYear + 1 };
    }
    return { month: currentMonth + 1, year: currentYear };
  }

  return { month: currentMonth, year: currentYear };
}

/**
 * Create a BILL_SETTLEMENT ledger entry that debits the resident's fund
 * account when a bill is generated. Idempotent — only one BILL_SETTLEMENT
 * entry is ever created per bill (subsequent regenerations update the bill
 * but skip re-debiting the ledger, so the running balance isn't double-counted).
 *
 * The entry's amount is negative (a debit) equal to the bill's totalAmount.
 */
export async function createBillSettlementLedger(
  userId: string,
  billId: string,
  amount: number,
  periodMonth: number,
  periodYear: number
): Promise<void> {
  // Idempotency: skip if a BILL_SETTLEMENT entry already exists for this bill
  const existing = await db.ledgerEntry.findFirst({
    where: { userId, type: "BILL_SETTLEMENT", entityId: billId },
    select: { id: true },
  });
  if (existing) return;

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  await createLedgerEntry({
    userId,
    type: "BILL_SETTLEMENT",
    amount: -amount, // negative = debit
    entityType: "Bill",
    entityId: billId,
    description: `Bill for ${MONTHS[periodMonth] ?? `Month ${periodMonth + 1}`} ${periodYear}`,
    billingMonth: periodMonth,
    billingYear: periodYear,
  });
}

/**
 * Create a ledger entry for a financial event.
 * Updates the running balance for the user.
 */
export async function createLedgerEntry(input: {
  userId: string;
  type: "DEPOSIT" | "BILL_SETTLEMENT" | "REFUND" | "ADJUSTMENT";
  amount: number; // positive = credit, negative = debit
  entityType: string;
  entityId?: string;
  description: string;
  billingMonth?: number;
  billingYear?: number;
}): Promise<void> {
  // Get the current running balance
  const lastEntry = await db.ledgerEntry.findFirst({
    where: { userId: input.userId },
    orderBy: { createdAt: "desc" },
    select: { runningBalance: true },
  });
  const previousBalance = lastEntry?.runningBalance ?? 0;
  const newBalance = previousBalance + input.amount;

  await db.ledgerEntry.create({
    data: {
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      runningBalance: newBalance,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      description: input.description,
      billingMonth: input.billingMonth ?? null,
      billingYear: input.billingYear ?? null,
    },
  });
}

/**
 * Get the full Resident Fund Account for a user.
 * This is the unified financial view — all balances derived from the ledger.
 */
export async function getResidentFundAccount(userId: string): Promise<ResidentFundAccount | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, room: true, avatarUrl: true, status: true,
    },
  });
  if (!user) return null;

  const now = new Date();
  const currentPeriod = now.getFullYear() * 12 + now.getMonth();

  // Run all queries in parallel
  const [lastLedgerEntry, pendingPayments, activeRefunds, bills, ledgerCount, totalDeposited, totalRefunded] = await Promise.all([
    // Last ledger entry → available balance
    db.ledgerEntry.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { runningBalance: true },
    }),
    // Pending deposits
    db.payment.findMany({
      where: { userId, status: "PENDING", deletedAt: null },
      select: { amount: true },
    }),
    // Active refunds (PENDING or PARTIALLY_PAID)
    db.refund.findMany({
      where: { userId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      select: { remainingAmount: true },
    }),
    // All non-void, non-deleted bills
    db.bill.findMany({
      where: { userId, deletedAt: null, status: { notIn: ["VOID", "DELETED"] } },
      select: { dueAmount: true, totalAmount: true, periodMonth: true, periodYear: true },
    }),
    // Ledger entry count
    db.ledgerEntry.count({ where: { userId } }),
    // Total deposited ever (sum of APPROVED payments)
    db.payment.aggregate({
      where: { userId, status: "APPROVED", deletedAt: null },
      _sum: { amount: true },
    }),
    // Total refunded ever (sum of COMPLETED refunds)
    db.refund.aggregate({
      where: { userId, status: "COMPLETED" },
      _sum: { amount: true },
    }),
  ]);

  const availableBalance = lastLedgerEntry?.runningBalance ?? 0;
  const pendingDeposits = pendingPayments.reduce((s, p) => s + p.amount, 0);
  const refundPending = activeRefunds.reduce((s, r) => s + r.remainingAmount, 0);

  // Split dues: current period vs previous periods
  let outstandingDue = 0;
  let previousDue = 0;
  let totalBilled = 0;
  for (const b of bills) {
    totalBilled += b.totalAmount;
    if (b.dueAmount > 0) {
      outstandingDue += b.dueAmount;
      const billPeriod = b.periodYear * 12 + b.periodMonth;
      if (billPeriod < currentPeriod) {
        previousDue += b.dueAmount;
      }
    }
  }

  // Determine financial status
  let financialStatus: FinancialStatus = "HEALTHY";
  if (outstandingDue > 0 && availableBalance <= 0) {
    financialStatus = "OVERDUE";
  } else if (availableBalance < 0) {
    // DEC-032: should never happen, but guard anyway
    financialStatus = "LOW_BALANCE";
  }

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    room: user.room,
    avatarUrl: user.avatarUrl,
    availableBalance: Math.max(0, availableBalance), // DEC-032: never negative
    pendingDeposits,
    refundPending,
    outstandingDue,
    previousDue,
    financialStatus,
    totalDeposited: totalDeposited._sum.amount ?? 0,
    totalBilled,
    totalRefunded: totalRefunded._sum.amount ?? 0,
    ledgerEntryCount: ledgerCount,
  };
}

/**
 * Get the ledger history for a user (paginated).
 */
export async function getLedgerHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0
) {
  const entries = await db.ledgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return entries;
}
