import { eq } from "drizzle-orm";

import { createDatabase } from "./db/client";
import { Bill, BillingCycle } from "./db/schema";

export type BillingCycleRollbackResult = {
  success: boolean;
  error?: string;
};

export async function rollbackBillingCycle(
  binding: D1Database,
  cycleId: string,
  nowDate: Date = new Date(),
): Promise<BillingCycleRollbackResult> {
  const db = createDatabase(binding);
  const [cycle] = await db
    .select()
    .from(BillingCycle)
    .where(eq(BillingCycle.id, cycleId))
    .limit(1);
  if (!cycle) return { success: false, error: "Billing cycle not found" };

  if (["BILLS_GENERATED", "SETTLED", "CLOSED"].includes(cycle.status)) {
    return {
      success: false,
      error: "Cannot rollback after bills have been generated. Corrections require adjustment entries (PRD DEC-033).",
    };
  }

  const [linkedBill] = await db
    .select({ id: Bill.id })
    .from(Bill)
    .where(eq(Bill.billingCycleId, cycleId))
    .limit(1);
  if (linkedBill) {
    return {
      success: false,
      error: "Cannot rollback because cycle-linked bills already exist. Resume closing or use adjustment entries instead.",
    };
  }

  const now = nowDate.toISOString();
  await binding.batch([
    binding.prepare(`
      DELETE FROM "MonthlySnapshot"
      WHERE "billingCycleId" = ?1
    `).bind(cycleId),
    binding.prepare(`
      UPDATE "Expense"
      SET "status" = 'APPROVED',
          "lockedAt" = NULL,
          "lockedByCycleId" = NULL,
          "updatedAt" = ?1
      WHERE "lockedByCycleId" = ?2
        AND "status" = 'LOCKED'
    `).bind(now, cycleId),
    binding.prepare(`
      UPDATE "BillingCycle"
      SET "status" = 'OPEN',
          "snapshotId" = NULL,
          "readiness" = NULL,
          "startedBy" = NULL,
          "startedAt" = NULL,
          "closedBy" = NULL,
          "closedAt" = NULL,
          "errorMessage" = NULL,
          "totalExpenses" = 0,
          "totalMeals" = 0,
          "totalGuestMeals" = 0,
          "mealCharge" = 0,
          "billsGenerated" = 0,
          "refundQueueTotal" = 0,
          "outstandingDue" = 0,
          "updatedAt" = ?1
      WHERE "id" = ?2
        AND "status" NOT IN ('BILLS_GENERATED', 'SETTLED', 'CLOSED')
    `).bind(now, cycleId),
  ]);

  return { success: true };
}
