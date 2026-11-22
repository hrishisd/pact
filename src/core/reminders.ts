// Reminders: sending each Active pact's reminders as their times come, and
// dropping those the scheduler reaches too late.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { clockText, formatDate } from "../shared/format.ts";
import type { AccountId, LocalDate } from "../shared/types.ts";
import { localDateOf, mondayOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { occurrenceView, weekProgress } from "./occurrence-state.ts";
import { hasSchedule, oneTimeReminderAt, reminderAt, type Occurrences } from "./occurrences.ts";
import { pushOperatorAlert } from "./outbox.ts";
import {
  lastAnkiCheck,
  occurrencesOf,
  remindersOf,
  scheduleOf,
  scheduleTermsOf,
  termsOn,
  type PactClock,
  type PactRow,
} from "./rows.ts";

/** A reminder the scheduler reaches later than this after its time, as after downtime, is dropped, not sent. */
const REMINDER_LATE_MS = 15 * 60 * 1000;

/**
 * Sends each Active pact's reminders whose time has come since the
 * scheduler last looked (the pact's `reminded_through`), so a stopped
 * scheduler catches up, but drops those more than 15 minutes late and
 * tells the operator. A reminder goes off before its occurrence's due time
 * and only while it's useful: a Camera day with no evidence and not judged
 * (on Weekly count, any day of the week while its target isn't met or
 * waiting for approval), a scheduled bedtime night Oura hasn't judged yet (usually every
 * night, as the ring syncs the next morning), an Anki day not judged yet, never one an
 * approved excuse or vacation covers.
 */
export function remind(ctx: CoreContext, t: Date): DroppedReminder[] {
  const dropped: DroppedReminder[] = [];
  for (const pact of reminderPacts(ctx)) {
    const from = pact.reminded_through === null ? t : new Date(pact.reminded_through);
    if (from.getTime() >= t.getTime()) continue;
    ctx.db.prepare(`UPDATE pact SET reminded_through = ? WHERE id = ?`).run(t.toISOString(), pact.id);
    if (remindersOf(pact.reminders).length === 0) continue;
    // A reminder sent before the owner moved west comes round again: it went off already.
    ctx.db
      .prepare(`DELETE FROM reminder_sent WHERE pact_id = ? AND date < ?`)
      .run(pact.id, addDays(remindersFromDate(from, pact.timezone), -1));
    const { occurrences, due } = remindersBetween(ctx, pact, from, t);
    for (const { date, time, at } of due) {
      if (!worthReminding(ctx, pact, occurrences, date)) continue;
      const lateMs = t.getTime() - at.getTime();
      if (lateMs > REMINDER_LATE_MS) {
        dropped.push({ pactId: pact.id, date, time, lateMs });
        continue;
      }
      const sent = ctx.db
        .prepare(`INSERT INTO reminder_sent (pact_id, date, time) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
        .run(pact.id, date, time);
      if (sent.changes === 1) enqueueReminder(ctx, pact, date);
    }
  }
  if (dropped.length > 0) {
    const body = `${capitalized(droppedText(dropped.length))} after downtime.`;
    pushOperatorAlert(ctx, { alert: "reminders-dropped", dropped: dropped.length }, body);
  }
  return dropped;
}

/**
 * The Active Anki pacts with a reminder that `remind` would send at `t`: due
 * since the scheduler last looked, not more than 15 minutes late, about a day
 * not judged yet. The tick checks their owners' AnkiWeb first, so a deck
 * finished since the last check stops the reminder.
 */
export function ankiPactsToRemind(ctx: CoreContext, t: Date): Set<string> {
  const pactIds = new Set<string>();
  for (const pact of reminderPacts(ctx, "anki")) {
    if (pact.reminded_through === null) continue;
    const from = new Date(pact.reminded_through);
    if (from.getTime() >= t.getTime()) continue;
    const { occurrences, due } = remindersBetween(ctx, pact, from, t);
    const sends = due.some(
      ({ date, at }) => t.getTime() - at.getTime() <= REMINDER_LATE_MS && worthReminding(ctx, pact, occurrences, date),
    );
    if (sends) pactIds.add(pact.id);
  }
  return pactIds;
}

type ReminderPact = Pick<
  PactRow,
  | "id"
  | "name"
  | "evidence_kind"
  | "schedule"
  | "reminders"
  | "reminded_through"
  | "anki_rollover_hour"
  | "in_bed_by"
  | "due_by"
  | "created_at"
> & {
  owner_account_id: AccountId;
  timezone: string;
};

/** Every Active pact (or only those with `evidenceKind`), with what sending its reminders needs. */
function reminderPacts(ctx: CoreContext, evidenceKind?: PactRow["evidence_kind"]): ReminderPact[] {
  return ctx.all<ReminderPact>(
    `SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, pact.reminders, pact.reminded_through,
            pact.anki_rollover_hour, pact.in_bed_by, pact.due_by, pact.created_at, pact.owner_account_id,
            account.timezone
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.stage = 'active' AND (? IS NULL OR pact.evidence_kind = ?)
       ORDER BY pact.created_at, pact.id`,
    evidenceKind ?? null,
    evidenceKind ?? null,
  );
}

/** A night's or an Anki day's reminder can go off the morning after, so the days to look at start a day early. */
function remindersFromDate(from: Date, timezone: string): LocalDate {
  return addDays(localDateOf(from, timezone), -1);
}

/**
 * `pact`'s reminders whose time is after `from`, at or before `t`, and
 * before their day's due time, with the pact's occurrences.
 */
function remindersBetween(
  ctx: CoreContext,
  pact: ReminderPact,
  from: Date,
  t: Date,
): { occurrences: Occurrences; due: { date: LocalDate; time: string; at: Date }[] } {
  const { timezone } = pact;
  const occurrences = occurrencesOf(ctx, pact.id, timezone);
  const times = remindersOf(pact.reminders);
  if (times.length === 0) return { occurrences, due: [] };
  const all = remindersDue(
    pact,
    times,
    occurrences,
    remindersFromDate(from, timezone),
    localDateOf(t, timezone),
    timezone,
  );
  const due = all.filter(
    ({ at, dueAt }) => at.getTime() > from.getTime() && at.getTime() <= t.getTime() && at.getTime() < dueAt.getTime(),
  );
  return { occurrences, due };
}

/**
 * Whether the day `day` still needs a nudge: its occurrence's `remind`, the
 * same rule Today's To do card follows (R7), and on Weekly count a day with
 * nothing submitted yet.
 */
function worthReminding(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "schedule">,
  occurrences: Occurrences,
  day: LocalDate,
): boolean {
  const occurrence = occurrences.covering(day);
  if (occurrence === null || !occurrenceView(ctx, pact.id, occurrence).remind) return false;
  if (scheduleOf(pact.schedule).kind !== "weekly-count") return true;
  return ctx.db.prepare(`SELECT 1 FROM evidence WHERE pact_id = ? AND day = ?`).get(pact.id, day) === undefined;
}

/** A reminder about the day `date` (on Weekly count, a day of the week). */
function enqueueReminder(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "name" | "evidence_kind" | "schedule"> & { owner_account_id: AccountId },
  date: LocalDate,
): void {
  const { kind } = scheduleOf(pact.schedule);
  const weekly = kind === "weekly-count";
  const terms = termsOn(ctx, pact.id, weekly ? mondayOf(date) : date);
  const due = terms.due_by === null ? "midnight" : clockText(terms.due_by);
  let body = `No photo yet today. Due at ${due}.`;
  if (pact.evidence_kind === "oura") body = `In bed by ${clockText(terms.in_bed_by!)} tonight.`;
  if (pact.evidence_kind === "anki") {
    const check = lastAnkiCheck(ctx, pact.id, date);
    body =
      check === null
        ? `Due at ${due}. Pact hasn't checked your deck yet.`
        : `${cardsText(check.cardsLeft)} left, due at ${due}`;
  }
  if (kind === "one-time") body = `No photo yet. Due ${formatDate(date)} at ${due}.`;
  if (weekly) {
    const { sessions, target } = weekProgress(ctx, pact.id, mondayOf(date));
    body = `${sessions} of ${target} days done this week. Today's photo is due at ${due}.`;
  }
  ctx.enqueue({
    recipient: pact.owner_account_id,
    kind: "reminder",
    payload: { pactId: pact.id, occurrenceDate: date, title: pact.name, body, url: APP_PATHS.today },
  });
}

/** "1 card", "42 cards". */
function cardsText(n: number): string {
  return `${n} ${n === 1 ? "card" : "cards"}`;
}

/** A reminder the scheduler reached too late to send. */
interface DroppedReminder {
  pactId: string;
  /** The occurrence it was for. */
  date: LocalDate;
  /** Its time, "HH:MM". */
  time: string;
  lateMs: number;
}

/** "dropped 1 reminder more than 15 minutes late", or "dropped 2 reminders …". */
export function droppedText(count: number): string {
  return `dropped ${count} reminder${count === 1 ? "" : "s"} more than ${REMINDER_LATE_MS / 60_000} minutes late`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Each of `times` that could go off for `pact` from `fromDate` through
 * `toDate`, with the day it's about and when that day's evidence is due: on
 * Weekly count, every day of an open week. On One-time each reminder has its
 * own date, and they're all about the one occurrence.
 */
function remindersDue(
  pact: PactClock & Pick<PactRow, "schedule" | "in_bed_by" | "due_by">,
  times: string[],
  occurrences: Occurrences,
  fromDate: LocalDate,
  toDate: LocalDate,
  timezone: string,
): { date: LocalDate; dueAt: Date; time: string; at: Date }[] {
  const terms = scheduleTermsOf(pact, scheduleOf(pact.schedule), pact.in_bed_by, pact.due_by);
  if (hasSchedule(terms, "one-time")) {
    const { date, dueAt } = occurrences.first;
    return times.map((time) => ({ date, dueAt, time, at: oneTimeReminderAt(time, timezone) }));
  }
  const days: { date: LocalDate; dueAt: Date }[] = [];
  if (hasSchedule(terms, "weekly-count")) {
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      const dueAt = occurrences.dayDueAt(date);
      if (dueAt) days.push({ date, dueAt });
    }
  } else {
    days.push(...occurrences.between(fromDate, toDate));
  }
  return days.flatMap(({ date, dueAt }) =>
    times.map((time) => ({ date, dueAt, time, at: reminderAt(date, time, timezone, terms) })),
  );
}
