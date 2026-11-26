// Reading a sleep's timestamps on the clock its night is read on. A
// timestamp here carries the UTC offset of that clock: Oura's own, where the
// ring was, for an Oura Ring night (`nightClockOf`, rows.ts).

import { addDays, parseClockTime } from "../shared/calendar.ts";
import type { ClockTime, LocalDate } from "../shared/types.ts";
import { NIGHT_STARTS_HOUR } from "./occurrences.ts";

/**
 * A timestamp read on the clock it was written with: "YYYY-MM-DDTHH:MM".
 * Oura's timestamps carry the UTC offset where the ring was, so their wall
 * time is the time there.
 */
export function wallClock(timestamp: string): string {
  return timestamp.slice(0, 16);
}

/**
 * The UTC offset `timestamp` carries, "+HH:MM" or "-HH:MM" ("Z" is "+00:00"),
 * or null for a timestamp written without one.
 */
export function utcOffsetOf(timestamp: string): string | null {
  if (timestamp.endsWith("Z")) return "+00:00";
  return /T.*([+-]\d{2}:\d{2})$/.exec(timestamp)?.[1] ?? null;
}

/** The night a sleep starting at `timestamp` counts for: its day from 18:00, else the day before. */
export function nightOf(timestamp: string): LocalDate {
  const date = timestamp.slice(0, 10);
  return Number(timestamp.slice(11, 13)) >= NIGHT_STARTS_HOUR ? date : addDays(date, -1);
}

/** The night of `date`'s in-bed-by deadline as a wall-clock "YYYY-MM-DDTHH:MM". */
export function deadlineWallClock(date: LocalDate, inBedBy: ClockTime): string {
  return `${parseClockTime(inBedBy).hour >= NIGHT_STARTS_HOUR ? date : addDays(date, 1)}T${inBedBy}`;
}
