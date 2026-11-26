import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
import { answers, onOurSide, renderWithUser, stubApi } from "./testing/render.tsx";

const me: MeResponse = {
  email: "me@example.test",
  name: "Me",
  timezone: "America/New_York",
  connections: [],
  ouraAvailable: false,
  ankiAvailable: false,
};

test("Today's header shows the day Today loaded is for, as the core says, written as the app writes days elsewhere", async () => {
  // Whatever this device's clock says: the core decides the day in the profile's timezone.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T15:00:00Z") });
  window.history.replaceState(null, "", APP_PATHS.today);
  stubApi({
    me: answers(me),
    today: answers<TodayResponse>({
      date: "2026-11-21",
      hasPacts: false,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [],
    }),
    pacts: answers<PactsResponse>([]),
    reviewQueue: answers<ReviewQueueResponse>([]),
    waitingOnReply: answers<WaitingOnReplyResponse>([]),
    ledgers: answers<LedgersResponse>([]),
  });

  renderWithUser(<App />);

  expect(await screen.findByText("Sat Nov 21")).toBeTruthy();
});

test("until Today first loads, and if that load fails, Today's header shows the day by the clock in the profile's timezone", async () => {
  // 1am Sunday in London is still Saturday evening in New York.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T01:00:00Z") });
  window.history.replaceState(null, "", APP_PATHS.today);
  stubApi({
    me: answers(me),
    today: answers<TodayResponse>(onOurSide),
    pacts: answers<PactsResponse>([]),
    reviewQueue: answers<ReviewQueueResponse>([]),
    waitingOnReply: answers<WaitingOnReplyResponse>([]),
    ledgers: answers<LedgersResponse>([]),
  });

  renderWithUser(<App />);

  expect(await screen.findByText("Today couldn't load")).toBeTruthy();
  expect(screen.getByText("Sat Nov 21")).toBeTruthy();
});
