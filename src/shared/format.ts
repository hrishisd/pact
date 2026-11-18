// How money, days and schedules are written, by the client and in notifications.

import { parseClockTime, parseLocalDate } from "./calendar.ts";
import { WEEKDAYS, type ClockTime, type LocalDate, type Schedule, type Weekday } from "./types.ts";

/** US cents as dollars: "$5" for whole dollars, "$5.50" otherwise. */
export function money(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/**
 * A calendar date as "Thu Oct 22". It's a day, not an instant, so it's
 * formatted as written and never shifted into another timezone.
 */
export function formatDate(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  return formatDay(new Date(Date.UTC(year, month - 1, day)).toISOString(), "UTC");
}

/** "Dec 20", from `formatDate`'s "Sun Dec 20". */
export function monthDay(date: LocalDate): string {
  return formatDate(date).slice(4);
}

/** A vacation's dates: "Dec 20 – Jan 2", "Dec 20 – 26" within one month, or "Dec 20" for one day. */
export function dateSpan(from: LocalDate, to: LocalDate): string {
  if (from === to) return monthDay(from);
  const [toMonth, toDay] = monthDay(to).split(" ");
  return monthDay(from).startsWith(`${toMonth} `)
    ? `${monthDay(from)} – ${toDay}`
    : `${monthDay(from)} – ${monthDay(to)}`;
}

/** Pact names as a push lists them: "Gym", "Gym and Reading", or "Gym, Reading, and 2 more". */
export function pactNamesText(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

/** An instant, as an ISO string, as its day in `timeZone` (the profile's): "Thu Oct 22", like `formatDate`. */
export function formatDay(instant: string, timeZone: string): string {
  const part = partsIn(instant, timeZone, { weekday: "short", month: "short", day: "numeric" });
  return `${part("weekday")} ${part("month")} ${part("day")}`;
}

/** An instant, as an ISO string, as its day and time in `timeZone` (the profile's): "Thu Oct 22, 9:05pm". */
export function formatDayTime(instant: string, timeZone: string): string {
  return `${formatDay(instant, timeZone)}, ${clockTime(instant, timeZone)}`;
}

/**
 * An instant, as an ISO string, as a time in `timeZone` (the profile's):
 * "2:24pm". Undefined reads it on this device's clock.
 */
export function clockTime(instant: string, timeZone: string | undefined): string {
  const part = partsIn(instant, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

/**
 * Days whose excuse window a rejected or withdrawn vacation reopened, and
 * when it closes: "Mon Jan 5 to Wed Jan 7 can be excused until Fri Jan 9,
 * 8:00am." `until` is an ISO string, written in `timeZone` (the owner's).
 */
export function excusableText(firstDate: LocalDate, lastDate: LocalDate, until: string, timeZone: string): string {
  return `${daysText(firstDate, lastDate)} can be excused until ${formatDayTime(until, timeZone)}.`;
}

/** The days from `firstDate` to `lastDate`: "Mon Jan 5 to Wed Jan 7", or "Mon Jan 5" for one. */
export function daysText(firstDate: LocalDate, lastDate: LocalDate): string {
  return firstDate === lastDate ? formatDate(firstDate) : `${formatDate(firstDate)} to ${formatDate(lastDate)}`;
}

/**
 * `instant` (an ISO string, or ms) formatted in `timeZone` with `options`, as
 * a lookup of its parts: `part("hour")`, or "" for a part it doesn't have.
 * Undefined `timeZone` reads it on this device's clock.
 */
export function partsIn(
  instant: string | number,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): (type: Intl.DateTimeFormatPartTypes) => string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(new Date(instant));
  return (type) => parts.find((p) => p.type === type)?.value ?? "";
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/**
 * "Every day", the days in order ("Mon, Wed, Fri"), a Weekly count's target
 * ("3× per week"), or a One-time deadline's date ("One-time, Thu Nov 12", or
 * "Anytime until Thu Nov 12" with Submit anytime).
 */
export function scheduleText(schedule: Schedule): string {
  if (schedule.kind === "weekly-count") return `${schedule.target}× per week`;
  if (schedule.kind === "one-time") {
    const date = formatDate(schedule.deadline);
    return schedule.submitAnytime ? `Anytime until ${date}` : `One-time, ${date}`;
  }
  if (schedule.days.length === WEEKDAYS.length) return "Every day";
  return schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

/** A clock time as "12:00am" or "11:30pm". */
export function clockText(time: ClockTime): string {
  const { hour, minute } = parseClockTime(time);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

/** The name a bedtime pact fills in from its in-bed-by time: "In bed by midnight", "In bed by 11:30pm", "In bed by 1am". */
export function inBedByName(time: ClockTime): string {
  const { hour, minute } = parseClockTime(time);
  if (hour === 0 && minute === 0) return "In bed by midnight";
  const clock = clockText(time);
  return `In bed by ${minute === 0 ? clock.replace(":00", "") : clock}`;
}
