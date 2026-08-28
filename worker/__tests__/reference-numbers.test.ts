import { describe, expect, it } from "vitest";

import {
  formatReferenceNumber,
  getDefaultReferenceFormat,
  getNextReferenceSequence,
  getReferencePrefix,
} from "../reference-numbers";

const date = new Date("2026-08-28T12:00:00Z");

describe("reference numbers", () => {
  it("preserves the legacy default formats", () => {
    expect(formatReferenceNumber("bill", 1, date)).toBe("BILL-2026-00001");
    expect(formatReferenceNumber("refund", 42, date)).toBe("REF-2026-00042");
    expect(formatReferenceNumber("adjustment", 9, date)).toBe("ADJ-2026-00009");
    expect(getDefaultReferenceFormat("bill")).toBe("BILL-{YEAR}-{SEQ}");
    expect(getReferencePrefix("refund")).toBe("REF");
  });

  it("supports every legacy configurable placeholder", () => {
    expect(
      formatReferenceNumber(
        "bill",
        7,
        date,
        "{PREFIX}/{PERIOD}/{YY}/{MONTH}/{YEAR}/{SEQ}",
      ),
    ).toBe("BILL/2026-08/26/08/2026/00007");
  });

  it("finds the next per-year sequence and ignores malformed or other-year values", () => {
    expect(
      getNextReferenceSequence(
        [
          "BILL-2026-00001",
          "BILL-2026-00019",
          "BILL-2025-99999",
          "REF-2026-00099",
          "BILL-2026-nope",
          null,
        ],
        "bill",
        date,
      ),
    ).toBe(20);
  });

  it("starts a fresh yearly sequence at one", () => {
    expect(getNextReferenceSequence([], "bill", date)).toBe(1);
  });

  it("rejects invalid sequence and date inputs", () => {
    expect(() => formatReferenceNumber("bill", 0, date)).toThrow(/positive integer/);
    expect(() => getNextReferenceSequence([], "bill", new Date("invalid"))).toThrow(/valid/);
  });
});
