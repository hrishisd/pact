// The number on the app's icon (docs/behaviour.md, "Notifications and
// reminders"): the Review Queue's size, set by the app from what it loads,
// and again on each return to the front, since a push may have changed it.

import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
import { forgetThisDevice } from "./push.ts";
import { answers, comeBackAt, renderWithUser, stubApi } from "./testing/render.tsx";

const ZONE = "America/New_York";
/** Sat Nov 21, 10:00 in New York. */
const OPENED = "2026-11-21T15:00:00Z";

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
const vacation = (id: string): ReviewQueueResponse[number] => ({
  kind: "vacation",
  id,
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
});

const unanswered = () => new Promise<never>(() => {});
function stubAll(reviewQueue: () => Promise<ReviewQueueResponse>) {
  return stubApi({
    me: answers(me),
    today: answers(NOTHING_TODAY),
    pacts: answers<PactsResponse>([]),
    reviewQueue,
    waitingOnReply: answers<WaitingOnReplyResponse>([]),
    ledgers: answers<LedgersResponse>([]),
    checkOura: answers({ ok: true }),
    checkAnki: answers({ ok: true }),
    notifications: unanswered,
  });
}

/** A browser that can badge the app's icon: what was asked of it, in order. */
function badgeableIcon({ refuse = false } = {}) {
  const calls: string[] = [];
  const answer = () =>
    refuse ? Promise.reject(new DOMException("No permission", "NotAllowedError")) : Promise.resolve();
  Object.defineProperty(navigator, "setAppBadge", {
    configurable: true,
    value: (count: number) => {
      calls.push(`set ${count}`);
      return answer();
    },
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    configurable: true,
    value: () => {
      calls.push("clear");
      return answer();
    },
  });
  return calls;
}

beforeEach(() => {
  // Timers move with real time too, so Testing Library's waits still work.
  vi.useFakeTimers({ now: new Date(OPENED), shouldAdvanceTime: true });
  window.history.replaceState(null, "", APP_PATHS.today);
});

afterEach(() => {
  delete (navigator as { setAppBadge?: unknown }).setAppBadge;
  delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

test("on open, the icon shows the Review Queue's size once it has loaded, and not before", async () => {
  const calls = badgeableIcon();
  let answer = (_queue: ReviewQueueResponse) => {};
  stubAll(() => new Promise((resolve) => (answer = resolve)));
  renderWithUser(<App />);
  await screen.findByText("Nothing to do right now");
  await settle();
  expect(calls).toEqual([]);

  await act(async () => answer([vacation("v1"), vacation("v2")]));

  expect(await screen.findByLabelText("2 to review")).toBeTruthy();
  expect(calls).toEqual(["set 2"]);
});

test("with nothing to review, the icon's badge is cleared", async () => {
  const calls = badgeableIcon();
  stubAll(answers<ReviewQueueResponse>([]));
  renderWithUser(<App />);
  await screen.findByText("Nothing to do right now");

  await waitFor(() => expect(calls).toEqual(["clear"]));
});

test("on the Review tab, each load of its queue sets the icon", async () => {
  window.history.replaceState(null, "", APP_PATHS.review);
  const calls = badgeableIcon();
  stubAll(answers<ReviewQueueResponse>([vacation("v1")]));
  renderWithUser(<App />);

  expect(await screen.findByLabelText("1 to review")).toBeTruthy();
  expect(calls).toEqual(["set 1"]);
});

test("coming back, however soon, sets the icon to the count the app has again: a push may have changed it", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")]));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();
  const loads = spies.reviewQueue.mock.calls.length;

  comeBackAt("2026-11-21T15:05:00Z");
  await settle();

  expect(calls).toEqual(["set 1", "set 1"]);
  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads);
});

test("coming back after 11 minutes, the icon shows the count the badge reloads", async () => {
  const calls = badgeableIcon();
  stubAll(answers<ReviewQueueResponse>([vacation("v1")], [vacation("v1"), vacation("v2")]));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();

  comeBackAt("2026-11-21T15:11:00Z");

  expect(await screen.findByLabelText("2 to review")).toBeTruthy();
  expect(calls.at(-1)).toBe("set 2");
});

test("a browser that refuses the badge, as without notification permission, breaks nothing", async () => {
  const calls = badgeableIcon({ refuse: true });
  stubAll(answers<ReviewQueueResponse>([vacation("v1")]));
  renderWithUser(<App />);

  expect(await screen.findByLabelText("1 to review")).toBeTruthy();
  comeBackAt("2026-11-21T15:05:00Z");
  await settle();
  expect(calls).toEqual(["set 1", "set 1"]);
  expect(screen.getByLabelText("1 to review")).toBeTruthy();
});

test("signing out clears the icon", async () => {
  const calls = badgeableIcon();

  await forgetThisDevice();

  expect(calls).toEqual(["clear"]);
});
