import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayChip, excuseDayText, presentOccurrence } from "./excuse-days.tsx";

const missed = {
  kind: "missed",
  penaltyCents: 500,
  excusableUntil: "2026-12-24T05:00:00Z",
  cover: { kind: "excuse", state: "waiting" },
  phase: "past-due",
} as const;

test("a Missed day held by an excuse or a vacation says which waits for approval", () => {
  render(
    <>
      <DayChip status={missed} now={0} timezone="America/New_York" />
      <DayChip
        status={{ ...missed, cover: { kind: "vacation", state: "waiting" } }}
        now={0}
        timezone="America/New_York"
      />
    </>,
  );
  expect(screen.getByText("Missed · excuse waiting for approval")).toBeTruthy();
  expect(screen.getByText("Missed · vacation waiting for approval")).toBeTruthy();
});

describe("presentOccurrence", () => {
  const now = Date.parse("2026-01-21T15:00:00.000Z");
  const open = {
    kind: "not-judged",
    opensAt: "2026-01-21T05:00:00.000Z",
    dueAt: "2026-01-22T05:00:00.000Z",
    evidenceWaiting: false,
    phase: "open",
  } as const;

  test("a waiting excuse and a waiting vacation on a day not judged yet give the same square and different chips", () => {
    const excuse = presentOccurrence({ ...open, cover: { kind: "excuse", state: "waiting" } }, now, {
      timezone: "America/New_York",
    });
    const vacation = presentOccurrence({ ...open, cover: { kind: "vacation", state: "waiting" } }, now, {
      timezone: "America/New_York",
    });

    expect(vacation.square).toBe(excuse.square);
    expect(excuse.chip?.text).toBe("Excuse waiting for approval");
    expect(vacation.chip?.text).toBe("Vacation waiting for approval");
  });

  test("a Missed day under a waiting vacation reads Missed · vacation waiting for approval", () => {
    const presented = presentOccurrence({ ...missed, cover: { kind: "vacation", state: "waiting" } }, now, {
      timezone: "America/New_York",
    });

    expect(presented.square).toBe("missed");
    expect(presented.chip?.text).toBe("Missed · vacation waiting for approval");
  });
});

describe("where a day not judged yet is in time", () => {
  const status = {
    kind: "not-judged",
    opensAt: "2026-01-21T05:00:00.000Z",
    dueAt: "2026-01-22T05:00:00.000Z",
    evidenceWaiting: false,
    cover: null,
  } as const;
  const options = { timezone: "America/New_York" };

  test("starts where the core says, even with the browser clock behind", () => {
    const presented = presentOccurrence({ ...status, phase: "open" }, Date.parse("2026-01-21T04:00:00.000Z"), options);

    expect(presented.chip?.text).toBe("Due today");
    expect(presented.square).toBe("open");
  });

  test("moves on with the browser clock while the screen is open", () => {
    const presented = presentOccurrence({ ...status, phase: "ahead" }, Date.parse("2026-01-22T06:00:00.000Z"), options);

    expect(presented.chip?.text).toBe("Not judged yet");
    expect(presented.square).toBe("not-judged");
  });
});

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
      presentOccurrence(open("2026-01-26T05:00:00.000Z"), now, { timezone: "America/New_York", period: "weekly-count" })
        .note,
    ).toBe("Due by Sunday");
  });
});

test("an excuse's period is named by its kind, which its length tells", () => {
  expect(excuseDayText({ date: "2026-12-07", through: "2026-12-13" })).toBe("Week of Mon Dec 7");
  expect(excuseDayText({ date: "2026-11-30", through: "2026-12-13" })).toBe("Nov 30 – Dec 13");
  expect(excuseDayText({ date: "2026-02-01", through: "2026-02-28" })).toBe("February");
  expect(excuseDayText({ date: "2026-12-07" })).toBe("Mon Dec 7");
});
