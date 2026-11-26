// History: the pact page's heat map of past occurrences, and Today's Yesterday.

import { addDays } from "../shared/calendar.ts";
import { isBedtimeKind } from "../shared/evidence-kinds.ts";
import { isPeriodSchedule, lastDayOf } from "../shared/schedules.ts";
import {
  WEEKDAYS,
  type AccountId,
  type AnkiCheck,
  type HeatMapDay,
  type HeatMapPeriod,
  type LocalDate,
  type OccurrenceDetail,
  type OccurrenceRecord,
  type OccurrenceStatus,
  type PactHistory,
  type RecordedStatus,
  type TodayYesterdayEntry,
} from "../shared/types.ts";
import { laterDate, localDateOf, weekdayOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { onApprovedVacation } from "./covers.ts";
import { occurrenceStatus, rejection, PERIOD_PACT, periodProgress } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { wallClock } from "./night-clock.ts";
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

/** The pact page's history: its one occurrence, its periods, or its days, from the first occurrence `first`. */
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
    case "every-2-weeks":
    case "once-a-month":
      return { kind: "periods", periods: heatMapPeriods(ctx, row, timezone, first.date, now) };
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
 * A period schedule pact's heat map as of `now`: every period from its first
 * through this one, or the one it Ended, or its first while that's ahead;
 * none from the period it Ended in that was never judged.
 */
export function heatMapPeriods(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  first: LocalDate,
  now: Date,
): HeatMapPeriod[] {
  const endedOn = endedOnOf(pact, timezone);
  const last = laterDate(first, endedOn ?? localDateOf(now, timezone));
  const schedule = scheduleOf(pact.schedule);
  return occurrencesOf(ctx, pact.id, timezone)
    .between(first, last)
    .map((period) => {
      const record = occurrenceRecord(ctx, pact, period);
      const afterEnd =
        endedOn !== null && lastDayOf(schedule, period.date) >= endedOn && record.status.kind === "not-judged";
      return {
        date: period.date,
        occurrence: afterEnd ? null : record,
        progress: periodProgress(ctx, pact.id, period.date),
      };
    });
}

/**
 * The owner's pacts due yesterday, by name, each with how its occurrence
 * went, except one an approved vacation covers: the owner was off that day.
 */
export function yesterdayEntries(ctx: CoreContext, ownerId: AccountId, timezone: string): TodayYesterdayEntry[] {
  const yesterday = addDays(localDateOf(ctx.clock.now(), timezone), -1);
  // A period isn't due on any one day.
  const pacts = ctx.all<PactRow>(
    `SELECT * FROM pact WHERE owner_account_id = ? AND NOT ${PERIOD_PACT} ORDER BY name, created_at, id`,
    ownerId,
  );
  return pacts.flatMap((pact) =>
    occurrenceRecords(ctx, pact, timezone, yesterday, yesterday).flatMap(({ date, occurrence }) =>
      occurrence && !onApprovedVacation(ctx, pact.id, date)
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
  if (isBedtimeKind(pact.evidence_kind) && judged) {
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
  // A period is Satisfied or Missed by its days, not by any one decision.
  const onPeriods = isPeriodSchedule(scheduleOf(pact.schedule));
  switch (status.kind) {
    case "satisfied": {
      const row = onPeriods
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
      return { ...status, recipientName, rejection: onPeriods ? null : rejection(ctx, pactId, date) };
    case "excused":
    case "not-judged": {
      const covered = status.kind === "excused" || status.cover?.state === "approved";
      const row = covered
        ? ctx.one<{ name: string; reason: string }>(
            `SELECT account.name, excuse.reason FROM cover_day_v AS cover
               JOIN excuse ON excuse.id = cover.id
               JOIN account ON account.id = excuse.decided_by_account_id
               WHERE cover.kind = 'excuse' AND cover.pact_id = ? AND cover.date = ? AND cover.decision = 'approved'
               ORDER BY cover.decided_at DESC LIMIT 1`,
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
    `SELECT vacation.first_day, vacation.last_day FROM cover_day_v AS cover
       JOIN vacation ON vacation.id = cover.id
       WHERE cover.kind = 'vacation' AND cover.pact_id = ? AND cover.date = ? AND cover.decision = 'approved'`,
    pactId,
    date,
  );
}
