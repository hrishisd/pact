// The number on the app's icon (docs/behaviour.md, "Notifications and
// reminders"): the Review Queue's size, set by the app from each load of the
// queue, which runs again on every return to the front, since a push may
// have changed the icon.

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
import { forgetLoaded } from "./last-loaded.ts";
import { forgetThisDevice } from "./push.ts";
import { answers, comeBackAt, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

// Better Auth's sign-out request, the only one in this file that reaches
// fetch. Before the imports: its client keeps the fetch it finds when made.
vi.hoisted(() => {
  globalThis.fetch = async () => Response.json({ success: true });
});

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
    // What the Profile sheet loads; never answered, since no test looks at it.
    lastVacation: unanswered,
    vacations: unanswered,
    friends: unanswered,
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

test("coming back, however soon, loads the count afresh and sets the icon from it: a push may have changed it", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")], [vacation("v1"), vacation("v2")]));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();
  const loads = spies.reviewQueue.mock.calls.length;

  comeBackAt("2026-11-21T15:05:00Z");

  expect(await screen.findByLabelText("2 to review")).toBeTruthy();
  expect(calls).toEqual(["set 1", "set 2"]);
  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads + 1);
});

test("coming back after 11 minutes, the count loads once, and the icon shows it", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")], [vacation("v1"), vacation("v2")]));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();
  const loads = spies.reviewQueue.mock.calls.length;

  comeBackAt("2026-11-21T15:11:00Z");

  expect(await screen.findByLabelText("2 to review")).toBeTruthy();
  await settle();
  expect(calls).toEqual(["set 1", "set 2"]);
  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads + 1);
});

test("a count that fails to load leaves the icon as it was", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")], onOurSide));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();
  const loads = spies.reviewQueue.mock.calls.length;

  comeBackAt("2026-11-21T15:05:00Z");
  await settle();

  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads + 1);
  expect(calls).toEqual(["set 1"]);
  expect(screen.getByLabelText("1 to review")).toBeTruthy();
});

test("leaving the app does nothing", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")]));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();
  const loads = spies.reviewQueue.mock.calls.length;

  act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settle();

  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads);
  expect(calls).toEqual(["set 1"]);
});

test("after a command, the queue's reload in the background sets the icon", async () => {
  const calls = badgeableIcon();
  stubAll(answers<ReviewQueueResponse>([vacation("v1")], []));
  renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();

  // What any command the person sends does (api.ts).
  act(() => forgetLoaded());

  await waitFor(() => expect(calls).toEqual(["set 1", "clear"]));
});

test("a browser that refuses the badge, as without notification permission, breaks nothing", async () => {
  const calls = badgeableIcon({ refuse: true });
  stubAll(answers<ReviewQueueResponse>([vacation("v1")], [vacation("v1"), vacation("v2")]));
  renderWithUser(<App />);

  expect(await screen.findByLabelText("1 to review")).toBeTruthy();
  comeBackAt("2026-11-21T15:05:00Z");
  expect(await screen.findByLabelText("2 to review")).toBeTruthy();
  expect(calls).toEqual(["set 1", "set 2"]);
});

test("signing out clears the icon, and coming back afterwards loads nothing", async () => {
  const calls = badgeableIcon();
  const spies = stubAll(answers<ReviewQueueResponse>([vacation("v1")]));
  const { user } = renderWithUser(<App />);
  await screen.findByLabelText("1 to review");
  await settle();

  await user.click(screen.getByRole("button", { name: "Profile" }));
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("button", { name: /Sign in with Google/ })).toBeTruthy();
  expect(calls).toEqual(["set 1", "clear"]);
  const loads = spies.reviewQueue.mock.calls.length;

  comeBackAt("2026-11-21T15:05:00Z");
  await settle();

  expect(spies.reviewQueue).toHaveBeenCalledTimes(loads);
  expect(calls).toEqual(["set 1", "clear"]);
});

test("signing out clears the icon once this device has unsubscribed, and even if that fails", async () => {
  const calls = badgeableIcon();
  let unsubscribe = async () => {
    calls.push("unsubscribe");
    return true;
  };
  const subscription = { endpoint: "https://push.example.test/1", unsubscribe: () => unsubscribe() };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => registration },
  });
  stubApi({ removePushSubscription: answers({ ok: true as const }) });

  await forgetThisDevice();
  expect(calls).toEqual(["unsubscribe", "clear"]);

  unsubscribe = () => Promise.reject(new Error("offline"));
  await forgetThisDevice();
  expect(calls).toEqual(["unsubscribe", "clear", "clear"]);

  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});
