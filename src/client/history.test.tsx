import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Json } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import type { HeatMapDay, HeatMapWeek, OccurrenceRecord } from "../shared/types.ts";
import { HeatMap, monthLabels, weeksOf } from "./history.tsx";
import { cameraPact, renderWithUser } from "./testing/render.tsx";

const NOW = Date.parse("2026-01-12T17:00:00Z");
const VACATION = { from: "2026-01-07", to: "2026-01-10" };

const satisfied: Json<OccurrenceRecord> = {
  status: { kind: "satisfied", approvedBy: "Ana", cover: null, phase: "past-due" },
  detail: null,
};
const excused: Json<OccurrenceRecord> = {
  status: {
    kind: "excused",
    excuseApproval: { reviewerName: "Ana", reason: "Red-eye flight back" },
    cover: { kind: "excuse", state: "approved" },
    phase: "past-due",
  },
  detail: null,
};
const onVacation: Json<OccurrenceRecord> = {
  status: {
    kind: "excused",
    excuseApproval: null,
    vacation: VACATION,
    cover: { kind: "vacation", state: "approved" },
    phase: "past-due",
  },
  detail: null,
};

/** Gym's daily heat map, Mon Jan 5 to Fri Jan 9: Satisfied, Excused by an excuse, then three vacation days. */
function renderDaily() {
  const days: Json<HeatMapDay>[] = [
    { date: "2026-01-05", occurrence: satisfied },
    { date: "2026-01-06", occurrence: excused },
    { date: "2026-01-07", occurrence: onVacation },
    { date: "2026-01-08", occurrence: onVacation },
    { date: "2026-01-09", occurrence: onVacation },
  ];
  return renderWithUser(
    <HeatMap pact={{ ...cameraPact(), history: { kind: "fixed-days", days } }} timezone="America/New_York" now={NOW} />,
  );
}

test("a vacation day has its own square beside an ordinary Excused one, and the legend says Vacation after Excused", () => {
  renderDaily();

  const vacationDay = screen.getByRole("button", { name: "Wed Jan 7: Vacation" });
  expect(vacationDay.className).toBe("cell vac");
  expect(screen.getByRole("button", { name: "Tue Jan 6: Excused" }).className).toBe("cell excused");
  const legend = document.querySelector(".legend")!;
  expect([...legend.querySelectorAll("span")].map((entry) => entry.textContent)).toEqual([
    "Satisfied",
    "Missed",
    "Excused",
    "Vacation",
    "Not judged yet",
  ]);
  expect(legend.querySelector(".cell.vac")).not.toBeNull();
});

test("tapping a vacation day shows the Vacation chip and its dates", async () => {
  const { user } = renderDaily();

  await user.click(screen.getByRole("button", { name: "Thu Jan 8: Vacation" }));

  const detail = screen.getByRole("status");
  expect(within(detail).getByText("Vacation").className).toBe("chip c-vac");
  expect(within(detail).getByText("Excused for your vacation, Jan 7 – 10. No penalty.")).toBeTruthy();
});

test("tapping an ordinary excused day still shows the excuse", async () => {
  const { user } = renderDaily();

  await user.click(screen.getByRole("button", { name: "Tue Jan 6: Excused" }));

  const detail = screen.getByRole("status");
  expect(within(detail).getByText("Excused").className).toBe("chip c-excused");
  expect(within(detail).getByText("Excuse approved by Ana: “Red-eye flight back.”")).toBeTruthy();
});

test("a Weekly count week a vacation covers is drawn and tapped the same way", async () => {
  const weeks: Json<HeatMapWeek>[] = [
    {
      date: "2025-12-29",
      occurrence: { ...satisfied, status: { kind: "satisfied", approvedBy: null, cover: null, phase: "past-due" } },
      progress: { sessions: 3, waiting: 0, target: 3 },
    },
    { date: "2026-01-05", occurrence: onVacation, progress: { sessions: 0, waiting: 0, target: 3 } },
  ];
  const { user } = renderWithUser(
    <HeatMap
      pact={{
        ...cameraPact(),
        evidenceKind: "camera",
        dueBy: null,
        schedule: { kind: "weekly-count", target: 3 },
        history: { kind: "weekly-count", weeks },
      }}
      timezone="America/New_York"
      now={NOW}
    />,
  );

  const week = screen.getByRole("button", { name: "Week of Mon Jan 5: Vacation, 0 of 3" });
  expect(week.className).toBe("cell wk vac");
  expect(week.textContent).toBe("");
  await user.click(week);

  const detail = screen.getByRole("status");
  expect(within(detail).getByText("Vacation").className).toBe("chip c-vac");
  expect(within(detail).getByText("Excused for your vacation, Jan 7 – 10. No penalty.")).toBeTruthy();
});

test("a day with an excuse waiting for approval has a square and a chip that say the same", async () => {
  const waiting: Json<OccurrenceRecord> = {
    status: {
      kind: "not-judged",
      opensAt: "2026-01-12T05:00:00Z",
      dueAt: "2026-01-13T05:00:00Z",
      evidenceWaiting: false,
      cover: { kind: "excuse", state: "waiting" },
      phase: "open",
      excuseApproval: null,
    },
    detail: null,
  };
  const { user } = renderWithUser(
    <HeatMap
      pact={{ ...cameraPact(), history: { kind: "fixed-days", days: [{ date: "2026-01-12", occurrence: waiting }] } }}
      timezone="America/New_York"
      now={NOW}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Mon Jan 12: Excuse waiting for approval" }));

  const detail = screen.getByRole("status");
  expect(within(detail).getByText("Excuse waiting for approval").className).toBe("chip c-wait");
});

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
