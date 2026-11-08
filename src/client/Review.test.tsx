import { screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ReviewQueueResponse } from "../shared/api.ts";
import { Review } from "./Review.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

type VacationItem = Extract<ReviewQueueResponse[number], { kind: "vacation" }>;

const VACATION: VacationItem = {
  kind: "vacation",
  id: "v1",
  ownerName: "Jordan Lee",
  from: "2026-12-20",
  to: "2027-01-02",
  days: 14,
  note: "Going to Portugal",
  pacts: { kind: "all-recurring" },
  reviewerNames: ["Sam Rivera", "Alex Chen"],
  covers: [
    {
      pactId: "bed",
      name: "Bed by midnight",
      evidenceKind: "oura",
      schedule: { kind: "fixed-days", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
      covered: Array.from({ length: 14 }, (_, i) => ({
        date: i < 12 ? `2026-12-${20 + i}` : `2027-01-0${i - 11}`,
      })),
    },
    {
      pactId: "gym",
      name: "Gym",
      evidenceKind: "camera",
      schedule: { kind: "weekly-count", target: 3 },
      covered: [{ date: "2026-12-21", through: "2026-12-27" }],
    },
    {
      pactId: "essay",
      name: "Essay",
      evidenceKind: "camera",
      schedule: { kind: "one-time", deadline: "2026-12-23", submitAnytime: false },
      covered: [{ date: "2026-12-23" }],
    },
  ],
  filedAt: "2026-12-01T17:00:00.000Z",
  thread: { comments: [], waitingOnReply: false },
};

test("a vacation item says whose it is, its days and pacts, and what each pact gives up", async () => {
  stubApi({ reviewQueue: answers<ReviewQueueResponse>([VACATION]), waitingOnReply: answers<ReviewQueueResponse>([]) });
  renderWithUser(<Review timezone="America/New_York" onQueue={vi.fn()} />);

  expect(await screen.findByText("from Jordan Lee")).toBeTruthy();
  const card = screen.getByRole("article");
  expect(within(card).getByRole("heading", { name: "Vacation" })).toBeTruthy();
  expect(within(card).getByText("Dec 20 – Jan 2 · 14 days")).toBeTruthy();
  expect(within(card).getByText("Sun Dec 20 – Sat Jan 2 · All recurring pacts")).toBeTruthy();
  expect(within(card).getByText("“Going to Portugal”")).toBeTruthy();
  expect(within(card).getByText("Sent to Sam Rivera and Alex Chen. Either can decide.")).toBeTruthy();
  expect(within(card).getByText("14 nights off · Dec 20 – Jan 2")).toBeTruthy();
  expect(within(card).getByText("1 week off · Dec 21 – 27")).toBeTruthy();
  expect(within(card).getByText("Deadline Wed Dec 23 excused")).toBeTruthy();
  expect(within(card).getByText("The pact ends.")).toBeTruthy();
  expect(
    within(card).getByText(
      "Approving excuses all of these and stops their reminders on these days. Once approved, it can't be changed.",
    ),
  ).toBeTruthy();
});

test("rejecting a vacation needs a reason and says Jordan's pacts keep every day", async () => {
  const spies = stubApi({
    reviewQueue: answers<ReviewQueueResponse>([VACATION], []),
    waitingOnReply: answers<ReviewQueueResponse>([]),
    decide: answers({ ok: true as const }),
  });
  const { user } = renderWithUser(<Review timezone="America/New_York" onQueue={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Reject" }));

  const reason = screen.getByRole("textbox", { name: "Why are you rejecting it? (required)" });
  expect(reason.getAttribute("placeholder")).toBe("e.g. Not two weeks before the gym challenge ends");
  expect(screen.getByText("Rejecting keeps every day of Jordan's pacts as it is.")).toBeTruthy();
  await user.type(reason, "Not now");
  await user.click(screen.getByRole("button", { name: "Reject" }));

  expect(spies.decide).toHaveBeenCalledWith("v1", { kind: "reject", reason: "Not now" });
  expect(await screen.findByText("Nothing to review")).toBeTruthy();
});

test("a vacation waiting on Jordan's reply is listed by its dates, under Jordan's name", async () => {
  stubApi({
    reviewQueue: answers<ReviewQueueResponse>([]),
    waitingOnReply: answers<ReviewQueueResponse>([
      {
        ...VACATION,
        thread: {
          comments: [
            { fromOwner: false, authorName: "Sam Rivera", text: "Spanish?", sentAt: "2026-12-02T15:00:00.000Z" },
          ],
          waitingOnReply: true,
        },
      },
    ]),
  });
  const { user } = renderWithUser(<Review timezone="America/New_York" onQueue={vi.fn()} />);

  expect(await screen.findByText("Waiting on Jordan Lee's reply")).toBeTruthy();
  const row = screen.getByRole("button", { name: /^Dec 20 – Jan 2Vacation · asked / });
  await user.click(row);
  expect(screen.getByText("Spanish?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
});
