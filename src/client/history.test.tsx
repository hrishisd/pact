import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Json } from "../shared/api.ts";
import type { HeatMapDay, HeatMapWeek, OccurrenceRecord } from "../shared/types.ts";
import { HeatMap } from "./history.tsx";
import { cameraPact, renderWithUser } from "./testing/render.tsx";

const NOW = Date.parse("2026-01-12T17:00:00Z");
const VACATION = { from: "2026-01-07", to: "2026-01-10" };

const satisfied: Json<OccurrenceRecord> = { status: { kind: "satisfied", approvedBy: "Ana" }, detail: null };
const excused: Json<OccurrenceRecord> = {
  status: { kind: "excused", excuseApproval: { reviewerName: "Ana", reason: "Red-eye flight back" } },
  detail: null,
};
const onVacation: Json<OccurrenceRecord> = {
  status: { kind: "excused", excuseApproval: null, vacation: VACATION },
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
  expect(within(detail).getByText("Vacation, Jan 7 – 10. Excused, no penalty.")).toBeTruthy();
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
      occurrence: { ...satisfied, status: { kind: "satisfied", approvedBy: null } },
      progress: { sessions: 3, waiting: 0, target: 3 },
    },
    { date: "2026-01-05", occurrence: onVacation, progress: { sessions: 0, waiting: 0, target: 3 } },
  ];
  const { user } = renderWithUser(
    <HeatMap
      pact={{
        ...cameraPact(),
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
  expect(within(detail).getByText("Vacation, Jan 7 – 10. Excused, no penalty.")).toBeTruthy();
});
