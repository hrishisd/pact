// When a pact's occurrences open and fall due. Pure timing, worked out from
// the pact's schedule, its first occurrence and the owner's timezone. Whether
// an occurrence is Satisfied, Missed or Excused is judging's to decide.

import { WEEKDAYS, type ClockTime, type DatedReminder, type LocalDate, type Schedule } from "../shared/types.ts";
import { addDays, parseClockTime, parseDatedReminder, parseLocalDate } from "../shared/calendar.ts";
import { localDateOf, mondayOf, startOfDay, wallTime, weekdayOf } from "./calendar.ts";

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
   * night 18:00 the next day (on Oura's clock, if it's given one), when a night
   * Oura never reported counts as missed.
   */
  closesAt: Date;
}

type FixedDays = Extract<Schedule, { kind: "fixed-days" }>;
type WeeklyCount = Extract<Schedule, { kind: "weekly-count" }>;
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
 * a date on: Fixed days, each due on the pact's day clock; or Weekly count
 * (Camera only), whose due-by time, if any, limits each day's evidence.
 */
export type RecurringTerms =
  { schedule: FixedDays; day: DayClock } | { schedule: WeeklyCount; dueBy: ClockTime | null };

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
   * Optional: the pact's last day. Every occurrence ends by it: a Weekly
   * count week counts only if its Sunday does. A One-time pact has none.
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
 * for Weekly count, the week starting the Monday after `createdAt`, or the
 * first starting on or after `startDate`; for One-time, its one occurrence,
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
  if (hasSchedule(terms, "weekly-count")) {
    const firstOccurrence = firstWeekFrom(addDays(created, 1), startDate);
    const schedule = { kind: "weekly-count", target: terms.schedule.target } as const;
    return {
      ok: true,
      terms: { schedule, dueBy: terms.dueBy, firstOccurrence, endDate: null },
      first: weekOccurrence(firstOccurrence, timezone),
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
 * The first Monday on or after `from`, or after the start date if that's
 * later: a Weekly count pact's first week once it starts from `from`.
 */
export function firstWeekFrom(from: LocalDate, startDate: LocalDate | null): LocalDate {
  const start = startDate !== null && startDate > from ? startDate : from;
  const monday = mondayOf(start);
  return monday < start ? addDays(monday, 7) : monday;
}

/** The last day of the period of the occurrence dated `date` on `schedule`: its Sunday for a Weekly count week. A One-time occurrence is dated by its deadline's date, its last. */
export function lastDayOf(schedule: Schedule, date: LocalDate): LocalDate {
  return schedule.kind === "weekly-count" ? addDays(date, WEEKDAYS.length - 1) : date;
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

/**
 * The clock a bedtime night's 18:00 is read on, when it isn't the owner's
 * timezone: a fixed UTC offset, "+01:00" or "-10:00", the one Oura's
 * timestamps carry where the owner is. Null reads it in the owner's timezone.
 */
export type OuraOffset = string | null;

/**
 * The occurrences of a pact with `terms`, in its owner's `timezone`. A bedtime
 * night closes at 18:00 the next day on `ouraOffset`'s clock, if there is one.
 */
export function occurrences(terms: OccurrenceTerms, timezone: string, ouraOffset: OuraOffset = null): Occurrences {
  return occurrencesOverTime(terms, [], timezone, ouraOffset);
}

/**
 * Terms a pact had before a change: they apply to its occurrences dated
 * before `until` ("YYYY-MM-DD"). A change starts new terms from the first
 * date not open yet. A One-time change applies to its one occurrence, so
 * only a recurring schedule has them.
 */
export type EarlierTerms = RecurringTerms & { until: LocalDate };

/**
 * The occurrences of a pact whose terms changed over time: each date follows
 * the first of `earlier` (oldest first) it's dated before, else `current`.
 * The first occurrence and end date are always `current`'s.
 */
export function occurrencesOverTime(
  current: OccurrenceTerms,
  earlier: readonly EarlierTerms[],
  timezone: string,
  ouraOffset: OuraOffset = null,
): Occurrences {
  // One occurrence, which a change applies to even once it's open: only the current terms count.
  if (hasSchedule(current, "one-time")) return oneTimeOccurrences(current, timezone);
  if (hasSchedule(current, "weekly-count")) {
    const weeks = sameKind(earlier, "weekly-count");
    const dueByOn = (date: LocalDate) => (weeks.find((terms) => date < terms.until) ?? current).dueBy;
    return recurringOccurrences(current, timezone, {
      periodOf: mondayOf,
      // For a day that isn't a Monday, its week's.
      occurrence: (date) => weekOccurrence(mondayOf(date), timezone),
      scheduled: (date) => date === mondayOf(date),
      dayDueAt: (day, week) => dueOnDay(day, dueByOn(week.date), timezone),
      rollover: null,
    });
  }
  const days = sameKind(earlier, "fixed-days");
  const termsOn = (date: LocalDate) => days.find((terms) => date < terms.until) ?? current;
  return recurringOccurrences(current, timezone, {
    periodOf: (day) => day,
    // For a day that isn't an occurrence's, as one would be.
    occurrence: (date) => fixedDaysOccurrence(date, timezone, termsOn(date).day, ouraOffset),
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
  /** The day the period with `day` in it starts: the day itself, or its week's Monday. */
  periodOf(day: LocalDate): LocalDate;
  /**
   * The occurrence dated `date`, or for a date that isn't one's, as one
   * would be: due times then only grow with the date.
   */
  occurrence(date: LocalDate): Occurrence;
  /** Whether the schedule has an occurrence dated `date`, before the end date is applied. */
  scheduled(date: LocalDate): boolean;
  /** When evidence submitted on `day`, in `occurrence`'s period, is due. */
  dayDueAt(day: LocalDate, occurrence: Occurrence): Date;
  /** The hour each day opens at, for an Anki day; else null for the start of its day. */
  rollover: number | null;
}

/** The occurrences of recurring `terms` whose periods fall as `periods` says, from their first occurrence to their end date. */
function recurringOccurrences(
  terms: OccurrenceTerms,
  timezone: string,
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
      const day = localDateOf(t, timezone);
      if (rollover !== null && t.getTime() < wallTime(day, rollover, 0, timezone).getTime()) {
        return covering(addDays(day, -1));
      }
      return covering(day);
    },
    covering,
    dayDueAt(day) {
      const found = covering(day);
      return found && dayDueAt(day, found);
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

/** A Weekly count week starting on the Monday `date`: open from its start, due at the end of its Sunday. */
function weekOccurrence(date: LocalDate, timezone: string): Occurrence {
  const dueAt = startOfDay(addDays(date, WEEKDAYS.length), timezone);
  return { date, opensAt: startOfDay(date, timezone), dueAt, closesAt: dueAt };
}

/** A bedtime night starts, and the night before closes, at this hour. */
export const NIGHT_STARTS_HOUR = 18;

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
