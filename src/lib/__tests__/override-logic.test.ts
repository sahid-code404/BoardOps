import { describe, expect, test } from "vitest";
import { isOverridden } from "@/lib/meal-engine";

describe("override-logic: isOverridden", () => {
  test("status=ON, originalState=ON → not overridden", () => {
    expect(isOverridden({ status: "ON", originalState: "ON" })).toBe(false);
  });

  test("status=OFF, originalState=OFF → not overridden", () => {
    expect(isOverridden({ status: "OFF", originalState: "OFF" })).toBe(false);
  });

  test("status=ON, originalState=OFF → overridden", () => {
    expect(isOverridden({ status: "ON", originalState: "OFF" })).toBe(true);
  });

  test("status=OFF, originalState=ON → overridden", () => {
    expect(isOverridden({ status: "OFF", originalState: "ON" })).toBe(true);
  });

  test("status=LOCKED, originalState=ON → not overridden", () => {
    expect(isOverridden({ status: "LOCKED", originalState: "ON" })).toBe(false);
  });

  test("status=LOCKED, originalState=OFF → overridden", () => {
    expect(isOverridden({ status: "LOCKED", originalState: "OFF" })).toBe(true);
  });

  test("LOCKED behaves identically to ON for every originalState value", () => {
    for (const originalState of ["ON", "OFF"]) {
      const onResult = isOverridden({ status: "ON", originalState });
      const lockedResult = isOverridden({ status: "LOCKED", originalState });
      expect(lockedResult).toBe(onResult);
    }
  });

  test("always returns a boolean", () => {
    expect(typeof isOverridden({ status: "ON", originalState: "ON" })).toBe("boolean");
    expect(typeof isOverridden({ status: "ON", originalState: "OFF" })).toBe("boolean");
  });
});
