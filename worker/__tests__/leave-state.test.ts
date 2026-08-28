import { describe, expect, it } from "vitest";

import {
  buildInclusiveUtcDates,
  buildLeaveMealRows,
  parseLeaveMealIds,
} from "../leave-state";

describe("leave state helpers", () => {
  it("parses and deduplicates specific meal ids", () => {
    expect(parseLeaveMealIds("ALL", '["breakfast"]')).toEqual([]);
    expect(parseLeaveMealIds("SPECIFIC", '["breakfast","dinner","breakfast"]')).toEqual([
      "breakfast",
      "dinner",
    ]);
    expect(parseLeaveMealIds("SPECIFIC", "not-json")).toEqual([]);
  });

  it("builds an inclusive UTC date range", () => {
    const dates = buildInclusiveUtcDates(
      "2026-08-28T00:00:00.000Z",
      "2026-08-30T23:59:59.999Z",
    );
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-08-28T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
      "2026-08-30T00:00:00.000Z",
    ]);
  });

  it("returns no dates for an inverted range", () => {
    expect(
      buildInclusiveUtcDates(
        "2026-08-30T00:00:00.000Z",
        "2026-08-28T23:59:59.999Z",
      ),
    ).toEqual([]);
  });

  it("builds one leave meal row per meal and date using cutoff rules", () => {
    const rows = buildLeaveMealRows(
      [
        {
          id: "dinner",
          cutoffStrategy: "PREVIOUS_DAY",
          cutoffTime: "16:00",
          cutoffOffsetMinutes: 0,
        },
      ],
      [new Date("2026-08-28T00:00:00.000Z"), new Date("2026-08-29T00:00:00.000Z")],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      mealId: "dinner",
      serviceDate: "2026-08-28T00:00:00.000Z",
      editableUntil: "2026-08-27T16:00:00.000Z",
    });
    expect(rows[1]).toMatchObject({
      mealId: "dinner",
      serviceDate: "2026-08-29T00:00:00.000Z",
      editableUntil: "2026-08-28T16:00:00.000Z",
    });
  });
});
