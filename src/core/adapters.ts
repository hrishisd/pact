// Production adapters for the four ports (the photo stores are in
// photo-stores.ts, the notifier in web-push.ts). The server wires these into createPactCore; tests use the
// fakes in testing/fakes.ts instead.

import type { Clock, OuraSource } from "./ports.ts";

/** The one place system time is read. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** Oura isn't connected until ticket 08. Nothing calls this yet. */
export const stubOuraSource: OuraSource = {
  async sleepPeriods() {
    throw new Error("Oura source not implemented yet (ticket 08)");
  },
};
