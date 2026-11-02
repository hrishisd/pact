// How money, days and schedules are written, by the client and in notifications.

import { WEEKDAYS, type Schedule, type Weekday } from "./types.ts";

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
 * A calendar date, "YYYY-MM-DD", as "Thu Oct 22". It's a day, not an instant,
 * so it's formatted as written and never shifted into another timezone.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return formatDay(new Date(Date.UTC(year, month - 1, day)).toISOString(), "UTC");
}

/** An instant, as an ISO string, as its day in `timeZone` (the profile's): "Thu Oct 22", like `formatDate`. */
export function formatDay(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("month")} ${part("day")}`;
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

/** "Every day", or the days in order: "Mon, Wed, Fri". */
export function scheduleText(schedule: Schedule): string {
  if (schedule.days.length === WEEKDAYS.length) return "Every day";
  return schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

/** A clock time, "HH:MM" on a 24-hour clock, as "12:00am" or "11:30pm". */
export function clockText(time: string): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

/** The name a bedtime pact fills in from its in-bed-by time: "In bed by midnight", "In bed by 11:30pm", "In bed by 1am". */
export function inBedByName(time: string): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  if (hour === 0 && minute === 0) return "In bed by midnight";
  const clock = clockText(time);
  return `In bed by ${minute === 0 ? clock.replace(":00", "") : clock}`;
}
