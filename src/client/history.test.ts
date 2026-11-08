import { describe, expect, test } from "vitest";
import { addDays } from "../shared/calendar.ts";
import { monthLabels, weeksOf } from "./history.tsx";

/** `count` heat map days from `first`, none with an occurrence. */
function days(first: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(first, i), occurrence: null }));
}

describe("the daily heat map's weeks", () => {
  test("start on the Monday before the first day, with blanks for the days before it", () => {
    const weeks = weeksOf(days("2026-01-01", 11));
    expect(weeks.map((week) => week.monday)).toEqual(["2025-12-29", "2026-01-05"]);
    expect(weeks[0]!.days.map((day) => day?.date ?? null)).toEqual([
      null,
      null,
      null,
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(weeks[1]!.days.map((day) => day?.date)).toEqual(days("2026-01-05", 7).map((day) => day.date));
  });

  test("none without days", () => {
    expect(weeksOf([])).toEqual([]);
  });
});

describe("the daily heat map's month labels", () => {
  test.each([
    // A week whose Monday is in a month's first 7 days is labelled with it, across a year's end.
    ["2025-12-10", 63, ["Dec", "", "", "", "Jan", "", "", "", "Feb", ""]],
    // The 7th still counts; the first week stays blank when the next one is labelled.
    ["2026-09-01", 14, ["", "Sep", ""]],
    // The first week's Monday, not its first day, is what's labelled.
    ["2026-07-08", 14, ["Jul", "", ""]],
    // An unlabelled first week takes its Monday's month when the next one has none either.
    ["2026-01-14", 7, ["Jan", ""]],
    ["2026-01-21", 14, ["Jan", "", "Feb"]],
  ])("from %s for %d days: %j", (first, count, labels) => {
    expect(monthLabels(weeksOf(days(first, count)))).toEqual(labels);
  });
});
