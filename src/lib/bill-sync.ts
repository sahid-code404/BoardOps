import { db } from "@/lib/db";

/**
 * Recompute a bill's payment-derived fields from its payments.
 *
 * The bill's `paidAmount` equals: (sum of APPROVED payments) − (sum of
 * REFUNDED payments). REFUNDED payments are negative contributions — they
 * represent money returned to the user, reducing the effective amount paid.
 *
 * VOID, REJECTED, DELETED, and soft-deleted payments are excluded.
 *
 * This is the single source of truth — every payment status change (approve,
 * reject, void, delete, restore, refund, edit) calls this to re-sync the
 * bill. This replaces the previous incremental add/subtract logic which was
 * bug-prone (double-counting on re-approve, missing reversal on reject/
 * delete, etc.).
 *
 * Status mapping:
 *   - paidAmount >= totalAmount (total > 0) → PAID
 *   - paidAmount > 0                          → PARTIALLY_PAID
 *   - paidAmount === 0                         → GENERATED
 *   - (OVERDUE is not set here — derived from due date elsewhere)
 */
export async function recomputeBillPaidState(billId: string): Promise<void> {
  const bill = await db.bill.findUnique({ where: { id: billId } });
  if (!bill) return;

  const payments = await db.payment.findMany({
    where: {
      billId,
      deletedAt: null,
      status: { in: ["APPROVED", "REFUNDED"] },
    },
    select: { amount: true, status: true },
  });

  const paidAmount = payments.reduce((sum, p) => {
    if (p.status === "APPROVED") return sum + p.amount;
    if (p.status === "REFUNDED") return sum - p.amount; // refunds reduce paid
    return sum;
  }, 0);
  const clampedPaid = Math.max(0, paidAmount);
  const dueAmount = Math.max(0, bill.totalAmount - clampedPaid);

  let status: string;
  if (bill.totalAmount > 0 && clampedPaid >= bill.totalAmount) {
    status = "PAID";
  } else if (clampedPaid > 0) {
    status = "PARTIALLY_PAID";
  } else {
    status = "GENERATED";
  }

  // Don't downgrade a VOID or DELETED bill — just sync the numbers
  if (bill.status === "VOID" || bill.status === "DELETED") {
    await db.bill.update({
      where: { id: billId },
      data: { paidAmount: clampedPaid, dueAmount },
    });
    return;
  }

  await db.bill.update({
    where: { id: billId },
    data: { paidAmount: clampedPaid, dueAmount, status },
  });
}

