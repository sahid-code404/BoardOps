import { describe, expect, test } from "vitest";
import { computeProrationFactor } from "@/lib/bill-proration";

// Proration model (BLG-1):
//   factor = daysEnrolled / daysInMonth
// where `daysEnrolled` counts BOTH the registration day and the last day of
// the month inclusively. Mid-month joiners pay only for the days they were
// actually a resident; meal charges are NOT prorated (only the fixed
// `roomRent + cleaning` portion is).
describe("bill-calculation: proration factor", () => {
  test("full-month enrollment → factor = 1.0", () => {
    const userCreatedAt = new Date(2025, 0, 1);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 6, 2026);
    expect(daysInMonth).toBe(31);
    expect(daysEnrolled).toBe(31);
    expect(factor).toBe(1);
  });

  test("mid-month enrollment (day 15 of 30) uses inclusive enrolled days", () => {
    const userCreatedAt = new Date(2026, 5, 15);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 5, 2026);
    expect(daysInMonth).toBe(30);
    expect(daysEnrolled).toBe(16);
    expect(factor).toBeCloseTo(16 / 30, 10);
    expect(factor).toBeGreaterThan(0.5);
    expect(factor).toBeLessThan(0.6);
  });

  test("first day of month (registered on the 1st) → factor = 1.0", () => {
    const userCreatedAt = new Date(2026, 6, 1, 9, 0, 0);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 6, 2026);
    expect(daysInMonth).toBe(31);
    expect(daysEnrolled).toBe(31);
    expect(factor).toBe(1);
  });

  test("last day of month (registered on the 30th of June) → factor = 1/30", () => {
    const userCreatedAt = new Date(2026, 5, 30, 23, 59, 0);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 5, 2026);
    expect(daysInMonth).toBe(30);
    expect(daysEnrolled).toBe(1);
    expect(factor).toBeCloseTo(1 / 30, 10);
  });

  test("registration BEFORE the period starts → factor = 1.0 (full month)", () => {
    const userCreatedAt = new Date(2020, 0, 1);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 1, 2026);
    expect(daysInMonth).toBe(28);
    expect(daysEnrolled).toBe(28);
    expect(factor).toBe(1);
  });

  test("registration ON the last day of February in a non-leap year → factor = 1/28", () => {
    const userCreatedAt = new Date(2026, 1, 28, 12, 0, 0);
    const { factor, daysEnrolled, daysInMonth } = computeProrationFactor(userCreatedAt, 1, 2026);
    expect(daysInMonth).toBe(28);
    expect(daysEnrolled).toBe(1);
    expect(factor).toBeCloseTo(1 / 28, 10);
  });

  test("time-of-day on the registration date is ignored (date-only comparison)", () => {
    const morning = new Date(2026, 6, 15, 6, 0, 0);
    const evening = new Date(2026, 6, 15, 23, 30, 0);
    const a = computeProrationFactor(morning, 6, 2026);
    const b = computeProrationFactor(evening, 6, 2026);
    expect(a.factor).toBe(b.factor);
    expect(a.daysEnrolled).toBe(b.daysEnrolled);
  });

  test("factor is always 0..1 (never negative, never > 1)", () => {
    const futureReg = new Date(2026, 11, 31, 23, 59, 59);
    const { factor, daysEnrolled } = computeProrationFactor(futureReg, 6, 2026);
    expect(daysEnrolled).toBe(0);
    expect(factor).toBe(0);

    const longTenured = computeProrationFactor(new Date(2000, 0, 1), 6, 2026);
    expect(longTenured.factor).toBeLessThanOrEqual(1);
    expect(longTenured.factor).toBeGreaterThanOrEqual(0);
  });
});
