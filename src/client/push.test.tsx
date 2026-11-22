import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { NotificationsResponse } from "../shared/api.ts";
import { usePush } from "./push.ts";
import { answers, stubApi } from "./testing/render.tsx";

/** The VAPID key the server gives, and the same bytes as the device's subscription holds them. */
const VAPID_KEY = "AQID";
const SUBSCRIBED_KEY = new Uint8Array([1, 2, 3]).buffer;

/** A browser that can get notifications, has said yes, and already has a subscription. */
function deviceWithPushOn() {
  const notification = { permission: "granted" as NotificationPermission, requestPermission: vi.fn() };
  const subscription = {
    endpoint: "https://push.example.test/1",
    options: { applicationServerKey: SUBSCRIBED_KEY },
    toJSON: () => ({ endpoint: "https://push.example.test/1", keys: { p256dh: "p", auth: "a" } }),
  };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: async () => registration,
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    },
  });
  return notification;
}

const notificationsResponse: NotificationsResponse = {
  settings: [],
  dailySummary: { enabled: false, to: "me@example.test" },
  vapidPublicKey: VAPID_KEY,
};

function comeBackToTheApp() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
}

function PushLine() {
  return <p>{usePush().state}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (document as { visibilityState?: unknown }).visibilityState;
});

test("notifications turned off in the device's settings show as blocked on coming back to the app", async () => {
  const notification = deviceWithPushOn();
  const { notifications } = stubApi({
    notifications: answers(notificationsResponse),
    savePushSubscription: answers({ ok: true }),
  });
  render(<PushLine />);
  expect(await screen.findByText("on")).toBeTruthy();

  notification.permission = "denied";
  await act(async () => comeBackToTheApp());

  expect(await screen.findByText("blocked")).toBeTruthy();
  // Seeing the permission needs no request: none was sent on coming back.
  expect(notifications).toHaveBeenCalledTimes(1);
});

test("coming back with notifications still allowed checks nothing again", async () => {
  deviceWithPushOn();
  const { notifications } = stubApi({
    notifications: answers(notificationsResponse),
    savePushSubscription: answers({ ok: true }),
  });
  render(<PushLine />);
  expect(await screen.findByText("on")).toBeTruthy();

  await act(async () => comeBackToTheApp());

  expect(screen.getByText("on")).toBeTruthy();
  expect(notifications).toHaveBeenCalledTimes(1);
});
