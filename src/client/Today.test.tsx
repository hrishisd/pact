import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LedgerResponse, TodayResponse } from "../shared/api.ts";
import type { CheckNowResult } from "../shared/types.ts";
import { PullToRefresh } from "./pull-to-refresh.tsx";
import { answers, endSheetSlides, onOurSide, pullDown, renderWithUser, stubApi } from "./testing/render.tsx";
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
      creditCents: 0,
      creditWaitsOn: [],
      overdueCents: 0,
      billDue: { amountCents: 1000, dueAt: "2026-01-08T05:00:00Z" },
    },
    history: [],
  },
};

const onOpenPact = vi.fn<(id: string, name: string) => void>();
const openers = {
  evidence: vi.fn<(id: string) => void>(),
  excuse: vi.fn<(id: string) => void>(),
  payment: vi.fn<(id: string) => void>(),
  "change-request": vi.fn<(id: string) => void>(),
  vacation: vi.fn<(id: string) => void>(),
};

function renderToday() {
  return renderWithUser(
    <Today
      timezone="America/New_York"
      onOpenPact={onOpenPact}
      onOpenLedger={vi.fn()}
      openers={openers}
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
  for (const open of Object.values(openers)) open.mockReset();
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

  test("Enter on the card's name opens the pact", async () => {
    const { user } = renderToday();
    within(await card("Spanish"))
      .getByRole("button", { name: "Spanish" })
      .focus();
    await user.keyboard("{Enter}");
    expect(onOpenPact).toHaveBeenCalledWith("spanish", "Spanish");
  });

  test("a card's actions sit beside the button that opens it, not inside it, so each is reached on its own", async () => {
    renderToday();
    for (const [name, action] of [
      ["Spanish", /^File excuse/],
      ["Gym", /^File excuse/],
      ["Pay Sam", /^Record payment/],
    ] as const) {
      const opener = within(await card(name)).getByRole("button", { name });
      expect(within(opener).queryByRole("button")).toBeNull();
      expect(within(await card(name)).getByRole("button", { name: action })).toBeTruthy();
    }
    // The card itself isn't a link wrapped around them.
    expect(screen.queryByRole("link", { name: /Spanish|Gym|Pay Sam/ })).toBeNull();
  });

  test("a click on a card's own button doesn't open the pact", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Gym")).getByRole("button", { name: /^File excuse/ }));
    await screen.findByRole("dialog", { name: "Excuse Gym, Sun Jan 4" });
    expect(onOpenPact).not.toHaveBeenCalled();
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
    endSheetSlides();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenPact).not.toHaveBeenCalled();
  });

  test("Escape closes the excuse sheet opened from a Missed card", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Gym")).getByRole("button", { name: /^File excuse/ }));
    await screen.findByRole("dialog", { name: "Excuse Gym, Sun Jan 4" });
    await user.keyboard("{Escape}");
    endSheetSlides();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Escape closes Record a payment opened from a bill card", async () => {
    const { user } = renderToday();
    await user.click(within(await card("Pay Sam")).getByRole("button", { name: "Record payment" }));
    await screen.findByRole("dialog", { name: "Record a payment" });
    await user.keyboard("{Escape}");
    endSheetSlides();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a pull on Today", () => {
  /** Tue night not judged yet: a No Oura data card. */
  const OURA_WAITING: TodayResponse = {
    ...TODAY,
    sections: [
      {
        kind: "no-oura-data",
        cards: [
          {
            pactId: "bed",
            name: "In bed by 11",
            penaltyCents: 1000,
            occurrenceDate: "2026-01-04",
            closesAt: "2026-01-05T23:00:00Z",
            tonight: null,
          },
        ],
      },
      ...TODAY.sections,
    ],
  };
  const UNREACHABLE = { ok: false, reason: "unreachable" } as const;
  const ANKI_UNREACHED = "Couldn't reach AnkiWeb. Pact will try again.";
  const OURA_UNREACHED = "Couldn't reach Oura. Pact will try again.";

  function renderInShell() {
    return renderWithUser(
      <PullToRefresh pullable header={<h1>Today</h1>} mainClassName="scroll gut">
        <Today
          timezone="America/New_York"
          onOpenPact={onOpenPact}
          onOpenLedger={vi.fn()}
          openers={openers}
          onCreate={vi.fn()}
          onInvite={vi.fn()}
        />
      </PullToRefresh>,
    );
  }
  const busy = () => screen.getByRole("main").getAttribute("aria-busy");
  /** Today has loaded, opened, checked what its cards wait on and reloaded: nothing running. */
  async function opened(spies: { today: { mock: { calls: unknown[] } } }) {
    await card("Spanish");
    await waitFor(() => expect(spies.today.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("Checking AnkiWeb…")).toBeNull());
  }

  test("checks Oura and AnkiWeb, whatever cards show, then reloads Today", async () => {
    const spies = stubApi({
      today: answers(TODAY),
      checkAnki: answers({ ok: true }),
      checkOura: answers({ ok: true }),
    });
    renderInShell();
    await opened(spies);
    expect(spies.checkOura).not.toHaveBeenCalled();
    const loads = spies.today.mock.calls.length;

    pullDown();

    await waitFor(() => expect(busy()).toBeNull());
    expect(spies.checkOura).toHaveBeenCalledTimes(1);
    expect(spies.checkAnki).toHaveBeenCalledTimes(2);
    expect(spies.today).toHaveBeenCalledTimes(loads + 1);
  });

  test("skips a service whose connection needs reconnecting", async () => {
    const broken: TodayResponse = {
      ...TODAY,
      alerts: [{ kind: "connection", service: "oura", status: "needs-reconnecting" }],
    };
    const spies = stubApi({
      today: answers(broken),
      checkAnki: answers({ ok: true }),
      checkOura: answers({ ok: true }),
    });
    renderInShell();
    await opened(spies);
    pullDown();
    await waitFor(() => expect(spies.checkAnki).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(busy()).toBeNull());
    expect(spies.checkOura).not.toHaveBeenCalled();
  });

  test("an AnkiWeb out of reach says so on the Anki card, until a check answers ok", async () => {
    const spies = stubApi({
      today: answers(TODAY),
      checkAnki: answers<CheckNowResult>({ ok: true }, UNREACHABLE, { ok: true }),
      checkOura: answers({ ok: true }),
    });
    renderInShell();
    await opened(spies);

    pullDown();
    expect(await within(await card("Spanish")).findByText(ANKI_UNREACHED)).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());

    pullDown();
    await waitFor(() => expect(busy()).toBeNull());
    expect(screen.queryByText(ANKI_UNREACHED)).toBeNull();
  });

  test("an Oura out of reach says so on the No Oura data card, until a check answers ok", async () => {
    const spies = stubApi({
      today: answers(OURA_WAITING),
      checkAnki: answers({ ok: true }),
      checkOura: answers<CheckNowResult>({ ok: true }, UNREACHABLE, { ok: true }),
    });
    renderInShell();
    await opened(spies);
    await waitFor(() => expect(screen.queryByText("Checking Oura…")).toBeNull());

    pullDown();
    expect(await within(await card("In bed by 11")).findByText(OURA_UNREACHED)).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());

    pullDown();
    await waitFor(() => expect(busy()).toBeNull());
    expect(screen.queryByText(OURA_UNREACHED)).toBeNull();
  });

  test("a pull while Today's own check runs waits for that check, and shows what it found", async () => {
    let answer: (result: CheckNowResult) => void = () => {};
    const spies = stubApi({
      today: answers(TODAY),
      checkAnki: () => new Promise<CheckNowResult>((resolve) => (answer = resolve)),
      checkOura: answers({ ok: true }),
    });
    renderInShell();
    await card("Spanish");
    await waitFor(() => expect(spies.checkAnki).toHaveBeenCalledTimes(1));

    pullDown();
    await waitFor(() => expect(spies.checkOura).toHaveBeenCalledTimes(1));
    expect(busy()).toBe("true");
    const loads = spies.today.mock.calls.length;
    answer(UNREACHABLE);

    expect(await within(await card("Spanish")).findByText(ANKI_UNREACHED)).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());
    expect(spies.checkAnki).toHaveBeenCalledTimes(1);
    expect(spies.today.mock.calls.length).toBeGreaterThan(loads);
  });

  test("a check Today sends by itself that can't reach AnkiWeb says nothing", async () => {
    const spies = stubApi({ today: answers(TODAY), checkAnki: answers(UNREACHABLE) });
    renderInShell();
    await opened(spies);
    expect(spies.checkAnki).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ANKI_UNREACHED)).toBeNull();
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
  const rejected = (
    owedAgainCents: number,
    excusable: { firstDate: string; lastDate: string; until: string } | null = null,
  ): TodayResponse => ({
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
        excusable,
      },
    ],
    sections: [],
    waiting: [],
    yesterday: [],
  });

  test("names the reviewer, quotes the reason, and says the days count as usual", async () => {
    stubApi({ today: answers(rejected(0)) });
    renderToday();
    const alert = await screen.findByRole("status");
    expect(within(alert).getByText("Sam rejected your vacation")).toBeTruthy();
    expect(within(alert).getByText("“Not two weeks before the gym challenge ends”")).toBeTruthy();
    expect(alert.textContent).toContain("Dec 20 – Jan 2 · These days count as usual.");
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

  test("with Missed days it released, says until when they can be excused", async () => {
    const excusable = { firstDate: "2026-12-21", lastDate: "2026-12-23", until: "2026-12-26T13:00:00.000Z" };
    stubApi({ today: answers(rejected(1000, excusable)) });
    renderToday();
    const alert = await screen.findByRole("status");
    expect(alert.textContent).toContain("Mon Dec 21 to Wed Dec 23 can be excused until Sat Dec 26, 8:00am.");
  });

  test("with none it can release, says nothing of excuses", async () => {
    stubApi({ today: answers(rejected(1000)) });
    renderToday();
    const alert = await screen.findByRole("status");
    expect(alert.textContent).not.toContain("can be excused");
  });
});

describe("the vacation banner", () => {
  const onVacation = (pacts: { kind: "all" } | { kind: "some"; names: string[] }): TodayResponse => ({
    hasPacts: true,
    alerts: [],
    sections: [],
    waiting: [],
    yesterday: [],
    vacations: [
      {
        id: "v1",
        from: "2026-12-20",
        to: "2027-01-02",
        note: "Going to Portugal",
        pacts,
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
            covered: [
              { date: "2026-12-21", through: "2026-12-27" },
              { date: "2026-12-28", through: "2027-01-03" },
            ],
          },
        ],
      },
    ],
  });

  test("says until when, the note and which pacts are Excused; See what's excused lists each one's line, and Hide closes it", async () => {
    stubApi({ today: answers(onVacation({ kind: "some", names: ["Bed by midnight", "Gym"] })) });
    const { user } = renderToday();

    const banner = await screen.findByRole("status");
    expect(within(banner).getByText("On vacation until Sat Jan 2")).toBeTruthy();
    expect(within(banner).getByText("Going to Portugal")).toBeTruthy();
    expect(
      within(banner).getByText(
        "Bed by midnight and Gym are excused on these days. You won't get reminders or penalties.",
      ),
    ).toBeTruthy();
    expect(within(banner).queryByText("14 nights off · Dec 20 – Jan 2")).toBeNull();
    expect(screen.queryByText("Nothing to do right now")).toBeNull();

    await user.click(within(banner).getByRole("button", { name: "See what's excused" }));
    expect(within(banner).getByText("14 nights off · Dec 20 – Jan 2")).toBeTruthy();
    expect(within(banner).getByText("2 weeks off · Dec 21 – Jan 3")).toBeTruthy();
    expect(within(banner).getByText("Week of Dec 28: whole week off")).toBeTruthy();

    await user.click(within(banner).getByRole("button", { name: "Hide" }));
    expect(within(banner).queryByText("14 nights off · Dec 20 – Jan 2")).toBeNull();
  });

  test("covering every pact, it says your pacts are Excused", async () => {
    stubApi({ today: answers(onVacation({ kind: "all" })) });
    renderToday();

    const banner = await screen.findByRole("status");
    expect(
      within(banner).getByText("Your pacts are excused on these days. You won't get reminders or penalties."),
    ).toBeTruthy();
  });
});

describe("Waiting for approval", () => {
  const waiting: TodayResponse = {
    hasPacts: true,
    alerts: [
      {
        kind: "reviewer-question",
        item: { kind: "vacation", id: "trip", firstDate: "2026-01-12", lastDate: "2026-01-18", filedAt: NOW },
        reviewerName: "Sam",
        question: "When does your flight leave?",
        askedAt: NOW,
      },
    ],
    sections: [],
    waiting: [
      { kind: "vacation", id: "trip", firstDate: "2026-01-12", lastDate: "2026-01-18", filedAt: NOW },
      {
        kind: "evidence",
        id: "photo-1",
        pactId: "gym",
        name: "Gym",
        occurrenceDate: "2026-01-05",
        submittedAt: "2026-01-05T14:00:00Z",
      },
    ],
    yesterday: [],
  };

  beforeEach(() => stubApi({ today: answers(waiting) }));

  test("a waiting evidence row opens its evidence page, not the pact", async () => {
    const { user } = renderToday();
    await user.click(await screen.findByRole("button", { name: /Gym\s*Photo · Mon Jan 5/ }));
    expect(openers.evidence).toHaveBeenCalledWith("photo-1");
    expect(onOpenPact).not.toHaveBeenCalled();
  });

  test("a waiting vacation row opens the vacation", async () => {
    const { user } = renderToday();
    await user.click(await screen.findByRole("button", { name: /Mon Jan 12 – Sun Jan 18\s*Vacation/ }));
    expect(openers.vacation).toHaveBeenCalledWith("trip");
  });

  test("a question about a vacation shows as an alert, and Reply opens the vacation", async () => {
    const { user } = renderToday();
    expect(await screen.findByText("Sam asked about your vacation, Mon Jan 12 – Sun Jan 18")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(openers.vacation).toHaveBeenCalledWith("trip");
  });
});
