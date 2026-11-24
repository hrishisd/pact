// What a pact's schedule says about its periods: pure day arithmetic, no timezone.

import { addDays, dayCount, parseLocalDate } from "./calendar.ts";
import { PERIOD_KINDS, type LocalDate, type PeriodKind, type Schedule } from "./types.ts";

/**
 * A period schedule: each occurrence is a period of days, any of which can
 * take evidence, at most one counting per day. Weekly count's is a Mon–Sun
 * week, Every 2 weeks' two of them, Once a month's a calendar month.
 */
export type PeriodSchedule = Extract<Schedule, { kind: PeriodKind }>;

/** Whether each occurrence of `schedule` is a period of days (`PeriodSchedule`) rather than one day. */
export function isPeriodSchedule(schedule: Schedule): schedule is PeriodSchedule {
  return (PERIOD_KINDS as readonly string[]).includes(schedule.kind);
}

/**
 * Every 2 weeks and Once a month: the period schedules with one day to do,
 * whose first period the owner picks, and whose periods have a reminder
 * window and can have a trip ahead.
 */
export type OncePerPeriodKind = "every-2-weeks" | "once-a-month";

/** Whether `schedule` is Every 2 weeks or Once a month (`OncePerPeriodKind`). */
export function isOncePerPeriod<S extends Pick<Schedule, "kind">>(
  schedule: S,
): schedule is S & { kind: OncePerPeriodKind } {
  return schedule.kind === "every-2-weeks" || schedule.kind === "once-a-month";
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

/** The kind of period each occurrence of `schedule` is, or undefined when each is one day. */
export function periodKindOfSchedule(schedule: Pick<Schedule, "kind">): PeriodKind | undefined {
  return PERIOD_KINDS.find((kind) => kind === schedule.kind);
}

/**
 * The kind of period an occurrence dated `date` through `through` is, by its
 * length: a week is 7 days, two weeks 14, a month 28 to 31. Undefined for a
 * day's occurrence, which has no `through`.
 */
export function periodKindOfSpan(date: LocalDate, through: LocalDate | undefined): PeriodKind | undefined {
  if (through === undefined) return undefined;
  const days = dayCount(date, through);
  return days === 7 ? "weekly-count" : days === 14 ? "every-2-weeks" : "once-a-month";
}
