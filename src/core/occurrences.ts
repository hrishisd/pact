// When a pact's occurrences open and fall due. Pure timing, worked out from
// the pact's schedule, its first occurrence and the owner's timezone. Whether
// an occurrence is Satisfied, Missed or Excused is judging's to decide.

import {
  NIGHT_CLOSES_AT,
  WEEKDAYS,
  type ClockTime,
  type DatedReminder,
  type LocalDate,
  type Schedule,
} from "../shared/types.ts";
import { addDays, dayCount, parseClockTime, parseDatedReminder, parseLocalDate } from "../shared/calendar.ts";
import { isPeriodSchedule, lastDayOf, type OncePerPeriodKind, type PeriodSchedule } from "../shared/schedules.ts";
import { laterDate, localDateOf, mondayOf, startOfDay, wallTime, weekdayOf } from "./calendar.ts";

/** One occurrence's timing. */
export interface Occurrence {
  /** Names the occurrence (with its pact): the day its period starts, in the owner's timezone (a week's Monday, a month's 1st). */
  date: LocalDate;
  opensAt: Date;
  /**
   * Its due time: midnight ending its day, its due-by time that day, or a
   * bedtime night's in-bed-by time; for a period schedule's period, the end of its last day.
   */
  dueAt: Date;
  /**
   * The latest it's judged, with no evidence: its due time, or for a bedtime
   * night 18:00 the next day (on Oura's clock, if it's given one), when a night
   * Oura never reported counts as missed.
   */
  closesAt: Date;
}

type FixedDays = Extract<Schedule, { kind: "fixed-days" }>;
type OneTimeSchedule = Extract<Schedule, { kind: "one-time" }>;

/**
 * A pact's day clock: when each of its Fixed days is due, and the hour its
 * day starts, from which its clock times are read (a time before that hour
 * is the morning after).
 * - `day`, a Camera pact's: midnight to midnight, due at its due-by time,
 *   or with none, the midnight ending it.
 * - `night`, a bedtime pact's: from 18:00 (`NIGHT_STARTS_HOUR`), due at its
 *   in-bed-by time.
 * - `anki`, an Anki pact's: from `rollover`, the hour 0–23 the collection's
 *   Anki day starts at, until that hour the next day; due at its due-by time,
 *   read as `ankiDueByDayAfter` reads it, or with none, the midnight ending
 *   its date.
 */
export type DayClock =
  | { kind: "day"; dueBy: ClockTime | null }
  | { kind: "night"; inBedBy: ClockTime }
  | { kind: "anki"; rollover: number; dueBy: ClockTime | null };

/**
 * A recurring schedule's terms, those a change gives the occurrences from
 * a date on: Fixed days, each due on the pact's day clock; or a period
 * schedule (Camera only), whose due-by time, if any, limits each day's evidence.
 */
export type RecurringTerms =
  { schedule: FixedDays; day: DayClock } | { schedule: PeriodSchedule; dueBy: ClockTime | null };

/**
 * A One-time pact's terms (Camera only): due at its due-by time on the
 * deadline's date, or with none, the midnight ending it. With Submit
 * anytime it opens at `createdAt`, when the pact was made.
 */
export interface OneTimeTerms {
  schedule: OneTimeSchedule;
  dueBy: ClockTime | null;
  createdAt: Date;
}

/**
 * What a pact's occurrences follow from, as the pact stores it: by its
 * schedule's kind (Fixed days' days Monday first, without repeats), its
 * first occurrence, and its end date.
 */
export type OccurrenceTerms = (RecurringTerms | OneTimeTerms) & {
  firstOccurrence: LocalDate;
  /**
   * Optional: the pact's last day. Every occurrence ends by it: a period
   * counts only if its last day does. A One-time pact has none.
   */
  endDate: LocalDate | null;
};

/** Whether `terms` are on a schedule of kind `kind`. */
export function hasSchedule<T extends { schedule: Schedule }, K extends Schedule["kind"]>(
  terms: T,
  kind: K,
): terms is Extract<T, { schedule: { kind: K } }> {
  return terms.schedule.kind === kind;
}

/** Whether `terms` are on a period schedule (`PeriodSchedule`). */
export function hasPeriodSchedule<T extends { schedule: Schedule }>(
  terms: T,
): terms is Extract<T, { schedule: PeriodSchedule }> {
  return isPeriodSchedule(terms.schedule);
}

/** A new pact's terms by its schedule's kind: those `OccurrenceTerms` has, but its creation time. */
export type NewTerms = RecurringTerms | Omit<OneTimeTerms, "createdAt">;

export type NewOccurrenceTermsResult =
  { ok: true; terms: OccurrenceTerms; first: Occurrence } | { ok: false; reason: "no-days" | "deadline-too-soon" };

/** A pact's first occurrence is due at least this long after it's created. */
const FIRST_OCCURRENCE_LEAD_MS = 60 * 60 * 1000;

/**
 * The terms a pact made at `createdAt` with `terms` gets: the schedule as
 * stored, and its first occurrence, the first scheduled day due at least an
 * hour after `createdAt` (by its day clock), and not before `startDate`;
 * for a period schedule, `firstPeriod`'s; for One-time, its one occurrence,
 * which must be due at least an hour after `createdAt` (a start date doesn't
 * apply). Fixed days with no days is refused.
 */
export function newOccurrenceTerms(
  terms: NewTerms,
  createdAt: Date,
  timezone: string,
  startDate: LocalDate | null,
): NewOccurrenceTermsResult {
  const created = localDateOf(createdAt, timezone);
  if (hasSchedule(terms, "one-time")) {
    const { deadline, submitAnytime } = terms.schedule;
    const oneTime = { schedule: { kind: "one-time", deadline, submitAnytime } as const, dueBy: terms.dueBy, createdAt };
    const first = oneTimeOccurrence(oneTime, timezone);
    if (!dueSoonEnough(first, createdAt)) return { ok: false, reason: "deadline-too-soon" };
    return { ok: true, terms: { ...oneTime, firstOccurrence: deadline, endDate: null }, first };
  }
  if (hasPeriodSchedule(terms)) {
    const { schedule, dueBy } = terms;
    const firstOccurrence = firstPeriod(schedule, createdAt, timezone, startDate);
    return {
      ok: true,
      terms: { schedule, dueBy, firstOccurrence, endDate: null },
      first: periodOccurrence(schedule, firstOccurrence, timezone),
    };
  }
  const days = WEEKDAYS.filter((day) => terms.schedule.days.includes(day));
  if (days.length === 0) return { ok: false, reason: "no-days" };
  const from = startDate !== null && startDate > created ? startDate : created;
  // A day within an hour of its due time can be skipped, so look one day past a full week.
  for (let date = from, i = 0; i <= 7; date = addDays(date, 1), i++) {
    if (!days.includes(weekdayOf(date))) continue;
    const first = fixedDaysOccurrence(date, timezone, terms.day, null);
    if (dueSoonEnough(first, createdAt)) {
      const schedule = { kind: "fixed-days", days } as const;
      return { ok: true, terms: { schedule, day: terms.day, firstOccurrence: date, endDate: null }, first };
    }
  }
  throw new Error("unreachable: every scheduled weekday recurs within 8 days");
}

/** Whether `occurrence` is due at least an hour after `at`: a first occurrence, or a One-time deadline once changed. */
export function dueSoonEnough(occurrence: Occurrence, at: Date): boolean {
  return occurrence.dueAt.getTime() - at.getTime() >= FIRST_OCCURRENCE_LEAD_MS;
}

/**
 * The first period of a pact on `schedule` made at `createdAt`: with a start
 * date after the day it's made, the first period starting on or after it.
 * Otherwise, for Weekly count, the week starting the Monday after; for Every
 * 2 weeks and Once a month, the period that has the day it's made, if it's
 * due at least an hour after, else the next one.
 */
function firstPeriod(
  schedule: PeriodSchedule,
  createdAt: Date,
  timezone: string,
  startDate: LocalDate | null,
): LocalDate {
  const created = localDateOf(createdAt, timezone);
  if (schedule.kind === "weekly-count") return firstPeriodFrom(schedule, addDays(created, 1), startDate);
  if (startDate !== null && startDate > created) return firstPeriodFrom(schedule, startDate, null);
  const { current, next } = offeredPeriods(schedule, createdAt, timezone);
  return (current ?? next).date;
}

/**
 * The first periods a pact on Every 2 weeks or Once a month made at
 * `createdAt` can have: the one that has the day it's made, unless that's due
 * less than an hour after (then null), and the next month, or the two weeks
 * from next Monday.
 */
export function offeredPeriods(
  schedule: PeriodSchedule & { kind: OncePerPeriodKind },
  createdAt: Date,
  timezone: string,
): { current: Occurrence | null; next: Occurrence } {
  const created = localDateOf(createdAt, timezone);
  // Two weeks are counted from the first, so the current two start this Monday, the next two next Monday.
  const date = schedule.kind === "once-a-month" ? firstOfMonth(created) : mondayOf(created);
  const current = periodOccurrence(schedule, date, timezone);
  const nextDate = schedule.kind === "once-a-month" ? addDays(lastDayOf(schedule, date), 1) : addDays(date, 7);
  const next = periodOccurrence(schedule, nextDate, timezone);
  return { current: dueSoonEnough(current, createdAt) ? current : null, next };
}

/**
 * The first day a period on `schedule` can start on, on or after `from`, or
 * after the start date if that's later: a Monday, or a month's 1st. A pact's
 * first period once it starts from `from`.
 */
export function firstPeriodFrom(schedule: PeriodSchedule, from: LocalDate, startDate: LocalDate | null): LocalDate {
  const start = startDate !== null && startDate > from ? startDate : from;
  if (schedule.kind === "once-a-month") {
    const first = firstOfMonth(start);
    return first < start ? addDays(lastDayOf(schedule, first), 1) : first;
  }
  const monday = mondayOf(start);
  return monday < start ? addDays(monday, 7) : monday;
}

/**
 * The first day of the period that has the day `day`, for a pact on
 * `schedule` whose first occurrence is `first`: its week's Monday; the
 * Monday starting its two weeks, counted from `first`; or its month's 1st.
 */
export function periodStart(schedule: PeriodSchedule, first: LocalDate, day: LocalDate): LocalDate {
  switch (schedule.kind) {
    case "weekly-count":
      return mondayOf(day);
    case "every-2-weeks": {
      const fortnights = Math.floor((dayCount(first, mondayOf(day)) - 1) / 14);
      return addDays(first, fortnights * 14);
    }
    case "once-a-month":
      return firstOfMonth(day);
  }
}

/** The 1st of `date`'s month. */
function firstOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 8)}01`;
}

export interface Occurrences {
  /** The pact's first occurrence. Until it opens, the pact is coming up. */
  readonly first: Occurrence;
  /**
   * The occurrence open at `t`: none on a day the schedule skips, or before
   * the first occurrence. An Anki day is open from its rollover hour until
   * the rollover hour the next day.
   */
  openAt(t: Date): Occurrence | null;
  /** The occurrence whose period has the day `day` (on a period schedule, any of its days), if any. */
  covering(day: LocalDate): Occurrence | null;
  /**
   * When evidence submitted on `day` is due, for the occurrence covering it:
   * that occurrence's due time, or on a period schedule that day's due-by
   * time, else midnight ending it. Null with no occurrence covering it.
   */
  dayDueAt(day: LocalDate): Date | null;
  /** Whether the pact has an occurrence dated `date`. */
  includes(date: LocalDate): boolean;
  /** The timezone the occurrence whose period has the day `day` is worked out in (see `EarlierTimezone`). */
  timezoneOn(day: LocalDate): string;
  /**
   * The occurrences dated after `date` (from the first occurrence, if null)
   * whose due time has come by `t`, oldest first: what judging at `t` still
   * has to look at when it has been through `date`. After a move east one
   * can be due before an older one that isn't.
   */
  dueAfter(date: LocalDate | null, t: Date): Occurrence[];
  /** The pact's occurrences dated `from` to `to`, both included, oldest first. */
  between(from: LocalDate, to: LocalDate): Occurrence[];
  /** The pact's occurrences with any day of their period from `from` to `to`, oldest first. */
  overlapping(from: LocalDate, to: LocalDate): Occurrence[];
}

/**
 * The clock a bedtime night's 18:00 is read on, when it isn't the owner's
 * timezone: a fixed UTC offset, "+01:00" or "-10:00", the one Oura's
 * timestamps carry where the owner is. Null reads it in the owner's timezone.
 */
export type OuraOffset = string | null;

/**
 * The Oura clock the bedtime night dated `night`, worked out in `timezone`,
 * closes on: each night keeps the one it opened on (`ouraClockOf`, rows.ts).
 */
export type OuraClock = (night: LocalDate, timezone: string) => OuraOffset;

/**
 * The occurrences of a pact with `terms`, in its owner's `timezone`. A bedtime
 * night closes at 18:00 the next day on `ouraOffset`'s clock, if there is one.
 */
export function occurrences(terms: OccurrenceTerms, timezone: string, ouraOffset: OuraOffset = null): Occurrences {
  return occurrencesOverTime(terms, [], timezone, () => ouraOffset);
}

/**
 * A timezone the pact's owner had before a change: it applies to the pact's
 * occurrences dated before `until`, the day after the day of the change
 * there (or in the new timezone, if that's later), so an occurrence open or
 * past keeps the timezone it opened in.
 */
export interface EarlierTimezone {
  timezone: string;
  until: LocalDate;
}

/** The timezone an occurrence is worked out in. */
type Zone = Omit<EarlierTimezone, "until">;

/** A pact's zones over time: `earlier` ones, oldest first, then `current`. */
interface Zones {
  earlier: readonly EarlierTimezone[];
  current: Zone;
}

/** The zone of the date `date`: the first earlier one it's dated before, else the current one. */
function zoneOn({ earlier, current }: Zones, date: LocalDate): Zone {
  return earlier.find((zone) => date < zone.until) ?? current;
}

/**
 * Terms a pact had before a change: they apply to its occurrences dated
 * before `until` ("YYYY-MM-DD"). A change starts new terms from the first
 * date not open yet. A One-time change applies to its one occurrence, so
 * only a recurring schedule has them.
 */
export type EarlierTerms = RecurringTerms & { until: LocalDate };

/**
 * The occurrences of a pact whose terms, or its owner's timezone, changed
 * over time: each date follows the first of `earlier` (oldest first) it's
 * dated before, else `current`, and is worked out in the first of
 * `earlierTimezones` (oldest first) it's dated before, else `timezone`. A
 * period goes by its first day. The first occurrence and end date
 * are always `current`'s. A bedtime night closes on `ouraClock`'s clock for
 * it; with none, in the timezone it's worked out in.
 */
export function occurrencesOverTime(
  current: OccurrenceTerms,
  earlier: readonly EarlierTerms[],
  timezone: string,
  ouraClock: OuraClock | null = null,
  earlierTimezones: readonly EarlierTimezone[] = [],
): Occurrences {
  const zones: Zones = { earlier: earlierTimezones, current: { timezone } };
  const timezoneOn = (date: LocalDate) => zoneOn(zones, date).timezone;
  if (hasSchedule(current, "one-time")) {
    // One occurrence, which a change applies to even once it's open: only the current terms count. With
    // Submit anytime it opened when the pact was made, before every change of timezone since.
    const { submitAnytime, deadline } = current.schedule;
    return oneTimeOccurrences(
      current,
      submitAnytime ? (earlierTimezones[0]?.timezone ?? timezone) : timezoneOn(deadline),
    );
  }
  if (hasPeriodSchedule(current)) {
    const { schedule, firstOccurrence } = current;
    const periods = sameKind(earlier, schedule.kind);
    const dueByOn = (date: LocalDate) => (periods.find((terms) => date < terms.until) ?? current).dueBy;
    const periodOf = (day: LocalDate) => periodStart(schedule, firstOccurrence, day);
    return recurringOccurrences(current, zones, {
      periodOf,
      // For a day that doesn't start a period, its period's.
      occurrence: (date) => periodOccurrence(schedule, periodOf(date), timezoneOn(periodOf(date))),
      scheduled: (date) => date === periodOf(date),
      dayDueAt: (day, period) => dueOnDay(day, dueByOn(period.date), timezoneOn(period.date)),
      rollover: null,
    });
  }
  const days = sameKind(earlier, "fixed-days");
  const termsOn = (date: LocalDate) => days.find((terms) => date < terms.until) ?? current;
  return recurringOccurrences(current, zones, {
    periodOf: (day) => day,
    // For a day that isn't an occurrence's, as one would be.
    occurrence: (date) => {
      const zone = zoneOn(zones, date);
      return fixedDaysOccurrence(date, zone.timezone, termsOn(date).day, ouraClock?.(date, zone.timezone) ?? null);
    },
    scheduled: (date) => termsOn(date).schedule.days.includes(weekdayOf(date)),
    dayDueAt: (_day, occurrence) => occurrence.dueAt,
    // An Anki pact keeps the rollover hour it was made with.
    rollover: current.day.kind === "anki" ? current.day.rollover : null,
  });
}

/**
 * `earlier` as terms on a schedule of kind `kind`, the current terms'. A
 * pact's schedule keeps its kind once its edit window has closed, and only a
 * change after that leaves earlier terms, so they all have the same.
 */
function sameKind<K extends RecurringTerms["schedule"]["kind"]>(
  earlier: readonly EarlierTerms[],
  kind: K,
): Extract<EarlierTerms, { schedule: { kind: K } }>[] {
  return earlier.map((terms) => {
    if (!hasSchedule(terms, kind)) throw new Error(`terms until ${terms.until} aren't on a ${kind} schedule`);
    return terms;
  });
}

/** How a recurring schedule's periods fall: what `recurringOccurrences` needs to know of it. */
interface Periods {
  /** The day the period with `day` in it starts: the day itself, or its period's first day. */
  periodOf(day: LocalDate): LocalDate;
  /**
   * The occurrence dated `date`, or for a date that isn't one's, as one
   * would be: due times then only grow with the date, in one timezone.
   */
  occurrence(date: LocalDate): Occurrence;
  /** Whether the schedule has an occurrence dated `date`, before the end date is applied. */
  scheduled(date: LocalDate): boolean;
  /** When evidence submitted on `day`, in `occurrence`'s period, is due. */
  dayDueAt(day: LocalDate, occurrence: Occurrence): Date;
  /** The hour each day opens at, for an Anki day; else null for the start of its day. */
  rollover: number | null;
}

/**
 * The occurrences of recurring `terms` whose periods fall as `periods` says,
 * from their first occurrence to their end date, each in the zone of its
 * period's first day.
 */
function recurringOccurrences(
  terms: OccurrenceTerms,
  zones: Zones,
  { periodOf, occurrence, scheduled, dayDueAt, rollover }: Periods,
): Occurrences {
  const { schedule, firstOccurrence, endDate } = terms;
  const ended = (date: LocalDate) => endDate !== null && lastDayOf(schedule, periodOf(date)) > endDate;
  const includes = (date: LocalDate) => date >= firstOccurrence && !ended(date) && scheduled(date);
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
      // The day it is at `t` in each zone, if that zone has it. After a move east the last day in
      // the old timezone and the first in the new one are both open for some hours: the older
      // one is the open one until it's due.
      const open: Occurrence[] = [];
      for (const zone of [...zones.earlier, zones.current]) {
        let day = localDateOf(t, zone.timezone);
        if (rollover !== null && t.getTime() < wallTime(day, rollover, 0, zone.timezone).getTime()) {
          day = addDays(day, -1);
        }
        const found = zoneOn(zones, periodOf(day)) === zone ? covering(day) : null;
        if (found !== null) open.push(found);
      }
      return open.find((o) => t.getTime() < o.dueAt.getTime()) ?? open.at(-1) ?? null;
    },
    covering,
    dayDueAt(day) {
      const found = covering(day);
      return found && dayDueAt(day, found);
    },
    includes,
    timezoneOn: (day) => zoneOn(zones, periodOf(day)).timezone,
    dueAfter(after, t) {
      const due: Occurrence[] = [];
      const start = after === null || after < firstOccurrence ? firstOccurrence : addDays(after, 1);
      for (let date = start; !ended(date); date = addDays(date, 1)) {
        const next = occurrence(date);
        if (next.dueAt.getTime() > t.getTime()) {
          // Due times only grow with the date in one zone, so the first not due yet ends that zone's
          // dates. A later zone, further east, may have some due before it.
          const zone = zones.earlier.find((earlier) => periodOf(date) < earlier.until);
          if (zone === undefined) return due;
          // The loop goes on from `until`, or from the next day if a week from before it holds `until`.
          date = laterDate(date, addDays(zone.until, -1));
          continue;
        }
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

/**
 * A One-time pact's occurrences: just the one, dated by the deadline's date.
 * Its period runs from that date (from the pact's creation, with Submit
 * anytime) to the deadline, and evidence on any day of it is due then.
 */
function oneTimeOccurrences(terms: OneTimeTerms, timezone: string): Occurrences {
  const only = oneTimeOccurrence(terms, timezone);
  const firstDay = localDateOf(only.opensAt, timezone);
  const covering = (day: LocalDate) => (day >= firstDay && day <= only.date ? only : null);
  const between = (from: LocalDate, to: LocalDate) => (from <= only.date && only.date <= to ? [only] : []);
  return {
    first: only,
    openAt: (t) => (t.getTime() >= only.opensAt.getTime() ? covering(localDateOf(t, timezone)) : null),
    covering,
    dayDueAt: (day) => covering(day)?.dueAt ?? null,
    includes: (date) => date === only.date,
    timezoneOn: () => timezone,
    dueAfter: (after, t) =>
      (after === null || after < only.date) && only.dueAt.getTime() <= t.getTime() ? [only] : [],
    between,
    overlapping: (from, to) => (from <= only.date && firstDay <= to ? [only] : []),
  };
}

/**
 * A One-time occurrence: due at the due-by time on the deadline's date, or the
 * midnight ending it. It opens at the start of that date, or with Submit
 * anytime when the pact was created.
 */
function oneTimeOccurrence({ schedule, dueBy, createdAt }: OneTimeTerms, timezone: string): Occurrence {
  const date = schedule.deadline;
  const dueAt = dueOnDay(date, dueBy, timezone);
  const dayStarts = startOfDay(date, timezone);
  const opensAt = schedule.submitAnytime && createdAt < dayStarts ? createdAt : dayStarts;
  return { date, opensAt, dueAt, closesAt: dueAt };
}

/** When a day `date` is due: at its due-by time `dueBy` that day, or with none, the midnight ending it. */
function dueOnDay(date: LocalDate, dueBy: ClockTime | null, timezone: string): Date {
  if (dueBy === null) return startOfDay(addDays(date, 1), timezone);
  const { hour, minute } = parseClockTime(dueBy);
  return wallTime(date, hour, minute, timezone);
}

/** The period on `schedule` starting on `date`: open from its start, due at the end of its last day. */
function periodOccurrence(schedule: PeriodSchedule, date: LocalDate, timezone: string): Occurrence {
  const dueAt = startOfDay(addDays(lastDayOf(schedule, date), 1), timezone);
  return { date, opensAt: startOfDay(date, timezone), dueAt, closesAt: dueAt };
}

/** A bedtime night starts, and the night before closes, at this hour. */
export const NIGHT_STARTS_HOUR = NIGHT_CLOSES_AT;

/** An Anki day can't be due on its own day before this hour. */
const ANKI_EVENING_HOUR = 12;

const MINUTES_PER_DAY = 24 * 60;

/**
 * When an Anki day of `date` is due by `dueBy`, with its Anki day
 * starting at `rolloverHour`: that day, from noon and after the rollover
 * hour; else the morning after, up to the rollover hour, while it's still
 * that Anki day. Null for a time that's neither, such as 09:00 with Anki's
 * usual 4am rollover. "00:00" is the midnight ending its day.
 */
function ankiDueByDayAfter(dueBy: ClockTime, rolloverHour: number): 0 | 1 | null {
  const time = minutesFrom(dueBy, 0);
  if (time >= ANKI_EVENING_HOUR * 60 && time > rolloverHour * 60) return 0;
  return time <= rolloverHour * 60 ? 1 : null;
}

/** Whether an Anki pact can be due by `dueBy` with its Anki day starting at `rolloverHour`; see `ankiDueByDayAfter`. */
export function ankiDueByFits(dueBy: ClockTime, rolloverHour: number): boolean {
  return ankiDueByDayAfter(dueBy, rolloverHour) !== null;
}

/** `ankiDueByDayAfter` for a time already checked with `ankiDueByFits`: throws for one that can't fit. */
function fittingAnkiDueByDayAfter(dueBy: ClockTime, rolloverHour: number): 0 | 1 {
  const dayAfter = ankiDueByDayAfter(dueBy, rolloverHour);
  if (dayAfter === null) throw new Error(`an Anki day starting at ${rolloverHour}:00 can't be due by ${dueBy}`);
  return dayAfter;
}

/**
 * Minutes from `startHour`:00 to `time`, reading a time before
 * `startHour` as the day after: how times sort in a day that starts then,
 * such as a bedtime night (`NIGHT_STARTS_HOUR`) or an Anki day (its rollover hour).
 */
export function minutesFrom(time: ClockTime, startHour: number): number {
  const { hour, minute } = parseClockTime(time);
  return (hour * 60 + minute - startHour * 60 + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Minutes from when an Anki day opens to its due-by time `dueBy` (null for
 * midnight), read as `ankiDueByDayAfter` reads it: how due-by
 * times sort, the later the looser. Throws for a time it can't be due by,
 * which is refused before this.
 */
export function ankiDueByOrder(dueBy: ClockTime | null, rolloverHour: number): number {
  const time = dueBy ?? "00:00";
  const dayAfter = fittingAnkiDueByDayAfter(time, rolloverHour);
  return dayAfter * MINUTES_PER_DAY + minutesFrom(time, 0) - rolloverHour * 60;
}

/**
 * A Fixed-days occurrence on `date`, on the day clock `day`. A day opens at
 * the start of its date, and is due at its due-by time that day if it has
 * one, else at the midnight ending it. A bedtime night opens then too, is due
 * at its in-bed-by time (that evening from 18:00, else the morning after) and
 * closes at 18:00 the next day, on Oura's clock (`ouraOffset`) if there is
 * one. An Anki day opens at its rollover hour, and its due-by time is read as
 * `ankiDueByDayAfter` reads it.
 */
function fixedDaysOccurrence(date: LocalDate, timezone: string, day: DayClock, ouraOffset: OuraOffset): Occurrence {
  switch (day.kind) {
    case "day": {
      const dueAt = dueOnDay(date, day.dueBy, timezone);
      return { date, opensAt: startOfDay(date, timezone), dueAt, closesAt: dueAt };
    }
    case "night": {
      const { hour, minute } = parseClockTime(day.inBedBy);
      return {
        date,
        opensAt: startOfDay(date, timezone),
        dueAt: wallTime(hour < NIGHT_STARTS_HOUR ? addDays(date, 1) : date, hour, minute, timezone),
        closesAt: nightStartsAt(addDays(date, 1), timezone, ouraOffset),
      };
    }
    case "anki": {
      const { rollover, dueBy } = day;
      // A due-by time that can't fit is refused before this.
      const dueDay = dueBy === null ? date : addDays(date, fittingAnkiDueByDayAfter(dueBy, rollover));
      const dueAt = dueOnDay(dueDay, dueBy, timezone);
      return { date, opensAt: wallTime(date, rollover, 0, timezone), dueAt, closesAt: dueAt };
    }
  }
}

/**
 * The hour each day of a pact with `terms` starts, from which its clock times
 * are read: a time before it is the morning after. Midnight on Weekly count;
 * on Fixed days, as its day clock says.
 */
export function dayStartHour(terms: RecurringTerms): number {
  if (!hasSchedule(terms, "fixed-days")) return 0;
  switch (terms.day.kind) {
    case "day":
      return 0;
    case "night":
      return NIGHT_STARTS_HOUR;
    case "anki":
      return terms.day.rollover;
  }
}

/**
 * When a reminder set for `time` goes off for the occurrence (or Weekly
 * count day) dated `date` of a pact with `terms`: that time on its date, or
 * the morning after for a time before its day starts (`dayStartHour`): a
 * bedtime night's from 18:00, an Anki day's from its rollover hour.
 */
export function reminderAt(date: LocalDate, time: ClockTime, timezone: string, terms: RecurringTerms): Date {
  const { hour, minute } = parseClockTime(time);
  return wallTime(hour < dayStartHour(terms) ? addDays(date, 1) : date, hour, minute, timezone);
}

/** When a One-time pact's reminder, on the owner's clock, goes off. */
export function oneTimeReminderAt(reminder: DatedReminder, timezone: string): Date {
  const { date, time } = parseDatedReminder(reminder);
  const { hour, minute } = parseClockTime(time);
  return wallTime(date, hour, minute, timezone);
}

/**
 * 18:00 on `date`, on Oura's clock (`ouraOffset`) or else in `timezone`: when
 * the night of `date` starts, and the night before closes.
 */
export function nightStartsAt(date: LocalDate, timezone: string, ouraOffset: OuraOffset = null): Date {
  return nightClockTime(date, NIGHT_STARTS_HOUR, timezone, ouraOffset);
}

/**
 * 15:00 the day after `date`, on the clock the night closes on: a night of
 * `date` still not judged then sends its owner one push.
 */
export function noOuraDataPushAt(date: LocalDate, timezone: string, ouraOffset: OuraOffset = null): Date {
  return nightClockTime(addDays(date, 1), NIGHT_STARTS_HOUR - 3, timezone, ouraOffset);
}

/** `hour`:00 on `date` at the UTC offset `ouraOffset`, or in `timezone` with none. */
function nightClockTime(date: LocalDate, hour: number, timezone: string, ouraOffset: OuraOffset): Date {
  if (ouraOffset === null) return wallTime(date, hour, 0, timezone);
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day, hour) - utcOffsetMs(ouraOffset));
}

/** A UTC offset "+HH:MM" or "-HH:MM" in ms, negative west of UTC. */
export function utcOffsetMs(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new Error(`unreadable UTC offset "${offset}"`);
  const [, sign, hours, minutes] = match as unknown as [string, string, string, string];
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
}
