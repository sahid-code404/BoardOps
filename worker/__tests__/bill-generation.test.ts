import { describe, expect, it } from "vitest";

import { calculateBillAmounts, getBillLedgerTarget } from "../bill-generation";

describe("native bill generation math", () => {
  it("keeps actual meal charges separate from prorated fixed charges", () => {
    expect(
      calculateBillAmounts({
        residentMealCount: 20,
        perMealCharge: 37.5,
        roomRent: 3000,
        cleaning: 500,
        prorationFactor: 0.5,
      }),
    ).toEqual({
      mealCharges: 750,
      otherCharges: 3500,
      proratedOtherCharges: 1750,
      totalAmount: 2500,
    });
  });

  it("uses the same integer rounding contract as the legacy bill engine", () => {
    expect(
      calculateBillAmounts({
        residentMealCount: 3,
        perMealCharge: 10.49,
        roomRent: 101,
        cleaning: 0,
        prorationFactor: 1 / 3,
      }),
    ).toEqual({
      mealCharges: 31,
      otherCharges: 101,
      proratedOtherCharges: 34,
      totalAmount: 65,
    });
  });

  it("normalizes the bill ledger contribution to the negative current total", () => {
    expect(getBillLedgerTarget(2450)).toBe(-2450);
    expect(getBillLedgerTarget(0)).toBe(-0);
  });
});
