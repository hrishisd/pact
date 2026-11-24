// Where an occurrence stands: judged or not, its evidence and excuses, a
// period's progress, and which pacts judging reads.

import { isPeriodSchedule, lastDayOf, targetOf } from "../shared/schedules.ts";
import {
  PERIOD_KINDS,
  type AccountId,
  type EvidenceKind,
  type EvidenceRejection,
  type ExcuseSkipReason,
  type LocalDate,
  type OccurrenceStanding,
  type OccurrenceStatus,
  type PeriodProgress,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { coverOn, excusableUntil, excuseWindowOpensSql, keepsToDo } from "./covers.ts";
import type { Occurrence } from "./occurrences.ts";
import type { ReviewOutcome } from "./requests.ts";
import { occurrencesOf, scheduleOf, termsOn, type PactRow } from "./rows.ts";

/** SQL: what judging reads of a `pact` row and its owner's `account` row (PactToJudge). */
const PACT_TO_JUDGE_COLUMNS = `pact.id, pact.schedule, pact.first_occurrence, pact.evidence_kind, pact.in_bed_by,
  pact.judged_through, pact.ended_at, account.timezone, pact.owner_account_id`;

/** A pact as judging reads it. */
export type PactToJudge = Pick<PactRow, "id" | "schedule" | "first_occurrence" | "evidence_kind" | "in_bed_by"> & {
  judged_through: LocalDate | null;
  /** When it Ended; null while Active. */
  ended_at: string | null;
  timezone: string;
  owner_account_id: AccountId;
};

/** The pact's `occurrence` by its dates: a period runs `through` its last day. */
export function occurrenceSpan(
  ctx: CoreContext,
  pactId: string,
  occurrence: Occurrence,
): { date: LocalDate; through?: LocalDate } {
  const schedule = scheduleOf(termsOn(ctx, pactId, occurrence.date).schedule);
  return {
    date: occurrence.date,
    ...(isPeriodSchedule(schedule) && { through: lastDayOf(schedule, occurrence.date) }),
  };
}

/** Whether the occurrence already has an outcome: Satisfied, Missed or Excused. */
export function isJudged(ctx: CoreContext, pactId: string, date: LocalDate): boolean {
  return (
    ctx.db
      .prepare(`SELECT 1 FROM occurrence WHERE pact_id = ? AND date = ? AND outcome IS NOT NULL`)
      .get(pactId, date) !== undefined
  );
}

/**
 * Where the evidence for an occurrence (or with `by` "day", for one day of
 * it) stands: waiting or approved if any is, else rejected or none.
 */
export function evidenceDecision(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  by: "occurrence_date" | "day" = "occurrence_date",
): ReviewOutcome | "waiting" | "none" {
  const decisions = ctx
    .all<{
      decision: ReviewOutcome | null;
    }>(`SELECT decision FROM evidence WHERE pact_id = ? AND ${by} = ? AND withdrawn_at IS NULL`, pactId, date)
    .map((row) => row.decision ?? "waiting");
  if (decisions.includes("waiting")) return "waiting";
  if (decisions.includes("approved")) return "approved";
  return decisions.length > 0 ? "rejected" : "none";
}

/** How far the pact's period starting `date` has got: see `PeriodProgress`. */
export function periodProgress(ctx: CoreContext, pactId: string, date: LocalDate): PeriodProgress {
  const schedule = scheduleOf(termsOn(ctx, pactId, date).schedule);
  if (!isPeriodSchedule(schedule)) throw new Error(`pact ${pactId} isn't on a period schedule`);
  const counts = ctx.db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN decision = 'approved' THEN day END) AS sessions,
              COUNT(DISTINCT CASE WHEN decision IS NULL AND withdrawn_at IS NULL THEN day END) AS waiting
       FROM evidence WHERE pact_id = ? AND occurrence_date = ?`,
    )
    .get(pactId, date) as { sessions: number; waiting: number };
  return { scheduleKind: schedule.kind, ...counts, target: targetOf(schedule) };
}

/**
 * The one read of where the pact's occurrence stands as of now, which Today,
 * reminders, history and excuses share: its `OccurrenceStatus`, and whether
 * it's still the owner's to do.
 */
export type OccurrenceView = OccurrenceStatus & {
  /**
   * Today shows it as the owner's to do now: a To do card, or for a bedtime
   * night the Automatic or No Oura data card. A period's card also
   * needs today's day to take evidence.
   */
  toDo: boolean;
  /**
   * Its reminders still fire (at their times, before its due time): the same
   * cover rule as `toDo` (R7), so a waiting excuse stops both and a waiting
   * vacation keeps both. A bedtime night Oura has already judged gets none.
   */
  remind: boolean;
};

/** Where the pact's occurrence stands as of now, as the owner's screens show it: its view without the to-do flags. */
export function occurrenceStatus(ctx: CoreContext, pactId: string, occurrence: Occurrence): OccurrenceStatus {
  const { toDo: _toDo, remind: _remind, ...status } = occurrenceView(ctx, pactId, occurrence);
  return status;
}

/** See `OccurrenceView`. */
export function occurrenceView(ctx: CoreContext, pactId: string, occurrence: Occurrence): OccurrenceView {
  const { date } = occurrence;
  const now = ctx.clock.now().getTime();
  const row = ctx.one<{
    outcome: "satisfied" | "missed" | "excused" | null;
    excuse_window_opens: string | null;
    amount_cents: number | null;
  }>(
    `SELECT occurrence.outcome,
            ${excuseWindowOpensSql("occurrence.pact_id", "occurrence.date", "occurrence.judged_at")} AS excuse_window_opens,
            penalty.amount_cents
       FROM occurrence
       LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
       WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
    pactId,
    date,
  );
  const found = coverOn(ctx, pactId, date);
  const cover = found && { kind: found.kind, state: found.state };
  const phase = now < occurrence.opensAt.getTime() ? "ahead" : now < occurrence.dueAt.getTime() ? "open" : "past-due";
  const outcome = row?.outcome ?? null;
  const evidence = evidenceDecision(ctx, pactId, date);
  const { evidence_kind: evidenceKind } = ctx.db.prepare(`SELECT evidence_kind FROM pact WHERE id = ?`).get(pactId) as {
    evidence_kind: EvidenceKind;
  };
  // R7: one rule for Today and reminders. Judged, or under a cover that takes it off the owner, it's not theirs to do.
  const owed = outcome === null && keepsToDo(found) && evidenceStillNeeded(ctx, pactId, date, evidenceKind, evidence);
  // A bedtime night stays on Today, under No Oura data, until it closes.
  const inWindow = now >= occurrence.opensAt.getTime() && now < occurrence.closesAt.getTime();
  const standing = {
    cover,
    phase,
    toDo: owed && inWindow,
    remind: owed,
  } satisfies OccurrenceStanding & Pick<OccurrenceView, "toDo" | "remind">;
  if (outcome === "satisfied") return { kind: "satisfied", ...standing };
  if (outcome === "excused") return { kind: "excused", ...standing };
  if (outcome === "missed") {
    return {
      kind: "missed",
      penaltyCents: row!.amount_cents!,
      excusableUntil: excusableUntil(row!.excuse_window_opens!),
      ...standing,
    };
  }
  return {
    kind: "not-judged",
    opensAt: occurrence.opensAt,
    dueAt: occurrence.dueAt,
    evidenceWaiting: evidence === "waiting",
    ...standing,
  };
}

/**
 * Whether the occurrence still needs evidence from its owner, as far as the
 * whole occurrence goes: a Camera day with none submitted, a period
 * whose approved and waiting days are short of its target. Bedtime and Anki
 * need nothing from the owner here.
 */
function evidenceStillNeeded(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  kind: EvidenceKind,
  evidence: ReturnType<typeof evidenceDecision>,
): boolean {
  if (kind !== "camera") return true;
  if (!isPeriodSchedule(scheduleOf(termsOn(ctx, pactId, date).schedule))) return evidence === "none";
  const { sessions, waiting, target } = periodProgress(ctx, pactId, date);
  return sessions + waiting < target;
}

/** Who rejected the latest rejected evidence for an occurrence, and why; null if none was rejected. */
export function rejection(ctx: CoreContext, pactId: string, date: LocalDate): EvidenceRejection | null {
  const row = ctx.one<{ name: string; reject_reason: string }>(
    `SELECT account.name, evidence.reject_reason FROM evidence
       JOIN account ON account.id = evidence.decided_by_account_id
       WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'rejected'
       ORDER BY evidence.decided_at DESC, evidence.submitted_at DESC
       LIMIT 1`,
    pactId,
    date,
  );
  return row ? { reviewerName: row.name, reason: row.reject_reason } : null;
}

/**
 * Whether the pact Ended before `occurrence` fell due and it isn't judged:
 * it's no longer one of the pact's, so it's never judged or excused.
 */
export function dueAfterEnd(ctx: CoreContext, pactId: string, occurrence: Occurrence): boolean {
  const { ended_at: endedAt } = ctx.db.prepare(`SELECT ended_at FROM pact WHERE id = ?`).get(pactId) as {
    ended_at: string | null;
  };
  if (endedAt === null || occurrence.dueAt.getTime() <= new Date(endedAt).getTime()) return false;
  return !isJudged(ctx, pactId, occurrence.date);
}

/**
 * Every Active pact (or just `pactId`, Active or Ended) with what judging
 * reads of it: its terms, cursor and owner's timezone. An Ended pact makes
 * no more occurrences, but a decision can still judge one it had.
 */
export function pactsToJudge(ctx: CoreContext, pactId?: string): PactToJudge[] {
  return ctx.all<PactToJudge>(
    `SELECT ${PACT_TO_JUDGE_COLUMNS}
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE (? IS NULL AND pact.stage = 'active') OR pact.id = ?
       ORDER BY pact.created_at, pact.id`,
    pactId ?? null,
    pactId ?? null,
  );
}

/** Ended bedtime pacts with a night not judged that fell due before they Ended, as `pactsToJudge` reads them. */
export function endedBedtimePacts(ctx: CoreContext): PactToJudge[] {
  return ctx.all<PactToJudge>(`SELECT ${PACT_TO_JUDGE_COLUMNS}
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.stage = 'ended' AND pact.evidence_kind = 'oura' AND pact.ended_at IS NOT NULL
         AND (pact.judged_through IS NULL OR pact.judged_through < date(pact.ended_at, '+1 day'))
       ORDER BY pact.created_at, pact.id`);
}

/** Why a day with `status` can't be excused at `now`, or null if it can. */
export function skipReason(status: OccurrenceStatus, now: Date): ExcuseSkipReason | null {
  switch (status.kind) {
    case "satisfied":
      return "satisfied";
    case "excused":
      return "excused";
    case "missed":
      if (status.cover?.state === "waiting")
        return status.cover.kind === "vacation" ? "on-waiting-vacation" : "on-waiting-excuse";
      return status.excusableUntil.getTime() > now.getTime() ? null : "window-closed";
    case "not-judged":
      // A vacation waiting for approval isn't an excuse: the excuse's own check finds it.
      if (status.cover?.kind === "excuse" && status.cover.state === "waiting") return "on-waiting-excuse";
      return status.cover?.state === "approved" ? "excused" : null;
  }
}

/** SQL: the `pact` row's schedule is a period schedule (`isPeriodSchedule`). */
export const PERIOD_PACT = `json_extract(pact.schedule, '$.kind') IN (${PERIOD_KINDS.map((kind) => `'${kind}'`).join(", ")})`;

/**
 * SQL: the Missed `occurrence` row (of the `pact` row) was judged through a
 * rejection. Any rejected evidence will do: on Fixed days and One-time a
 * rejection judges the occurrence at once. A period's rejected
 * evidence just doesn't count, so a short period is never Missed through it.
 */
export const MISSED_THROUGH_REJECTION = `(NOT ${PERIOD_PACT} AND EXISTS (SELECT 1 FROM evidence
  WHERE evidence.pact_id = occurrence.pact_id AND evidence.occurrence_date = occurrence.date
    AND evidence.decision = 'rejected'))`;
