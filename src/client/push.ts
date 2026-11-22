// This device's side of Web Push: whether it can get notifications, and
// subscribing it. Push is per device, so this lives in the browser; which kinds
// an account gets is the core's (Notifications.tsx shows those).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

export type PushState =
  /** Not known yet. */
  | "checking"
  /** On an iPhone or iPad in the browser: push works only from the Home Screen. */
  | "needs-install"
  | "can-turn-on"
  | "on"
  /** The user said no, and only the device's settings can change that. */
  | "blocked"
  | "unsupported";

export interface Push {
  state: PushState;
  /** Call straight from a tap: iPhone asks for permission only then. Rejects if subscribing fails. */
  turnOn: () => Promise<void>;
}

/**
 * Whether Safari's Share button and "Settings → Notifications" are the right
 * instructions here. iPadOS reports itself as a Mac, except that Macs have no touch screen.
 */
export function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** What to call this device in copy: "iPhone", "iPad" or "device". */
export function deviceName(): string {
  if (!isIos()) return "device";
  return /iPhone|iPod/.test(navigator.userAgent) ? "iPhone" : "iPad";
}

function isInstalled(): boolean {
  const { standalone } = navigator as Navigator & { standalone?: boolean };
  return standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function isSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Subscribes this device, or reuses its subscription, and tells the server.
 * Run on each open too: the server drops a subscription a push service says
 * has expired, and a browser may replace one at any time.
 */
async function subscribeThisDevice(): Promise<void> {
  const { vapidPublicKey } = await api.notifications();
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(vapidPublicKey.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an old key can't be used, or replaced without unsubscribing.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { endpoint, keys } = subscription.toJSON();
  const saved = await api.savePushSubscription({
    endpoint: endpoint ?? subscription.endpoint,
    p256dh: keys?.p256dh ?? "",
    auth: keys?.auth ?? "",
  });
  if (!saved.ok) throw new Error(saved.reason);
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (a === null || a.byteLength !== b.length) return false;
  return new Uint8Array(a).every((byte, i) => byte === b[i]);
}

async function checkPush(): Promise<PushState> {
  if (isIos() && !isInstalled()) return "needs-install";
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "default") return "can-turn-on";
  const existing = await currentSubscription();
  try {
    await subscribeThisDevice();
    return "on";
  } catch {
    // Offline, say: it's still on if the device already has a subscription. If not, offer to try again.
    return existing ? "on" : "can-turn-on";
  }
}

/** Checks on open, and again on coming back to the app: the user may have just changed Settings. */
export function usePush(): Push {
  const [state, setState] = useState<PushState>("checking");
  const stateRef = useRef(state);
  stateRef.current = state;

  const check = useCallback(() => {
    checkPush().then(setState, () => setState("can-turn-on"));
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => {
      // Turned on, it can still have been turned off in Settings meanwhile: the permission says so without a request.
      if (document.visibilityState !== "visible") return;
      if (stateRef.current !== "on" || Notification.permission !== "granted") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  const turnOn = useCallback(async () => {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await subscribeThisDevice();
      setState("on");
    } else {
      setState(permission === "denied" ? "blocked" : "can-turn-on");
    }
  }, []);

  return { state, turnOn };
}

/** For signing out: this device stops getting the account's pushes. Never stops the sign-out. */
export async function forgetThisDevice(): Promise<void> {
  try {
    if (!isSupported()) return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    // Whatever the server says: once unsubscribed, a push service reports the device as gone.
    await api.removePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  } catch {
    // Signing out still goes ahead.
  }
}
