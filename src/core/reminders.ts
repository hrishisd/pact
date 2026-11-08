// Reminders: sending each Active pact's reminders as their times come, and
// dropping those the scheduler reaches too late.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { clockText, formatDate } from "../shared/format.ts";
import type { AccountId, LocalDate } from "../shared/types.ts";
import { localDateOf, mondayOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { excuseOn, isJudged, weekProgress } from "./occurrence-state.ts";
import { hasSchedule, oneTimeReminderAt, reminderAt, type Occurrences } from "./occurrences.ts";
import {
  lastAnkiCheck,
  occurrencesOf,
  ownerZone,
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
 * waiting for approval), any scheduled bedtime night (the app can't know the owner is in bed until
 * the ring syncs), an Anki day not judged yet, never one an approved excuse covers.
 */
export function remind(ctx: CoreContext, t: Date): DroppedReminder[] {
  const pacts = ctx.all<
    Pick<
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
      timezone: string | null;
    }
  >(`SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, pact.reminders, pact.reminded_through,
              pact.anki_rollover_hour, pact.in_bed_by, pact.due_by, pact.created_at, pact.owner_account_id,
              account.timezone
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.stage = 'active'
       ORDER BY pact.created_at, pact.id`);
  const dropped: DroppedReminder[] = [];
  for (const pact of pacts) {
    const from = pact.reminded_through === null ? t : new Date(pact.reminded_through);
    if (from.getTime() >= t.getTime()) continue;
    ctx.db.prepare(`UPDATE pact SET reminded_through = ? WHERE id = ?`).run(t.toISOString(), pact.id);
    const times = remindersOf(pact.reminders);
    if (times.length === 0) continue;
    const timezone = ownerZone(pact.timezone, pact.owner_account_id);
    // A night's or an Anki day's reminder can go off the morning after, so start a day early.
    const fromDate = addDays(localDateOf(from, timezone), -1);
    const due = remindersDue(
      pact,
      times,
      occurrencesOf(ctx, pact.id, timezone),
      fromDate,
      localDateOf(t, timezone),
      timezone,
    );
    // A reminder sent before the owner moved west comes round again: it went off already.
    ctx.db.prepare(`DELETE FROM reminder_sent WHERE pact_id = ? AND date < ?`).run(pact.id, addDays(fromDate, -1));
    for (const { date, dueAt, time, at } of due) {
      if (at.getTime() <= from.getTime() || at.getTime() > t.getTime()) continue;
      if (at.getTime() >= dueAt.getTime() || !worthReminding(ctx, pact, date)) continue;
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
  const operator = ctx.one<{ id: AccountId }>(`SELECT id FROM account WHERE is_operator = 1`);
  if (dropped.length > 0 && operator) {
    ctx.enqueue({
      recipient: operator.id,
      kind: "operator-alert",
      payload: {
        alert: "reminders-dropped",
        dropped: dropped.length,
        title: "Operator alert",
        body: `${capitalized(droppedText(dropped.length))} after downtime.`,
        url: APP_PATHS.today,
      },
    });
  }
  return dropped;
}

/**
 * Whether the day `day` still needs a nudge: a bedtime night always, a
 * Camera day with nothing submitted or judged, and on Weekly count a day
 * with nothing submitted of a week not judged, whose target isn't met or
 * waiting for approval.
 */
function worthReminding(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "evidence_kind" | "schedule">,
  day: LocalDate,
): boolean {
  const weekly = scheduleOf(pact.schedule).kind === "weekly-count";
  const date = weekly ? mondayOf(day) : day;
  if (excuseOn(ctx, pact.id, date) === "approved") return false;
  if (pact.evidence_kind === "oura") return true;
  // Pact doesn't see the deck finished until a check does: an Anki day is worth reminding until it's judged.
  if (pact.evidence_kind === "anki") return !isJudged(ctx, pact.id, date);
  const submitted = ctx.db.prepare(`SELECT 1 FROM evidence WHERE pact_id = ? AND day = ?`).get(pact.id, day);
  if (submitted !== undefined || isJudged(ctx, pact.id, date)) return false;
  if (!weekly) return true;
  const { sessions, waiting, target } = weekProgress(ctx, pact.id, date);
  return sessions + waiting < target;
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
    body = check === null ? `Due at ${due}. Not checked yet.` : `${cardsText(check.cardsLeft)} left, due at ${due}`;
  }
  if (kind === "one-time") body = `No photo yet. Due ${formatDate(date)} at ${due}.`;
  if (weekly) {
    const { sessions, target } = weekProgress(ctx, pact.id, mondayOf(date));
    body = `${sessions} of ${target} this week. Today's photo is due at ${due}.`;
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
