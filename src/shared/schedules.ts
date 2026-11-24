// What a pact's schedule says about its periods: pure day arithmetic, no timezone.

import { addDays, parseLocalDate } from "./calendar.ts";
import type { LocalDate, PeriodKind, Schedule } from "./types.ts";

/**
 * A period schedule: each occurrence is a period of days, any of which can
 * take evidence, at most one counting per day. Weekly count's is a Mon–Sun
 * week, Every 2 weeks' two of them, Once a month's a calendar month.
 */
export type PeriodSchedule = Extract<Schedule, { kind: PeriodKind }>;

/** The kinds of the period schedules. */
export const PERIOD_KINDS: readonly PeriodKind[] = ["weekly-count", "every-2-weeks", "once-a-month"];

/** Whether each occurrence of `schedule` is a period of days (`PeriodSchedule`) rather than one day. */
export function isPeriodSchedule(schedule: Schedule): schedule is PeriodSchedule {
  return (PERIOD_KINDS as readonly string[]).includes(schedule.kind);
}

/** How many days of an occurrence need approved evidence to Satisfy it: Weekly count's target, else 1. */
export function targetOf(schedule: Schedule): number {
  return schedule.kind === "weekly-count" ? schedule.target : 1;
}

/**
 * The last day of the period of the occurrence dated `date` on `schedule`:
 * a week's Sunday, the second Sunday of two weeks, a month's last day. A
 * day's occurrence is just that day; a One-time one is dated by its deadline's
 * date, its last.
 */
export function lastDayOf(schedule: Schedule, date: LocalDate): LocalDate {
  switch (schedule.kind) {
    case "weekly-count":
      return addDays(date, 6);
    case "every-2-weeks":
      return addDays(date, 13);
    case "once-a-month": {
      const { year, month } = parseLocalDate(date);
      // Day 0 of the next month is this one's last.
      return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    case "fixed-days":
    case "one-time":
      return date;
  }
}
