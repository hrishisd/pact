// Coming back to the front (.scratch/pull-to-refresh/issues/04-refresh-on-coming-back-to-the-front.md):
// iOS often keeps Pact in memory while other apps are used, so coming back
// shows what was there when the app was left. What may be old reloads by
// itself (`useReloadWhenDue`): on coming back, when it last loaded more than
// RELOAD_AFTER_MS ago or on another day in the profile's timezone, and at
// local midnight while the app is in front. On a return when the shown
// screen isn't due a reload, what runs on every return (`onComingBack`) runs
// instead.

import { useCallback, useEffect, useRef } from "react";
import { partsIn } from "../shared/format.ts";
import { dateIn } from "./format.ts";
import { anySheetOpen, onLastSheetClosed } from "./ui.tsx";

/** How long ago something shown may have loaded, on coming back to the front, before it reloads. */
export const RELOAD_AFTER_MS = 10 * 60_000;
/**
 * The longest the wait for midnight goes before working it out again, so a
 * daylight saving change before midnight can't make it late.
 */
const MIDNIGHT_RECHECK_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Whether what loaded at `at` (ms) is due a reload at `now`, in `timezone`. */
type Due = (at: number, now: number, timezone: string) => boolean;
const newDay: Due = (at, now, timezone) => dateIn(at, timezone) !== dateIn(now, timezone);
const old: Due = (at, now, timezone) => now - at > RELOAD_AFTER_MS || newDay(at, now, timezone);

/** The reloads' checks on coming back (`useReloadWhenDue`); each answers whether the shown screen's came due. */
const reloadChecks = new Set<() => boolean>();
/** What runs on every return when the shown screen isn't due a reload (`onComingBack`). */
const listeners = new Set<() => void>();

function cameBack(): void {
  if (document.visibilityState !== "visible") return;
  const shownScreenDue = [...reloadChecks].map((check) => check()).includes(true);
  if (!shownScreenDue) for (const listener of [...listeners]) listener();
}

function listen<T>(set: Set<T>, listener: T): () => void {
  if (reloadChecks.size + listeners.size === 0) document.addEventListener("visibilitychange", cameBack);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (reloadChecks.size + listeners.size === 0) document.removeEventListener("visibilitychange", cameBack);
  };
}

/**
 * Calls `listener` each time the app comes back to the front, unless the
 * shown screen is due a reload then, until the returned function stops it.
 * That reload does what a listener would (Today's check of Oura and
 * AnkiWeb), once a sheet open closes.
 */
export function onComingBack(listener: () => void): () => void {
  return listen(listeners, listener);
}

/**
 * Calls `reload` when what it reloads is due: on coming back to the front, if
 * it last loaded (`loadedAt()`, ms) more than RELOAD_AFTER_MS ago or on
 * another day in `timezone` (the profile's); and, while the app is in front,
 * at that timezone's midnight. While any sheet is open, it waits, and calls
 * `reload` when the last one closes, if still due. `loadedAt()` answers null
 * when there is nothing to reload (a form). With `shownScreen`, a return on
 * which it is due, now or once a sheet closes, runs no `onComingBack`
 * listener. Returns a check that calls `reload` if it is due now, for when it
 * may have come due unheard (while a refresh ran).
 */
export function useReloadWhenDue(
  loadedAt: () => number | null,
  timezone: string,
  reload: () => void,
  { shownScreen = false }: { shownScreen?: boolean } = {},
): () => void {
  const latest = useRef({ loadedAt, timezone, reload, shownScreen });
  latest.current = { loadedAt, timezone, reload, shownScreen };
  /** It came due while a sheet was open. */
  const waiting = useRef(false);
  /** Reloads if `due`, or waits for the sheets to close; answers whether it was due. */
  const reloadIf = useCallback((due: Due): boolean => {
    const { loadedAt, timezone, reload } = latest.current;
    const at = loadedAt();
    if (at === null || document.visibilityState === "hidden" || !due(at, Date.now(), timezone)) return false;
    if (anySheetOpen()) waiting.current = true;
    else reload();
    return true;
  }, []);

  useEffect(() => {
    const stopListening = listen(reloadChecks, () => reloadIf(old) && latest.current.shownScreen);
    const stopWaiting = onLastSheetClosed(() => {
      if (!waiting.current) return;
      waiting.current = false;
      reloadIf(old);
    });
    return () => {
      stopListening();
      stopWaiting();
    };
  }, []);

  useEffect(() => {
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
    document.addEventListener("visibilitychange", waitForMidnight);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", waitForMidnight);
    };
  }, [timezone]);

  return useCallback(() => void reloadIf(old), []);
}

/** How long from `now` (ms) to the next midnight on the wall clock in `timeZone`, ignoring daylight saving changes. */
function msToMidnight(now: number, timeZone: string): number {
  const part = partsIn(now, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const seconds = (Number(part("hour")) * 60 + Number(part("minute"))) * 60 + Number(part("second"));
  return DAY_MS - seconds * 1000 - (now % 1000);
}
