// How a sheet moves (.scratch/sheet-drag-to-close/spec.md): dragged down, it
// follows the finger, and letting go far enough down or with a flick closes
// it, as iOS's own sheets do; otherwise it springs back. However it closes
// (a drag, its close link, a tap outside it, Escape), it slides down while the
// dimming fades, and only then is it told to close. Under Reduce Motion it
// closes at once, though it still follows a finger. Touch only, like pull to
// refresh: a mouse never drags it.

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** How far the finger must move down, in px, before a touch drags the sheet rather than taps or scrolls in it. */
export const DRAG_CLAIM_PX = 6;
/** Letting go further down than this share of the sheet's height closes it. */
export const CLOSE_SHARE = 1 / 3;
/** Letting go while moving down faster than this, in px per ms, closes it however short the drag. */
export const FLICK_PX_PER_MS = 0.5;
/** The release speed is measured over about this many ms of movement before letting go. */
export const FLICK_WINDOW_MS = 100;
/** How far the sheet moves up for each px the finger moves up past where it rests. */
const UP_RESISTANCE = 0.15;
/** The furthest the sheet moves up past where it rests, in px (the sheet's box-shadow in styles.css fills the gap below it). */
export const UP_MAX_PX = 12;
/** How long a sheet let go short of closing takes to spring back, in ms. */
const SPRING_MS = 250;
/** How long the slide down and the dimming's fade take, in ms. */
export const EXIT_MS = 200;
/** Closing waits at most this long for the slide to end, in case the browser never says it ended. */
export const EXIT_FALLBACK_MS = EXIT_MS + 100;

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Drag to close on `sheet`, inside `overlay`, the dimmed area. Returns the
 * sheet's own close: it slides the sheet away, then calls `onClose`, once
 * however often it's called. `onClose` must take the sheet away; a sheet
 * that stayed would sit off screen behind a clear overlay.
 */
export function useSheetMotion(
  sheet: RefObject<HTMLElement | null>,
  overlay: RefObject<HTMLElement | null>,
  onClose: () => void,
): () => void {
  const latest = useRef(onClose);
  latest.current = onClose;
  /** Set once the sheet starts closing, so it closes once. */
  const closing = useRef(false);
  /** Stops waiting for the slide to end, if the sheet goes away first. */
  const stopWaiting = useRef<() => void>(() => {});

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const box = sheet.current;
    const dim = overlay.current;
    if (!box || !dim || prefersReducedMotion()) return latest.current();
    const finish = () => {
      stopWaiting.current();
      latest.current();
    };
    const ended = (e: TransitionEvent) => e.target === box && finish();
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    box.addEventListener("transitionend", ended);
    stopWaiting.current = () => {
      window.clearTimeout(timer);
      box.removeEventListener("transitionend", ended);
    };
    // From wherever it is now, a finger's drag included.
    box.style.transition = `transform ${EXIT_MS}ms ease-in`;
    box.style.transform = "translateY(100%)";
    dim.style.transition = `background-color ${EXIT_MS}ms linear`;
    dim.style.backgroundColor = "transparent";
  }, [sheet, overlay]);

  useEffect(() => () => stopWaiting.current(), []);

  useEffect(() => {
    const box = sheet.current;
    if (!box) return;
    /** Where the finger went down, while it may still drag the sheet; null otherwise. */
    let start: { x: number; y: number } | null = null;
    /** Whether the finger has moved far enough down to be dragging the sheet. */
    let dragging = false;
    /** How far the sheet is moved down now, in px (up is negative). */
    let moved = 0;
    /** The finger's recent heights and times, to tell a flick at the end. */
    let trail: { y: number; t: number }[] = [];

    const paint = (px: number, springBack: boolean) => {
      moved = px;
      box.style.transition = springBack ? `transform ${SPRING_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none";
      box.style.transform = px === 0 ? "" : `translateY(${px}px)`;
    };
    const stop = () => {
      start = null;
      dragging = false;
      trail = [];
    };
    const springBack = () => {
      stop();
      paint(0, true);
    };

    const down = (e: TouchEvent) => {
      // A second finger ends a drag.
      if (dragging) return springBack();
      stop();
      const touch = e.touches[0];
      if (closing.current || e.touches.length !== 1 || !touch) return;
      // Scrolled down, it's a scroll; in the field being typed in, it's the caret's.
      if (!atTop(e.target, box) || inFocusedField(e.target)) return;
      start = { x: touch.clientX, y: touch.clientY };
      trail = [{ y: touch.clientY, t: e.timeStamp }];
    };
    const move = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Closed some other way mid-drag, the slide away moves it now.
      if (closing.current) return stop();
      if (start === null || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!dragging) {
        // Up first is a scroll; sideways first is the sheet's own swipe or scroller's.
        if (dy < 0 || Math.abs(dx) > Math.max(dy, DRAG_CLAIM_PX / 2)) return stop();
        // Too little yet to tell from a tap.
        if (dy < DRAG_CLAIM_PX) return;
        dragging = true;
      }
      // The drag, not the browser, moves the sheet now.
      if (e.cancelable) e.preventDefault();
      trail.push({ y: touch.clientY, t: e.timeStamp });
      while (trail.length > 2 && trail[1]!.t <= e.timeStamp - FLICK_WINDOW_MS) trail.shift();
      paint(dy >= 0 ? dy : -Math.min(UP_MAX_PX, -dy * UP_RESISTANCE), false);
    };
    const up = (e: TouchEvent) => {
      if (start === null || closing.current) return stop();
      const wasDragging = dragging;
      const speed = releaseSpeed(trail, e.timeStamp);
      stop();
      if (!wasDragging) return;
      const far = moved > box.offsetHeight * CLOSE_SHARE;
      if (e.type === "touchend" && (far || speed > FLICK_PX_PER_MS)) close();
      else paint(0, true);
    };

    box.addEventListener("touchstart", down, { passive: true });
    // Not passive: a drag stops the browser scrolling or bouncing the sheet.
    box.addEventListener("touchmove", move, { passive: false });
    box.addEventListener("touchend", up);
    box.addEventListener("touchcancel", up);
    return () => {
      box.removeEventListener("touchstart", down);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", up);
      box.removeEventListener("touchcancel", up);
    };
  }, [sheet, close]);

  return close;
}

/**
 * Whether everything from `target` out to `sheet` is scrolled to its top, so
 * a drag down moves the sheet rather than scrolling back up. iOS's bounce at
 * the top reads below 0.
 */
function atTop(target: EventTarget | null, sheet: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
    if (el === sheet) return true;
  }
  return true;
}

/** Whether `target` is in the text field being typed in, where a drag moves the caret or selection. */
function inFocusedField(target: EventTarget | null): boolean {
  const field = target instanceof Element ? target.closest("input, textarea") : null;
  return field !== null && field === document.activeElement;
}

/**
 * How fast the finger was moving down when it let go at `now`, in px per ms,
 * over its last `FLICK_WINDOW_MS` or so: from the last point at least that
 * old (or the first) to the last. A finger held still before letting go reads near 0.
 */
function releaseSpeed(trail: { y: number; t: number }[], now: number): number {
  const first = trail[0];
  const last = trail.at(-1);
  if (!first || !last || now <= first.t) return 0;
  return (last.y - first.y) / (now - first.t);
}
