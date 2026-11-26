import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import type {
  LedgersResponse,
  MeResponse,
  PactsResponse,
  ReviewQueueResponse,
  TodayResponse,
  WaitingOnReplyResponse,
} from "../shared/api.ts";
import { APP_PATHS } from "../shared/api.ts";
import { App } from "./App.tsx";
import { Ledgers } from "./Ledgers.tsx";
import { Pacts } from "./Pacts.tsx";
import { PULL_THRESHOLD_PX, PullToRefresh, useRefresh } from "./pull-to-refresh.tsx";
import { Review } from "./Review.tsx";
import { answers, pullDown, renderWithUser, stubApi } from "./testing/render.tsx";
import { useLoad } from "./ui.tsx";

/** Whether the tab is busy refreshing: "true" while the bar runs, null otherwise. */
const busy = () => screen.getByRole("main").getAttribute("aria-busy");

/** The finger's travel that pulls the content `px` far, after resistance. */
const fingerFor = (px: number) => px * 2;

/** A tab whose refresh is `refresh`. */
function Tab({ refresh }: { refresh: () => Promise<unknown> }) {
  useRefresh(refresh);
  return <p>A tab</p>;
}

/** The shell, showing `tab`. */
function shellWith(tab: ReactElement, pullable = true) {
  return (
    <PullToRefresh pullable={pullable} timezone="America/New_York" header={<h1>Today</h1>} mainClassName="scroll gut">
      {tab}
    </PullToRefresh>
  );
}

function shell(refresh: () => Promise<unknown>, pullable = true) {
  return renderWithUser(shellWith(<Tab refresh={refresh} />, pullable));
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

    pullDown(fingerFor(PULL_THRESHOLD_PX));

    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(busy()).toBe("true"));
    done();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a refresh that fails still ends the bar", async () => {
    shell(() => Promise.reject(new Error("offline")));
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a pull short of the threshold refreshes nothing", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    pullDown(fingerFor(PULL_THRESHOLD_PX - 1));
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a pull that starts below the top is a scroll", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh);
    const main = screen.getByRole("main");
    Object.defineProperty(main, "scrollTop", { value: 200, configurable: true });
    pullDown(fingerFor(PULL_THRESHOLD_PX + 20));
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
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBe("true"));
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    expect(refresh).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(busy()).toBeNull());
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("a tab left while its refresh runs ends the bar; the next tab's pull is its own", async () => {
    const first = heldRefresh();
    const { rerender } = shell(first.refresh);
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBe("true"));

    const next = heldRefresh();
    rerender(shellWith(<Tab key="next" refresh={next.refresh} />));
    await waitFor(() => expect(busy()).toBeNull());

    pullDown(fingerFor(PULL_THRESHOLD_PX));
    expect(next.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(busy()).toBe("true"));
    // The first tab's refresh settling now doesn't end the next tab's.
    await act(async () => first.done());
    expect(busy()).toBe("true");
    next.done();
    await waitFor(() => expect(busy()).toBeNull());
  });

  test("a tab that reloads on a pull and is left before the reload answers settles its refresh", async () => {
    const settled = vi.fn();
    function Loading() {
      const { reload } = useLoad(() => new Promise<never>(() => {}));
      useRefresh(() => reload().then(settled));
      return <p>A loading tab</p>;
    }
    const { rerender } = renderWithUser(shellWith(<Loading />));
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBe("true"));

    rerender(shellWith(<Tab refresh={() => Promise.resolve()} />));

    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  });

  test("a page opened from a tab has no pull", () => {
    const refresh = vi.fn(() => Promise.resolve());
    shell(refresh, false);
    pullDown(fingerFor(PULL_THRESHOLD_PX + 20));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("each tab's refresh", () => {
  const inShell = (tab: ReactElement) =>
    renderWithUser(
      <PullToRefresh pullable timezone="America/New_York" header={<h1>Tab</h1>} mainClassName="scroll gut">
        {tab}
      </PullToRefresh>,
    );

  test("Pacts reloads its pacts", async () => {
    const spies = stubApi({ pacts: answers<PactsResponse>([]) });
    inShell(<Pacts onOpenPact={() => {}} onCreate={() => {}} />);
    await screen.findByText("No pacts yet");
    pullDown(fingerFor(PULL_THRESHOLD_PX));
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
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.reviewQueue).toHaveBeenCalledTimes(2));
    expect(spies.waitingOnReply).toHaveBeenCalledTimes(2);
  });

  test("Ledgers reloads its ledgers", async () => {
    const spies = stubApi({ ledgers: answers<LedgersResponse>([]) });
    inShell(<Ledgers timezone="America/New_York" onOpenLedger={() => {}} />);
    await screen.findByText("No ledgers yet");
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.ledgers).toHaveBeenCalledTimes(2));
  });
});

describe("in the app", () => {
  const me: MeResponse = {
    email: "me@example.test",
    name: "Me",
    timezone: "America/New_York",
    connections: [],
    ouraAvailable: false,
    ankiAvailable: false,
  };

  test("a tab's own screen has the pull", async () => {
    window.history.replaceState(null, "", APP_PATHS.pacts);
    const spies = stubApi({
      me: answers(me),
      pacts: answers<PactsResponse>([]),
      today: answers<TodayResponse>({ hasPacts: false, alerts: [], sections: [], waiting: [], yesterday: [] }),
      reviewQueue: answers<ReviewQueueResponse>([]),
      waitingOnReply: answers<WaitingOnReplyResponse>([]),
      ledgers: answers<LedgersResponse>([]),
    });
    renderWithUser(<App />);
    await screen.findByText("No pacts yet");
    const before = spies.pacts.mock.calls.length;
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.pacts).toHaveBeenCalledTimes(before + 1));
  });

  test("a tab left while its pull reloads it ends the bar, and the next tab's pull reloads that tab", async () => {
    window.history.replaceState(null, "", APP_PATHS.pacts);
    const spies = stubApi({
      me: answers(me),
      // The pull's reload never answers.
      pacts: vi
        .fn<() => Promise<PactsResponse>>()
        .mockResolvedValueOnce([])
        .mockReturnValue(new Promise(() => {})),
      today: answers<TodayResponse>({ hasPacts: false, alerts: [], sections: [], waiting: [], yesterday: [] }),
      reviewQueue: answers<ReviewQueueResponse>([]),
      waitingOnReply: answers<WaitingOnReplyResponse>([]),
      ledgers: answers<LedgersResponse>([]),
    });
    const { user } = renderWithUser(<App />);
    await screen.findByText("No pacts yet");
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(busy()).toBe("true"));

    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Ledgers" }));
    await screen.findByText("No ledgers yet");
    await waitFor(() => expect(busy()).toBeNull());

    const before = spies.ledgers.mock.calls.length;
    pullDown(fingerFor(PULL_THRESHOLD_PX));
    await waitFor(() => expect(spies.ledgers).toHaveBeenCalledTimes(before + 1));
    await waitFor(() => expect(busy()).toBeNull());
  });
});
