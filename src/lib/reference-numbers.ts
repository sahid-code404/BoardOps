/**
 * Reference Number Service (PRD DEC-031, Engineering Improvement #4)
 *
 * Centralized generation of human-readable reference numbers for:
 *   - Bills:       BILL-{YEAR}-{SEQUENCE}
 *   - Refunds:     REF-{YEAR}-{SEQUENCE}
 *   - Adjustments: ADJ-{YEAR}-{SEQUENCE}
 *
 * The format is configurable via the Settings/Variables system (key: "system.billNumberFormat",
 * "system.refundNumberFormat", "system.adjustmentNumberFormat"). Supported placeholders:
 *   {YEAR}     — 4-digit year (e.g. 2026)
 *   {YY}       — 2-digit year (e.g. 26)
 *   {MONTH}    — 2-digit month 01-12
 *   {PERIOD}   — "YYYY-MM" (e.g. 2026-06)
 *   {PREFIX}   — the entity prefix (BILL, REF, ADJ)
 *   {SEQ}      — zero-padded sequence number (5 digits, resets per year)
 *
 * Default formats:
 *   BILL-{YEAR}-{SEQ}     → BILL-2026-00001
 *   REF-{YEAR}-{SEQ}      → REF-2026-00001
 *   ADJ-{YEAR}-{SEQ}      → ADJ-2026-00001
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient;

const DEFAULTS: Record<string, { prefix: string; format: string }> = {
  bill: { prefix: "BILL", format: "BILL-{YEAR}-{SEQ}" },
  refund: { prefix: "REF", format: "REF-{YEAR}-{SEQ}" },
  adjustment: { prefix: "ADJ", format: "ADJ-{YEAR}-{SEQ}" },
};

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatNumber(
  type: "bill" | "refund" | "adjustment",
  sequence: number,
  date: Date,
  customFormat?: string
): string {
  const config = DEFAULTS[type];
  const format = customFormat || config.format;
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-indexed

  return format
    .replace(/{PREFIX}/g, config.prefix)
    .replace(/{YEAR}/g, String(year))
    .replace(/{YY}/g, String(year).slice(-2))
    .replace(/{MONTH}/g, pad(month, 2))
    .replace(/{PERIOD}/g, `${year}-${pad(month, 2)}`)
    .replace(/{SEQ}/g, pad(sequence, 5));
}

/**
 * Generate the next bill number for a given period.
 * Sequence is per-year (resets on Jan 1).
 */
export async function generateBillNumber(date: Date = new Date()): Promise<string> {
  const year = date.getFullYear();

  // Load the configured format from variables (if it exists)
  const formatVar = await db.variable.findUnique({ where: { key: "system.billNumberFormat" } });
  const customFormat = formatVar?.value || undefined;

  // Count existing bills for this year to determine the sequence
  // We use billNumber LIKE '{PREFIX}-{year}-%' to find the max sequence
  const prefix = DEFAULTS.bill.prefix;
  const existingBills = await db.bill.findMany({
    where: {
      billNumber: { startsWith: `${prefix}-${year}-` },
    },
    select: { billNumber: true },
  });

  let maxSeq = 0;
  for (const b of existingBills) {
    if (!b.billNumber) continue;
    const parts = b.billNumber.split("-");
    const seqPart = parts[parts.length - 1];
    const seq = parseInt(seqPart, 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return formatNumber("bill", maxSeq + 1, date, customFormat);
}

/**
 * Generate the next refund number.
 */
export async function generateRefundNumber(date: Date = new Date()): Promise<string> {
  const year = date.getFullYear();
  const formatVar = await db.variable.findUnique({ where: { key: "system.refundNumberFormat" } });
  const customFormat = formatVar?.value || undefined;

  const prefix = DEFAULTS.refund.prefix;
  const existing = await db.refund.findMany({
    where: { refundNumber: { startsWith: `${prefix}-${year}-` } },
    select: { refundNumber: true },
  });

  let maxSeq = 0;
  for (const r of existing) {
    if (!r.refundNumber) continue;
    const parts = r.refundNumber.split("-");
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return formatNumber("refund", maxSeq + 1, date, customFormat);
}

/**
 * Generate the next adjustment number.
 */
export async function generateAdjustmentNumber(date: Date = new Date()): Promise<string> {
  const year = date.getFullYear();
  const formatVar = await db.variable.findUnique({ where: { key: "system.adjustmentNumberFormat" } });
  const customFormat = formatVar?.value || undefined;

  const prefix = DEFAULTS.adjustment.prefix;
  const existing = await db.adjustment.findMany({
    where: { adjustmentNumber: { startsWith: `${prefix}-${year}-` } },
    select: { adjustmentNumber: true },
  });

  let maxSeq = 0;
  for (const a of existing) {
    if (!a.adjustmentNumber) continue;
    const parts = a.adjustmentNumber.split("-");
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return formatNumber("adjustment", maxSeq + 1, date, customFormat);
}

/**
 * Get the previous outstanding due for a user (sum of all non-void, non-deleted bills
 * from previous periods that still have dueAmount > 0).
 * PRD DEC-027: previous dues are tracked separately from the current bill.
 */
export async function getPreviousDue(userId: string, currentMonth: number, currentYear: number): Promise<number> {
  const bills = await db.bill.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { notIn: ["VOID", "DRAFT"] },
      OR: [
        { periodYear: { lt: currentYear } },
        { periodYear: currentYear, periodMonth: { lt: currentMonth } },
      ],
    },
    select: { dueAmount: true },
  });

  return bills.reduce((sum, b) => sum + Math.max(0, b.dueAmount), 0);
}

/**
 * Lock all expenses for a billing period after the monthly snapshot is created.
 * PRD DEC-030: expenses become permanently immutable after snapshot creation.
 *
 * @param tx Optional Prisma transaction client. When provided, the update runs
 *           inside the caller's transaction (used by `executeClosing` so the
 *           lock is rolled back if a later step fails).
 */
export async function lockExpensesForPeriod(
  month: number,
  year: number,
  billingCycleId: string,
  tx: Tx | typeof db = db
): Promise<number> {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const result = await tx.expense.updateMany({
    where: {
      expenseDate: { gte: start, lte: end },
      deletedAt: null,
      status: { not: "DELETED" },
      lockedAt: null, // only lock unlocked expenses
    },
    data: {
      status: "LOCKED",
      lockedAt: new Date(),
      lockedByCycleId: billingCycleId,
    },
  });

  return result.count;
}

/**
 * Check if an expense is locked (immutable). PRD DEC-030.
 */
export function isExpenseLocked(expense: { status: string; lockedAt: Date | null }): boolean {
  return expense.status === "LOCKED" || !!expense.lockedAt;
}
