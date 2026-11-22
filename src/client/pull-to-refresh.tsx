// Pull to refresh on the four tabs (.scratch/pull-to-refresh/spec.md): pulling
// down at the top of a tab and letting go past a threshold runs what the tab
// registered with `useRefreshOnPull`. While the finger pulls, the content
// follows it and a line under the header grows; once it lets go, the content
// springs back and the line becomes a moving bar until the refresh settles.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** How far the content must be pulled, in px after resistance, for letting go to refresh. */
export const PULL_THRESHOLD_PX = 64;
/** The furthest the content follows the finger, in px. */
const PULL_MAX_PX = 120;
/** How far the content moves for each px the finger moves. */
const RESISTANCE = 0.5;

type Refresh = () => Promise<unknown>;
/** Makes `refresh` what a pull does; the returned function undoes it, unless another took its place. */
type Register = (refresh: Refresh) => () => void;

const RegisterRefresh = createContext<Register>(() => () => {});

/** What a pull on this tab does. The bar runs until its promise settles, whether it resolves or rejects. */
export function useRefreshOnPull(refresh: Refresh): void {
  const register = useContext(RegisterRefresh);
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => register(() => latest.current()), [register]);
}

/**
 * The shell's header and scroll area. On a tab (`pullable`), the scroll area
 * has pull to refresh and the header its bar; a page opened from a tab has
 * neither. Touch only: a mouse never pulls.
 */
export function PullToRefresh({
  pullable,
  header,
  mainClassName,
  children,
}: {
  pullable: boolean;
  /** What goes inside the header. */
  header: ReactNode;
  mainClassName: string;
  children: ReactNode;
}) {
  const scroll = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const current = useRef<Refresh | null>(null);
  /** The refresh running now, if any. */
  const running = useRef<{ refresh: Refresh } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /** Ends `run`, unless a newer run has taken its place. */
  const end = useCallback((run: { refresh: Refresh }) => {
    if (running.current !== run) return;
    running.current = null;
    setRefreshing(false);
  }, []);

  const register = useCallback<Register>(
    (refresh) => {
      current.current = refresh;
      return () => {
        if (current.current === refresh) current.current = null;
        // A tab left while its refresh runs ends the run, so the bar stops
        // and the next tab can be pulled; its refresh may never settle.
        if (running.current?.refresh === refresh) end(running.current);
      };
    },
    [end],
  );

  const run = useCallback(async () => {
    const refresh = current.current;
    if (!refresh) return;
    const thisRun = { refresh };
    running.current = thisRun;
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // The tab shows its own failure (a "couldn't load" line); the bar just stops.
    } finally {
      end(thisRun);
    }
  }, [end]);

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
      if (refresh) void run();
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
  }, [pullable, run]);

  return (
    <RegisterRefresh.Provider value={register}>
      <header className="hdr gut">
        {header}
        {pullable && <div ref={bar} className={refreshing ? "pullbar working" : "pullbar"} aria-hidden="true" />}
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
