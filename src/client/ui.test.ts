import { describe, expect, test } from "vitest";
import { loadFailure, loadedData, sendOnce, settledLoad, settleUnlessDropped, type Load } from "./ui.tsx";

/** A load still on its way, settled by the test. */
function deferred() {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("only the newest load's answer counts", () => {
  test("an older load answering after a reload is dropped, whether it loaded or failed", async () => {
    const applied: string[] = [];
    const settle = (promise: Promise<string>) =>
      settleUnlessDropped(
        promise,
        (value) => applied.push(value),
        (error) => applied.push(`failed: ${String(error)}`),
      );
    const slow = deferred();
    const slower = deferred();
    const dropSlow = settle(slow.promise);
    const dropSlower = settle(slower.promise);
    // Two reloads: each runs the previous load's cleanup.
    dropSlow();
    dropSlower();
    const newest = deferred();
    settle(newest.promise);

    newest.resolve("newest");
    await newest.promise;
    slow.resolve("older");
    await slow.promise;
    slower.reject(new Error("offline"));
    await slower.promise.catch(() => undefined);

    expect(applied).toEqual(["newest"]);
  });

  test("a load not dropped hands on what it settles to", async () => {
    const applied: string[] = [];
    const failing = Promise.reject(new Error("offline"));
    const loading = Promise.resolve("loaded");
    settleUnlessDropped(
      failing,
      () => applied.push("loaded?"),
      (error) => applied.push(String(error)),
    );
    settleUnlessDropped(
      loading,
      (value) => applied.push(value),
      () => applied.push("failed?"),
    );
    await failing.catch(() => undefined);
    await loading;

    expect(applied).toEqual(["Error: offline", "loaded"]);
  });
});

describe("a load that fails", () => {
  const loaded: Load<string> = { kind: "loaded", data: "Gym", reloadFailed: null };
  const offline = new Error("offline");

  test("with nothing loaded yet fails the screen", () => {
    const failed = settledLoad<string>({ kind: "loading" }, { ok: false, error: offline });
    expect(failed).toEqual({ kind: "failed", error: offline });
    expect(loadedData(failed)).toBeNull();
    expect(loadFailure(failed)).toEqual({ error: offline });
  });

  test("on a reload keeps the data shown, and says why", () => {
    const kept = settledLoad(loaded, { ok: false, error: offline });
    expect(kept).toEqual({ kind: "loaded", data: "Gym", reloadFailed: { error: offline } });
    expect(loadedData(kept)).toBe("Gym");
    expect(loadFailure(kept)).toEqual({ error: offline });
  });

  test("is forgotten once a load works", () => {
    const failedReload = settledLoad(loaded, { ok: false, error: offline });
    expect(settledLoad(failedReload, { ok: true, data: "Run" })).toEqual({
      kind: "loaded",
      data: "Run",
      reloadFailed: null,
    });
    expect(settledLoad<string>({ kind: "failed", error: offline }, { ok: true, data: "Run" })).toEqual({
      kind: "loaded",
      data: "Run",
      reloadFailed: null,
    });
  });

  test("again with nothing loaded says the newest reason", () => {
    const later = new Error("on our side");
    expect(settledLoad<string>({ kind: "failed", error: offline }, { ok: false, error: later })).toEqual({
      kind: "failed",
      error: later,
    });
  });
});

describe("a send", () => {
  /** Runs `send` through sendOnce, recording each state update in order. */
  async function updates(send: () => Promise<string | void>) {
    const seen: string[] = [];
    await sendOnce(
      send,
      (error) => `failed: ${String(error)}`,
      (busy) => seen.push(`busy ${busy}`),
      (error) => seen.push(`error ${error}`),
    );
    return seen;
  }

  test("that goes through: busy, error cleared, what follows it, then not busy", async () => {
    const seen = await updates(async () => {
      await Promise.resolve();
    });
    expect(seen).toEqual(["busy true", "error null", "busy false"]);
  });

  test("that is refused shows the refusal's text", async () => {
    expect(await updates(async () => "This pact wasn't found.")).toEqual([
      "busy true",
      "error null",
      "error This pact wasn't found.",
      "busy false",
    ]);
  });

  test("that throws says why, from the screen's failure text", async () => {
    expect(
      await updates(async () => {
        throw new Error("offline");
      }),
    ).toEqual(["busy true", "error null", "error failed: Error: offline", "busy false"]);
  });
});
