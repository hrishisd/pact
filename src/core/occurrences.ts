// When a pact's occurrences open and fall due. Pure timing, worked out from
// the pact's schedule, its first occurrence and the owner's timezone. Whether
// an occurrence is Kept, Missed or Excused is judging's to decide.

import { WEEKDAYS, type Schedule } from "../shared/types.ts";
import { addDays, localDateOf, startOfDay, weekdayOf, zonedWallTimeToInstant, type LocalDate } from "./calendar.ts";

/** One occurrence's timing. */
export interface Occurrence {
  /** Names the occurrence (with its pact): the day its period starts, in the owner's timezone. */
  date: LocalDate;
  opensAt: Date;
  /** Its due time: midnight ending its day, or a bedtime night's in-bed-by time. */
  dueAt: Date;
  /**
   * The latest it's judged, with no evidence: its due time, or for a bedtime
   * night 18:00 the next day, when a night Oura never reported counts as missed.
   */
  closesAt: Date;
}

/** What a pact's occurrences follow from, as the pact stores it. */
export interface OccurrenceTerms {
  /** Days Monday first, without repeats. */
  schedule: Schedule;
  firstOccurrence: LocalDate;
  /** Bedtime pacts only: the in-bed-by time, "HH:MM". */
  inBedBy?: string | null;
}

export type NewOccurrenceTermsResult =
  { ok: true; terms: OccurrenceTerms; first: Occurrence } | { ok: false; reason: "no-days" };

/** A pact's first occurrence is due at least this long after it's created. */
const FIRST_OCCURRENCE_LEAD_MS = 60 * 60 * 1000;

/**
 * The terms a pact made at `createdAt` with `schedule` gets: the schedule as
 * stored, and its first occurrence, the first scheduled day due at least an
 * hour after `createdAt`. A schedule with no days is refused.
 */
export function newOccurrenceTerms(
  schedule: Schedule,
  createdAt: Date,
  timezone: string,
  inBedBy: string | null = null,
): NewOccurrenceTermsResult {
  const days = WEEKDAYS.filter((day) => schedule.days.includes(day));
  if (days.length === 0) return { ok: false, reason: "no-days" };
  // A day within an hour of its end can be skipped, so look one day past a full week.
  for (let date = localDateOf(createdAt, timezone), i = 0; i <= 7; date = addDays(date, 1), i++) {
    if (!days.includes(weekdayOf(date))) continue;
    const first = fixedDaysOccurrence(date, timezone, inBedBy);
    if (first.dueAt.getTime() - createdAt.getTime() >= FIRST_OCCURRENCE_LEAD_MS) {
      const terms: OccurrenceTerms = { schedule: { kind: "fixed-days", days }, firstOccurrence: date };
      return { ok: true, terms: inBedBy === null ? terms : { ...terms, inBedBy }, first };
    }
  }
  throw new Error("unreachable: every scheduled weekday recurs within 8 days");
}

export interface Occurrences {
  /** The pact's first occurrence. Until it opens, the pact is coming up. */
  readonly first: Occurrence;
  /** The occurrence open at `t`: none on a day the schedule skips, or before the first occurrence. */
  openAt(t: Date): Occurrence | null;
  /** Whether the pact has an occurrence dated `date`. */
  includes(date: LocalDate): boolean;
  /**
   * The occurrences dated after `date` (from the first occurrence, if null)
   * whose due time has come by `t`, oldest first: what judging at `t` still
   * has to look at when it has been through `date`.
   */
  dueAfter(date: LocalDate | null, t: Date): Occurrence[];
  /** The pact's occurrences dated `from` to `to`, both included, oldest first. */
  between(from: LocalDate, to: LocalDate): Occurrence[];
}

/** The occurrences of a pact with `terms`, in its owner's `timezone`. */
export function occurrences(terms: OccurrenceTerms, timezone: string): Occurrences {
  const inBedBy = terms.inBedBy ?? null;
  const occurrence = (date: LocalDate) => fixedDaysOccurrence(date, timezone, inBedBy);
  const includes = (date: LocalDate) => date >= terms.firstOccurrence && terms.schedule.days.includes(weekdayOf(date));
  return {
    first: occurrence(terms.firstOccurrence),
    openAt(t) {
      const date = localDateOf(t, timezone);
      if (date < terms.firstOccurrence || !terms.schedule.days.includes(weekdayOf(date))) return null;
      return occurrence(date);
    },
    includes,
    dueAfter(after, t) {
      const due: Occurrence[] = [];
      const start = after === null || after < terms.firstOccurrence ? terms.firstOccurrence : addDays(after, 1);
      // Due times only grow with the date, so the first not due yet ends the list.
      for (let date = start; ; date = addDays(date, 1)) {
        const next = occurrence(date);
        if (next.dueAt.getTime() > t.getTime()) return due;
        if (terms.schedule.days.includes(weekdayOf(date))) due.push(next);
      }
    },
    between(from, to) {
      const found: Occurrence[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        if (includes(date)) found.push(occurrence(date));
      }
      return found;
    },
  };
}

/** A bedtime night starts, and the night before closes, at this hour. */
const NIGHT_STARTS_HOUR = 18;

/**
 * A Fixed-days occurrence on `date`, open from the start of its day. Without
 * an in-bed-by time it's due at the midnight ending its day. A bedtime night
 * is due at its in-bed-by time (that evening from 18:00, else the morning
 * after) and closes at 18:00 the next day.
 */
function fixedDaysOccurrence(date: LocalDate, timezone: string, inBedBy: string | null): Occurrence {
  const opensAt = startOfDay(date, timezone);
  if (inBedBy === null) {
    const dueAt = startOfDay(addDays(date, 1), timezone);
    return { date, opensAt, dueAt, closesAt: dueAt };
  }
  const [hour, minute] = inBedBy.split(":").map(Number) as [number, number];
  return {
    date,
    opensAt,
    dueAt: wallTime(hour < NIGHT_STARTS_HOUR ? addDays(date, 1) : date, hour, minute, timezone),
    closesAt: nightStartsAt(addDays(date, 1), timezone),
  };
}

/** 18:00 on `date` in `timezone`: when the night of `date` starts, and the night before closes. */
export function nightStartsAt(date: LocalDate, timezone: string): Date {
  return wallTime(date, NIGHT_STARTS_HOUR, 0, timezone);
}

function wallTime(date: LocalDate, hour: number, minute: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToInstant(year, month, day, hour, minute, timezone);
}
