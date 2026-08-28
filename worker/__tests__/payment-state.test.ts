import { describe, expect, it } from "vitest";

import {
  getEffectiveBillingPeriod,
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
