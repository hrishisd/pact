import { describe, expect, test } from "vitest";
import { presentOccurrence } from "./excuse-days.tsx";

describe("a covered day's note while it's open", () => {
  const now = Date.parse("2026-01-21T15:00:00.000Z");
  const open = (dueAt: string) => ({
    kind: "not-judged" as const,
    opensAt: "2026-01-21T05:00:00.000Z",
    dueAt,
    evidenceWaiting: false,
    cover: null,
    phase: "open" as const,
  });

  test.each([
    ["2026-01-22T05:00:00.000Z", "Due at midnight"],
    ["2026-01-22T02:00:00.000Z", "Due at 9:00pm"],
    ["2026-01-22T04:30:00.000Z", "Due at 11:30pm"],
    ["2026-01-22T06:00:00.000Z", "Due at 1:00am"],
  ])("due %s reads %s in New York", (dueAt, note) => {
    expect(presentOccurrence(open(dueAt), now, { timezone: "America/New_York" }).note).toBe(note);
  });

  test("a Weekly count week is due by Sunday", () => {
    expect(
      presentOccurrence(open("2026-01-26T05:00:00.000Z"), now, { timezone: "America/New_York", week: true }).note,
    ).toBe("Due by Sunday");
  });
});
