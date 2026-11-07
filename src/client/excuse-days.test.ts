import { describe, expect, test } from "vitest";
import { dayNote } from "./excuse-days.tsx";

describe("a covered day's note while it's open", () => {
  const now = Date.parse("2026-01-21T15:00:00.000Z");
  const open = (dueAt: string) => ({
    kind: "not-judged" as const,
    opensAt: "2026-01-21T05:00:00.000Z",
    dueAt,
    evidenceWaiting: false,
    excuse: null,
  });

  test.each([
    ["2026-01-22T05:00:00.000Z", "Due at midnight"],
    ["2026-01-22T02:00:00.000Z", "Due at 9:00pm"],
    ["2026-01-22T04:30:00.000Z", "Due at 11:30pm"],
    ["2026-01-22T06:00:00.000Z", "Due at 1:00am"],
  ])("due %s reads %s in New York", (dueAt, note) => {
    expect(dayNote(open(dueAt), now, "America/New_York")).toBe(note);
  });

  test("a Weekly count week is due by Sunday", () => {
    expect(dayNote(open("2026-01-26T05:00:00.000Z"), now, "America/New_York", true)).toBe("Due by Sunday");
  });
});
