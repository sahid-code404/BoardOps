import { and, asc, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";

import { databaseDateToIso } from "./auth/session";
import { createDatabase } from "./db/client";
import { Bill, LedgerEntry, Notification, Restriction, Variable } from "./db/schema";

type NativeDatabase = ReturnType<typeof createDatabase>;

export type NativeRestriction = {
  id: string;
  userId: string;
  type: string;
  reason: string;
  source: string;
  status: string;
  appliedBy: string | null;
  appliedAt: string | null;
  expiresAt: string | null;
  liftedBy: string | null;
  liftedAt: string | null;
  liftReason: string | null;
};

export type RestrictionPolicy = {
  enabled: boolean;
  graceDays: number;
  requiredBalance: number;
};

export type RestrictionEvaluation = {
  hasActiveFinancialRestriction: boolean;
  hasActiveAdminRestriction: boolean;
  hasExemption: boolean;
  financialStatus: string;
  availableBalance: number;
  requiredBalance: number;
  graceDaysRemaining: number | null;
  canBookMeals: boolean;
  activeRestrictions: NativeRestriction[];
  restrictionReason: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_PERIOD_DAYS = 2;
const DEFAULT_REQUIRED_BALANCE = 1000;

export function deriveRestrictionEvaluation(input: {
  policy: RestrictionPolicy;
  availableBalance: number;
  outstandingDue: number;
  activeRestrictions: NativeRestriction[];
  lowBalanceWarningCreatedAt: string | null;
  now: Date;
}): RestrictionEvaluation {
  const { policy, outstandingDue, activeRestrictions, now } = input;
  const availableBalance = Math.max(0, input.availableBalance);
  const hasActiveFinancialRestriction = activeRestrictions.some(
    (restriction) => restriction.type === "FINANCIAL",
  );
  const hasActiveAdminRestriction = activeRestrictions.some(
    (restriction) => restriction.type === "ADMINISTRATIVE",
  );
  const hasExemption = activeRestrictions.some(
    (restriction) =>
      restriction.type === "FINANCIAL" &&
      restriction.source === "MANUAL" &&
      restriction.reason.includes("EXEMPTION"),
  );

  let graceDaysRemaining: number | null = null;
  if (
    !hasExemption &&
    !hasActiveFinancialRestriction &&
    policy.enabled &&
    availableBalance < policy.requiredBalance &&
    outstandingDue > 0
  ) {
    if (input.lowBalanceWarningCreatedAt) {
      const warning = new Date(input.lowBalanceWarningCreatedAt);
      if (!Number.isNaN(warning.getTime())) {
        const graceEnd = warning.getTime() + policy.graceDays * DAY_MS;
        graceDaysRemaining = Math.max(0, Math.ceil((graceEnd - now.getTime()) / DAY_MS));
      }
    }
    if (graceDaysRemaining === null) graceDaysRemaining = policy.graceDays;
  }

  const canBookMeals = !hasActiveFinancialRestriction || hasExemption;
  let financialStatus = "HEALTHY";
  if (hasExemption) {
    financialStatus = "EXEMPTED";
  } else if (hasActiveFinancialRestriction) {
    financialStatus = "RESTRICTED";
  } else if (availableBalance < policy.requiredBalance && outstandingDue > 0) {
    financialStatus = graceDaysRemaining !== null && graceDaysRemaining > 0
      ? "LOW_BALANCE"
      : "RESTRICTED";
  } else if (outstandingDue > 0) {
    financialStatus = "OVERDUE";
  }

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
    restrictionReason: activeRestrictions[0]?.reason ?? null,
  };
}

async function getPolicyConfig(db: NativeDatabase): Promise<RestrictionPolicy> {
  const rows = await db
    .select({ key: Variable.key, value: Variable.value })
    .from(Variable)
    .where(
      inArray(Variable.key, [
        "policy.lowBalance.graceDays",
        "policy.lowBalance.requiredBalance",
        "policy.lowBalance.enabled",
      ]),
    );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const parsedGrace = Number.parseInt(values.get("policy.lowBalance.graceDays") ?? "", 10);
  const parsedBalance = Number.parseFloat(values.get("policy.lowBalance.requiredBalance") ?? "");

  return {
    enabled: values.get("policy.lowBalance.enabled") !== "false",
    graceDays: Number.isFinite(parsedGrace) && parsedGrace !== 0
      ? parsedGrace
      : DEFAULT_GRACE_PERIOD_DAYS,
    requiredBalance: Number.isFinite(parsedBalance) && parsedBalance !== 0
      ? parsedBalance
      : DEFAULT_REQUIRED_BALANCE,
  };
}

function serializeRestriction(record: typeof Restriction.$inferSelect): NativeRestriction {
  return {
    id: record.id,
    userId: record.userId,
    type: record.type,
    reason: record.reason,
    source: record.source,
    status: record.status,
    appliedBy: record.appliedBy,
    appliedAt: databaseDateToIso(record.appliedAt),
    expiresAt: databaseDateToIso(record.expiresAt),
    liftedBy: record.liftedBy,
    liftedAt: databaseDateToIso(record.liftedAt),
    liftReason: record.liftReason,
  };
}

export async function evaluateRestrictions(
  db: NativeDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<RestrictionEvaluation> {
  const [policy, latestLedger, dueBills, restrictionRows] = await Promise.all([
    getPolicyConfig(db),
    db
      .select({ runningBalance: LedgerEntry.runningBalance })
      .from(LedgerEntry)
      .where(eq(LedgerEntry.userId, userId))
      .orderBy(desc(LedgerEntry.createdAt))
      .limit(1),
    db
      .select({ dueAmount: Bill.dueAmount })
      .from(Bill)
      .where(
        and(
          eq(Bill.userId, userId),
          isNull(Bill.deletedAt),
          notInArray(Bill.status, ["VOID", "DELETED"]),
        ),
      ),
    db
      .select()
      .from(Restriction)
      .where(and(eq(Restriction.userId, userId), eq(Restriction.status, "ACTIVE")))
      .orderBy(desc(Restriction.appliedAt)),
  ]);

  const availableBalance = latestLedger[0]?.runningBalance ?? 0;
  const outstandingDue = dueBills.reduce((sum, bill) => sum + Math.max(0, bill.dueAmount), 0);
  const activeRestrictions = restrictionRows.map(serializeRestriction);

  let lowBalanceWarningCreatedAt: string | null = null;
  const hasExemption = activeRestrictions.some(
    (restriction) =>
      restriction.type === "FINANCIAL" &&
      restriction.source === "MANUAL" &&
      restriction.reason.includes("EXEMPTION"),
  );
  const hasFinancialRestriction = activeRestrictions.some(
    (restriction) => restriction.type === "FINANCIAL",
  );

  if (
    !hasExemption &&
    !hasFinancialRestriction &&
    policy.enabled &&
    availableBalance < policy.requiredBalance &&
    outstandingDue > 0
  ) {
    const cutoff = new Date(now.getTime() - policy.graceDays * DAY_MS).toISOString();
    const warnings = await db
      .select({ createdAt: Notification.createdAt })
      .from(Notification)
      .where(
        and(
          eq(Notification.userId, userId),
          eq(Notification.title, "Low Balance Warning"),
          gte(Notification.createdAt, cutoff),
        ),
      )
      .orderBy(asc(Notification.createdAt))
      .limit(1);
    lowBalanceWarningCreatedAt = databaseDateToIso(warnings[0]?.createdAt ?? null);
  }

  return deriveRestrictionEvaluation({
    policy,
    availableBalance,
    outstandingDue,
    activeRestrictions,
    lowBalanceWarningCreatedAt,
    now,
  });
}
