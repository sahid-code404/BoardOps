import { describe, expect, it } from "vitest";

import {
  getEffectiveBillingPeriod,
  getLedgerCorrection,
  getLedgerTargetBalance,
  getPaymentLedgerIntent,
  resolvePaymentTarget,
} from "../payment-state";

describe("payment state helpers", () => {
  it("defaults unknown and missing actions to approval", () => {
    expect(resolvePaymentTarget(undefined)).toBe("APPROVED");
    expect(resolvePaymentTarget("APPROVE")).toBe("APPROVED");
    expect(resolvePaymentTarget("anything-else")).toBe("APPROVED");
    expect(resolvePaymentTarget("REJECT")).toBe("REJECTED");
  });

  it("uses the current UTC period while the cycle is not closed", () => {
    const now = new Date("2026-08-28T13:00:00.000Z");
    expect(getEffectiveBillingPeriod(now, "OPEN")).toEqual({ month: 7, year: 2026 });
    expect(getEffectiveBillingPeriod(now, null)).toEqual({ month: 7, year: 2026 });
  });

  it("rolls a closed cycle into the next month and year", () => {
    expect(
      getEffectiveBillingPeriod(new Date("2026-08-28T13:00:00.000Z"), "CLOSED"),
    ).toEqual({ month: 8, year: 2026 });
    expect(
      getEffectiveBillingPeriod(new Date("2026-12-15T13:00:00.000Z"), "CLOSED"),
    ).toEqual({ month: 0, year: 2027 });
  });

  it("keeps approved payments credited and every non-approved state neutral", () => {
    expect(getLedgerTargetBalance("APPROVED", 1250)).toBe(1250);
    expect(getLedgerTargetBalance("PENDING", 1250)).toBe(0);
    expect(getLedgerTargetBalance("REJECTED", 1250)).toBe(0);
    expect(getLedgerTargetBalance("VOID", 1250)).toBe(0);
    expect(getLedgerTargetBalance("DELETED", 1250)).toBe(0);
  });

  it("computes self-healing ledger corrections", () => {
    expect(getLedgerCorrection("APPROVED", 1250, 0)).toBe(1250);
    expect(getLedgerCorrection("APPROVED", 1250, 1000)).toBe(250);
    expect(getLedgerCorrection("REJECTED", 1250, 1250)).toBe(-1250);
    expect(getLedgerCorrection("DELETED", 1250, 2500)).toBe(-2500);
    expect(getLedgerCorrection("PENDING", 1250, -50)).toBe(50);
  });

  it("creates credit and reversal ledger intents", () => {
    expect(getPaymentLedgerIntent("APPROVED", 1250, "UPI")).toMatchObject({
      type: "DEPOSIT",
      amount: 1250,
    });
    expect(getPaymentLedgerIntent("REJECTED", 1250, "UPI")).toMatchObject({
      type: "ADJUSTMENT",
      amount: -1250,
    });
  });
});
