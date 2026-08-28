import { describe, expect, it } from "vitest";

import { calculateSettlement } from "../monthly-closing";

describe("calculateSettlement", () => {
  it("separates outstanding dues from overpayments", () => {
    expect(calculateSettlement([
      { id: "a", userId: "u1", totalAmount: 1000, paidAmount: 250 },
      { id: "b", userId: "u2", totalAmount: 500, paidAmount: 650 },
      { id: "c", userId: "u3", totalAmount: 300, paidAmount: 300 },
    ])).toEqual({
      refundQueueTotal: 150,
      outstandingDue: 750,
      overpayments: [{ billId: "b", userId: "u2", amount: 150 }],
    });
  });

  it("clamps corrupted negative paid amounts before deriving dues", () => {
    expect(calculateSettlement([
      { id: "a", userId: "u1", totalAmount: 400, paidAmount: -50 },
    ])).toEqual({
      refundQueueTotal: 0,
      outstandingDue: 400,
      overpayments: [],
    });
  });

  it("handles multiple overpayments without losing precision", () => {
    const result = calculateSettlement([
      { id: "a", userId: "u1", totalAmount: 100.25, paidAmount: 125.5 },
      { id: "b", userId: "u2", totalAmount: 200.1, paidAmount: 210.35 },
    ]);
    expect(result.refundQueueTotal).toBeCloseTo(35.5);
    expect(result.outstandingDue).toBe(0);
    expect(result.overpayments).toHaveLength(2);
  });
});
