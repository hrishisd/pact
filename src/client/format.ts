// How the client writes money, schedules, dates and time left.

import { parseDatedReminder, parseLocalDate } from "../shared/calendar.ts";
import { clockText, formatDate, formatDay, partsIn } from "../shared/format.ts";
import type { Json } from "../shared/api.ts";
import {
  EDIT_WINDOW_MINUTES,
  EXCUSE_WINDOW_HOURS,
  NIGHT_CLOSES_AT,
  type AnkiCheck,
  type ClockTime,
  type DatedReminder,
  type LocalDate,
} from "../shared/types.ts";

export {
  clockText,
  dateSpan,
  formatDate,
  formatDay,
  inBedByName,
  monthDay,
  money,
  scheduleText,
} from "../shared/format.ts";

/** A pact's edit window, as copy says it: "10 minutes". */
export const EDIT_WINDOW_TEXT = `${EDIT_WINDOW_MINUTES} minutes`;

/** The excuse window, as copy says it: "48 hours". */
export const EXCUSE_WINDOW_TEXT = `${EXCUSE_WINDOW_HOURS} hours`;

/** The hour a bedtime night closes, as copy says it: "6pm". */
export const NIGHT_CLOSES_TEXT = clockText(`${String(NIGHT_CLOSES_AT).padStart(2, "0")}:00`).replace(":00", "");

/** Dollars as typed ("5", "$2.50", "0.5", ".50") in whole cents, or null when it isn't an amount. */
export function parseCents(text: string): number | null {
  const match = /^\$?\s*(\d*)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** A pact's reminders, in the order they go off: "6:00pm, 8:30pm", "Wed Jan 7, 9:00am" on One-time, or "None". */
export function remindersText(reminders: (ClockTime | DatedReminder)[]): string {
  return reminders.length === 0 ? "None" : reminders.map(reminderText).join(", ");
}

/** A reminder: a time of day, "6:00pm", or a One-time pact's dated reminder, "Wed Jan 7, 9:00am". */
function reminderText(reminder: ClockTime | DatedReminder): string {
  if (!reminder.includes("T")) return clockText(reminder);
  const { date, time } = parseDatedReminder(reminder);
  return `${formatDate(date)}, ${clockText(time)}`;
}

/** Cents as an amount field starts out: "5" for whole dollars, "2.50" otherwise, with no "$". */
export function centsInputText(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/** A calendar date as its weekday, "Wednesday". Never shifted into another timezone. */
export function weekdayName(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** An instant, as an ISO string, as its day and time in `timeZone` (the profile's): "Thu Oct 22, 9:05pm". */
export function formatDayTime(instant: string, timeZone: string): string {
  return `${formatDay(instant, timeZone)}, ${clockTime(instant, timeZone)}`;
}

/**
 * An instant, as an ISO string, as its day and time in `timeZone` (the
 * profile's), the way bills are due: "Wed Jan 21 at 6pm", or "at 6:30pm"
 * off the hour.
 */
export function formatDueAt(instant: string, timeZone: string): string {
  return `${formatDay(instant, timeZone)} at ${clockText(wallClockIn(instant, timeZone)).replace(":00", "")}`;
}

/** An instant, as an ISO string, as the time a day is due by in `timeZone` (the profile's): "9:00pm", or "midnight". */
export function dueClockText(instant: string, timeZone: string): string {
  const clock = wallClockIn(instant, timeZone);
  return clock === "00:00" ? "midnight" : clockText(clock);
}

/** An instant, as an ISO string, as its wall-clock time in `timeZone`. */
function wallClockIn(instant: string, timeZone: string): ClockTime {
  const part = partsIn(instant, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${part("hour")}:${part("minute")}`;
}

/** `now` (ms) as its date in `timeZone` (the profile's), not this device's. */
export function dateIn(now: number, timeZone: string): LocalDate {
  const part = partsIn(now, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * `date`, as written, unless it is today in `timeZone` (the profile's) at
 * `now` (ms): "Thu Nov 12", or null for today. The same day of another
 * year isn't today.
 */
export function dateUnlessToday(date: LocalDate, now: number, timeZone: string): string | null {
  return date === dateIn(now, timeZone) ? null : formatDate(date);
}

/** Time left as "16h 19m", or "1d 21h" from 24 hours up. Never negative. */
export function timeLeft(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes % 60}m`;
}

/** Time left to file an excuse, in whole hours as the spec writes it: "31h", or "45m" under an hour. Never negative. */
export function hoursLeft(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/** The whole minutes left until `closesAt`, rounded up: "7 min" holds until 6 have passed. Null once it's reached or if none. */
export function minutesLeft(closesAt: string | null, now: number): number | null {
  if (closesAt === null) return null;
  const ms = Date.parse(closesAt) - now;
  return ms > 0 ? Math.ceil(ms / 60_000) : null;
}

/**
 * An instant, as an ISO string, as a time in `timeZone` (the profile's):
 * "2:24pm". Undefined reads it on this device's clock.
 */
export function clockTime(instant: string, timeZone: string | undefined): string {
  const part = partsIn(instant, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

/** "Sam Lee" → "S". */
export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Why an Anki day is Missed: how many cards were left at Pact's last check
 * that counted for it ("12 cards left at 11:50pm" in `timeZone`, the
 * profile's), or that no check reached AnkiWeb that day.
 */
export function ankiMissText(check: Json<AnkiCheck> | null, timeZone: string): string {
  if (check === null) return "AnkiWeb not reached";
  const { cardsLeft, checkedAt } = check;
  return `${cardsLeft} ${cardsLeft === 1 ? "card" : "cards"} left at ${clockTime(checkedAt, timeZone)}`;
}
