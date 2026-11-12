import { act, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { forgetLoaded } from "./last-loaded.ts";
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
