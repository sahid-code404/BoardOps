import { describe, expect, it } from "vitest";

import { computeProrationFactor } from "../bill-proration";

describe("computeProrationFactor", () => {
  it("charges a full month for a resident enrolled before the period", () => {
    expect(computeProrationFactor(new Date("2026-06-15T12:00:00Z"), 6, 2026)).toEqual({
      factor: 1,
      daysEnrolled: 31,
      daysInMonth: 31,
    });
  });

  it("prorates inclusively for a mid-month enrollment", () => {
    const result = computeProrationFactor(new Date("2026-07-20T23:59:00Z"), 6, 2026);
    expect(result.daysEnrolled).toBe(12);
    expect(result.daysInMonth).toBe(31);
    expect(result.factor).toBeCloseTo(12 / 31);
  });

  it("charges one day when enrollment is on the last day", () => {
    expect(computeProrationFactor(new Date("2026-07-31T08:00:00Z"), 6, 2026)).toEqual({
      factor: 1 / 31,
      daysEnrolled: 1,
      daysInMonth: 31,
    });
  });

  it("returns zero enrollment for a resident created after the billing month", () => {
    expect(computeProrationFactor(new Date("2026-08-01T00:00:00Z"), 6, 2026)).toEqual({
      factor: 0,
      daysEnrolled: 0,
      daysInMonth: 31,
    });
  });

  it("handles leap-year February", () => {
    const result = computeProrationFactor(new Date("2028-02-15T00:00:00Z"), 1, 2028);
    expect(result.daysInMonth).toBe(29);
    expect(result.daysEnrolled).toBe(15);
    expect(result.factor).toBeCloseTo(15 / 29);
  });
});
