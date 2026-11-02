// When a pact's occurrences open and fall due. Pure timing, worked out from
// the pact's schedule, its first occurrence and the owner's timezone. Whether
// an occurrence is Kept, Missed or Excused is judging's to decide.

import { WEEKDAYS, type Schedule } from "../shared/types.ts";
import { addDays, localDateOf, startOfDay, weekdayOf, type LocalDate } from "./calendar.ts";

/** One occurrence's timing. */
export interface Occurrence {
  /** Names the occurrence (with its pact): the day its period starts, in the owner's timezone. */
  date: LocalDate;
  opensAt: Date;
  /** Its due time. */
  dueAt: Date;
}

/** What a pact's occurrences follow from, as the pact stores it. */
export interface OccurrenceTerms {
  /** Days Monday first, without repeats. */
  schedule: Schedule;
  firstOccurrence: LocalDate;
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
export function newOccurrenceTerms(schedule: Schedule, createdAt: Date, timezone: string): NewOccurrenceTermsResult {
  const days = WEEKDAYS.filter((day) => schedule.days.includes(day));
  if (days.length === 0) return { ok: false, reason: "no-days" };
  // A day within an hour of its end can be skipped, so look one day past a full week.
  for (let date = localDateOf(createdAt, timezone), i = 0; i <= 7; date = addDays(date, 1), i++) {
    if (!days.includes(weekdayOf(date))) continue;
    const first = fixedDaysOccurrence(date, timezone);
    if (first.dueAt.getTime() - createdAt.getTime() >= FIRST_OCCURRENCE_LEAD_MS) {
      return { ok: true, terms: { schedule: { kind: "fixed-days", days }, firstOccurrence: date }, first };
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
  const includes = (date: LocalDate) => date >= terms.firstOccurrence && terms.schedule.days.includes(weekdayOf(date));
  return {
    first: fixedDaysOccurrence(terms.firstOccurrence, timezone),
    openAt(t) {
      const date = localDateOf(t, timezone);
      if (date < terms.firstOccurrence || !terms.schedule.days.includes(weekdayOf(date))) return null;
      return fixedDaysOccurrence(date, timezone);
    },
    includes,
    dueAfter(after, t) {
      const due: Occurrence[] = [];
      const start = after === null || after < terms.firstOccurrence ? terms.firstOccurrence : addDays(after, 1);
      // Due times only grow with the date, so the first not due yet ends the list.
      for (let date = start; ; date = addDays(date, 1)) {
        const occurrence = fixedDaysOccurrence(date, timezone);
        if (occurrence.dueAt.getTime() > t.getTime()) return due;
        if (terms.schedule.days.includes(weekdayOf(date))) due.push(occurrence);
      }
    },
    between(from, to) {
      const found: Occurrence[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        if (includes(date)) found.push(fixedDaysOccurrence(date, timezone));
      }
      return found;
    },
  };
}

/** A Fixed-days occurrence on `date`: open all day, due at the midnight ending it. */
function fixedDaysOccurrence(date: LocalDate, timezone: string): Occurrence {
  return { date, opensAt: startOfDay(date, timezone), dueAt: startOfDay(addDays(date, 1), timezone) };
}
