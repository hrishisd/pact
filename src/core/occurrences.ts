// When a pact's occurrences open and fall due. Pure timing, worked out from
// the pact's schedule, its first occurrence and the owner's timezone. Whether
// an occurrence is Kept, Missed or Excused is judging's to decide.

import { WEEKDAYS, type Schedule } from "../shared/types.ts";
import {
  addDays,
  localDateOf,
  mondayOf,
  startOfDay,
  weekdayOf,
  zonedWallTimeToInstant,
  type LocalDate,
} from "./calendar.ts";

/** One occurrence's timing. */
export interface Occurrence {
  /** Names the occurrence (with its pact): the day its period starts, in the owner's timezone (a Weekly count week's Monday). */
  date: LocalDate;
  opensAt: Date;
  /**
   * Its due time: midnight ending its day, its due-by time that day, or a
   * bedtime night's in-bed-by time; for a Weekly count week, the end of its Sunday.
   */
  dueAt: Date;
  /**
   * The latest it's judged, with no evidence: its due time, or for a bedtime
   * night 18:00 the next day, when a night Oura never reported counts as missed.
   */
  closesAt: Date;
}

/** What a pact's occurrences follow from, as the pact stores it. */
export interface OccurrenceTerms {
  /** Fixed days' days Monday first, without repeats. */
  schedule: Schedule;
  firstOccurrence: LocalDate;
  /** Bedtime pacts only: the in-bed-by time, "HH:MM". */
  inBedBy?: string | null;
  /**
   * Camera pacts only, optional: the due-by time, "HH:MM", each day's due time
   * instead of midnight. On Weekly count it limits each day's evidence only.
   */
  dueBy?: string | null;
  /** Optional: the pact's last day. Every occurrence ends by it: a Weekly count week counts only if its Sunday does. */
  endDate?: LocalDate | null;
}

/** The optional times a new pact's first occurrence depends on. */
export interface NewOccurrenceOptions {
  inBedBy?: string | null;
  dueBy?: string | null;
  /** The first occurrence is on this day or later. */
  startDate?: LocalDate | null;
}

export type NewOccurrenceTermsResult =
  { ok: true; terms: OccurrenceTerms; first: Occurrence } | { ok: false; reason: "no-days" };

/** A pact's first occurrence is due at least this long after it's created. */
const FIRST_OCCURRENCE_LEAD_MS = 60 * 60 * 1000;

/**
 * The terms a pact made at `createdAt` with `schedule` gets: the schedule as
 * stored, and its first occurrence, the first scheduled day due at least an
 * hour after `createdAt` (by its due-by or in-bed-by time, if it has one),
 * and not before the start date; for Weekly count, the week starting the
 * Monday after `createdAt`, or the first starting on or after the start date.
 * Fixed days with no days is refused.
 */
export function newOccurrenceTerms(
  schedule: Schedule,
  createdAt: Date,
  timezone: string,
  { inBedBy = null, dueBy = null, startDate = null }: NewOccurrenceOptions = {},
): NewOccurrenceTermsResult {
  const created = localDateOf(createdAt, timezone);
  if (schedule.kind === "weekly-count") {
    const firstOccurrence = firstWeekFrom(addDays(created, 1), startDate);
    const terms: OccurrenceTerms = {
      schedule: { kind: "weekly-count", target: schedule.target },
      firstOccurrence,
      ...(dueBy !== null && { dueBy }),
    };
    return { ok: true, terms, first: weekOccurrence(firstOccurrence, timezone) };
  }
  const days = WEEKDAYS.filter((day) => schedule.days.includes(day));
  if (days.length === 0) return { ok: false, reason: "no-days" };
  const from = startDate !== null && startDate > created ? startDate : created;
  // A day within an hour of its due time can be skipped, so look one day past a full week.
  for (let date = from, i = 0; i <= 7; date = addDays(date, 1), i++) {
    if (!days.includes(weekdayOf(date))) continue;
    const first = fixedDaysOccurrence(date, timezone, inBedBy, dueBy);
    if (first.dueAt.getTime() - createdAt.getTime() >= FIRST_OCCURRENCE_LEAD_MS) {
      const terms: OccurrenceTerms = {
        schedule: { kind: "fixed-days", days },
        firstOccurrence: date,
        ...(inBedBy !== null && { inBedBy }),
        ...(dueBy !== null && { dueBy }),
      };
      return { ok: true, terms, first };
    }
  }
  throw new Error("unreachable: every scheduled weekday recurs within 8 days");
}

/**
 * The first Monday on or after `from`, or after the start date if that's
 * later: a Weekly count pact's first week once it starts from `from`.
 */
export function firstWeekFrom(from: LocalDate, startDate: LocalDate | null): LocalDate {
  const start = startDate !== null && startDate > from ? startDate : from;
  const monday = mondayOf(start);
  return monday < start ? addDays(monday, 7) : monday;
}

/** The last day of the period of the occurrence dated `date` on `schedule`: its Sunday for a Weekly count week. */
export function lastDayOf(schedule: Schedule, date: LocalDate): LocalDate {
  return schedule.kind === "weekly-count" ? addDays(date, WEEKDAYS.length - 1) : date;
}

export interface Occurrences {
  /** The pact's first occurrence. Until it opens, the pact is coming up. */
  readonly first: Occurrence;
  /** The occurrence open at `t`: none on a day the schedule skips, or before the first occurrence. */
  openAt(t: Date): Occurrence | null;
  /** The occurrence whose period has the day `day` (a Weekly count week, any of its days), if any. */
  covering(day: LocalDate): Occurrence | null;
  /**
   * When evidence submitted on `day` is due, for the occurrence covering it:
   * that occurrence's due time, or for a Weekly count week that day's due-by
   * time, else midnight ending it. Null with no occurrence covering it.
   */
  dayDueAt(day: LocalDate): Date | null;
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
  /** The pact's occurrences with any day of their period from `from` to `to`, oldest first. */
  overlapping(from: LocalDate, to: LocalDate): Occurrence[];
}

/** The occurrences of a pact with `terms`, in its owner's `timezone`. */
export function occurrences(terms: OccurrenceTerms, timezone: string): Occurrences {
  return occurrencesOverTime([{ until: null, terms }], timezone);
}

/**
 * Terms a pact had for a while: they apply to its occurrences dated before
 * `until` ("YYYY-MM-DD"), or from then on when it's null. A change starts a
 * new era from the first date not open yet.
 */
export interface TermsEra {
  until: LocalDate | null;
  terms: OccurrenceTerms;
}

/**
 * The occurrences of a pact whose terms changed over time: each date follows
 * the era it falls in. `eras` are oldest first, the last with `until` null,
 * and the pact's first occurrence and end date are the last era's.
 */
export function occurrencesOverTime(eras: readonly TermsEra[], timezone: string): Occurrences {
  const termsOn = (date: LocalDate) =>
    (eras.find((era) => era.until === null || date < era.until) ?? eras.at(-1)!).terms;
  const { firstOccurrence, endDate = null } = eras.at(-1)!.terms;
  // A pact's schedule keeps its kind once its edit window has closed, so every era has the same.
  const weekly = eras.at(-1)!.terms.schedule.kind === "weekly-count";
  // The day the period with `day` in it starts: the day itself, or its week's Monday.
  const periodOf = (day: LocalDate) => (weekly ? mondayOf(day) : day);
  // For a day that isn't an occurrence's, as one would be: due times then only grow with the date.
  const occurrence = (date: LocalDate) => {
    if (weekly) return weekOccurrence(mondayOf(date), timezone);
    const terms = termsOn(date);
    return fixedDaysOccurrence(date, timezone, terms.inBedBy ?? null, terms.dueBy ?? null);
  };
  const ended = (date: LocalDate) => endDate !== null && lastDayOf(termsOn(date).schedule, periodOf(date)) > endDate;
  const scheduled = (date: LocalDate) => {
    if (ended(date)) return false;
    const { schedule } = termsOn(date);
    return schedule.kind === "weekly-count" ? date === mondayOf(date) : schedule.days.includes(weekdayOf(date));
  };
  const includes = (date: LocalDate) => date >= firstOccurrence && scheduled(date);
  const covering = (day: LocalDate) => (includes(periodOf(day)) ? occurrence(periodOf(day)) : null);
  const between = (from: LocalDate, to: LocalDate) => {
    const found: Occurrence[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      if (includes(date)) found.push(occurrence(date));
    }
    return found;
  };
  return {
    first: occurrence(firstOccurrence),
    openAt(t) {
      return covering(localDateOf(t, timezone));
    },
    covering,
    dayDueAt(day) {
      const found = covering(day);
      if (!found || !weekly) return found?.dueAt ?? null;
      const { dueBy = null } = termsOn(found.date);
      return dueBy === null ? startOfDay(addDays(day, 1), timezone) : wallTime(day, ...clockOf(dueBy), timezone);
    },
    includes,
    dueAfter(after, t) {
      const due: Occurrence[] = [];
      const start = after === null || after < firstOccurrence ? firstOccurrence : addDays(after, 1);
      // Due times only grow with the date, so the first not due yet ends the list.
      for (let date = start; !ended(date); date = addDays(date, 1)) {
        const next = occurrence(date);
        if (next.dueAt.getTime() > t.getTime()) return due;
        if (scheduled(date)) due.push(next);
      }
      return due;
    },
    between,
    overlapping(from, to) {
      return between(periodOf(from), to);
    },
  };
}

/** A Weekly count week starting on the Monday `date`: open from its start, due at the end of its Sunday. */
function weekOccurrence(date: LocalDate, timezone: string): Occurrence {
  const dueAt = startOfDay(addDays(date, WEEKDAYS.length), timezone);
  return { date, opensAt: startOfDay(date, timezone), dueAt, closesAt: dueAt };
}

/** A bedtime night starts, and the night before closes, at this hour. */
const NIGHT_STARTS_HOUR = 18;

/**
 * A Fixed-days occurrence on `date`, open from the start of its day. It's due
 * at its due-by time that day if it has one, else at the midnight ending its
 * day. A bedtime night is due at its in-bed-by time (that evening from 18:00,
 * else the morning after) and closes at 18:00 the next day.
 */
function fixedDaysOccurrence(
  date: LocalDate,
  timezone: string,
  inBedBy: string | null,
  dueBy: string | null,
): Occurrence {
  const opensAt = startOfDay(date, timezone);
  if (inBedBy === null) {
    const dueAt = dueBy === null ? startOfDay(addDays(date, 1), timezone) : wallTime(date, ...clockOf(dueBy), timezone);
    return { date, opensAt, dueAt, closesAt: dueAt };
  }
  const [hour, minute] = clockOf(inBedBy);
  return {
    date,
    opensAt,
    dueAt: wallTime(hour < NIGHT_STARTS_HOUR ? addDays(date, 1) : date, hour, minute, timezone),
    closesAt: nightStartsAt(addDays(date, 1), timezone),
  };
}

/**
 * When a reminder set for `time` ("HH:MM") goes off for the occurrence dated
 * `date`: that time on its day, or for a bedtime night (`night`), that
 * evening from 18:00, else the morning after, as an in-bed-by time is read.
 */
export function reminderAt(date: LocalDate, time: string, timezone: string, night: boolean): Date {
  const [hour, minute] = clockOf(time);
  return wallTime(night && hour < NIGHT_STARTS_HOUR ? addDays(date, 1) : date, hour, minute, timezone);
}

/** 18:00 on `date` in `timezone`: when the night of `date` starts, and the night before closes. */
export function nightStartsAt(date: LocalDate, timezone: string): Date {
  return wallTime(date, NIGHT_STARTS_HOUR, 0, timezone);
}

/** "HH:MM" as hour and minute. */
function clockOf(time: string): [number, number] {
  return time.split(":").map(Number) as [number, number];
}

function wallTime(date: LocalDate, hour: number, minute: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToInstant(year, month, day, hour, minute, timezone);
}
