import { act, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { forgetLoaded, reloadWhenForgotten, stopReloading } from "./last-loaded.ts";
import { onOurSide, renderWithUser } from "./testing/render.tsx";
import { Loaded, useLoad } from "./ui.tsx";

const PATH = "/api/things";

/** A screen showing what `load` loads, remembered under `path` when one is given. */
function Screen({ load, path }: { load: () => Promise<string>; path?: string }) {
  const { state } = useLoad(load, path);
  return (
    <Loaded state={state} what="This screen">
      {(data) => <p>{data}</p>}
    </Loaded>
  );
}

/** A load still on its way, settled by the test. */
function deferred() {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { load: () => promise, resolve, reject };
}

/** Opens the screen, waits for `data` to show, and closes it. */
async function openAndClose(data: string, path?: string) {
  const { unmount } = renderWithUser(<Screen load={async () => data} path={path} />);
  await screen.findByText(data);
  unmount();
}

test("a screen opened again shows what it last loaded at once, then what it loads now", async () => {
  await openAndClose("Monday's", PATH);
  const next = deferred();
  renderWithUser(<Screen load={next.load} path={PATH} />);
  expect(screen.getByText("Monday's")).toBeTruthy();
  await act(async () => next.resolve("Tuesday's"));
  expect(screen.getByText("Tuesday's")).toBeTruthy();
  expect(screen.queryByText("Monday's")).toBeNull();
});

test("a screen opened again whose load fails keeps what it last loaded and says the load failed", async () => {
  await openAndClose("Monday's", PATH);
  const next = deferred();
  renderWithUser(<Screen load={next.load} path={PATH} />);
  await act(async () => next.reject(onOurSide));
  expect(screen.getByText("This screen couldn't load")).toBeTruthy();
  expect(screen.getByText("Monday's")).toBeTruthy();
});

test("without a key, a screen opened again starts blank", async () => {
  await openAndClose("Monday's");
  const { container } = renderWithUser(<Screen load={deferred().load} />);
  expect(container.textContent).toBe("");
});

test("once everything is forgotten, a screen opened again starts blank", async () => {
  await openAndClose("Monday's", PATH);
  forgetLoaded();
  const { container } = renderWithUser(<Screen load={deferred().load} path={PATH} />);
  expect(container.textContent).toBe("");
});

test("a load that began before everything was forgotten shows but isn't remembered", async () => {
  const first = deferred();
  const { unmount } = renderWithUser(<Screen load={first.load} path={PATH} />);
  forgetLoaded();
  await act(async () => first.resolve("Monday's"));
  expect(screen.getByText("Monday's")).toBeTruthy();
  unmount();
  const { container } = renderWithUser(<Screen load={deferred().load} path={PATH} />);
  expect(container.textContent).toBe("");
});

describe("loads reloaded when everything is forgotten", () => {
  test("run again after forgetting, so a screen opened afterwards shows what they loaded at once", async () => {
    await openAndClose("Monday's", PATH);
    const load = vi.fn(async () => "Tuesday's");
    reloadWhenForgotten(PATH, load);
    forgetLoaded();
    await act(async () => undefined);
    expect(load).toHaveBeenCalledTimes(1);
    renderWithUser(<Screen load={deferred().load} path={PATH} />);
    expect(screen.getByText("Tuesday's")).toBeTruthy();
  });

  test("one that fails after forgetting leaves the screen to start blank, and throws nothing", async () => {
    await openAndClose("Monday's", PATH);
    reloadWhenForgotten(PATH, async () => {
      throw onOurSide;
    });
    forgetLoaded();
    await act(async () => undefined);
    const { container } = renderWithUser(<Screen load={deferred().load} path={PATH} />);
    expect(container.textContent).toBe("");
  });

  test("once stopped, forgetting runs nothing", () => {
    const load = vi.fn(async () => "Tuesday's");
    const stop = reloadWhenForgotten(PATH, load);
    const other = vi.fn(async () => "Wednesday's");
    reloadWhenForgotten("/api/other", other);
    stop();
    stopReloading();
    forgetLoaded();
    expect(load).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
