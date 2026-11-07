// Calendar math in an IANA timezone, shared by the core and the scenario
// harness. A local date is a "YYYY-MM-DD" string naming a calendar day in
// some zone; which zone is always the caller's to say. No Pact rules live
// here: when occurrences open and fall due is occurrences.ts's to say.

import { WEEKDAYS, type Weekday } from "../shared/types.ts";

/** "YYYY-MM-DD": a calendar day in some timezone. */
export type LocalDate = string;

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

/** The later of two dates. */
export function laterDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

/** The earlier of two dates. */
export function earlierDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}

/** The Monday of `date`'s Mon–Sun week. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/**
 * The first instant of `date` in `timezone`. That's its midnight, except where
 * the clocks jump forward at midnight (as in Chile): midnight never happens
 * there, and the day starts when the jump lands.
 */
export function startOfDay(date: LocalDate, timezone: string): Date {
  const [year, month, day] = splitDate(date);
  const midnight = zonedWallTimeToInstant(year, month, day, 0, 0, timezone);
  if (localDateOf(midnight, timezone) === date) return midnight;
  // `midnight` fell just before the jump; the offset there puts the wall
  // time 00:00 at the jump itself.
  return new Date(Date.UTC(year, month - 1, day) - offsetMs(midnight.getTime(), timezone));
}

/** `timezone`'s UTC offset at `instant`, in ms (negative west of UTC). */
export function zoneOffsetAt(instant: Date, timezone: string): number {
  return offsetMs(instant.getTime(), timezone);
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
