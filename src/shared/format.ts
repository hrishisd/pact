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

/** An instant, as an ISO string, as its day in `timeZone` (the profile's): "Thu Oct 22", like `formatDate`. */
export function formatDay(instant: string, timeZone: string): string {
  const part = partsIn(instant, timeZone, { weekday: "short", month: "short", day: "numeric" });
  return `${part("weekday")} ${part("month")} ${part("day")}`;
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
