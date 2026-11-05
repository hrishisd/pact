// How the client writes money, schedules, dates and time left.

import { clockText, formatDate, formatDay } from "../shared/format.ts";

export { clockText, formatDate, formatDay, inBedByName, money, scheduleText } from "../shared/format.ts";

/** Dollars as typed ("5", "$2.50", "0.5", ".50") in whole cents, or null when it isn't an amount. */
export function parseCents(text: string): number | null {
  const match = /^\$?\s*(\d*)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** A pact's reminders, in the order they go off: "6:00pm, 8:30pm", "Wed Jan 7, 9:00am" on One-time, or "None". */
export function remindersText(reminders: string[]): string {
  return reminders.length === 0 ? "None" : reminders.map(reminderText).join(", ");
}

/** A reminder: a time of day, "6:00pm", or a One-time pact's "YYYY-MM-DDTHH:MM", "Wed Jan 7, 9:00am". */
function reminderText(reminder: string): string {
  const [date, time] = reminder.split("T");
  return time === undefined ? clockText(reminder) : `${formatDate(date!)}, ${clockText(time)}`;
}

/** Cents as an amount field starts out: "5" for whole dollars, "2.50" otherwise, with no "$". */
export function centsInputText(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
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

/**
 * An instant, as an ISO string, as its day and time in `timeZone` (the
 * profile's), the way bills are due: "Wed Jan 21 at 6pm", or "at 6:30pm"
 * off the hour.
 */
export function formatDueAt(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const clock = clockText(`${part("hour")}:${part("minute")}`);
  return `${formatDay(instant, timeZone)} at ${clock.replace(":00", "")}`;
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

/** An instant, as an ISO string, as a time on this device: "2:24pm". */
export function clockTime(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).formatToParts(
    new Date(instant),
  );
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

/** "Sam Lee" → "S". */
export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Why an Anki day is Missed: how many cards were left at Pact's last check
 * that counted for it ("12 cards left at 11:50pm"), or that no check reached
 * AnkiWeb that day.
 */
export function ankiMissText({ cardsLeft, checkedAt }: { cardsLeft: number | null; checkedAt: string | null }): string {
  if (cardsLeft === null || checkedAt === null) return "AnkiWeb not reached";
  return `${cardsLeft} ${cardsLeft === 1 ? "card" : "cards"} left at ${clockTime(checkedAt)}`;
}
