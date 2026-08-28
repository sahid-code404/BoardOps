import { describe, expect, it } from "vitest";

import {
  deriveRestrictionEvaluation,
  type NativeRestriction,
  type RestrictionPolicy,
} from "../restriction-engine";

const policy: RestrictionPolicy = {
  enabled: true,
  graceDays: 2,
  requiredBalance: 1000,
};

function restriction(overrides: Partial<NativeRestriction> = {}): NativeRestriction {
  return {
    id: "restriction-1",
    userId: "user-1",
    type: "FINANCIAL",
    reason: "Insufficient balance",
    source: "AUTOMATIC",
    status: "ACTIVE",
    appliedBy: null,
    appliedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: null,
    liftedBy: null,
    liftedAt: null,
    liftReason: null,
    ...overrides,
  };
}

describe("restriction evaluation", () => {
  it("blocks meal booking for an active automatic financial restriction", () => {
    const result = deriveRestrictionEvaluation({
      policy,
      availableBalance: 100,
      outstandingDue: 500,
      activeRestrictions: [restriction()],
      lowBalanceWarningCreatedAt: null,
      now: new Date("2026-08-28T00:00:00.000Z"),
    });

    expect(result.canBookMeals).toBe(false);
    expect(result.financialStatus).toBe("RESTRICTED");
    expect(result.hasActiveFinancialRestriction).toBe(true);
  });

  it("allows meal booking for a manual financial exemption", () => {
    const result = deriveRestrictionEvaluation({
      policy,
      availableBalance: 100,
      outstandingDue: 500,
      activeRestrictions: [
        restriction({ source: "MANUAL", reason: "EXEMPTION: scholarship" }),
      ],
      lowBalanceWarningCreatedAt: null,
      now: new Date("2026-08-28T00:00:00.000Z"),
    });

    expect(result.hasExemption).toBe(true);
    expect(result.canBookMeals).toBe(true);
    expect(result.financialStatus).toBe("EXEMPTED");
  });

  it("reports the remaining low-balance grace period", () => {
    const result = deriveRestrictionEvaluation({
      policy,
      availableBalance: 100,
      outstandingDue: 500,
      activeRestrictions: [],
      lowBalanceWarningCreatedAt: "2026-08-27T12:00:00.000Z",
      now: new Date("2026-08-28T12:00:00.000Z"),
    });

    expect(result.graceDaysRemaining).toBe(1);
    expect(result.financialStatus).toBe("LOW_BALANCE");
    expect(result.canBookMeals).toBe(true);
  });

  it("starts with the configured grace period when no warning exists", () => {
    const result = deriveRestrictionEvaluation({
      policy,
      availableBalance: 100,
      outstandingDue: 500,
      activeRestrictions: [],
      lowBalanceWarningCreatedAt: null,
      now: new Date("2026-08-28T12:00:00.000Z"),
    });

    expect(result.graceDaysRemaining).toBe(2);
    expect(result.financialStatus).toBe("LOW_BALANCE");
  });

  it("clamps a negative ledger balance to zero", () => {
    const result = deriveRestrictionEvaluation({
      policy,
      availableBalance: -50,
      outstandingDue: 0,
      activeRestrictions: [],
      lowBalanceWarningCreatedAt: null,
      now: new Date("2026-08-28T12:00:00.000Z"),
    });

    expect(result.availableBalance).toBe(0);
    expect(result.financialStatus).toBe("HEALTHY");
  });
});
