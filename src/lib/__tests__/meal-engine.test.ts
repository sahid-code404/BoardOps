import { describe, expect, test } from "vitest";
import {
  computeEditableUntil,
  isLocked,
  isPreRegistration,
  isMealBeforeEnrollment,
} from "@/lib/meal-engine";

type MealConfig = {
  cutoffStrategy: "SAME_DAY" | "PREVIOUS_DAY" | "CUSTOM_OFFSET";
  cutoffTime: string;
  cutoffOffsetMinutes: number;
};

describe("meal-engine: isMealBeforeEnrollment", () => {
  const regDate = new Date(2026, 6, 8, 8, 0, 0);
  const meal: MealConfig = {
    cutoffStrategy: "SAME_DAY",
    cutoffTime: "16:00",
    cutoffOffsetMinutes: 0,
  };

  test("service date strictly before registration date → true", () => {
    expect(isMealBeforeEnrollment(new Date(2026, 6, 1), regDate, meal)).toBe(true);
  });

  test("service date strictly after registration date → false", () => {
    expect(isMealBeforeEnrollment(new Date(2026, 6, 15), regDate, meal)).toBe(false);
  });

  test("same day, registered before cutoff → false", () => {
    expect(isMealBeforeEnrollment(new Date(2026, 6, 8, 12, 0, 0), regDate, meal)).toBe(false);
  });

  test("same day, registered after cutoff → true", () => {
    const lateReg = new Date(2026, 6, 8, 17, 0, 0);
    expect(isMealBeforeEnrollment(new Date(2026, 6, 8, 12, 0, 0), lateReg, meal)).toBe(true);
  });

  test("PREVIOUS_DAY cutoff makes same-day registration too late", () => {
    const prevDayMeal: MealConfig = {
      cutoffStrategy: "PREVIOUS_DAY",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 0,
    };
    const serviceDate = new Date(2026, 6, 8, 8, 0, 0);
    const earlyReg = new Date(2026, 6, 8, 0, 30, 0);
    expect(isMealBeforeEnrollment(serviceDate, earlyReg, prevDayMeal)).toBe(true);
  });

  test("CUSTOM_OFFSET cutoff respects the configured offset", () => {
    const customMeal: MealConfig = {
      cutoffStrategy: "CUSTOM_OFFSET",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 120,
    };
    const serviceDate = new Date(2026, 6, 8, 12, 0, 0);
    expect(isMealBeforeEnrollment(serviceDate, new Date(2026, 6, 8, 13, 0, 0), customMeal)).toBe(false);
    expect(isMealBeforeEnrollment(serviceDate, new Date(2026, 6, 8, 15, 0, 0), customMeal)).toBe(true);
  });
});

describe("meal-engine: isPreRegistration", () => {
  const regDate = new Date(2026, 6, 8, 14, 30, 0);

  test("service date strictly before registration date → true", () => {
    expect(isPreRegistration(new Date(2026, 6, 1), regDate)).toBe(true);
  });

  test("service date strictly after registration date → false", () => {
    expect(isPreRegistration(new Date(2026, 6, 20), regDate)).toBe(false);
  });

  test("same day → false", () => {
    expect(isPreRegistration(new Date(2026, 6, 8, 8, 0, 0), regDate)).toBe(false);
  });
});

describe("meal-engine: computeEditableUntil", () => {
  const serviceDate = new Date(2026, 6, 8, 12, 0, 0);

  test("SAME_DAY strategy uses cutoffTime on the service date", () => {
    const meal: MealConfig = {
      cutoffStrategy: "SAME_DAY",
      cutoffTime: "16:30",
      cutoffOffsetMinutes: 0,
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(16);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  test("PREVIOUS_DAY strategy uses cutoffTime on the previous day", () => {
    const meal: MealConfig = {
      cutoffStrategy: "PREVIOUS_DAY",
      cutoffTime: "10:00",
      cutoffOffsetMinutes: 0,
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getDate()).toBe(7);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });

  test("CUSTOM_OFFSET strategy subtracts offset minutes", () => {
    const meal: MealConfig = {
      cutoffStrategy: "CUSTOM_OFFSET",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 90,
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  test("CUSTOM_OFFSET with zero offset matches SAME_DAY", () => {
    const sameDay: MealConfig = {
      cutoffStrategy: "SAME_DAY",
      cutoffTime: "09:15",
      cutoffOffsetMinutes: 0,
    };
    const customZero: MealConfig = {
      cutoffStrategy: "CUSTOM_OFFSET",
      cutoffTime: "09:15",
      cutoffOffsetMinutes: 0,
    };
    expect(computeEditableUntil(customZero, serviceDate).getTime()).toBe(
      computeEditableUntil(sameDay, serviceDate).getTime()
    );
  });
});

describe("meal-engine: isLocked", () => {
  test("editableUntil in the past → locked", () => {
    expect(
      isLocked(new Date(2026, 6, 8, 12, 0, 0), new Date(2026, 6, 8, 13, 0, 0))
    ).toBe(true);
  });

  test("editableUntil in the future → not locked", () => {
    expect(
      isLocked(new Date(2026, 6, 8, 12, 0, 0), new Date(2026, 6, 8, 11, 0, 0))
    ).toBe(false);
  });

  test("exactly at cutoff → not locked", () => {
    const time = new Date(2026, 6, 8, 12, 0, 0);
    expect(isLocked(time, time)).toBe(false);
  });

  test("defaults now to the current time", () => {
    expect(isLocked(new Date(Date.now() + 60_000))).toBe(false);
    expect(isLocked(new Date(Date.now() - 60_000))).toBe(true);
  });
});
