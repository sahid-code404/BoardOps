import { describe, expect, it } from "vitest";

import {
  evaluateFormula,
  extractVarSlugs,
  FORMULA_FUNCTIONS,
  FORMULA_OPERATORS,
  validateFormula,
} from "../formula-engine";

const noVars = () => 0;

describe("native formula engine parity", () => {
  it("preserves arithmetic precedence and unary operators", () => {
    expect(evaluateFormula("2 + 3 * 4", noVars)).toEqual({ value: 14 });
    expect(evaluateFormula("-(2 + 3) * 4", noVars)).toEqual({ value: -20 });
    expect(evaluateFormula("+5 % 2", noVars)).toEqual({ value: 1 });
  });

  it("resolves single and double quoted variables", () => {
    const values: Record<string, number> = { total_expense: 125.5, "billing.roomRent": 74.5 };
    const result = evaluateFormula(
      "var('total_expense') + var(\"billing.roomRent\")",
      (slug) => values[slug],
    );
    expect(result).toEqual({ value: 200 });
  });

  it("preserves comparison and conditional semantics", () => {
    expect(evaluateFormula("IF(10 >= 5, 7, 3)", noVars)).toEqual({ value: 7 });
    expect(evaluateFormula("IF(2 == 3, 7, 3)", noVars)).toEqual({ value: 3 });
    expect(evaluateFormula("AND(1, 2, 3) + OR(0, 0, 5) + NOT(0)", noVars)).toEqual({ value: 3 });
  });

  it("preserves supported numeric functions", () => {
    expect(evaluateFormula("ROUND(10.126, 2)", noVars)).toEqual({ value: 10.13 });
    expect(evaluateFormula("SUM(1,2,3) + AVG(2,4) + COUNT(8,9)", noVars)).toEqual({ value: 11 });
    expect(evaluateFormula("POWER(3,2) + SQRT(16) + MOD(10,3)", noVars)).toEqual({ value: 14 });
    expect(evaluateFormula("MIN(5,2,7) + MAX(5,2,7) + ABS(-3)", noVars)).toEqual({ value: 12 });
    expect(evaluateFormula("ROUNDUP(1.1) + ROUNDDOWN(1.9) + FLOOR(2.8) + CEIL(2.1)", noVars)).toEqual({ value: 8 });
    expect(evaluateFormula("COALESCE(0,0,9) + NULLIF(4,4) + NULLIF(5,4)", noVars)).toEqual({ value: 14 });
  });

  it("preserves legacy error results", () => {
    expect(evaluateFormula("4 / 0", noVars)).toEqual({ value: 0, error: "Division by zero" });
    expect(evaluateFormula("MOD(4,0)", noVars)).toEqual({ value: 0, error: "MOD division by zero" });
    expect(evaluateFormula("UNKNOWN(1)", noVars).error).toContain('Unknown function "UNKNOWN"');
    expect(evaluateFormula("var('missing')", () => Number.NaN).error).toContain('Variable "missing" is not a number');
  });

  it("validates parser syntax and extracts unique variable slugs", () => {
    expect(validateFormula("ROUND(var('x') * 2, 1)")).toEqual({ valid: true });
    expect(validateFormula("1 + )").valid).toBe(false);
    expect(extractVarSlugs("var('x') + var(\"y\") + var('x')")).toEqual(["x", "y"]);
  });

  it("keeps the public function/operator catalog available to the UI", () => {
    expect(FORMULA_FUNCTIONS.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["ROUND", "IF", "SUM", "POWER", "COALESCE", "NULLIF"]),
    );
    expect(FORMULA_OPERATORS).toEqual(["+", "-", "*", "/", "%", "(", ")"]);
  });
});
