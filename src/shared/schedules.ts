// What a pact's schedule says about its occurrences.

import type { Schedule } from "./types.ts";

/** A schedule whose every occurrence is a period of days, any of which can take evidence: Weekly count. */
export type PeriodSchedule = Extract<Schedule, { kind: "weekly-count" }>;

/** Whether each occurrence of `schedule` is a period of days (`PeriodSchedule`) rather than one day. */
export function isPeriodSchedule(schedule: Schedule): schedule is PeriodSchedule {
  return schedule.kind === "weekly-count";
}

/** How many days of an occurrence need approved evidence to Satisfy it: Weekly count's target, else 1. */
export function targetOf(schedule: Schedule): number {
  return schedule.kind === "weekly-count" ? schedule.target : 1;
}
