import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DayChip } from "./excuse-days.tsx";

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
