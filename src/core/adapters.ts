// Production adapters for the six ports (the photo stores are in
// photo-stores.ts, the notifier in web-push.ts, the mailer in gmail.ts, Oura in
// oura.ts, Anki in anki.ts). The server wires these into createPactCore; tests
// use the fakes in testing/fakes.ts instead.

import type { Clock } from "./ports.ts";

/** The one place system time is read. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock that can be moved forward: the dev server's, for the browser smoke test. */
export interface DevClock extends Clock {
  /** Moves this clock `minutes` ahead of where it was. Never backward. */
  advance(minutes: number): void;
}

/**
 * DEVELOPMENT ONLY (PACT_DEV_CLOCK=1): `base`'s time plus however far it has
 * been advanced, so time still runs between advances.
 */
export function offsetClock(base: Clock = systemClock): DevClock {
  let offsetMs = 0;
  return {
    now: () => new Date(base.now().getTime() + offsetMs),
    advance(minutes) {
      if (!(minutes > 0)) throw new Error(`a dev clock only moves forward (asked for ${minutes} minutes)`);
      offsetMs += minutes * 60_000;
    },
  };
}
