// History: the pact page's heat map of past occurrences, and Today's Yesterday.

import { addDays } from "../shared/calendar.ts";
import {
  WEEKDAYS,
  type AccountId,
  type AnkiCheck,
  type HeatMapDay,
  type HeatMapWeek,
  type LocalDate,
  type OccurrenceDetail,
  type OccurrenceRecord,
  type OccurrenceStatus,
  type PactHistory,
  type RecordedStatus,
  type TodayYesterdayEntry,
} from "../shared/types.ts";
import { laterDate, localDateOf, mondayOf, weekdayOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { occurrenceStatus, rejection, vacationOn, WEEKLY_COUNT_PACT, weekProgress } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { wallClock } from "./oura-clock.ts";
import { occurrencesOf, scheduleOf, type PactRow } from "./rows.ts";

/** The day an Ended pact Ended, in `timezone`; null while it's Active. */
export function endedOnOf(pact: Pick<PactRow, "ended_at">, timezone: string): LocalDate | null {
  return pact.ended_at === null ? null : localDateOf(new Date(pact.ended_at), timezone);
}

/** An Anki day's deciding check as its occurrence row stores it; null when no check reached AnkiWeb. */
export function ankiCheckOf(row: { anki_cards_left: number | null; anki_checked_at: string | null }): AnkiCheck | null {
  if (row.anki_cards_left === null || row.anki_checked_at === null) return null;
  return { cardsLeft: row.anki_cards_left, checkedAt: new Date(row.anki_checked_at) };
}

/** The pact page's history: its one occurrence, its weeks, or its days, from the first occurrence `first`. */
export function pactHistory(
  ctx: CoreContext,
  row: PactRow,
  timezone: string,
  first: Occurrence,
  now: Date,
): PactHistory {
  switch (scheduleOf(row.schedule).kind) {
    case "one-time":
      return { kind: "one-time", day: { date: first.date, occurrence: occurrenceRecord(ctx, row, first) } };
    case "weekly-count":
      return { kind: "weekly-count", weeks: heatMapWeeks(ctx, row, timezone, first.date, now) };
    case "fixed-days":
      return { kind: "fixed-days", days: heatMapDays(ctx, row, timezone, first.date, now) };
  }
}

/**
 * The pact's heat map as of `now`: every day from its first occurrence
 * through the Sunday ending this week, or the week it Ended, or its first
 * occurrence's week while that's ahead.
 */
export function heatMapDays(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  first: LocalDate,
  now: Date,
): HeatMapDay[] {
  const endedOn = endedOnOf(pact, timezone);
  const last = laterDate(first, endedOn ?? localDateOf(now, timezone));
  const sunday = addDays(last, WEEKDAYS.length - 1 - WEEKDAYS.indexOf(weekdayOf(last)));
  return occurrenceRecords(ctx, pact, timezone, first, sunday);
}

/**
 * A Weekly count pact's heat map as of `now`: every week from its first
 * through this one, or the one it Ended, or its first while that's ahead;
 * none from the week it Ended that was never judged.
 */
export function heatMapWeeks(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  first: LocalDate,
  now: Date,
): HeatMapWeek[] {
  const endedOn = endedOnOf(pact, timezone);
  const last = laterDate(first, endedOn ?? localDateOf(now, timezone));
  return occurrencesOf(ctx, pact.id, timezone)
    .between(first, last)
    .map((week) => {
      const record = occurrenceRecord(ctx, pact, week);
      const afterEnd = endedOn !== null && week.date >= mondayOf(endedOn) && record.status.kind === "not-judged";
      return {
        date: week.date,
        occurrence: afterEnd ? null : record,
        progress: weekProgress(ctx, pact.id, week.date),
      };
    });
}

/**
 * The owner's pacts due yesterday, by name, each with how its occurrence
 * went, except one an approved vacation covers: the owner was off that day.
 */
export function yesterdayEntries(ctx: CoreContext, ownerId: AccountId, timezone: string): TodayYesterdayEntry[] {
  const yesterday = addDays(localDateOf(ctx.clock.now(), timezone), -1);
  // A Weekly count week isn't due on any one day.
  const pacts = ctx.all<PactRow>(
    `SELECT * FROM pact WHERE owner_account_id = ? AND NOT ${WEEKLY_COUNT_PACT} ORDER BY name, created_at, id`,
    ownerId,
  );
  return pacts.flatMap((pact) =>
    occurrenceRecords(ctx, pact, timezone, yesterday, yesterday).flatMap(({ date, occurrence }) =>
      occurrence && vacationOn(ctx, pact.id, date) !== "approved"
        ? [{ pactId: pact.id, name: pact.name, evidenceKind: pact.evidence_kind, occurrenceDate: date, occurrence }]
        : [],
    ),
  );
}

/**
 * How each of the pact's days from `from` to `to` went, oldest first: null
 * on a day it has no occurrence. An Ended pact has none from the day it
 * Ended, except one a decision has judged since.
 */
export function occurrenceRecords(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  from: LocalDate,
  to: LocalDate,
): HeatMapDay[] {
  const endedOn = endedOnOf(pact, timezone);
  const found = new Map(
    occurrencesOf(ctx, pact.id, timezone)
      .between(from, to)
      .map((occurrence) => [occurrence.date, occurrence]),
  );
  const days: HeatMapDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const occurrence = found.get(date);
    const record = occurrence ? occurrenceRecord(ctx, pact, occurrence) : null;
    const afterEnd = endedOn !== null && date >= endedOn && record?.status.kind === "not-judged";
    days.push({ date, occurrence: afterEnd ? null : record });
  }
  return days;
}

/** How the pact's `occurrence` went, as of now: where it stands, who settled it, and a bedtime night's sleep. */
export function occurrenceRecord(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "evidence_kind" | "schedule">,
  occurrence: Occurrence,
): OccurrenceRecord {
  const status = occurrenceStatus(ctx, pact.id, occurrence);
  const row = ctx.one<{
    bedtime_start: string | null;
    anki_cards_left: number | null;
    anki_checked_at: string | null;
    recipient_name: string | null;
  }>(
    `SELECT occurrence.bedtime_start, occurrence.anki_cards_left, occurrence.anki_checked_at,
              recipient.name AS recipient_name
       FROM occurrence
       LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
       LEFT JOIN recipient ON recipient.id = penalty.recipient_id
       WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
    pact.id,
    occurrence.date,
  );
  const judged = status.kind === "satisfied" || status.kind === "missed";
  let detail: OccurrenceDetail | null = null;
  if (pact.evidence_kind === "oura" && judged) {
    const bedtimeStart = row?.bedtime_start ?? null;
    detail = { kind: "night", inBedAt: bedtimeStart === null ? null : wallClock(bedtimeStart).slice(11) };
  }
  if (pact.evidence_kind === "anki" && row && judged) detail = { kind: "anki", lastCheck: ankiCheckOf(row) };
  return { status: recordedStatus(ctx, pact, occurrence.date, status, row?.recipient_name ?? null), detail };
}

/**
 * `status` with the decision that settled it: its approved evidence
 * (Satisfied), its rejected evidence and where the penalty went (Missed), or
 * the approved excuse or vacation that covers it (Excused, or a day not
 * judged yet it already excuses). A covered occurrence that ended Satisfied
 * stays Satisfied.
 */
export function recordedStatus(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "schedule">,
  date: LocalDate,
  status: OccurrenceStatus,
  recipientName: string | null,
): RecordedStatus {
  const pactId = pact.id;
  // A Weekly count week is Satisfied or Missed by its days, not by any one decision.
  const weekly = scheduleOf(pact.schedule).kind === "weekly-count";
  switch (status.kind) {
    case "satisfied": {
      const row = weekly
        ? undefined
        : ctx.one<{ name: string }>(
            `SELECT account.name FROM evidence JOIN account ON account.id = evidence.decided_by_account_id
               WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'approved'`,
            pactId,
            date,
          );
      return { ...status, approvedBy: row?.name ?? null };
    }
    case "missed":
      return { ...status, recipientName, rejection: weekly ? null : rejection(ctx, pactId, date) };
    case "excused":
    case "not-judged": {
      const covered = status.kind === "excused" || status.excuse === "approved";
      const row = covered
        ? ctx.one<{ name: string; reason: string }>(
            `SELECT account.name, excuse.reason FROM excuse_day
               JOIN excuse ON excuse.id = excuse_day.excuse_id
               JOIN account ON account.id = excuse.decided_by_account_id
               WHERE excuse_day.pact_id = ? AND excuse_day.date = ? AND excuse.decision = 'approved'
               ORDER BY excuse.decided_at DESC LIMIT 1`,
            pactId,
            date,
          )
        : undefined;
      const vacation = covered && !row ? approvedVacationOn(ctx, pactId, date) : undefined;
      return {
        ...status,
        excuseApproval: row ? { reviewerName: row.name, reason: row.reason } : null,
        ...(vacation && { vacation: { from: vacation.first_day, to: vacation.last_day } }),
      };
    }
  }
}

/** The approved vacation covering the pact's occurrence on `date`, if one does. */
function approvedVacationOn(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
): { first_day: LocalDate; last_day: LocalDate } | undefined {
  return ctx.one(
    `SELECT vacation.first_day, vacation.last_day FROM vacation_day
       JOIN vacation ON vacation.id = vacation_day.vacation_id
       WHERE vacation_day.pact_id = ? AND vacation_day.date = ? AND vacation.decision = 'approved'`,
    pactId,
    date,
  );
}
