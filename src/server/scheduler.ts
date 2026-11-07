// The scheduler: calls the core's "advance to now" on start and every minute.
// A failed tick is logged and the next one runs as usual; /health turns red
// if ticks keep failing for 5 minutes.

import type { Clock, PactCore } from "../core/index.ts";

export interface Scheduler {
  /** Stops the timer and waits for a tick in progress. */
  stop(): Promise<void>;
}

export function startScheduler(core: PactCore, clock: Clock): Scheduler {
  /** The tick in progress, if any. */
  let running: Promise<void> | null = null;

  const tick = () => {
    // Never overlap ticks: a slow one simply delays the next.
    if (running) return;
    running = core
      .advanceTo(clock.now())
      .catch((error: unknown) =>
        console.error(`scheduler tick failed: ${error instanceof Error ? error.stack : String(error)}`),
      )
      .finally(() => {
        running = null;
      });
  };

  tick();
  const timer = setInterval(tick, 60_000);

  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
