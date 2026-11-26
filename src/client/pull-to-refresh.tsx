// Pull to refresh on the four tabs (.scratch/pull-to-refresh/spec.md): pulling
// down at the top of a tab and letting go past a threshold runs what the tab
// registered with `useRefresh`. While the finger pulls, the content follows
// it and a line under the header grows; once it lets go, the content springs
// back and the line becomes a moving bar until the refresh settles.
//
// The same refresh, on a tab or a page that shows what it loads, runs by
// itself on coming back to the front and at midnight when the screen is due
// a reload (coming-back.ts), with the same bar: quietly, trying once more if
// it fails.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useReloadWhenDue } from "./coming-back.ts";

/** How far the content must be pulled, in px after resistance, for letting go to refresh. */
export const PULL_THRESHOLD_PX = 64;
/** The furthest the content follows the finger, in px. */
const PULL_MAX_PX = 120;
/** How far the content moves for each px the finger moves. */
const RESISTANCE = 0.5;
/** How long a refresh that ran by itself and failed waits to try again, unless the browser says it's online first. */
export const RETRY_AFTER_MS = 3000;

/**
 * How a refresh runs. `pulled`: by a pull, not by itself. `quiet`: if it
 * fails, the screen shows nothing, so it can be tried again (`useLoad`'s
 * `reload({ quiet })`, ui.tsx).
 */
export interface RefreshRun {
  pulled: boolean;
  quiet: boolean;
}
/** Resolves to whether it loaded. */
type Refresh = (run: RefreshRun) => Promise<boolean>;
/** Makes `refresh` the shown screen's; the returned function undoes it, unless another took its place. */
type Register = (refresh: Refresh) => () => void;

const RegisterRefresh = createContext<Register>(() => () => {});

/**
 * What refreshes this screen: a pull on a tab, and coming back to the front
 * or midnight on a tab or a page that shows what it loads. Its promise
 * settling ends the bar. A screen that registers one counts as loaded when it
 * opens, and again from when a try of its refresh starts that loads; a form
 * registers none, so it never reloads by itself.
 */
export function useRefresh(refresh: Refresh): void {
  const register = useContext(RegisterRefresh);
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => register((run) => latest.current(run)), [register]);
}

/**
 * The shell's header and scroll area. On a tab (`pullable`), the scroll area
 * has pull to refresh; a page opened from a tab can't be pulled. Either
 * refreshes by itself when due on coming back to the front, or at midnight
 * in `timezone` (the profile's), and the header's bar moves while any
 * refresh runs. One refresh runs at a time; one that comes due meanwhile
 * runs once it settles, if still due. Touch only: a mouse never pulls.
 */
export function PullToRefresh({
  pullable,
  timezone,
  header,
  mainClassName,
  children,
}: {
  pullable: boolean;
  timezone: string;
  /** What goes inside the header. */
  header: ReactNode;
  mainClassName: string;
  children: ReactNode;
}) {
  const scroll = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const current = useRef<Refresh | null>(null);
  /** When the shown screen last loaded (ms); null while it has no refresh. */
  const loadedAt = useRef<number | null>(null);
  /** The refresh running now, if any. */
  const running = useRef<{ refresh: Refresh } | null>(null);
  /** A refresh by itself came due while another ran. */
  const dueWhileRunning = useRef(false);
  /** Refreshes by itself if due now (`useReloadWhenDue`'s check). */
  const refreshIfDue = useRef(() => {});
  const [refreshing, setRefreshing] = useState(false);

  /** Ends `run`, unless a newer run has taken its place; then runs a refresh that came due meanwhile. */
  const end = useCallback((run: { refresh: Refresh }) => {
    if (running.current !== run) return;
    running.current = null;
    setRefreshing(false);
    if (!dueWhileRunning.current) return;
    dueWhileRunning.current = false;
    refreshIfDue.current();
  }, []);

  const register = useCallback<Register>(
    (refresh) => {
      current.current = refresh;
      loadedAt.current = Date.now();
      return () => {
        if (current.current === refresh) {
          current.current = null;
          loadedAt.current = null;
        }
        // A screen left while its refresh runs ends the run, so the bar stops
        // and the next tab can be pulled; its refresh may never settle.
        if (running.current?.refresh === refresh) end(running.current);
      };
    },
    [end],
  );

  /**
   * Runs the shown screen's refresh through `tries`, with the bar, unless a
   * refresh runs already. `tryOnce` runs it once and answers whether it
   * loaded; one that loads counts as a load from when it started, unless the
   * screen was left.
   */
  const run = useCallback(
    async (tries: (tryOnce: (run: RefreshRun) => Promise<boolean>, left: () => boolean) => Promise<unknown>) => {
      const refresh = current.current;
      if (!refresh || running.current) return;
      const thisRun = { refresh };
      running.current = thisRun;
      setRefreshing(true);
      const left = () => running.current !== thisRun;
      const tryOnce = async (how: RefreshRun) => {
        const startedAt = Date.now();
        const ok = await refresh(how);
        if (ok && !left()) loadedAt.current = startedAt;
        return ok;
      };
      try {
        await tries(tryOnce, left);
      } finally {
        end(thisRun);
      }
    },
    [end],
  );

  const pull = useCallback(() => run((tryOnce) => tryOnce({ pulled: true, quiet: false })), [run]);

  // Quiet at first: right after a phone wakes, its network often isn't ready.
  // The second try, once online or after RETRY_AFTER_MS, shows its failure.
  const refreshItself = useCallback(() => {
    if (running.current) {
      dueWhileRunning.current = true;
      return;
    }
    void run(async (tryOnce, left) => {
      if (await tryOnce({ pulled: false, quiet: true })) return;
      await onlineOrAfter(RETRY_AFTER_MS);
      if (!left()) await tryOnce({ pulled: false, quiet: false });
    });
  }, [run]);
  refreshIfDue.current = useReloadWhenDue(() => loadedAt.current, timezone, refreshItself, { shownScreen: true });

  useEffect(() => {
    const scroller = scroll.current;
    if (!pullable || !scroller) return;
    /** Where the finger started, while it may be pulling; null otherwise. */
    let startY: number | null = null;
    /** How far the content is pulled now, in px. */
    let pulled = 0;
    const paint = (px: number, springBack: boolean) => {
      pulled = px;
      if (content.current) {
        content.current.style.transform = px > 0 ? `translateY(${px}px)` : "";
        content.current.classList.toggle("springing", springBack);
      }
      if (bar.current) bar.current.style.width = `${Math.min(1, px / PULL_THRESHOLD_PX) * 100}%`;
    };
    const start = (e: TouchEvent) => {
      // Only from the top, one finger, and not while a refresh runs.
      startY =
        running.current !== null || e.touches.length !== 1 || scroller.scrollTop > 0 ? null : e.touches[0]!.clientY;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0]!.clientY - startY;
      if (pulled === 0 && dy <= 0) {
        // Moving up into the content is a scroll, not a pull.
        if (dy < 0) startY = null;
        return;
      }
      // The pull, not the browser, moves the content now.
      if (e.cancelable) e.preventDefault();
      paint(Math.min(PULL_MAX_PX, Math.max(0, dy) * RESISTANCE), false);
    };
    const end = (e: TouchEvent) => {
      if (startY === null) return;
      startY = null;
      const refresh = e.type === "touchend" && pulled >= PULL_THRESHOLD_PX;
      paint(0, true);
      if (refresh) void pull();
    };
    scroller.addEventListener("touchstart", start, { passive: true });
    // Not passive: a pull stops the browser scrolling or bouncing the page.
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", end);
    scroller.addEventListener("touchcancel", end);
    return () => {
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", end);
      paint(0, false);
    };
  }, [pullable, pull]);

  return (
    <RegisterRefresh.Provider value={register}>
      <header className="hdr gut">
        {header}
        <div ref={bar} className={refreshing ? "pullbar working" : "pullbar"} aria-hidden="true" />
      </header>
      <main ref={scroll} className={mainClassName} aria-busy={refreshing || undefined}>
        {pullable ? (
          <div ref={content} className="pullcontent">
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </RegisterRefresh.Provider>
  );
}

/** Resolves once the browser says it's online, or after `ms`, whichever comes first. */
function onlineOrAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}
