/**
 * Restriction Engine (PRD Module: Restriction Engine — DEC-008)
 *
 * Controls resident access based on financial or administrative conditions.
 *
 * Financial restrictions:
 *   1. When a resident's available balance falls below the required minimum,
 *      their status becomes "Low Balance" and a grace period begins.
 *   2. During the grace period, the resident can still book meals.
 *   3. If the grace period expires and the balance is still below threshold,
 *      future meal bookings are automatically suspended (ACTIVE restriction).
 *   4. When sufficient funds are approved, the restriction is automatically lifted.
 *      However, future meals that were turned OFF are NOT automatically turned
 *      back ON — the resident must review and re-book them.
 *
 * Admin financial override:
 *   Admins can temporarily exempt a resident from the low balance policy
 *   (e.g. scholarship, medical emergency). Each override requires a reason
 *   and optional end date.
 *
 * PRD DEC-032: Fund accounts can never become negative. Outstanding dues are
 * tracked separately.
 */

import { db } from "@/lib/db";
import { getResidentFundAccount } from "@/lib/resident-fund";

export type RestrictionType = "FINANCIAL" | "ADMINISTRATIVE";

export type RestrictionStatus = "ACTIVE" | "LIFTED" | "EXEMPTED" | "EXPIRED";

export type Restriction = {
  id: string;
  userId: string;
  type: RestrictionType;
  reason: string;
  source: "AUTOMATIC" | "MANUAL";
  status: RestrictionStatus;
  appliedBy: string | null;
  appliedAt: Date;
  expiresAt: Date | null;
  liftedBy: string | null;
  liftedAt: Date | null;
  liftReason: string | null;
};

// ─────────────────────────────────────────────────────────────
// Policy configuration (from Variables, with sensible defaults)
// ─────────────────────────────────────────────────────────────

const DEFAULT_GRACE_PERIOD_DAYS = 2;
const DEFAULT_REQUIRED_BALANCE = 1000; // ₹1000 minimum

async function getPolicyConfig() {
  const [graceVar, balanceVar, enabledVar] = await Promise.all([
    db.variable.findUnique({ where: { key: "policy.lowBalance.graceDays" } }),
    db.variable.findUnique({ where: { key: "policy.lowBalance.requiredBalance" } }),
    db.variable.findUnique({ where: { key: "policy.lowBalance.enabled" } }),
  ]);

  return {
    enabled: enabledVar?.value !== "false", // default true
    graceDays: graceVar ? parseInt(graceVar.value) || DEFAULT_GRACE_PERIOD_DAYS : DEFAULT_GRACE_PERIOD_DAYS,
    requiredBalance: balanceVar ? parseFloat(balanceVar.value) || DEFAULT_REQUIRED_BALANCE : DEFAULT_REQUIRED_BALANCE,
  };
}

// ─────────────────────────────────────────────────────────────
// Evaluate a resident's restriction status
// ─────────────────────────────────────────────────────────────

export type RestrictionEvaluation = {
  hasActiveFinancialRestriction: boolean;
  hasActiveAdminRestriction: boolean;
  hasExemption: boolean;
  financialStatus: string;
  availableBalance: number;
  requiredBalance: number;
  graceDaysRemaining: number | null; // null = no grace period active
  canBookMeals: boolean;
  activeRestrictions: Restriction[];
  restrictionReason: string | null;
};

export async function evaluateRestrictions(userId: string): Promise<RestrictionEvaluation> {
  const [account, policy, activeRestrictions] = await Promise.all([
    getResidentFundAccount(userId),
    getPolicyConfig(),
    db.restriction.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: { appliedAt: "desc" },
    }),
  ]);

  const availableBalance = account?.availableBalance ?? 0;
  const outstandingDue = account?.outstandingDue ?? 0;

  const hasActiveFinancialRestriction = activeRestrictions.some(
    (r) => r.type === "FINANCIAL"
  );
  const hasActiveAdminRestriction = activeRestrictions.some(
    (r) => r.type === "ADMINISTRATIVE"
  );
  const hasExemption = activeRestrictions.some(
    (r) => r.type === "FINANCIAL" && r.source === "MANUAL" && r.reason.includes("EXEMPTION")
  );

  // Determine if the resident is in a grace period
  let graceDaysRemaining: number | null = null;
  if (
    !hasExemption &&
    !hasActiveFinancialRestriction &&
    policy.enabled &&
    availableBalance < policy.requiredBalance &&
    outstandingDue > 0
  ) {
    // In low-balance state but not yet restricted — check if there's a recent
    // low-balance notification that started the grace period
    // For simplicity, the grace period starts when the balance first drops below threshold.
    // We use the first low-balance notification's timestamp as the grace period start.
    const lowBalanceNotif = await db.notification.findFirst({
      where: {
        userId,
        title: "Low Balance Warning",
        createdAt: { gte: new Date(Date.now() - policy.graceDays * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "asc" },
    });

    if (lowBalanceNotif) {
      const graceEnd = new Date(lowBalanceNotif.createdAt.getTime() + policy.graceDays * 24 * 60 * 60 * 1000);
      graceDaysRemaining = Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    } else {
      // No prior warning — grace period starts now
      graceDaysRemaining = policy.graceDays;
    }
  }

  // Can book meals unless there's an active financial restriction (not exempted)
  const canBookMeals = !hasActiveFinancialRestriction || hasExemption;

  let financialStatus = "HEALTHY";
  if (hasExemption) {
    financialStatus = "EXEMPTED";
  } else if (hasActiveFinancialRestriction) {
    financialStatus = "RESTRICTED";
  } else if (availableBalance < policy.requiredBalance && outstandingDue > 0) {
    financialStatus = graceDaysRemaining !== null && graceDaysRemaining > 0 ? "LOW_BALANCE" : "RESTRICTED";
  } else if (outstandingDue > 0) {
    financialStatus = "OVERDUE";
  }

  const restrictionReason = activeRestrictions.length > 0
    ? activeRestrictions[0].reason
    : null;

  return {
    hasActiveFinancialRestriction,
    hasActiveAdminRestriction,
    hasExemption,
    financialStatus,
    availableBalance,
    requiredBalance: policy.requiredBalance,
    graceDaysRemaining,
    canBookMeals,
    activeRestrictions,
    restrictionReason,
  };
}

// ─────────────────────────────────────────────────────────────
// Apply auto financial restriction (called after payment approval/closing)
// ─────────────────────────────────────────────────────────────

export async function checkAndApplyFinancialRestriction(userId: string): Promise<{
  applied: boolean;
  restriction?: Restriction;
  reason?: string;
}> {
  const policy = await getPolicyConfig();
  if (!policy.enabled) return { applied: false };

  const evaluation = await evaluateRestrictions(userId);

  // If already restricted, don't double-apply
  if (evaluation.hasActiveFinancialRestriction) {
    return { applied: false, reason: "Already restricted" };
  }

  // If exempted, skip
  if (evaluation.hasExemption) {
    return { applied: false, reason: "Exempted" };
  }

  // Check if grace period has expired
  if (
    evaluation.availableBalance < policy.requiredBalance &&
    evaluation.graceDaysRemaining === 0
  ) {
    // Apply the restriction
    const restriction = await db.restriction.create({
      data: {
        userId,
        type: "FINANCIAL",
        reason: `Insufficient available balance (₹${Math.round(evaluation.availableBalance)} < required ₹${policy.requiredBalance}). Grace period expired.`,
        source: "AUTOMATIC",
        status: "ACTIVE",
      },
    });

    // Turn OFF all future meal bookings (PRD: only future meals affected)
    const now = new Date();
    await db.mealEntry.updateMany({
      where: {
        userId,
        serviceDate: { gt: now },
        status: "ON",
        locked: false,
      },
      data: {
        status: "OFF",
        notes: "Automatically turned OFF due to financial restriction",
        updatedAt: now,
      },
    });

    return { applied: true, restriction };
  }

  // If in low-balance state but grace period still active, send a warning notification
  if (
    evaluation.availableBalance < policy.requiredBalance &&
    evaluation.graceDaysRemaining !== null &&
    evaluation.graceDaysRemaining > 0
  ) {
    // Check if we already sent a warning recently (avoid spam)
    const recentWarning = await db.notification.findFirst({
      where: {
        userId,
        title: "Low Balance Warning",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // within last 24h
      },
    });

    if (!recentWarning) {
      const { createNotification } = await import("@/lib/notify");
      await createNotification({
        userId,
        title: "Low Balance Warning",
        description: `Your available balance (₹${Math.round(evaluation.availableBalance)}) is below the required minimum (₹${policy.requiredBalance}). Please deposit funds within ${evaluation.graceDaysRemaining} day(s) to avoid meal restriction.`,
        type: "WARNING",
        priority: "HIGH",
        route: "payments",
      });
    }
  }

  return { applied: false };
}

// ─────────────────────────────────────────────────────────────
// Auto-lift financial restriction when balance is restored
// ─────────────────────────────────────────────────────────────

export async function checkAndLiftFinancialRestriction(userId: string): Promise<{
  lifted: boolean;
  restriction?: Restriction;
}> {
  const policy = await getPolicyConfig();
  if (!policy.enabled) return { lifted: false };

  const evaluation = await evaluateRestrictions(userId);

  // If there's an active financial restriction but balance is now sufficient
  if (
    evaluation.hasActiveFinancialRestriction &&
    !evaluation.hasExemption &&
    evaluation.availableBalance >= policy.requiredBalance
  ) {
    const financialRestriction = evaluation.activeRestrictions.find(
      (r) => r.type === "FINANCIAL" && r.source === "AUTOMATIC"
    );

    if (financialRestriction) {
      const updated = await db.restriction.update({
        where: { id: financialRestriction.id },
        data: {
          status: "LIFTED",
          liftedAt: new Date(),
          liftReason: `Balance restored to ₹${Math.round(evaluation.availableBalance)} (≥ required ₹${policy.requiredBalance}).`,
        },
      });

      return { lifted: true, restriction: updated };
    }
  }

  return { lifted: false };
}

// ─────────────────────────────────────────────────────────────
// Admin manual operations
// ─────────────────────────────────────────────────────────────

export async function applyAdminRestriction(
  userId: string,
  adminId: string,
  reason: string,
  expiresAt?: Date
): Promise<Restriction> {
  return db.restriction.create({
    data: {
      userId,
      type: "ADMINISTRATIVE",
      reason,
      source: "MANUAL",
      status: "ACTIVE",
      appliedBy: adminId,
      expiresAt: expiresAt ?? null,
    },
  });
}

export async function applyFinancialExemption(
  userId: string,
  adminId: string,
  reason: string,
  expiresAt?: Date
): Promise<Restriction> {
  // Lift any existing automatic financial restriction
  await db.restriction.updateMany({
    where: { userId, type: "FINANCIAL", source: "AUTOMATIC", status: "ACTIVE" },
    data: {
      status: "LIFTED",
      liftedBy: adminId,
      liftedAt: new Date(),
      liftReason: `Exempted by admin: ${reason}`,
    },
  });

  // Create the exemption
  return db.restriction.create({
    data: {
      userId,
      type: "FINANCIAL",
      reason: `EXEMPTION: ${reason}`,
      source: "MANUAL",
      status: "ACTIVE",
      appliedBy: adminId,
      expiresAt: expiresAt ?? null,
    },
  });
}

export async function liftRestriction(
  restrictionId: string,
  adminId: string,
  reason: string
): Promise<Restriction | null> {
  const existing = await db.restriction.findUnique({ where: { id: restrictionId } });
  if (!existing) return null;

  return db.restriction.update({
    where: { id: restrictionId },
    data: {
      status: "LIFTED",
      liftedBy: adminId,
      liftedAt: new Date(),
      liftReason: reason,
    },
  });
}
