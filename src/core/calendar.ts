// Calendar math in an IANA timezone, shared by the core and the scenario
// harness. A local date is a "YYYY-MM-DD" string naming a calendar day in
// some zone; which zone is always the caller's to say. No Pact rules live
// here: when occurrences open and fall due is occurrences.ts's to say.

import { addDays, parseLocalDate } from "../shared/calendar.ts";
import { WEEKDAYS, type LocalDate, type Weekday } from "../shared/types.ts";

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
  const key = `${timezone} ${wall}`;
  let instant = instants.get(key);
  if (instant === undefined) {
    instant = wall - offsetMs(wall - offsetMs(wall, timezone), timezone);
    if (instants.size >= MAX_INSTANTS) instants.clear();
    instants.set(key, instant);
  }
  return new Date(instant);
}

/** The instant the wall-clock time `hour`:`minute` on `date` names in `timezone`. */
export function wallTime(date: LocalDate, hour: number, minute: number, timezone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  return zonedWallTimeToInstant(year, month, day, hour, minute, timezone);
}

/** The calendar day `instant` falls on in `timezone`. */
export function localDateOf(instant: Date, timezone: string): LocalDate {
  const parts = formatterIn(dateFormatters, timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function weekdayOf(date: LocalDate): Weekday {
  const { year, month, day } = parseLocalDate(date);
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
  const { year, month, day } = parseLocalDate(date);
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

/** The zone's UTC offset at `instantMs`, in ms (negative west of UTC). */
function offsetMs(instantMs: number, timezone: string): number {
  const parts = formatterIn(offsetFormatters, timezone, {
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

// Making an Intl.DateTimeFormat is slow, and these run many times a tick, so
// each keeps one per zone. No eviction: the set of IANA zones is bounded.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

// Each instant takes two formatToParts, and the occurrence functions ask for
// the same few days' starts thousands of times a tick, so each answer is kept,
// by zone and wall time. For a given timezone database it never changes,
// daylight saving included. A long-running server asks about ever new days,
// so the map is emptied when it reaches MAX_INSTANTS.
const instants = new Map<string, number>();
const MAX_INSTANTS = 10_000;

/** `cache`'s formatter for `timezone`, made with `options` the first time. */
function formatterIn(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options });
    cache.set(timezone, formatter);
  }
  return formatter;
}
