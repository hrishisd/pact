import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import type { LedgersResponse, PactsResponse, ReviewQueueResponse, WaitingOnReplyResponse } from "../shared/api.ts";
import { Ledgers } from "./Ledgers.tsx";
import { Pacts } from "./Pacts.tsx";
import { PULL_THRESHOLD_PX, PullToRefresh, useRefreshOnPull } from "./pull-to-refresh.tsx";
import { Review } from "./Review.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

/** Whether the tab is busy refreshing: "true" while the bar runs, null otherwise. */
const busy = () => screen.getByRole("main").getAttribute("aria-busy");

/** The finger's travel that pulls the content `px` far, after resistance. */
const fingerFor = (px: number) => px * 2;

/** Drags a finger down `by` px from the top of the tab's scroll area and lets go. */
function pull(by: number, scrollArea = screen.getByRole("main")) {
  fireEvent.touchStart(scrollArea, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(scrollArea, { touches: [{ clientY: 100 + by / 2 }] });
  fireEvent.touchMove(scrollArea, { touches: [{ clientY: 100 + by }] });
  fireEvent.touchEnd(scrollArea, { touches: [] });
}

/** A tab whose refresh is `refresh`. */
function Tab({ refresh }: { refresh: () => Promise<unknown> }) {
  useRefreshOnPull(refresh);
  return <p>A tab</p>;
}

function shell(refresh: () => Promise<unknown>, pullable = true) {
  return renderWithUser(
    <PullToRefresh pullable={pullable} header={<h1>Today</h1>} mainClassName="scroll gut">
      <Tab refresh={refresh} />
    </PullToRefresh>,
  );
}

/** A refresh the test finishes by calling `done`. */
function heldRefresh() {
  let done = () => {};
  const refresh = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
  return { refresh, done: () => done() };
}

describe("the pull", () => {
  test("a pull past the threshold runs the tab's refresh, busy until it settles", async () => {
    const { refresh, done } = heldRefresh();
    shell(refresh);

    pull(fingerFor(PULL_THRESHOLD_PX));

    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(busy()).toBe("true"));
    done();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a refresh that fails still ends the bar", async () => {
    shell(() => Promise.reject(new Error("offline")));
    pull(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a pull short of the threshold refreshes nothing", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    pull(fingerFor(PULL_THRESHOLD_PX - 1));
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a pull that starts below the top is a scroll", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    const main = screen.getByRole("main");
    Object.defineProperty(main, "scrollTop", { value: 200, configurable: true });
    pull(fingerFor(PULL_THRESHOLD_PX + 20));
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a finger that first moves up is a scroll, even if it then comes down", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    const main = screen.getByRole("main");
    fireEvent.touchStart(main, { touches: [{ clientY: 300 }] });
    fireEvent.touchMove(main, { touches: [{ clientY: 290 }] });
    fireEvent.touchMove(main, { touches: [{ clientY: 300 + fingerFor(PULL_THRESHOLD_PX + 20) }] });
    fireEvent.touchEnd(main, { touches: [] });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a cancelled touch springs back without refreshing", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    const main = screen.getByRole("main");
    fireEvent.touchStart(main, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(main, { touches: [{ clientY: 100 + fingerFor(PULL_THRESHOLD_PX + 20) }] });
    fireEvent.touchCancel(main, { touches: [] });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a pull while a refresh runs is ignored", async () => {
    const { refresh, done } = heldRefresh();
    shell(refresh);
    pull(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBe("true"));
    pull(fingerFor(PULL_THRESHOLD_PX));
    expect(refresh).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(busy()).toBeNull());
    pull(fingerFor(PULL_THRESHOLD_PX));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("a page opened from a tab has no pull", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh, false);
    pull(fingerFor(PULL_THRESHOLD_PX + 20));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("each tab's refresh", () => {
  const inShell = (tab: ReactElement) =>
    renderWithUser(
      <PullToRefresh pullable header={<h1>Tab</h1>} mainClassName="scroll gut">
        {tab}
      </PullToRefresh>,
    );

  test("Pacts reloads its pacts", async () => {
    const spies = stubApi({ pacts: answers<PactsResponse>([]) });
    inShell(<Pacts onOpenPact={() => {}} onCreate={() => {}} />);
    await screen.findByText("No pacts yet");
    pull(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.pacts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("Review reloads its queue and the list waiting on a reply", async () => {
    const spies = stubApi({
      reviewQueue: answers<ReviewQueueResponse>([]),
      waitingOnReply: answers<WaitingOnReplyResponse>([]),
    });
    inShell(<Review timezone="America/New_York" onQueue={() => {}} />);
    await waitFor(() => expect(spies.waitingOnReply).toHaveBeenCalledTimes(1));
    pull(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.reviewQueue).toHaveBeenCalledTimes(2));
    expect(spies.waitingOnReply).toHaveBeenCalledTimes(2);
  });

  test("Ledgers reloads its ledgers", async () => {
    const spies = stubApi({ ledgers: answers<LedgersResponse>([]) });
    inShell(<Ledgers timezone="America/New_York" onOpenLedger={() => {}} />);
    await screen.findByText("No ledgers yet");
    pull(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.ledgers).toHaveBeenCalledTimes(2));
  });
});
