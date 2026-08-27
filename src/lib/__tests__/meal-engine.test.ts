/// <reference types="bun-types" />
import { test, expect, describe } from "bun:test";
import {
  computeEditableUntil,
  isLocked,
  isPreRegistration,
  isMealBeforeEnrollment,
} from "@/lib/meal-engine";

// Minimal meal-config shape — only the fields the engine reads. Using a
// literal object avoids touching the database while still exercising the
// production code path.
type MealConfig = {
  cutoffStrategy: "SAME_DAY" | "PREVIOUS_DAY" | "CUSTOM_OFFSET";
  cutoffTime: string;
  cutoffOffsetMinutes: number;
};

describe("meal-engine: isMealBeforeEnrollment", () => {
  // User registers on July 8 at 8:00 AM local time.
  const regDate = new Date(2026, 6, 8, 8, 0, 0); // 2026-07-08 08:00
  const meal: MealConfig = {
    cutoffStrategy: "SAME_DAY",
    cutoffTime: "16:00", // cutoff is 4 PM on the service date
    cutoffOffsetMinutes: 0,
  };

  test("service date strictly before registration date → true", () => {
    const svc = new Date(2026, 6, 1); // July 1 — week before registration
    expect(isMealBeforeEnrollment(svc, regDate, meal)).toBe(true);
  });

  test("service date strictly after registration date → false", () => {
    const svc = new Date(2026, 6, 15); // July 15 — week after registration
    expect(isMealBeforeEnrollment(svc, regDate, meal)).toBe(false);
  });

  test("same day, registered before cutoff → false (can still toggle)", () => {
    // Service date == registration date == July 8.
    // Cutoff is 4 PM; user registered at 8 AM (before cutoff) → can toggle.
    const svc = new Date(2026, 6, 8, 12, 0, 0);
    expect(isMealBeforeEnrollment(svc, regDate, meal)).toBe(false);
  });

  test("same day, registered after cutoff → true (cutoff already passed)", () => {
    // User registers at 5 PM (after the 4 PM cutoff) → meal is already locked.
    const lateReg = new Date(2026, 6, 8, 17, 0, 0); // 5 PM
    const svc = new Date(2026, 6, 8, 12, 0, 0);
    expect(isMealBeforeEnrollment(svc, lateReg, meal)).toBe(true);
  });

  test("PREVIOUS_DAY cutoff strategy — same-day registration is always before enrollment (cutoff was yesterday)", () => {
    // Cutoff for a July 8 service date with PREVIOUS_DAY@16:00 is July 7 16:00.
    // A user who registers ANY time on July 8 has already missed the cutoff.
    const prevDayMeal: MealConfig = {
      cutoffStrategy: "PREVIOUS_DAY",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 0,
    };
    const svc = new Date(2026, 6, 8, 8, 0, 0); // July 8 8 AM
    const earlyReg = new Date(2026, 6, 8, 0, 30, 0); // registered 12:30 AM July 8
    expect(isMealBeforeEnrollment(svc, earlyReg, prevDayMeal)).toBe(true);
  });

  test("CUSTOM_OFFSET cutoff strategy — respects the offset on the service date", () => {
    // CUSTOM_OFFSET subtracts cutoffOffsetMinutes from the cutoffTime on the
    // service date. With cutoffTime=16:00 and offset=120 min, the cutoff is
    // 14:00 on July 8. A user who registered at 13:00 is before the cutoff
    // (false); one who registered at 15:00 is after the cutoff (true).
    const customMeal: MealConfig = {
      cutoffStrategy: "CUSTOM_OFFSET",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 120, // cutoff moves to 14:00
    };
    const svc = new Date(2026, 6, 8, 12, 0, 0);

    const beforeCutoff = new Date(2026, 6, 8, 13, 0, 0); // 1 PM — before 2 PM cutoff
    expect(isMealBeforeEnrollment(svc, beforeCutoff, customMeal)).toBe(false);

    const afterCutoff = new Date(2026, 6, 8, 15, 0, 0); // 3 PM — after 2 PM cutoff
    expect(isMealBeforeEnrollment(svc, afterCutoff, customMeal)).toBe(true);
  });
});

describe("meal-engine: isPreRegistration", () => {
  // Date-only comparison — time-of-day is ignored on both sides.
  const regDate = new Date(2026, 6, 8, 14, 30, 0); // July 8, 2:30 PM

  test("service date strictly before registration date → true", () => {
    expect(isPreRegistration(new Date(2026, 6, 1), regDate)).toBe(true);
  });

  test("service date strictly after registration date → false", () => {
    expect(isPreRegistration(new Date(2026, 6, 20), regDate)).toBe(false);
  });

  test("same day → false (user can still eat meals on registration day)", () => {
    // Even though the user registered at 2:30 PM, the date-only check treats
    // them as enrolled for the whole day. Use `isMealBeforeEnrollment` for
    // the precise cutoff-aware check on the registration day itself.
    expect(isPreRegistration(new Date(2026, 6, 8, 8, 0, 0), regDate)).toBe(false);
  });
});

describe("meal-engine: computeEditableUntil", () => {
  const serviceDate = new Date(2026, 6, 8, 12, 0, 0); // July 8 noon — time is overwritten

  test("SAME_DAY strategy — cutoff is at cutoffTime on the service date", () => {
    const meal: MealConfig = {
      cutoffStrategy: "SAME_DAY",
      cutoffTime: "16:30",
      cutoffOffsetMinutes: 0,
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6); // July (0-indexed)
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(16);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  test("PREVIOUS_DAY strategy — cutoff is at cutoffTime on the day before", () => {
    const meal: MealConfig = {
      cutoffStrategy: "PREVIOUS_DAY",
      cutoffTime: "10:00",
      cutoffOffsetMinutes: 0,
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getDate()).toBe(7); // July 7
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });

  test("CUSTOM_OFFSET strategy — cutoff is cutoffTime minus offset minutes", () => {
    const meal: MealConfig = {
      cutoffStrategy: "CUSTOM_OFFSET",
      cutoffTime: "16:00",
      cutoffOffsetMinutes: 90, // 1h30m earlier → 14:30
    };
    const result = computeEditableUntil(meal, serviceDate);
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  test("CUSTOM_OFFSET with zero offset matches SAME_DAY at cutoffTime", () => {
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
    const editableUntil = new Date(2026, 6, 8, 12, 0, 0); // July 8 noon
    const now = new Date(2026, 6, 8, 13, 0, 0); // July 8 1 PM — after cutoff
    expect(isLocked(editableUntil, now)).toBe(true);
  });

  test("editableUntil in the future → not locked", () => {
    const editableUntil = new Date(2026, 6, 8, 12, 0, 0); // July 8 noon
    const now = new Date(2026, 6, 8, 11, 0, 0); // July 8 11 AM — before cutoff
    expect(isLocked(editableUntil, now)).toBe(false);
  });

  test("exactly at cutoff → not locked (boundary is exclusive on the past side)", () => {
    // `isLocked` is `now > editableUntil` — equal timestamps are NOT locked.
    const t = new Date(2026, 6, 8, 12, 0, 0);
    expect(isLocked(t, t)).toBe(false);
  });

  test("defaults `now` to the current time", () => {
    const future = new Date(Date.now() + 60_000); // 1 minute in the future
    expect(isLocked(future)).toBe(false);
    const past = new Date(Date.now() - 60_000); // 1 minute in the past
    expect(isLocked(past)).toBe(true);
  });
});
