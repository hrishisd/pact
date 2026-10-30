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
}

/** The occurrences of a pact with `terms`, in its owner's `timezone`. */
export function occurrences(terms: OccurrenceTerms, timezone: string): Occurrences {
  return {
    first: fixedDaysOccurrence(terms.firstOccurrence, timezone),
    openAt(t) {
      const date = localDateOf(t, timezone);
      if (date < terms.firstOccurrence || !terms.schedule.days.includes(weekdayOf(date))) return null;
      return fixedDaysOccurrence(date, timezone);
    },
  };
}

/** A Fixed-days occurrence on `date`: open all day, due at the midnight ending it. */
function fixedDaysOccurrence(date: LocalDate, timezone: string): Occurrence {
  return { date, opensAt: startOfDay(date, timezone), dueAt: startOfDay(addDays(date, 1), timezone) };
}
