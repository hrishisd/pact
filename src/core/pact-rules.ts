// A pact's rules that need no database: what its terms may be, its edit
// window, when a change to it applies, and how a change request stores its
// terms.

import { addDays, parseDatedReminder } from "../shared/calendar.ts";
import {
  EDIT_WINDOW_MINUTES,
  EXCUSE_WINDOW_HOURS,
  MAX_REMINDERS,
  MAX_WEEKLY_TARGET,
  WEEKDAYS,
  type ClockTime,
  type CreatePactRefusal,
  type EvidenceKind,
  type LocalDate,
  type NewPact,
  type Schedule,
} from "../shared/types.ts";
import { laterDate, mondayOf, weekdayOf } from "./calendar.ts";
import type { ChangeableTerms, TermDiff } from "./changes.ts";
import {
  ankiDueByFits,
  ankiDueByOrder,
  dayStartHour,
  firstWeekFrom,
  hasSchedule,
  lastDayOf,
  minutesFrom,
  newOccurrenceTerms,
  NIGHT_STARTS_HOUR,
  oneTimeReminderAt,
  type DayClock,
  type NewTerms,
  type OccurrenceTerms,
} from "./occurrences.ts";
import { nameTooLong, textTooLong } from "./text-limits.ts";

/** How long after creation the owner can edit or delete a pact freely. */
export const EDIT_WINDOW_MS = EDIT_WINDOW_MINUTES * 60 * 1000;

/**
 * How long after it's judged Missed (a rejection judges it then) an
 * occurrence can be excused. A Missed card stays on Today that long.
 */
export const EXCUSE_WINDOW_MS = EXCUSE_WINDOW_HOURS * 60 * 60 * 1000;

/** Whether `text` is a clock time, "HH:MM" on a 24-hour clock. */
export function isClockTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** A due-by time: a clock time after the day starts. Midnight ending the day is the due time without one. */
export function isDueBy(text: string): boolean {
  return isClockTime(text) && text !== "00:00";
}

/** Whether `text` is a One-time pact's reminder, "YYYY-MM-DDTHH:MM". */
function isDatedReminder(text: string): boolean {
  const { date, time } = parseDatedReminder(text);
  return text.length === 16 && isLocalDate(date) && isClockTime(time);
}

/** Whether `text` is a real calendar day written "YYYY-MM-DD". */
export function isLocalDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && addDays(text, 0) === text;
}

export function editWindowEnd({ created_at }: { created_at: string }): Date {
  return new Date(new Date(created_at).getTime() + EDIT_WINDOW_MS);
}

/** When a pact's edit window closes; null once it has, as of `now`. */
export function editWindowClosesAt(pact: { created_at: string }, now: Date): Date | null {
  const closesAt = editWindowEnd(pact);
  return now.getTime() < closesAt.getTime() ? closesAt : null;
}

/** A pact's terms as `checkedPact` (pacts.ts) checks them. */
export interface CheckedTerms {
  ok: true;
  /** The owner's: a pact needs one. */
  timezone: string;
  name: string;
  description: string;
  terms: OccurrenceTerms;
  startDate: LocalDate | null;
  reminders: string[];
}

/**
 * `pact`'s terms checked as a pact made at `createdAt` by an owner in
 * `timezone`, or why they're refused. An Anki pact's day turns at
 * `ankiRollover` (null for other pacts).
 */
export function checkedTerms(
  pact: NewPact,
  ankiRollover: number | null,
  timezone: string,
  createdAt: Date,
): CheckedTerms | { ok: false; reason: CreatePactRefusal } {
  const oura = pact.evidenceKind === "oura";
  const anki = pact.evidenceKind === "anki";
  if (oura && (pact.inBedBy === undefined || !isClockTime(pact.inBedBy))) {
    return { ok: false, reason: "invalid-in-bed-by" };
  }
  // A ring's nights are Fixed days only, and at most one day of evidence counts a day.
  if (pact.schedule.kind === "weekly-count") {
    const { target } = pact.schedule;
    if (oura || anki || !Number.isSafeInteger(target) || target < 1 || target > MAX_WEEKLY_TARGET) {
      return { ok: false, reason: "invalid-schedule" };
    }
  }
  const oneTime = pact.schedule.kind === "one-time";
  if (pact.schedule.kind === "one-time" && (oura || anki || !isLocalDate(pact.schedule.deadline))) {
    return { ok: false, reason: "invalid-schedule" };
  }
  // A due-by time is for evidence the owner submits; a ring's night has its in-bed-by time.
  if (
    pact.dueBy !== undefined &&
    (oura || !isDueBy(pact.dueBy) || (ankiRollover !== null && !ankiDueByFits(pact.dueBy, ankiRollover)))
  ) {
    return { ok: false, reason: "invalid-due-by" };
  }
  // A One-time pact has just its deadline: Submit anytime sets when it opens.
  if (pact.startDate !== undefined && (oneTime || !isLocalDate(pact.startDate))) {
    return { ok: false, reason: "invalid-start-date" };
  }
  if (pact.endDate !== undefined && (oneTime || !isLocalDate(pact.endDate))) {
    return { ok: false, reason: "invalid-end-date" };
  }
  const unique = [...new Set(pact.reminders ?? [])];
  if (unique.length > MAX_REMINDERS || !unique.every(oneTime ? isDatedReminder : isClockTime)) {
    return { ok: false, reason: "invalid-reminders" };
  }
  const name = pact.name.trim();
  // Oura Ring and Anki pacts have no photo to describe.
  const description = oura || anki ? "" : pact.description.trim();
  if (name === "") return { ok: false, reason: "blank-name" };
  if (!oura && !anki && description === "") return { ok: false, reason: "blank-description" };
  if (nameTooLong(name) || textTooLong(description)) return { ok: false, reason: "text-too-long" };
  const dueBy = pact.dueBy ?? null;
  // The day clock is for Fixed days: Oura Ring and Anki pacts were refused any other schedule above.
  const day = dayClockOf(
    { evidence_kind: pact.evidenceKind, anki_rollover_hour: ankiRollover },
    pact.inBedBy ?? null,
    dueBy,
  );
  const terms = newTermsOf(pact.schedule, day, dueBy);
  const timing = newOccurrenceTerms(terms, createdAt, timezone, pact.startDate ?? null);
  if (!timing.ok) return timing;
  const reminders = sortedReminders(unique, timing.terms);
  if (!remindersGoOffInTime(reminders, timing.terms, timing.first.dueAt, timezone)) {
    return { ok: false, reason: "reminder-after-due-time" };
  }
  const endDate = pact.endDate ?? null;
  // The first occurrence has to end by the end date: a whole week, for Weekly count.
  if (endDate !== null && endDate < lastDayOf(timing.terms.schedule, timing.terms.firstOccurrence)) {
    return { ok: false, reason: "end-date-too-early" };
  }
  if (!Number.isSafeInteger(pact.penaltyCents) || pact.penaltyCents <= 0) {
    return { ok: false, reason: "invalid-penalty" };
  }
  return {
    ok: true,
    timezone,
    name,
    description,
    terms: { ...timing.terms, endDate },
    startDate: pact.startDate ?? null,
    reminders,
  };
}

/**
 * The day clock of `pact` with the times `inBedBy` and `dueBy`: a Camera
 * pact's days, an Oura Ring pact's nights, an Anki pact's Anki days. The
 * schema keeps the rollover hour set on Anki pacts, and only on them.
 */
export function dayClockOf(
  pact: { evidence_kind: EvidenceKind; anki_rollover_hour: number | null },
  inBedBy: ClockTime | null,
  dueBy: ClockTime | null,
): DayClock {
  switch (pact.evidence_kind) {
    case "camera":
      return { kind: "day", dueBy };
    case "oura":
      if (inBedBy === null) throw new Error("an Oura Ring pact has no in-bed-by time");
      return { kind: "night", inBedBy };
    case "anki":
      if (pact.anki_rollover_hour === null) throw new Error("an Anki pact has no rollover hour");
      return { kind: "anki", rollover: pact.anki_rollover_hour, dueBy };
  }
}

/** `schedule`'s terms for a new pact: Fixed days due on the day clock `day`, any other schedule by `dueBy`. */
export function newTermsOf(schedule: Schedule, day: DayClock, dueBy: ClockTime | null): NewTerms {
  switch (schedule.kind) {
    case "fixed-days":
      return { schedule, day };
    case "weekly-count":
      return { schedule, dueBy };
    case "one-time":
      return { schedule, dueBy };
  }
}

/**
 * `reminders` in the order they go off on a pact with `terms`: a One-time
 * pact's by date and time, any other's from the hour its day starts
 * (`dayStartHour`): a night's from 18:00 to the morning after, an Anki
 * day's from its rollover hour, any other day's from midnight.
 */
function sortedReminders(reminders: string[], terms: OccurrenceTerms): string[] {
  // "YYYY-MM-DDTHH:MM" sorts as text.
  if (hasSchedule(terms, "one-time")) return [...reminders].sort((a, b) => a.localeCompare(b, "en-US"));
  const dayStarts = dayStartHour(terms);
  return [...reminders].sort((a, b) => minutesFrom(a, dayStarts) - minutesFrom(b, dayStarts));
}

/**
 * Whether every reminder goes off before the due time a pact with `terms`
 * has: a One-time pact's deadline (its occurrence's `dueAt`), a bedtime's
 * in-bed-by time (a night running from 18:00), an Anki day's due-by time
 * (from its rollover hour; midnight with none), or else the due-by time, if
 * there is one.
 */
export function remindersGoOffInTime(
  reminders: string[],
  terms: OccurrenceTerms,
  dueAt: Date,
  timezone: string,
): boolean {
  return reminders.every((time) => {
    if (hasSchedule(terms, "one-time")) return oneTimeReminderAt(time, timezone).getTime() < dueAt.getTime();
    if (hasSchedule(terms, "weekly-count")) return terms.dueBy === null || time < terms.dueBy;
    const { day } = terms;
    switch (day.kind) {
      case "day":
        return day.dueBy === null || time < day.dueBy;
      case "night":
        return minutesFrom(time, NIGHT_STARTS_HOUR) < minutesFrom(day.inBedBy, NIGHT_STARTS_HOUR);
      case "anki":
        // A due-by time that can't fit is refused before this.
        return minutesFrom(time, day.rollover) < ankiDueByOrder(day.dueBy, day.rollover);
    }
  });
}

/**
 * A pact's first occurrence once a change to `schedule` and `startDate` takes
 * effect `from` a date: as it was if that's before `from`; otherwise, as the
 * change came before the pact started, the first day of the new schedule
 * from `from`, or from the start date if that's later.
 */
export function firstOccurrenceAfterChange(
  firstOccurrence: LocalDate,
  schedule: Schedule,
  from: LocalDate,
  startDate: LocalDate | null,
): LocalDate {
  if (schedule.kind === "one-time") return schedule.deadline;
  if (firstOccurrence < from) return firstOccurrence;
  if (schedule.kind === "weekly-count") return firstWeekFrom(from, startDate);
  const start = startDate === null ? from : laterDate(startDate, from);
  for (let date = start, i = 0; i < 7; date = addDays(date, 1), i++) {
    if (schedule.days.includes(weekdayOf(date))) return date;
  }
  throw new Error("unreachable: a schedule has at least one day");
}

/**
 * The first day not open on `today` for a pact with `schedule`, from which a
 * change applies: tomorrow, or for Weekly count, whose week is open until its
 * Sunday, next Monday.
 */
export function firstDayNotOpen(schedule: Schedule, today: LocalDate): LocalDate {
  return schedule.kind === "weekly-count" ? addDays(mondayOf(today), WEEKDAYS.length) : addDays(today, 1);
}

/**
 * A change request's stored terms. Those sent before due-by times, dates and
 * reminders existed have none. Reminders apply at once, so a request's before
 * and after always have the same ones.
 */
export function storedTerms(json: string): ChangeableTerms {
  return {
    dueBy: null,
    startDate: null,
    endDate: null,
    reminders: [],
    ankiDeckId: null,
    ...(JSON.parse(json) as Partial<ChangeableTerms>),
  } as ChangeableTerms;
}

/** How a review item's push names each changed term. */
export const TERM_LABELS: Record<TermDiff["term"], string> = {
  name: "Name",
  description: "Photo shows",
  deck: "Deck",
  "in-bed-by": "In bed by",
  schedule: "Days",
  "due-by": "Due by",
  "start-date": "Starts",
  "end-date": "Ends",
  penalty: "Penalty",
  recipient: "Recipient",
  reviewers: "Reviewers",
  reminders: "Reminders",
};
