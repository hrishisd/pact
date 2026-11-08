// The scheduler: a tick a minute, never two at once, and stop waits for the one running.

import { expect, onTestFinished, test, vi } from "vitest";
import { scenario } from "../core/testing/scenario.ts";
import { startScheduler } from "./scheduler.ts";

function slowTicks() {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());
  const s = scenario();
  const finishes: (() => void)[] = [];
  const advanceTo = vi.spyOn(s.core, "advanceTo").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishes.push(resolve);
      }),
  );
  /** Finishes the oldest tick still running. */
  const finish = () => {
    const next = finishes.shift();
    if (!next) throw new Error("no tick running");
    next();
  };
  return { s, advanceTo, finish };
}

test("a tick still running when the next is due delays it; the one after runs", async () => {
  const { s, advanceTo, finish } = slowTicks();
  const scheduler = startScheduler(s.core, s.clock);
  expect(advanceTo).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(advanceTo).toHaveBeenCalledTimes(1);

  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(advanceTo).toHaveBeenCalledTimes(2);
  finish();
  await scheduler.stop();
});

test("stop waits for the tick running, and no tick starts after it", async () => {
  const { s, advanceTo, finish } = slowTicks();
  const scheduler = startScheduler(s.core, s.clock);
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });

  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  finish();
  await stopping;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(advanceTo).toHaveBeenCalledTimes(1);
});

test("a tick that fails is logged, and the next one runs", async () => {
  const { s, advanceTo, finish } = slowTicks();
  advanceTo.mockRejectedValueOnce(new Error("database is locked"));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => errors.mockRestore());
  const scheduler = startScheduler(s.core, s.clock);

  await vi.advanceTimersByTimeAsync(60_000);

  expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^scheduler tick failed: Error: database is locked/));
  expect(advanceTo).toHaveBeenCalledTimes(2);
  finish();
  await scheduler.stop();
});
