// The page behind an open sheet doesn't scroll (docs/behaviour.md). iOS WebKit
// can send a drag on a sheet to an overflow scroller under it (bugs.webkit.org
// 117059); a scroller with overflow hidden isn't one, so it can't.
//
// A sheet drags down to close, and slides away however it closes
// (.scratch/sheet-drag-to-close/spec.md). jsdom runs no transitions and lays
// nothing out: a test ends a slide with its transitionend (`endSheetSlides`),
// gives the sheet a height, and moves fake time between touches, which is
// what a touch's timeStamp reads.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PullToRefresh } from "./pull-to-refresh.tsx";
import { CLOSE_SHARE, DRAG_CLAIM_PX, EXIT_FALLBACK_MS, FLICK_PX_PER_MS, UP_MAX_PX } from "./sheet-motion.ts";
import { endSheetSlides, renderWithUser } from "./testing/render.tsx";
import { Sheet } from "./ui.tsx";

// The app's own stylesheet, so the test reads the scroll area's overflow as the app sets it.
beforeEach(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
  document.head.append(style);
  return () => style.remove();
});

/** The tab's scroll area's overflow: "auto" while it scrolls, "hidden" while it's held still. */
const scrollAreaOverflow = () => getComputedStyle(screen.getByRole("main")).overflow;

/** A tab with two sheets, each opened and closed by its own button. */
function TabWithSheets() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <PullToRefresh pullable timezone="America/New_York" header={<h1>Today</h1>} mainClassName="scroll gut">
      <button onClick={() => setFirst(true)}>Open the first</button>
      <button onClick={() => setSecond(true)}>Open the second</button>
      {first && (
        <Sheet title="First" closeLabel="Close the first" onClose={() => setFirst(false)}>
          <button onClick={() => setSecond(true)}>Open the second</button>
        </Sheet>
      )}
      {second && (
        <Sheet title="Second" closeLabel="Close the second" onClose={() => setSecond(false)}>
          <p>The second sheet</p>
        </Sheet>
      )}
    </PullToRefresh>
  );
}

describe("the page behind an open sheet", () => {
  test("doesn't scroll until the last open sheet closes", async () => {
    const { user } = renderWithUser(<TabWithSheets />);
    expect(scrollAreaOverflow()).toBe("auto");

    await user.click(screen.getByRole("button", { name: "Open the first" }));
    expect(scrollAreaOverflow()).toBe("hidden");

    await user.click(screen.getAllByRole("button", { name: "Open the second" }).at(-1)!);
    await user.click(screen.getByRole("button", { name: "Close the first" }));
    expect(screen.getByRole("dialog", { name: "Second" })).toBeTruthy();
    expect(scrollAreaOverflow()).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Close the second" }));
    // Still while they slide away.
    expect(scrollAreaOverflow()).toBe("hidden");
    endSheetSlides();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scrollAreaOverflow()).toBe("auto");
  });

  test("stays still while a sheet dragged away slides off", () => {
    vi.useFakeTimers();
    render(<TabWithSheets />);
    fireEvent.click(screen.getByRole("button", { name: "Open the first" }));
    dragDown(sheetOf(), CLOSE_SHARE * SHEET_HEIGHT + 20, 1000);
    expect(scrollAreaOverflow()).toBe("hidden");
    endSheetSlides();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scrollAreaOverflow()).toBe("auto");
  });

  test("scrolls again once a screen with a sheet open goes away", async () => {
    const { user, unmount } = renderWithUser(
      <>
        <PullToRefresh pullable timezone="America/New_York" header={<h1>Today</h1>} mainClassName="scroll gut">
          <p>A tab</p>
        </PullToRefresh>
        <OpenSheetOnce />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(scrollAreaOverflow()).toBe("hidden");

    unmount();
    renderWithUser(
      <PullToRefresh pullable timezone="America/New_York" header={<h1>Today</h1>} mainClassName="scroll gut">
        <p>The next screen</p>
      </PullToRefresh>,
    );
    expect(scrollAreaOverflow()).toBe("auto");
  });
});

/** A button that opens a sheet with no way to close it but going away. */
function OpenSheetOnce() {
  const [open, setOpen] = useState(false);
  return open ? (
    <Sheet title="Open sheet" onClose={() => undefined}>
      <p>Open</p>
    </Sheet>
  ) : (
    <button onClick={() => setOpen(true)}>Open</button>
  );
}

/** The sheets' height in these tests: jsdom lays nothing out. */
const SHEET_HEIGHT = 600;

/** The open sheet, given its height. */
function sheetOf(): HTMLElement {
  const sheet = screen.getAllByRole("dialog").at(-1)!;
  Object.defineProperty(sheet, "offsetHeight", { value: SHEET_HEIGHT, configurable: true });
  return sheet;
}

/** How far the sheet is moved now, in px: 0 at rest. */
const moved = (sheet: HTMLElement) => Number(/translateY\((-?[\d.]+)px\)/.exec(sheet.style.transform)?.[1] ?? 0);

/** Fake time moves on `ms`, which the next touch's timeStamp reads. */
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** A finger down at 100 px on `at`. */
const fingerDown = (at: Element) => fireEvent.touchStart(at, { touches: [{ clientX: 50, clientY: 100 }] });
/** The finger moved to `dy` px below where it went down; false if the move was claimed by the drag. */
const fingerTo = (at: Element, dy: number, dx = 0) =>
  fireEvent.touchMove(at, { touches: [{ clientX: 50 + dx, clientY: 100 + dy }] });
const fingerUp = (at: Element) => fireEvent.touchEnd(at, { touches: [] });

/** A finger down on `at`, moved `finger` px down in ten even steps over `ms`, then lifted. */
function dragDown(at: Element, finger: number, ms: number) {
  fingerDown(at);
  for (let step = 1; step <= 10; step++) {
    wait(ms / 10);
    fingerTo(at, (finger * step) / 10);
  }
  fingerUp(at);
}

/** A sheet with a text field and a button, open until it closes, with `onClose` told each time. */
function OneSheet({ onClose, stays = false }: { onClose: () => void; stays?: boolean }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <Sheet
      title="Name"
      closeLabel="Cancel"
      onClose={() => {
        onClose();
        if (!stays) setOpen(false);
      }}
    >
      <input aria-label="Name" />
      <button onClick={onClose}>Inside</button>
    </Sheet>
  ) : (
    <p>Closed</p>
  );
}

function openOne(stays = false) {
  const onClose = vi.fn();
  render(<OneSheet onClose={onClose} stays={stays} />);
  return { onClose, sheet: sheetOf() };
}

describe("dragging a sheet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test("follows the finger down, and let go far enough down slides away, then closes", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, 120);
    expect(moved(sheet)).toBe(120);
    wait(900);
    fingerTo(sheet, CLOSE_SHARE * SHEET_HEIGHT + 20);
    wait(100);
    fingerUp(sheet);

    expect(sheet.style.transform).toBe("translateY(100%)");
    expect(onClose).not.toHaveBeenCalled();
    endSheetSlides();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("closes when the slide's end never comes", () => {
    const { onClose, sheet } = openOne();
    dragDown(sheet, CLOSE_SHARE * SHEET_HEIGHT + 20, 1000);
    wait(EXIT_FALLBACK_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    wait(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("let go short and slow, springs back and stays open", () => {
    const { onClose, sheet } = openOne();
    dragDown(sheet, CLOSE_SHARE * SHEET_HEIGHT - 20, 1000);
    expect(moved(sheet)).toBe(0);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a fast flick closes it however short", () => {
    const { onClose, sheet } = openOne();
    // 60 px in 50 ms: 1.2 px per ms.
    dragDown(sheet, 60, 50);
    expect(60 / 50).toBeGreaterThan(FLICK_PX_PER_MS);
    endSheetSlides();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a finger held still before letting go is no flick", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(20);
    fingerTo(sheet, 60);
    wait(500);
    fingerUp(sheet);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a cancelled touch springs back", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(500);
    fingerTo(sheet, SHEET_HEIGHT / 2);
    fireEvent.touchCancel(sheet, { touches: [] });
    expect(moved(sheet)).toBe(0);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("dragged up, moves only a little", () => {
    const { sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, DRAG_CLAIM_PX);
    wait(100);
    fingerTo(sheet, -300);
    expect(moved(sheet)).toBeLessThan(0);
    expect(moved(sheet)).toBeGreaterThanOrEqual(-UP_MAX_PX);
  });

  test("scrolled down, a drag down scrolls the sheet instead of moving it", () => {
    const { onClose, sheet } = openOne();
    Object.defineProperty(sheet, "scrollTop", { value: 50, configurable: true });
    fingerDown(sheet);
    wait(100);
    expect(fingerTo(sheet, 300)).toBe(true);
    expect(moved(sheet)).toBe(0);
    fingerUp(sheet);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a finger that first moves up is a scroll, even if it then comes down", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, -10);
    wait(100);
    expect(fingerTo(sheet, SHEET_HEIGHT / 2)).toBe(true);
    expect(moved(sheet)).toBe(0);
    fingerUp(sheet);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a finger that first moves sideways isn't a drag", () => {
    const { sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, 2, 20);
    wait(100);
    expect(fingerTo(sheet, 200, 20)).toBe(true);
    expect(moved(sheet)).toBe(0);
  });

  test("a second finger ends a drag", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, SHEET_HEIGHT / 2);
    fireEvent.touchStart(sheet, {
      touches: [
        { clientX: 50, clientY: 100 + SHEET_HEIGHT / 2 },
        { clientX: 90, clientY: 100 },
      ],
    });
    expect(moved(sheet)).toBe(0);
    fingerUp(sheet);
    wait(EXIT_FALLBACK_MS);
    expect(onClose).not.toHaveBeenCalled();
  });

  // The move is held from the browser all the same, so iOS doesn't start a bounce
  // it would then not let a drag stop.
  test("a few px down is still a tap: the sheet stays and the browser doesn't bounce it", () => {
    const { onClose, sheet } = openOne(true);
    const inside = screen.getByRole("button", { name: "Inside" });
    fingerDown(inside);
    expect(fingerTo(inside, DRAG_CLAIM_PX - 1)).toBe(false);
    expect(moved(sheet)).toBe(0);
    fingerUp(inside);
    fireEvent.click(inside);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The button's own onClose, not a slide.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("a drag can start on a button in the sheet", () => {
    const { sheet } = openOne();
    const inside = screen.getByRole("button", { name: "Inside" });
    fingerDown(inside);
    wait(100);
    expect(fingerTo(inside, 100)).toBe(false);
    expect(moved(sheet)).toBe(100);
  });

  test("a drag in the field being typed in is left to the field", () => {
    const { sheet } = openOne();
    const field = screen.getByRole("textbox", { name: "Name" });
    field.focus();
    fingerDown(field);
    wait(100);
    expect(fingerTo(field, 200)).toBe(true);
    expect(moved(sheet)).toBe(0);
  });
});

describe("closing a sheet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([
    ["its close link", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
    ["a tap outside it", () => fireEvent.click(screen.getByRole("dialog").parentElement!)],
    ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
  ])("%s slides it away, then closes it", (_, close) => {
    const { onClose, sheet } = openOne();
    close();
    expect(sheet.style.transform).toBe("translateY(100%)");
    expect(sheet.parentElement!.style.backgroundColor).toBe("transparent");
    expect(onClose).not.toHaveBeenCalled();
    endSheetSlides();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  test("closes once, however often it's asked while it slides away", () => {
    const { onClose, sheet } = openOne(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(sheet.parentElement!);
    fireEvent.keyDown(document.body, { key: "Escape" });
    dragDown(sheet, SHEET_HEIGHT / 2, 100);
    endSheetSlides();
    wait(EXIT_FALLBACK_MS);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closed some other way mid-drag, it slides away rather than following the finger", () => {
    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(100);
    fingerTo(sheet, 100);
    fireEvent.keyDown(document.body, { key: "Escape" });
    wait(100);
    fingerTo(sheet, 150);
    fingerUp(sheet);
    expect(sheet.style.transform).toBe("translateY(100%)");
    endSheetSlides();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("under Reduce Motion it closes at once, though it still follows a finger", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    const first = openOne();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    const { onClose, sheet } = openOne();
    fingerDown(sheet);
    wait(500);
    fingerTo(sheet, CLOSE_SHARE * SHEET_HEIGHT + 20);
    expect(moved(sheet)).toBe(CLOSE_SHARE * SHEET_HEIGHT + 20);
    wait(500);
    fingerUp(sheet);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a mouse can't drag it", () => {
    const { sheet } = openOne();
    fireEvent.mouseDown(sheet, { clientX: 50, clientY: 100 });
    fireEvent.mouseMove(sheet, { clientX: 50, clientY: 400 });
    fireEvent.mouseUp(sheet, { clientX: 50, clientY: 400 });
    expect(moved(sheet)).toBe(0);
  });
});
