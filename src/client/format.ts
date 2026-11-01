// How the client writes money, schedules, dates and time left.

import { formatDay } from "../shared/format.ts";
import { WEEKDAYS, type Schedule, type Weekday } from "../shared/types.ts";

export { formatDate, formatDay, money } from "../shared/format.ts";

/** Dollars as typed ("5", "$2.50") in whole cents, or null when it isn't an amount. */
export function parseCents(text: string): number | null {
  const match = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Cents as an amount field starts out: "5" for whole dollars, "2.50" otherwise, with no "$". */
export function centsInputText(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
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

/** A calendar date, "YYYY-MM-DD", as its weekday, "Wednesday". Never shifted into another timezone. */
export function weekdayName(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** An instant, as an ISO string, as its day and time in `timeZone` (the profile's): "Thu Oct 22, 9:05pm". */
export function formatDayTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).formatToParts(
    new Date(instant),
  );
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${formatDay(instant, timeZone)}, ${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

/** Time left as "16h 19m", or "3d 4h" from 48 hours up. Never negative. */
export function timeLeft(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes % 60}m`;
}

/** "Sam Lee" → "S". */
export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
