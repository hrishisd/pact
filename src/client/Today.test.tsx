import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LedgerResponse, TodayResponse } from "../shared/api.ts";
import { answers, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";
import { Today } from "./Today.tsx";

const NOW = "2026-01-05T15:00:00Z";

const TODAY: TodayResponse = {
  hasPacts: true,
  alerts: [],
  sections: [
    {
      kind: "to-do",
      cards: [
        {
          kind: "anki",
          pactId: "spanish",
          name: "Spanish",
          penaltyCents: 500,
          editWindowClosesAt: null,
          occurrenceDate: "2026-01-05",
          dueAt: "2026-01-06T05:00:00Z",
          dueBy: null,
          deckName: "Spanish",
          deckMissing: false,
          lastCheck: null,
        },
        {
          kind: "bill",
          recipientId: "sam",
          recipientName: "Sam",
          amountCents: 1000,
          dueAt: "2026-01-08T05:00:00Z",
          billedOn: "2026-01-01",
        },
      ],
    },
    {
      kind: "missed",
      cards: [
        {
          pactId: "gym",
          name: "Gym",
          penaltyCents: 500,
          occurrenceDate: "2026-01-04",
          missedAt: "2026-01-05T05:00:00Z",
          excusableUntil: "2026-01-07T05:00:00Z",
          detail: null,
        },
      ],
    },
  ],
  waiting: [],
  yesterday: [],
};

const SAM_LEDGER: LedgerResponse = {
  ok: true,
  ledger: {
    summary: {
      recipientId: "sam",
      name: "Sam",
      owedCents: 1000,
      payableCents: 1000,
      awaitingCents: 0,
      awaitingCount: 0,
      paidCents: 0,
      suggestedPaymentCents: 1000,
      overdueCents: 0,
      billDue: { amountCents: 1000, dueAt: "2026-01-08T05:00:00Z" },
    },
    history: [],
  },
};

const onOpenPact = vi.fn<(id: string, name: string) => void>();

function renderToday() {
  return renderWithUser(
    <Today
      timezone="America/New_York"
      onOpenPact={onOpenPact}
      onOpenLedger={vi.fn()}
      onOpenExcuse={vi.fn()}
      onOpenChangeRequest={vi.fn()}
      onOpenEvidence={vi.fn()}
      onOpenPayment={vi.fn()}
      onCreate={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
}

/** The Today card titled `name`. */
async function card(name: string): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name })).closest("article")!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
  onOpenPact.mockReset();
});

describe("a Today card's own buttons", () => {
  beforeEach(() => {
    stubApi({
      today: answers(TODAY),
      checkAnki: answers({ ok: true }),
      // The excuse sheet's form isn't what these tests are about: it stops at "not found".
      pact: answers({ ok: false, reason: "pact-not-found" }),
      ledger: answers(SAM_LEDGER),
    });
  });

  test("Enter on the card itself opens the pact", async () => {
    const { user } = renderToday();
    (await card("Spanish")).focus();
    await user.keyboard("{Enter}");
    expect(onOpenPact).toHaveBeenCalledWith("spanish", "Spanish");
  });

  test("Enter on an Anki card's File excuse opens the excuse sheet, not the pact", async () => {
    const { user } = renderToday();
    within(await card("Spanish"))
      .getByRole("button", { name: "File excuse" })
      .focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Excuse Spanish, Mon Jan 5" })).toBeTruthy();
    expect(onOpenPact).not.toHaveBeenCalled();
  });

  test("Escape closes the excuse sheet opened from an Anki card, focus still on File excuse", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Spanish")).getByRole("button", { name: "File excuse" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenPact).not.toHaveBeenCalled();
  });

  test("Escape closes the excuse sheet opened from a Missed card", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Gym")).getByRole("button", { name: /^File excuse/ }));
    await screen.findByRole("dialog", { name: "Excuse Gym, Sun Jan 4" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Escape closes Record a payment opened from a bill card", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Pay Sam")).getByRole("button", { name: "Record payment" }));
    await screen.findByRole("dialog", { name: "Record a payment" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

test("a reload that fails keeps the cards shown, and says what failed above them", async () => {
  // The Anki card checks AnkiWeb on opening, then reloads Today.
  const spies = stubApi({ today: answers(TODAY, onOurSide), checkAnki: answers({ ok: true }) });
  renderToday();
  expect(await screen.findByText("Today couldn't load")).toBeTruthy();
  expect(spies.today).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Something went wrong on our side. Try again in a minute.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Spanish" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Pay Sam" })).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("Checking AnkiWeb…")).toBeNull());
});

describe("a rejected vacation's alert", () => {
  const rejected = (owedAgainCents: number): TodayResponse => ({
    hasPacts: true,
    alerts: [
      {
        kind: "vacation-rejected",
        vacationId: "v1",
        reviewerName: "Sam Rivera",
        reason: "Not two weeks before the gym challenge ends",
        firstDate: "2026-12-20",
        lastDate: "2027-01-02",
        owedAgainCents,
      },
    ],
    sections: [],
    waiting: [],
    yesterday: [],
  });

  test("names the reviewer, quotes the reason, and says the pacts keep all their days", async () => {
    stubApi({ today: answers(rejected(0)) });
    renderToday();
    const alert = await screen.findByRole("status");
    expect(within(alert).getByText("Sam rejected your vacation")).toBeTruthy();
    expect(within(alert).getByText("“Not two weeks before the gym challenge ends”")).toBeTruthy();
    expect(alert.textContent).toContain("Dec 20 – Jan 2 · your pacts keep all their days");
  });

  test("with held penalties, says what's owed again; Take the L sends at once and reloads Today", async () => {
    const spies = stubApi({
      today: answers(rejected(1500), { ...rejected(0), alerts: [] }),
      acceptVacationRejection: answers({ ok: true }),
    });
    const { user } = renderToday();
    const alert = await screen.findByRole("status");
    expect(alert.textContent).toContain("Dec 20 – Jan 2 · $15 is owed again");

    await user.click(within(alert).getByRole("button", { name: "Take the L" }));

    expect(spies.acceptVacationRejection).toHaveBeenCalledWith("v1");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
