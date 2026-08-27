/**
 * Bill Calculation Engine — LB-1 unification.
 *
 * Single authoritative bill-generation path. Both `POST /api/bills` (the
 * admin "Generate Bills" button) and `executeClosing()` (the monthly-closing
 * workflow) call this function so residents see identical charges regardless
 * of which path the admin uses. Previously the two paths diverged — POST
 * /api/bills used live data + a flat per-meal rate, while executeClosing used
 * a frozen snapshot + the Formula Engine — so the same period could produce
 * different `mealCharges` depending on which path was taken (LB-1).
 *
 * Calculation model (PRD):
 *   per-meal charge = (totalExpenses - guestRevenue) / totalResidentMeals
 *   mealCharges     = residentMealCount × per-meal charge
 *   otherCharges    = (roomRent + cleaning) × prorationFactor   (BLG-1)
 *   totalAmount     = mealCharges + proratedOtherCharges
 *
 * Confirmed meals = MealEntry rows with status "ON" or "LOCKED" (excludes
 * "OFF"). Admin users are excluded from both the resident-meal denominator
 * and the per-user numerator.
 *
 * Idempotent: re-running for the same period refreshes existing bills
 * (preserving paidAmount, recomputing dueAmount + status) and creates
 * BILL_SETTLEMENT ledger entries exactly once per bill (the helper skips if
 * one already exists). VOID and soft-deleted bills are skipped.
 *
 * Side-effects that use the `db` singleton (ledger entries, notifications,
 * `recomputeBillPaidState`, `generateBillNumber`) execute outside the
 * caller's transaction when `tx` is provided. They are idempotent, so a
 * rollback leaves harmless orphans — same pattern as the existing
 * `executeClosing` settlement loop.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createBillSettlementLedger } from "@/lib/resident-fund";
import { createNotification } from "@/lib/notify";
import { recomputeBillPaidState } from "@/lib/bill-sync";
import { generateBillNumber } from "@/lib/reference-numbers";
import { computeProrationFactor } from "@/lib/bill-proration";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodLabelFor(month: number, year: number): string {
  return `${MONTHS[month] ?? `Month ${month + 1}`} ${year}`;
}

export type GenerateBillsOptions = {
  /** Custom due date. If omitted, existing bills keep their due date and new
   *  bills default to the `policy.billing.dueDateDay`-th of next month. */
  dueDate?: Date;
  /** Admin user ID driving the generation. Recorded in the bill snapshot for
   *  audit traceability — the caller is responsible for the top-level audit
   *  log entry (POST /api/bills logs BILLS_GENERATED; executeClosing logs
   *  MONTHLY_CLOSING_COMPLETED). */
  adminId: string;
  /** Optional Prisma transaction client. When provided, all bill reads +
   *  writes run inside the caller's transaction. */
  tx?: Prisma.TransactionClient;
  /** Optional billing-cycle ID. When provided, bills are linked to the cycle
   *  via `billingCycleId` and assigned a human-readable `billNumber` (if they
   *  don't already have one). Used by `executeClosing` so cycle-generated
   *  bills remain connected to the cycle that produced them. POST /api/bills
   *  omits this — those bills stay unlinked (legacy behavior). */
  cycleId?: string;
};

export type GenerateBillsResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Generate (or refresh) bills for every active resident in a billing period.
 * Returns counts of newly-created, updated, and skipped bills.
 */
export async function generateBillsForPeriod(
  month: number,
  year: number,
  options: GenerateBillsOptions
): Promise<GenerateBillsResult> {
  const { dueDate, adminId, tx, cycleId } = options;
  // Use the caller's transaction when provided; otherwise the db singleton.
  // Both expose the model delegates (`user`, `bill`, `mealEntry`, …) so the
  // rest of the function reads identically either way.
  //
  // The non-null assertion mirrors the rest of the codebase: `db` is typed as
  // `PrismaClient | undefined` (see `src/lib/db.ts`) because the globalThis
  // singleton slot is nullable, but it's always populated at module load.
  // Every other helper in `src/lib` (e.g. `reference-numbers.ts`) makes the
  // same assumption and lives with the same "possibly undefined" TS noise.
  const client = (tx ?? db)!;
  const label = periodLabelFor(month, year);

  // ── Load policy + billing variables ──
  const [roomRentVar, cleaningVar, guestChargeVar, dueDateDayVar] = await Promise.all([
    client.variable.findUnique({ where: { key: "billing.roomRent" } }),
    client.variable.findUnique({ where: { key: "billing.cleaningCharges" } }),
    client.variable.findUnique({ where: { key: "billing.guestMealCharge" } }),
    client.variable.findUnique({ where: { key: "policy.billing.dueDateDay" } }),
  ]);
  const roomRent = roomRentVar ? Number(roomRentVar.value) : 0;
  const cleaning = cleaningVar ? Number(cleaningVar.value) : 0;
  const guestChargePerMeal = guestChargeVar ? Number(guestChargeVar.value) : 0;
  const dueDateDay = dueDateDayVar ? parseInt(dueDateDayVar.value) || 10 : 10;
  const defaultDueDate = new Date(year, month + 1, dueDateDay);

  // ── Fetch active residents (BLG-1: select createdAt for proration) ──
  const activeUsers = await client.user.findMany({
    where: { status: "ACTIVE", role: "USER" },
    select: {
      id: true,
      name: true,
      email: true,
      room: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  // ── Period bounds ──
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // ── Total expenses for the period (exclude soft-deleted + DELETED) ──
  const expenses = await client.expense.findMany({
    where: { expenseDate: { gte: start, lte: end }, deletedAt: null, status: { not: "DELETED" } },
    select: { amount: true },
  });
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  // ── Meal configs (id → name lookup map) ──
  const meals = await client.mealConfiguration.findMany();
  const mealNameById: Record<string, string> = {};
  meals.forEach((m) => (mealNameById[m.id] = m.name));

  // ── All confirmed resident meal entries (ON or LOCKED, USER role only) ──
  // Used for the per-meal charge denominator.
  const allMealEntries = await client.mealEntry.findMany({
    where: {
      serviceDate: { gte: start, lte: end },
      status: { in: ["ON", "LOCKED"] },
      user: { role: "USER" },
    },
  });
  const totalResidentMeals = allMealEntries.length;

  // ── Guest meals + revenue (flat per-meal charge from `billing.guestMealCharge`) ──
  const guestMeals = await client.guestMeal.findMany({
    where: { serviceDate: { gte: start, lte: end } },
    include: { meal: true },
  });
  let totalGuestMeals = 0;
  let guestRevenue = 0;
  for (const g of guestMeals) {
    totalGuestMeals += g.guestCount || 1;
    guestRevenue += (g.guestCount || 1) * guestChargePerMeal;
  }

  // ── PRD: per-meal charge = (Total Expenses - Guest Revenue) / Total Resident Meals ──
  const perMealCharge = totalResidentMeals > 0
    ? Math.max(0, (totalExpenses - guestRevenue) / totalResidentMeals)
    : 0;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const u of activeUsers) {
    const existing = await client.bill.findUnique({
      where: { userId_periodMonth_periodYear: { userId: u.id, periodMonth: month, periodYear: year } },
    });

    // Skip VOID (deliberately voided) and soft-deleted (queued for permanent
    // deletion). Resurrecting either via generation would undo the admin's
    // intent — VOID bills stay voided, deleted bills use the restore endpoint.
    if (existing && (existing.status === "VOID" || existing.deletedAt)) {
      skipped++;
      continue;
    }

    // Per-resident confirmed meal counts by meal name.
    const entries = await client.mealEntry.findMany({
      where: { userId: u.id, serviceDate: { gte: start, lte: end } },
    });
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      if (e.status === "ON" || e.status === "LOCKED") {
        const name = mealNameById[e.mealId] || "unknown";
        counts[name] = (counts[name] || 0) + 1;
      }
    });

    // PRD: meal charges = resident's total meal count × per-meal charge.
    const residentMealCount = Object.values(counts).reduce((s, c) => s + c, 0);
    const mealCharges = Math.round(residentMealCount * perMealCharge);
    const otherCharges = roomRent + cleaning;

    // BLG-1: Proration for mid-month joiners. A resident who registered on,
    // say, July 20 should only pay ~12/31 of room rent + cleaning. Meal
    // charges are NOT prorated — they're based on actual meal entries, which
    // only exist for post-registration dates anyway.
    const proration = computeProrationFactor(u.createdAt, month, year);
    const prorationFactor = proration.factor;
    const daysEnrolled = proration.daysEnrolled;
    const daysInMonth = proration.daysInMonth;
    const proratedOtherCharges = Math.round(otherCharges * prorationFactor);
    const totalAmount = mealCharges + proratedOtherCharges;

    const snapshot = JSON.stringify({
      counts,
      residentMealCount,
      perMealCharge,
      mealCharges,
      roomRent,
      cleaning,
      otherCharges,
      proratedOtherCharges,
      prorationFactor,
      daysEnrolled,
      daysInMonth,
      totalExpenses,
      guestRevenue,
      totalResidentMeals,
      totalGuestMeals,
      // Traceability: who generated/refreshed this bill and (when applicable)
      // which billing cycle it belongs to. The top-level audit log entry is
      // written by the caller; this is the per-bill provenance stub.
      generatedBy: adminId,
      ...(cycleId ? { billingCycleId: cycleId } : {}),
    });

    if (existing) {
      // Recalculate on an existing bill — preserve paidAmount, recompute due + status.
      const paidAmount = existing.paidAmount;
      const dueAmount = Math.max(0, totalAmount - paidAmount);
      let newStatus: string;
      if (totalAmount > 0 && paidAmount >= totalAmount) {
        newStatus = "PAID";
      } else if (paidAmount > 0) {
        newStatus = "PARTIALLY_PAID";
      } else {
        newStatus = "GENERATED";
      }

      // Due date: use the new one if provided, otherwise keep the existing one,
      // otherwise fall back to the default.
      const effectiveDueDate = dueDate ?? existing.dueDate ?? defaultDueDate;

      await client.bill.update({
        where: { id: existing.id },
        data: {
          mealCharges,
          // BLG-1: store the prorated value as the charged otherCharges
          otherCharges: proratedOtherCharges,
          totalAmount,
          dueAmount,
          status: newStatus,
          generatedAt: new Date(),
          dueDate: effectiveDueDate,
          snapshot,
          // Link to the cycle when provided (no-op if already linked).
          ...(cycleId ? { billingCycleId: cycleId } : {}),
          // Assign a bill number when running inside a closing — only if the
          // existing bill doesn't already have one (preserves the original).
          ...(cycleId && !existing.billNumber ? { billNumber: await generateBillNumber() } : {}),
        },
      });

      // Re-sync paid/due/status from actual APPROVED payments (authoritative).
      // Skip when running inside a transaction — `recomputeBillPaidState` uses
      // the `db` singleton and would not see the in-flight write. The bill's
      // payment-derived fields are already correctly set above.
      if (!tx) {
        await recomputeBillPaidState(existing.id);
      }

      // MF-2: BILL_SETTLEMENT ledger entry (idempotent — skipped if one
      // already exists for this bill, so re-generation doesn't double-debit).
      await createBillSettlementLedger(u.id, existing.id, totalAmount, month, year);
      updated++;

      // Notify the user when their bill amount increased (e.g. more meals
      // added after the initial generation). Skip no-op regenerations and
      // decreases (decreases are usually followed by a refund or adjustment
      // notification).
      if (totalAmount > existing.totalAmount) {
        const diff = totalAmount - existing.totalAmount;
        await createNotification({
          userId: u.id,
          title: "Bill updated",
          description: `Your ${label} bill increased by ₹${Math.round(diff)} — new total ₹${Math.round(totalAmount)}.`,
          type: "WARNING",
          priority: "HIGH",
          route: "billing",
        });
      }
    } else {
      // Create a new bill for this period.
      const createdBill = await client.bill.create({
        data: {
          userId: u.id,
          periodMonth: month,
          periodYear: year,
          mealCharges,
          // BLG-1: store the prorated value as the charged otherCharges
          otherCharges: proratedOtherCharges,
          totalAmount,
          paidAmount: 0,
          dueAmount: totalAmount,
          status: "GENERATED",
          generatedAt: new Date(),
          dueDate: dueDate ?? defaultDueDate,
          snapshot,
          // Link to the cycle + assign a bill number when running inside a closing.
          ...(cycleId ? {
            billingCycleId: cycleId,
            billNumber: await generateBillNumber(),
          } : {}),
        },
      });

      // MF-2: BILL_SETTLEMENT ledger entry debiting the resident's fund
      // account. Idempotent — only runs once per billId.
      await createBillSettlementLedger(u.id, createdBill.id, totalAmount, month, year);
      created++;

      // Notify the user that their bill is ready.
      const billDueDate = dueDate ?? defaultDueDate;
      const dueLabel = billDueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      await createNotification({
        userId: u.id,
        title: "Bill generated",
        description: `Your ${label} bill of ₹${Math.round(totalAmount)} is now available. Due ${dueLabel}.`,
        type: "INFO",
        priority: "HIGH",
        route: "billing",
      });
    }
  }

  return { created, updated, skipped };
}
