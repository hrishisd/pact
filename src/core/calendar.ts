// Calendar math in an IANA timezone, shared by the core and the scenario
// harness. A local date is a "YYYY-MM-DD" string naming a calendar day in
// some zone; which zone is always the caller's to say.

import { WEEKDAYS, type Weekday } from "../shared/types.ts";

/** "YYYY-MM-DD": a calendar day in some timezone. */
export type LocalDate = string;

const HOUR_MS = 60 * 60 * 1000;

/** The instant the wall-clock time `year-month-day hour:minute` names in `timezone`. */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - offsetMs(wall, timezone);
  instant = wall - offsetMs(instant, timezone);
  return new Date(instant);
}

/** The calendar day `instant` falls on in `timezone`. */
export function localDateOf(instant: Date, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = splitDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: LocalDate): Weekday {
  const [year, month, day] = splitDate(date);
  // getUTCDay counts from Sunday; WEEKDAYS counts from Monday.
  return WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7] as Weekday;
}

/** Midnight at the end of `date` in `timezone`: when a Fixed-days occurrence on that day is due. */
export function midnightEnding(date: LocalDate, timezone: string): Date {
  const [year, month, day] = splitDate(addDays(date, 1));
  return zonedWallTimeToInstant(year, month, day, 0, 0, timezone);
}

/**
 * A Fixed-days pact's first occurrence: the first scheduled day, in
 * `timezone`, whose due time (midnight ending it) is at least 1 hour after
 * `createdAt`. `days` must not be empty.
 */
export function firstFixedDaysOccurrence(
  days: readonly Weekday[],
  createdAt: Date,
  timezone: string,
): { date: LocalDate; dueAt: Date } {
  if (days.length === 0) throw new Error("a Fixed-days schedule needs at least one day");
  // A day within an hour of its end can be skipped, so look one day past a full week.
  for (let date = localDateOf(createdAt, timezone), i = 0; i <= 7; date = addDays(date, 1), i++) {
    const dueAt = midnightEnding(date, timezone);
    if (days.includes(weekdayOf(date)) && dueAt.getTime() - createdAt.getTime() >= HOUR_MS) {
      return { date, dueAt };
    }
  }
  throw new Error("unreachable: every scheduled weekday recurs within 8 days");
}

function splitDate(date: LocalDate): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year as number, month as number, day as number];
}

/** The zone's UTC offset at `instantMs`, in ms (negative west of UTC). */
function offsetMs(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}
