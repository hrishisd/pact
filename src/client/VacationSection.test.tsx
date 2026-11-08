import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { VacationsResponse } from "../shared/api.ts";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";
import { VacationSection } from "./VacationSection.tsx";

const WAITING: VacationsResponse = [
  {
    id: "v1",
    from: "2026-12-20",
    to: "2027-01-02",
    days: 14,
    note: "Going to Portugal",
    pacts: { kind: "all-recurring" },
    reviewerNames: ["Sam Rivera", "Alex Chen"],
    state: { kind: "waiting" },
  },
];

test("with nothing waiting it says None planned beside Plan a vacation", async () => {
  stubApi({ vacations: answers<VacationsResponse>([]) });
  const onPlan = vi.fn();
  const { user } = renderWithUser(<VacationSection message={null} onPlan={onPlan} />);

  expect(await screen.findByText("None planned")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Plan a vacation" }));
  expect(onPlan).toHaveBeenCalled();
});

test("a waiting vacation's card says what it covers and who it went to", async () => {
  stubApi({ vacations: answers(WAITING) });
  renderWithUser(<VacationSection message="Sent to Sam and Alex for approval." onPlan={vi.fn()} />);

  expect(await screen.findByText("Vacation Dec 20 – Jan 2")).toBeTruthy();
  expect(screen.getByText("Sent to Sam and Alex for approval.")).toBeTruthy();
  expect(screen.getByText("Waiting for approval")).toBeTruthy();
  expect(screen.getByText("Going to Portugal")).toBeTruthy();
  expect(screen.getByText("All recurring pacts · 14 days")).toBeTruthy();
  expect(
    screen.getByText("Sent to Sam Rivera and Alex Chen. Nothing changes until one of them approves it."),
  ).toBeTruthy();
  expect(screen.queryByText("None planned")).toBeNull();
});

test("Withdraw asks first, then withdraws and says the pacts keep their days", async () => {
  const spies = stubApi({
    vacations: answers<VacationsResponse>(WAITING, []),
    withdrawVacation: answers({ ok: true as const }),
  });
  const { user } = renderWithUser(<VacationSection message={null} onPlan={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Withdraw" }));

  expect(screen.getByText("Withdraw this vacation? Your pacts keep all their days.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Keep it" }));
  expect(spies.withdrawVacation).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Withdraw" }));
  await user.click(screen.getByRole("button", { name: "Withdraw" }));

  expect(await screen.findByText("Vacation withdrawn. Your pacts keep all their days.")).toBeTruthy();
  expect(spies.withdrawVacation).toHaveBeenCalledWith("v1");
  expect(await screen.findByText("None planned")).toBeTruthy();
});
