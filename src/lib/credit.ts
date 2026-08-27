import { db } from "@/lib/db";

/**
 * Compute a user's refundable credit.
 *
 * Credit = (sum of APPROVED, non-deleted payments) − (sum of totalAmount
 * across the user's non-void, non-deleted bills for periods up to and
 * including the current month) − (sum of already-issued REFUNDED payments).
 *
 * Future-period bills are excluded — a user shouldn't be denied a refund
 * just because next month's bill has been generated but not yet due.
 *
 * In other words: money the user has paid in (approved), minus what they
 * owe for periods that have already started, minus refunds already issued.
 * A positive result means the user overpaid and can be refunded up to that
 * amount.
 *
 * This catches three credit sources:
 *  1. Overpayment on a specific bill (paidAmount > totalAmount)
 *  2. Unlinked approved payments (no billId — direct deposits / wallet top-ups)
 *  3. Payments for a bill that was later voided or reduced
 */
export async function getUserCredit(userId: string): Promise<{
  credit: number;
  totalApproved: number;
  totalBilled: number;
  totalRefunded: number;
}> {
  // Only count bills for periods up to and including the current month.
  // Future-period bills (e.g. next month's bill generated in advance) don't
  // reduce the user's refundable credit — the user hasn't consumed those
  // services yet.
  const now = new Date();
  const currentPeriod = now.getFullYear() * 12 + now.getMonth();

  const [payments, bills] = await Promise.all([
    db.payment.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { in: ["APPROVED", "REFUNDED"] },
      },
      select: { amount: true, status: true },
    }),
    db.bill.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ["VOID", "DELETED"] },
      },
      select: { totalAmount: true, periodMonth: true, periodYear: true },
    }),
  ]);

  const totalApproved = payments
    .filter((p) => p.status === "APPROVED")
    .reduce((s, p) => s + p.amount, 0);
  const totalRefunded = payments
    .filter((p) => p.status === "REFUNDED")
    .reduce((s, p) => s + p.amount, 0);
  // Only count bills for current or past periods
  const totalBilled = bills
    .filter((b) => b.periodYear * 12 + b.periodMonth <= currentPeriod)
    .reduce((s, b) => s + b.totalAmount, 0);

  const credit = Math.max(0, totalApproved - totalBilled - totalRefunded);

  return { credit, totalApproved, totalBilled, totalRefunded };
}

