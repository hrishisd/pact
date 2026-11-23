// The page behind an open sheet doesn't scroll (docs/behaviour.md). iOS WebKit
// can send a drag on a sheet to an overflow scroller under it (bugs.webkit.org
// 117059); a scroller with overflow hidden isn't one, so it can't.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { PullToRefresh } from "./pull-to-refresh.tsx";
import { renderWithUser } from "./testing/render.tsx";
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
    <PullToRefresh pullable header={<h1>Today</h1>} mainClassName="scroll gut">
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
    expect(scrollAreaOverflow()).toBe("auto");
  });

  test("scrolls again once a screen with a sheet open goes away", async () => {
    const { user, unmount } = renderWithUser(
      <>
        <PullToRefresh pullable header={<h1>Today</h1>} mainClassName="scroll gut">
          <p>A tab</p>
        </PullToRefresh>
        <OpenSheetOnce />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(scrollAreaOverflow()).toBe("hidden");

    unmount();
    renderWithUser(
      <PullToRefresh pullable header={<h1>Today</h1>} mainClassName="scroll gut">
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
