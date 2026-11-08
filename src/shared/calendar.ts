// Reading and stepping the day and clock strings the core and the client
// share. No timezone here: these are days and clock times as written.

import type { ClockTime, DatedReminder, LocalDate } from "./types.ts";

/** A "YYYY-MM-DD" day's numbers, `month` counting from 1. */
export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const [year = NaN, month = NaN, day = NaN] = date.split("-").map(Number);
  return { year, month, day };
}

/** An "HH:MM" clock time's numbers. */
export function parseClockTime(time: ClockTime): { hour: number; minute: number } {
  const [hour = NaN, minute = NaN] = time.split(":").map(Number);
  return { hour, minute };
}

/** A "YYYY-MM-DDTHH:MM" reminder's day and clock time; `time` is "" when there's no "T". */
export function parseDatedReminder(reminder: DatedReminder): { date: LocalDate; time: ClockTime } {
  const [date = "", time = ""] = reminder.split("T");
  return { date, time };
}

/** The day `days` after `date` (before it, when negative). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** How many days run from `from` to `to`, both included: 1 for a single day. */
export function dayCount(from: LocalDate, to: LocalDate): number {
  const utc = (date: LocalDate) => {
    const { year, month, day } = parseLocalDate(date);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}
