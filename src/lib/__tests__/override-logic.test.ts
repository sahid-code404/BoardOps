/// <reference types="bun-types" />
import { test, expect, describe } from "bun:test";
import { isOverridden } from "@/lib/meal-engine";

// The override flag is NEVER stored in the database — it is derived
// dynamically from `status` vs `originalState` on every read. LOCKED is
// treated as ON (it's the immutable variant of a confirmed meal: the user
// picked ON, the cutoff has now passed, the entry can no longer be toggled).
//
// Production callers: dashboard route, kitchen route, meals/entries route,
// reports/meals route — all import `isOverridden` from `@/lib/meal-engine`.

describe("override-logic: isOverridden", () => {
  test("status=ON, originalState=ON → not overridden", () => {
    expect(isOverridden({ status: "ON", originalState: "ON" })).toBe(false);
  });

  test("status=OFF, originalState=OFF → not overridden", () => {
    expect(isOverridden({ status: "OFF", originalState: "OFF" })).toBe(false);
  });

  test("status=ON, originalState=OFF → overridden (admin turned it ON)", () => {
    expect(isOverridden({ status: "ON", originalState: "OFF" })).toBe(true);
  });

  test("status=OFF, originalState=ON → overridden (admin turned it OFF)", () => {
    expect(isOverridden({ status: "OFF", originalState: "ON" })).toBe(true);
  });

  test("status=LOCKED, originalState=ON → NOT overridden (LOCKED == ON)", () => {
    // LOCKED is the immutable variant of ON: the user picked ON, the cutoff
    // has passed, the entry is now frozen. Semantically it's still "on" and
    // matches the original selection — not an admin override.
    expect(isOverridden({ status: "LOCKED", originalState: "ON" })).toBe(false);
  });

  test("status=LOCKED, originalState=OFF → overridden", () => {
    // LOCKED here means the admin forced the meal ON (then the system froze
    // it). The user's original selection was OFF, so this IS an override.
    expect(isOverridden({ status: "LOCKED", originalState: "OFF" })).toBe(true);
  });

  test("LOCKED behaves identically to ON for every originalState value", () => {
    // Property-style check: for any originalState, LOCKED and ON produce the
    // same override result. This locks in the "LOCKED treated as ON" rule.
    for (const originalState of ["ON", "OFF"]) {
      const onResult = isOverridden({ status: "ON", originalState });
      const lockedResult = isOverridden({ status: "LOCKED", originalState });
      expect(lockedResult).toBe(onResult);
    }
  });

  test("returns a boolean (not a truthy/falsy value)", () => {
    // Defensive: callers use `!isOverridden(...)` and `isOverridden(...) ||`,
    // so the return type MUST be a strict boolean.
    expect(typeof isOverridden({ status: "ON", originalState: "ON" })).toBe("boolean");
    expect(typeof isOverridden({ status: "ON", originalState: "OFF" })).toBe("boolean");
  });
});
