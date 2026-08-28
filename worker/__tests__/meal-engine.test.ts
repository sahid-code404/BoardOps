import { describe, expect, it } from "vitest";

import {
  computeEditableUntil,
  getRegistrationDate,
  isLocked,
  isMealBeforeEnrollment,
  isOverridden,
  isPreRegistration,
} from "../meal-engine";

const sameDay = {
  cutoffStrategy: "SAME_DAY",
  cutoffTime: "16:00",
  cutoffOffsetMinutes: 0,
};

describe("meal cutoff engine", () => {
  it("computes same-day and previous-day UTC cutoffs", () => {
    const service = new Date("2026-08-28T00:00:00.000Z");
    expect(computeEditableUntil(sameDay, service).toISOString()).toBe("2026-08-28T16:00:00.000Z");
    expect(
      computeEditableUntil(
        { ...sameDay, cutoffStrategy: "PREVIOUS_DAY", cutoffTime: "07:30" },
        service,
      ).toISOString(),
    ).toBe("2026-08-27T07:30:00.000Z");
  });

  it("applies custom offset minutes", () => {
    const service = new Date("2026-08-28T00:00:00.000Z");
    expect(
      computeEditableUntil(
        { cutoffStrategy: "CUSTOM_OFFSET", cutoffTime: "16:00", cutoffOffsetMinutes: 90 },
        service,
      ).toISOString(),
    ).toBe("2026-08-28T14:30:00.000Z");
  });

  it("uses strict greater-than locking", () => {
    const cutoff = new Date("2026-08-28T16:00:00.000Z");
    expect(isLocked(cutoff, new Date("2026-08-28T16:00:00.000Z"))).toBe(false);
    expect(isLocked(cutoff, new Date("2026-08-28T16:00:00.001Z"))).toBe(true);
  });

  it("normalizes registration dates and detects pre-registration service dates", () => {
    const created = new Date("2026-08-28T13:45:00.000Z");
    expect(getRegistrationDate(created).toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(isPreRegistration(new Date("2026-08-27T00:00:00.000Z"), created)).toBe(true);
    expect(isPreRegistration(new Date("2026-08-28T00:00:00.000Z"), created)).toBe(false);
  });

  it("treats same-day meals as before enrollment when registration missed cutoff", () => {
    const service = new Date("2026-08-28T00:00:00.000Z");
    expect(
      isMealBeforeEnrollment(service, new Date("2026-08-28T17:00:00.000Z"), sameDay),
    ).toBe(true);
    expect(
      isMealBeforeEnrollment(service, new Date("2026-08-28T15:00:00.000Z"), sameDay),
    ).toBe(false);
  });

  it("treats LOCKED as the immutable ON state for overrides", () => {
    expect(isOverridden({ status: "LOCKED", originalState: "ON" })).toBe(false);
    expect(isOverridden({ status: "LOCKED", originalState: "OFF" })).toBe(true);
    expect(isOverridden({ status: "OFF", originalState: "ON" })).toBe(true);
  });
});
