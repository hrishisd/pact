// Coming back to the front (docs/behaviour.md, "Coming back to the front"):
// the shown screen refreshes by itself when what it shows may be old. The
// fake clock moves the way iOS does: a return jumps it with no timer run
// (`comeBackAt`); while the app is in front, timers run as time goes by.

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  LedgersResponse,
  MeResponse,
  PactsResponse,
  ReviewQueueResponse,
  TodayResponse,
  WaitingOnReplyResponse,
} from "../shared/api.ts";
import { APP_PATHS } from "../shared/api.ts";
import { App } from "./App.tsx";
import { Pacts } from "./Pacts.tsx";
import { PullToRefresh, RETRY_AFTER_MS, useRefresh, type RefreshRun } from "./pull-to-refresh.tsx";
import {
  answers,
  cameraPact,
  comeBackAt,
  endSheetSlides,
  onOurSide,
  pullDown,
  renderWithUser,
  stubApi,
} from "./testing/render.tsx";
import { Sheet } from "./ui.tsx";

const ZONE = "America/New_York";
/** Sat Nov 21, 10:00 in New York. */
const OPENED = "2026-11-21T15:00:00Z";

/** Whether the screen is busy refreshing: "true" while the bar runs, null otherwise. */
const busy = () => screen.getByRole("main").getAttribute("aria-busy");

/** Lets what the app started run: answers, renders, and the fake timers due now. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

/**
 * Moves the fake clock to `time` with the app in front, running the timers
 * due on the way. To a named time, not by a span, so however long the test
 * took to get here in real time (which the fake clock follows too) it can't
 * overshoot.
 */
const advanceTo = (time: string) =>
  act(() => vi.advanceTimersByTimeAsync(Date.parse(time) - vi.getMockedSystemTime()!.getTime()));

beforeEach(() => {
  // Timers move with real time too, so Testing Library's waits still work.
  vi.useFakeTimers({ now: new Date(OPENED), shouldAdvanceTime: true });
});

type Refresh = (run: RefreshRun) => Promise<boolean>;

/** A screen whose refresh is `refresh`. */
function Screen({ refresh }: { refresh: Refresh }) {
  useRefresh(refresh);
  return <p>A screen</p>;
}

/** The shell showing a screen whose refresh is `refresh`: a tab, or with `pullable` false a page opened from one. */
function shell(refresh: Refresh, pullable = true) {
  return renderWithUser(
    <PullToRefresh pullable={pullable} timezone={ZONE} header={<h1>Today</h1>} mainClassName="scroll gut">
      <Screen refresh={refresh} />
    </PullToRefresh>,
  );
}

/** A refresh the test finishes by calling `done` (it loaded), or `fail` (it didn't). */
function heldRefresh() {
  let done = () => {};
  let fail = () => {};
  const refresh = vi.fn(
    (_run: RefreshRun) =>
      new Promise<boolean>((resolve) => {
        done = () => resolve(true);
        fail = () => resolve(false);
      }),
  );
  return { refresh, done: () => act(() => done()), fail: () => act(() => fail()) };
}

const BY_ITSELF: RefreshRun = { pulled: false, quiet: true };

describe("when the shown screen refreshes by itself", () => {
  test("a short trip away refreshes nothing", () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    comeBackAt("2026-11-21T15:09:00Z");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("back more than 10 minutes after it loaded, it refreshes once, quietly", async () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    comeBackAt("2026-11-21T15:11:00Z");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(BY_ITSELF);
    // Back again soon after: it loaded at 15:11.
    await settle();
    comeBackAt("2026-11-21T15:20:00Z");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("back two minutes later on a new day in the profile's timezone, it refreshes", () => {
    vi.setSystemTime(new Date("2026-11-22T04:59:00Z")); // Sat 23:59 in New York
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    comeBackAt("2026-11-22T05:01:00Z");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a new day on this device's clock but not in the profile's timezone isn't one", () => {
    vi.setSystemTime(new Date("2026-11-21T23:59:00Z")); // Sat 18:59 in New York
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    comeBackAt("2026-11-22T00:01:00Z");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("with the app in front, it refreshes at midnight in the profile's timezone", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:55:00Z")); // Sat 23:55 in New York
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    await advanceTo("2026-11-22T04:59:59Z");
    expect(refresh).not.toHaveBeenCalled();
    await advanceTo("2026-11-22T05:00:01Z");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(BY_ITSELF);
  });

  test("a pull that answers after midnight is followed by midnight's refresh", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:55:00Z")); // Sat 23:55 in New York
    const { refresh, done } = heldRefresh();
    shell(refresh);
    await advanceTo("2026-11-22T04:59:59Z");
    pullDown();
    // Midnight comes while the pull runs; its Saturday answer comes after.
    await advanceTo("2026-11-22T05:00:01Z");
    expect(refresh).toHaveBeenCalledTimes(1);
    await done();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(BY_ITSELF);
  });

  test("a pull that fails isn't a load", async () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(false));
    shell(refresh);
    act(() => vi.setSystemTime(new Date("2026-11-21T15:08:00Z")));
    pullDown();
    await waitFor(() => expect(busy()).toBeNull());

    // 11 minutes after it opened, the last time it loaded.
    comeBackAt("2026-11-21T15:11:00Z");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(BY_ITSELF);
  });

  test("a pull counts as a load: pulled, then away 9 minutes, nothing refreshes", async () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh);
    act(() => vi.setSystemTime(new Date("2026-11-21T15:08:00Z")));
    pullDown();
    expect(refresh).toHaveBeenCalledWith({ pulled: true, quiet: false });
    await waitFor(() => expect(busy()).toBeNull());

    comeBackAt("2026-11-21T15:17:00Z");
    expect(refresh).toHaveBeenCalledTimes(1);
    comeBackAt("2026-11-21T15:19:00Z");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("the bar moves while it runs, on a tab and on a page opened from one alike", async () => {
    for (const pullable of [true, false]) {
      vi.setSystemTime(new Date(OPENED));
      const { refresh, done } = heldRefresh();
      const { unmount } = shell(refresh, pullable);
      expect(busy()).toBeNull();
      comeBackAt("2026-11-21T15:11:00Z");
      expect(busy()).toBe("true");
      await done();
      await waitFor(() => expect(busy()).toBeNull());
      unmount();
    }
  });

  test("a page opened from a tab still can't be pulled", () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    shell(refresh, false);
    pullDown();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a pull while it runs waits for it, with the same bar, and starts no other", async () => {
    const { refresh, done } = heldRefresh();
    shell(refresh);
    comeBackAt("2026-11-21T15:11:00Z");
    pullDown();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(busy()).toBe("true");
    await done();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("while a sheet is open it waits, and runs when the last sheet closes", async () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    function ScreenWithSheet() {
      const [open, setOpen] = useState(true);
      useRefresh(refresh);
      return open ? (
        <Sheet title="A sheet" closeLabel="Done" onClose={() => setOpen(false)}>
          <p>In the sheet</p>
        </Sheet>
      ) : (
        <p>No sheet</p>
      );
    }
    renderWithUser(
      <PullToRefresh pullable timezone={ZONE} header={<h1>Today</h1>} mainClassName="scroll gut">
        <ScreenWithSheet />
      </PullToRefresh>,
    );
    comeBackAt("2026-11-21T15:11:00Z");
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Still while the sheet slides away.
    expect(refresh).not.toHaveBeenCalled();
    act(() => endSheetSlides());
    expect(screen.getByText("No sheet")).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(BY_ITSELF);
  });

  test("waiting for a sheet, it still runs when the sheet closes after the profile's timezone changed in it", () => {
    const refresh = vi.fn((_run: RefreshRun) => Promise.resolve(true));
    function ScreenWithSheet() {
      const [open, setOpen] = useState(true);
      useRefresh(refresh);
      return open ? (
        <Sheet title="Profile" closeLabel="Done" onClose={() => setOpen(false)}>
          <p>In the sheet</p>
        </Sheet>
      ) : (
        <p>No sheet</p>
      );
    }
    const inZone = (timezone: string) => (
      <PullToRefresh pullable timezone={timezone} header={<h1>Today</h1>} mainClassName="scroll gut">
        <ScreenWithSheet />
      </PullToRefresh>
    );
    const { rerender } = renderWithUser(inZone(ZONE));
    comeBackAt("2026-11-21T15:11:00Z");

    rerender(inZone("Europe/London"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    act(() => endSheetSlides());

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("a refresh by itself that fails", () => {
  test("says nothing, and tries again after 3 seconds, as a pull would", async () => {
    const first = heldRefresh();
    shell(first.refresh);
    comeBackAt("2026-11-21T15:11:00Z");
    await first.fail();
    expect(busy()).toBe("true");
    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS - 100));
    expect(first.refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(first.refresh).toHaveBeenCalledTimes(2);
    expect(first.refresh).toHaveBeenLastCalledWith({ pulled: false, quiet: false });
    expect(busy()).toBe("true");
    await first.done();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("tries again as soon as the browser says it's online", async () => {
    const { refresh, fail } = heldRefresh();
    shell(refresh);
    comeBackAt("2026-11-21T15:11:00Z");
    await fail();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    // Once only: the 3 seconds passing tries nothing more.
    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("shows the screen's \"couldn't load\" only once the second try fails too", async () => {
    const spies = stubApi({ pacts: answers<PactsResponse>([], onOurSide, onOurSide) });
    renderWithUser(
      <PullToRefresh pullable timezone={ZONE} header={<h1>Pacts</h1>} mainClassName="scroll gut">
        <Pacts onOpenPact={() => {}} onCreate={() => {}} />
      </PullToRefresh>,
    );
    await screen.findByText("No pacts yet");

    comeBackAt("2026-11-21T15:11:00Z");
    await waitFor(() => expect(spies.pacts).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.queryByText("Pacts couldn't load")).toBeNull();
    expect(busy()).toBe("true");

    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS));
    expect(await screen.findByText("Pacts couldn't load")).toBeTruthy();
    expect(spies.pacts).toHaveBeenCalledTimes(3);
    expect(screen.getByText("No pacts yet")).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a refresh that failed twice isn't a load: back a minute later, it tries again", async () => {
    const spies = stubApi({ pacts: answers<PactsResponse>([], onOurSide, onOurSide, []) });
    renderWithUser(
      <PullToRefresh pullable timezone={ZONE} header={<h1>Pacts</h1>} mainClassName="scroll gut">
        <Pacts onOpenPact={() => {}} onCreate={() => {}} />
      </PullToRefresh>,
    );
    await screen.findByText("No pacts yet");
    comeBackAt("2026-11-21T15:11:00Z");
    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS));
    expect(await screen.findByText("Pacts couldn't load")).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());

    comeBackAt("2026-11-21T15:12:00Z");

    await waitFor(() => expect(spies.pacts).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByText("Pacts couldn't load")).toBeNull());
  });

  test("shows nothing when the second try loads", async () => {
    const spies = stubApi({ pacts: answers<PactsResponse>([], onOurSide, []) });
    renderWithUser(
      <PullToRefresh pullable timezone={ZONE} header={<h1>Pacts</h1>} mainClassName="scroll gut">
        <Pacts onOpenPact={() => {}} onCreate={() => {}} />
      </PullToRefresh>,
    );
    await screen.findByText("No pacts yet");
    comeBackAt("2026-11-21T15:11:00Z");
    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS));
    await waitFor(() => expect(busy()).toBeNull());
    expect(spies.pacts).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Pacts couldn't load")).toBeNull();
  });
});

describe("in the app", () => {
  const me: MeResponse = {
    email: "me@example.test",
    name: "Me",
    timezone: ZONE,
    connections: [],
    ouraAvailable: false,
    ankiAvailable: false,
  };
  const NOTHING_TODAY: TodayResponse = {
    date: "2026-11-21",
    hasPacts: true,
    alerts: [],
    sections: [],
    waiting: [],
    yesterday: [],
  };
  const NOTHING_SUNDAY: TodayResponse = { ...NOTHING_TODAY, date: "2026-11-22" };
  const VACATION: ReviewQueueResponse[number] = {
    kind: "vacation",
    id: "v1",
    ownerName: "Jordan Lee",
    from: "2026-12-20",
    to: "2026-12-21",
    days: 2,
    note: null,
    pacts: { kind: "all-recurring" },
    reviewerNames: ["Me"],
    covers: [],
    filedAt: "2026-11-21T15:05:00.000Z",
    thread: { comments: [], waitingOnReply: false },
  };

  const unanswered = () => new Promise<never>(() => {});
  function stubAll(reviewQueue = answers<ReviewQueueResponse>([]), today = answers(NOTHING_TODAY)) {
    return stubApi({
      me: answers(me),
      today,
      pacts: answers<PactsResponse>([]),
      reviewQueue,
      waitingOnReply: answers<WaitingOnReplyResponse>([]),
      ledgers: answers<LedgersResponse>([]),
      pact: answers({ ok: true as const, pact: cameraPact() }),
      checkOura: answers({ ok: true }),
      checkAnki: answers({ ok: true }),
      vacationOptions: answers({ today: "2026-11-21", recurring: [], oneTime: [], inEditWindow: false }),
      // What the Profile sheet loads; never answered, since no test looks at it.
      lastVacation: unanswered,
      vacations: unanswered,
      friends: unanswered,
      notifications: unanswered,
    });
  }
  /** How many times each call was made so far. */
  function counts(spies: Record<string, { mock: { calls: unknown[] } }>) {
    return Object.fromEntries(Object.entries(spies).map(([call, spy]) => [call, spy.mock.calls.length]));
  }
  /** Everything the shell loads when it opens has answered. */
  async function opened(spies: ReturnType<typeof stubAll>) {
    await waitFor(() => expect(spies.ledgers).toHaveBeenCalled());
    await settle();
  }

  test("on Today, back after 11 minutes, Today and the Review badge reload, once each, and nothing else", async () => {
    window.history.replaceState(null, "", APP_PATHS.today);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    renderWithUser(<App />);
    await screen.findByText("Nothing to do right now");
    await opened(spies);
    const before = counts(spies);

    comeBackAt("2026-11-21T15:11:00Z");

    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());
    // Today's refresh checks Oura and AnkiWeb, as a pull does.
    expect(counts(spies)).toEqual({
      ...before,
      today: before.today! + 1,
      reviewQueue: before.reviewQueue! + 1,
      checkOura: before.checkOura! + 1,
      checkAnki: before.checkAnki! + 1,
    });
  });

  test("on Today, a short trip away reloads only the Review badge, which a push may have changed on the app's icon", async () => {
    window.history.replaceState(null, "", APP_PATHS.today);
    const spies = stubAll();
    renderWithUser(<App />);
    await screen.findByText("Nothing to do right now");
    await opened(spies);
    const before = counts(spies);
    comeBackAt("2026-11-21T15:09:00Z");
    await settle();
    expect(counts(spies)).toEqual({ ...before, reviewQueue: before.reviewQueue! + 1 });
  });

  test("Today's header turns to the new day with its cards at midnight, with the app in front", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:50:00Z")); // Sat 23:50 in New York
    window.history.replaceState(null, "", APP_PATHS.today);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    renderWithUser(<App />);
    await screen.findByText("Nothing to do right now");
    await opened(spies);
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    const loads = spies.today.mock.calls.length;
    // Sunday's Today answers when the test says.
    let answerToday = () => {};
    spies.today.mockImplementation(() => new Promise((resolve) => (answerToday = () => resolve(NOTHING_SUNDAY))));

    await advanceTo("2026-11-22T04:59:59Z");
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    expect(spies.today).toHaveBeenCalledTimes(loads);

    await advanceTo("2026-11-22T05:00:01Z");
    expect(spies.today).toHaveBeenCalledTimes(loads + 1);
    // The badge's new count shows at once; the header waits for the cards.
    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    await act(async () => answerToday());
    expect(await screen.findByText("Sun Nov 22")).toBeTruthy();
  });

  test("Today's header stays on the old day, with the old cards, while Today can't load the new one", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:50:00Z")); // Sat 23:50 in New York
    window.history.replaceState(null, "", APP_PATHS.today);
    const spies = stubAll();
    renderWithUser(<App />);
    await screen.findByText("Nothing to do right now");
    await opened(spies);
    spies.today.mockImplementation(() => Promise.reject(onOurSide));

    await advanceTo("2026-11-22T05:00:01Z");
    await act(() => vi.advanceTimersByTimeAsync(RETRY_AFTER_MS));

    expect(await screen.findByText("Today couldn't load")).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    expect(screen.getByText("Nothing to do right now")).toBeTruthy();
  });

  test("Today's header shows the new day after a short trip away across midnight", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:59:00Z")); // Sat 23:59 in New York
    window.history.replaceState(null, "", APP_PATHS.today);
    const spies = stubAll(undefined, answers(NOTHING_TODAY, NOTHING_SUNDAY));
    renderWithUser(<App />);
    await screen.findByText("Nothing to do right now");
    await opened(spies);
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    const loads = spies.today.mock.calls.length;

    comeBackAt("2026-11-22T05:01:00Z");

    expect(await screen.findByText("Sun Nov 22")).toBeTruthy();
    expect(spies.today).toHaveBeenCalledTimes(loads + 1);
  });

  test("a pact's page reloads by itself when due", async () => {
    window.history.replaceState(null, "", APP_PATHS.pact("gym"));
    const spies = stubAll();
    renderWithUser(<App />);
    await screen.findByRole("heading", { name: "Gym" });
    await opened(spies);
    const before = counts(spies);

    comeBackAt("2026-11-21T15:11:00Z");

    await waitFor(() => expect(spies.pact).toHaveBeenCalledTimes(before.pact! + 1));
    await waitFor(() => expect(busy()).toBeNull());
    expect(counts(spies)).toEqual({ ...before, pact: before.pact! + 1, reviewQueue: before.reviewQueue! + 1 });
  });

  test("a form page never reloads by itself, though the Review badge does", async () => {
    window.history.replaceState(null, "", APP_PATHS.newVacation);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    renderWithUser(<App />);
    await screen.findByLabelText("First day");
    await opened(spies);
    const before = counts(spies);

    comeBackAt("2026-11-21T15:11:00Z");

    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    await settle();
    expect(counts(spies)).toEqual({ ...before, reviewQueue: before.reviewQueue! + 1 });
    expect(busy()).toBeNull();
    // Back again soon after: the badge reloads on every return, the form still doesn't.
    comeBackAt("2026-11-21T15:13:00Z");
    await settle();
    expect(counts(spies)).toEqual({ ...before, reviewQueue: before.reviewQueue! + 2 });
  });

  test("on a form opened over the Review tab, the Review badge still reloads by itself", async () => {
    window.history.replaceState(null, "", APP_PATHS.review);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    const { user } = renderWithUser(<App />);
    await screen.findByText("Nothing to review");
    await opened(spies);
    await user.click(screen.getByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Plan a vacation" }));
    await screen.findByLabelText("First day");
    await settle();
    const before = counts(spies);

    comeBackAt("2026-11-21T15:11:00Z");

    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    expect(counts(spies)).toEqual({ ...before, reviewQueue: before.reviewQueue! + 1 });
  });

  test("on a form page, the Review badge reloads at midnight", async () => {
    vi.setSystemTime(new Date("2026-11-22T04:55:00Z")); // Sat 23:55 in New York
    window.history.replaceState(null, "", APP_PATHS.newVacation);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    renderWithUser(<App />);
    await screen.findByLabelText("First day");
    await opened(spies);
    const before = counts(spies);

    await advanceTo("2026-11-22T04:59:59Z");
    expect(counts(spies)).toEqual(before);
    await advanceTo("2026-11-22T05:00:01Z");

    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    expect(counts(spies)).toEqual({ ...before, reviewQueue: before.reviewQueue! + 1 });
  });

  test("on Review, back after 11 minutes, its queue loads once, for the tab and the badge alike", async () => {
    window.history.replaceState(null, "", APP_PATHS.review);
    const spies = stubAll(answers<ReviewQueueResponse>([], [VACATION]));
    renderWithUser(<App />);
    await screen.findByText("Nothing to review");
    await opened(spies);
    const before = counts(spies);

    comeBackAt("2026-11-21T15:11:00Z");

    expect(await screen.findByLabelText("1 to review")).toBeTruthy();
    await waitFor(() => expect(busy()).toBeNull());
    expect(counts(spies)).toEqual({
      ...before,
      reviewQueue: before.reviewQueue! + 1,
      waitingOnReply: before.waitingOnReply! + 1,
    });
  });
});
