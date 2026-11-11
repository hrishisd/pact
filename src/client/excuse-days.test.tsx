import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayChip, presentOccurrence } from "./excuse-days.tsx";

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
      <DayChip status={missed} now={0} />
      <DayChip status={{ ...missed, cover: { kind: "vacation", state: "waiting" } }} now={0} />
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
