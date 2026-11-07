import { describe, expect, test } from "vitest";
import { settleUnlessDropped } from "./ui.tsx";

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
