// Production adapters for the four ports. The server wires these into
// createPactCore; tests use the fakes in testing/fakes.ts instead.

import type { Clock, Notification, Notifier, OuraSource, PhotoStore } from "./ports.ts";

/** The one place system time is read. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Logs each notification instead of sending it. Web Push replaces this in
 * ticket 05. (The core itself logs the OPERATOR_ALERT line for operator
 * alerts, whether or not delivery works, so this line isn't tagged.)
 */
export function logNotifier(log: (line: string) => void = (line) => console.log(line)): Notifier {
  return {
    async deliver(notification: Notification) {
      log(
        `notify ${notification.kind} via ${notification.channel} to ${notification.recipient}: ${JSON.stringify(notification.payload)}`,
      );
    },
  };
}

/** Oura isn't connected until ticket 08. Nothing calls this yet. */
export const stubOuraSource: OuraSource = {
  async sleepPeriods() {
    throw new Error("Oura source not implemented yet (ticket 08)");
  },
};

/** Photos aren't stored until ticket 03. Nothing calls this yet. */
export const stubPhotoStore: PhotoStore = {
  async store() {
    throw new Error("photo store not implemented yet (ticket 03)");
  },
  async fetch() {
    throw new Error("photo store not implemented yet (ticket 03)");
  },
};
