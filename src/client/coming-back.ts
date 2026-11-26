// Coming back to the front (.scratch/pull-to-refresh/issues/04-refresh-on-coming-back-to-the-front.md):
// iOS often keeps Pact in memory while other apps are used, so coming back
// shows what was there when the app was left. The shown screen reloads by
// itself when what it shows may be old: on coming back, when it last loaded
// more than RELOAD_AFTER_MS ago or on another day in the profile's timezone,
// and at local midnight while the app is in front. The one
// `visibilitychange` listener here runs those reloads first, then anything
// else that runs on every return (`onComingBack`), so that can join a reload
// already started.

import { useEffect, useRef } from "react";
import { partsIn } from "../shared/format.ts";
import { dateIn } from "./format.ts";
import { anySheetOpen, onLastSheetClosed } from "./ui.tsx";

/** How long ago the shown screen may have loaded, on coming back to the front, before it reloads. */
export const RELOAD_AFTER_MS = 10 * 60_000;
/**
 * The longest the wait for midnight goes before working it out again, so a
 * daylight saving change before midnight can't make it late.
 */
const MIDNIGHT_RECHECK_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The reloads' checks (`useReloadWhenDue`), which run before the other listeners. */
const reloadChecks = new Set<() => void>();
/** What runs on every return (`onComingBack`). */
const listeners = new Set<() => void>();

function cameBack(): void {
  if (document.visibilityState !== "visible") return;
  for (const listener of [...reloadChecks, ...listeners]) listener();
}

function listen(set: Set<() => void>, listener: () => void): () => void {
  if (reloadChecks.size + listeners.size === 0) document.addEventListener("visibilitychange", cameBack);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (reloadChecks.size + listeners.size === 0) document.removeEventListener("visibilitychange", cameBack);
  };
}

/**
 * Calls `listener` each time the app comes back to the front, after the
 * shown screen's reload has started if it was due, until the returned
 * function stops it.
 */
export function onComingBack(listener: () => void): () => void {
  return listen(listeners, listener);
}

/**
 * Calls `reload` when the shown screen is due a reload: on coming back to the
 * front, if it last loaded (`loadedAt()`, ms) more than RELOAD_AFTER_MS ago
 * or on another day in `timezone` (the profile's); and, while the app is in
 * front, at that timezone's midnight. While any sheet is open, it waits, and
 * calls `reload` when the last one closes, if the screen is still due.
 * `loadedAt()` answers null when the shown screen has nothing to reload (a
 * form).
 */
export function useReloadWhenDue(loadedAt: () => number | null, timezone: string, reload: () => void): void {
  const latest = useRef({ loadedAt, reload });
  latest.current = { loadedAt, reload };
  useEffect(() => {
    const newDay = (at: number, now: number) => dateIn(at, timezone) !== dateIn(now, timezone);
    const old = (at: number, now: number) => now - at > RELOAD_AFTER_MS || newDay(at, now);
    /** A reload came due while a sheet was open. */
    let waiting = false;
    const reloadIf = (due: (at: number, now: number) => boolean) => {
      const at = latest.current.loadedAt();
      if (at === null || document.visibilityState === "hidden" || !due(at, Date.now())) return;
      if (anySheetOpen()) waiting = true;
      else latest.current.reload();
    };
    let timer: number | undefined;
    // Worked out afresh on each return too: a timer can't be trusted after iOS has frozen the app.
    const waitForMidnight = () => {
      window.clearTimeout(timer);
      const wait = Math.min(MIDNIGHT_RECHECK_MS, msToMidnight(Date.now(), timezone));
      timer = window.setTimeout(() => {
        reloadIf(newDay);
        waitForMidnight();
      }, wait);
    };
    waitForMidnight();
    const stopListening = listen(reloadChecks, () => {
      reloadIf(old);
      waitForMidnight();
    });
    const stopWaiting = onLastSheetClosed(() => {
      if (!waiting) return;
      waiting = false;
      reloadIf(old);
    });
    return () => {
      window.clearTimeout(timer);
      stopListening();
      stopWaiting();
    };
  }, [timezone]);
}

/** How long from `now` (ms) to the next midnight on the wall clock in `timeZone`, ignoring daylight saving changes. */
function msToMidnight(now: number, timeZone: string): number {
  const part = partsIn(now, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const seconds = (Number(part("hour")) * 60 + Number(part("minute"))) * 60 + Number(part("second"));
  return DAY_MS - seconds * 1000 - (now % 1000);
}
