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
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

const me: MeResponse = {
  email: "me@example.test",
  name: "Me",
  timezone: "America/New_York",
  connections: [],
  ouraAvailable: false,
  ankiAvailable: false,
};

test("Today's header shows the day in the profile's timezone, written as the app writes days elsewhere", async () => {
  // 1am Sunday in London is still Saturday evening in New York.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T01:00:00Z") });
  window.history.replaceState(null, "", APP_PATHS.today);
  stubApi({
    me: answers(me),
    today: answers<TodayResponse>({ hasPacts: false, alerts: [], sections: [], waiting: [], yesterday: [] }),
    pacts: answers<PactsResponse>([]),
    reviewQueue: answers<ReviewQueueResponse>([]),
    waitingOnReply: answers<WaitingOnReplyResponse>([]),
    ledgers: answers<LedgersResponse>([]),
  });

  renderWithUser(<App />);

  expect(await screen.findByText("Sat Nov 21")).toBeTruthy();
});
