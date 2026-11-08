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

const ASKED: VacationsResponse = [
  {
    ...WAITING[0]!,
    state: { kind: "waiting-on-reply", askedBy: "Sam Rivera", question: "Can you keep Spanish going?" },
  },
];

test("a question waits on the owner's reply, with Reply and Withdraw", async () => {
  stubApi({ vacations: answers(ASKED) });
  renderWithUser(<VacationSection message={null} onPlan={vi.fn()} />);

  expect(await screen.findByText("Waiting on your reply")).toBeTruthy();
  expect(screen.getByText("Sam asked:")).toBeTruthy();
  expect(screen.getByText("“Can you keep Spanish going?”", { exact: false })).toBeTruthy();
  expect(screen.queryByText("Waiting for approval")).toBeNull();
  expect(screen.getByRole("button", { name: "Reply" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy();
});

test("Reply opens a box that sends to the reviewer who asked, then says it's back with them", async () => {
  const spies = stubApi({
    vacations: answers<VacationsResponse>(ASKED, WAITING),
    reply: answers({ ok: true as const }),
  });
  const { user } = renderWithUser(<VacationSection message={null} onPlan={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Reply" }));

  const box = screen.getByRole("textbox", { name: "Reply" });
  expect(box.getAttribute("placeholder")).toBe("e.g. My flight leaves Sun Dec 20 at 7am");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Reply" }));
  const send = screen.getByRole("button", { name: "Send to Sam" });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "Reply" }), "Yes, 10 minutes a day");
  await user.click(send);

  expect(await screen.findByText("Reply sent. It's back with Sam and Alex.")).toBeTruthy();
  expect(spies.reply).toHaveBeenCalledWith("v1", "Yes, 10 minutes a day");
  expect(await screen.findByText("Waiting for approval")).toBeTruthy();
});

test("an approved vacation says who approved it and that it can't be changed, with no Withdraw", async () => {
  stubApi({
    vacations: answers<VacationsResponse>([
      { ...WAITING[0]!, state: { kind: "approved", reviewerName: "Sam Rivera" } },
    ]),
  });
  renderWithUser(<VacationSection message={null} onPlan={vi.fn()} />);

  expect(await screen.findByText("Approved")).toBeTruthy();
  expect(screen.getByText("Approved by Sam Rivera. It can't be changed now.")).toBeTruthy();
  expect(screen.getByText("All recurring pacts · 14 days")).toBeTruthy();
  expect(screen.queryByText(/Nothing changes until/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
});

test("Withdraw on a vacation holding penalties says what becomes owed", async () => {
  stubApi({ vacations: answers<VacationsResponse>([{ ...WAITING[0]!, heldCents: 1500 }]) });
  const { user } = renderWithUser(<VacationSection message={null} onPlan={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Withdraw" }));

  expect(screen.getByText("Withdraw this vacation? $15 held becomes owed.")).toBeTruthy();
});
