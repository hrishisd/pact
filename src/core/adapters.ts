// Production adapters for the four ports (the photo stores are in
// photo-stores.ts, the notifier in web-push.ts, Oura in oura.ts). The server wires these into createPactCore; tests use the
// fakes in testing/fakes.ts instead.

import type { Clock } from "./ports.ts";

/** The one place system time is read. */
export const systemClock: Clock = {
  now: () => new Date(),
};
