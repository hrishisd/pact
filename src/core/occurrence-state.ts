// Where an occurrence stands: judged or not, its evidence and excuses, a
// Weekly count week's progress, and which pacts judging reads.

import type {
  AccountId,
  EvidenceRejection,
  ExcuseSkipReason,
  LocalDate,
  OccurrenceStatus,
  WeekProgress,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import type { Occurrence } from "./occurrences.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import { occurrencesOf, ownerZone, scheduleOf, termsOn, type PactRow, type ReviewOutcome } from "./rows.ts";

/** SQL: what judging reads of a `pact` row and its owner's `account` row (PactToJudge). */
const PACT_TO_JUDGE_COLUMNS = `pact.id, pact.schedule, pact.first_occurrence, pact.evidence_kind, pact.in_bed_by,
  pact.judged_through, pact.ended_at, account.timezone, pact.owner_account_id`;

/** A pact as judging reads it. */
export type PactToJudge = Pick<PactRow, "id" | "schedule" | "first_occurrence" | "evidence_kind" | "in_bed_by"> & {
  judged_through: LocalDate | null;
  /** When it Ended; null while Active. */
  ended_at: string | null;
  timezone: string | null;
  owner_account_id: AccountId;
};

/** Whether the occurrence already has an outcome: Satisfied, Missed or Excused. */
export function isJudged(ctx: CoreContext, pactId: string, date: LocalDate): boolean {
  return (
    ctx.db
      .prepare(`SELECT 1 FROM occurrence WHERE pact_id = ? AND date = ? AND outcome IS NOT NULL`)
      .get(pactId, date) !== undefined
  );
}

/** Whether an excuse waiting for approval, or else an approved one, covers the occurrence. */
export function excuseOn(ctx: CoreContext, pactId: string, date: LocalDate): "waiting" | "approved" | null {
  const decisions = ctx
    .all<{ decision: ReviewOutcome | null }>(
      `SELECT excuse.decision FROM excuse_day JOIN excuse ON excuse.id = excuse_day.excuse_id
         WHERE excuse_day.pact_id = ? AND excuse_day.date = ?`,
      pactId,
      date,
    )
    .map((row) => row.decision);
  if (decisions.includes(null)) return "waiting";
  return decisions.includes("approved") ? "approved" : null;
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
    }>(`SELECT decision FROM evidence WHERE pact_id = ? AND ${by} = ?`, pactId, date)
    .map((row) => row.decision ?? "waiting");
  if (decisions.includes("waiting")) return "waiting";
  if (decisions.includes("approved")) return "approved";
  return decisions.length > 0 ? "rejected" : "none";
}

/** How far the pact's Weekly count week starting `monday` has got: see `WeekProgress`. */
export function weekProgress(ctx: CoreContext, pactId: string, monday: LocalDate): WeekProgress {
  const schedule = scheduleOf(termsOn(ctx, pactId, monday).schedule);
  const counts = ctx.db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN decision = 'approved' THEN day END) AS sessions,
              COUNT(DISTINCT CASE WHEN decision IS NULL THEN day END) AS waiting
       FROM evidence WHERE pact_id = ? AND occurrence_date = ?`,
    )
    .get(pactId, monday) as { sessions: number; waiting: number };
  return { ...counts, target: schedule.kind === "weekly-count" ? schedule.target : 1 };
}

/**
 * Where the pact's occurrence `occurrence` stands as of `now`, excuses
 * included.
 */
export function occurrenceStatus(ctx: CoreContext, pactId: string, occurrence: Occurrence): OccurrenceStatus {
  const { date } = occurrence;
  const row = ctx.one<{
    outcome: "satisfied" | "missed" | "excused" | null;
    judged_at: string | null;
    amount_cents: number | null;
  }>(
    `SELECT occurrence.outcome, occurrence.judged_at, penalty.amount_cents
       FROM occurrence
       LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
       WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
    pactId,
    date,
  );
  const excuse = excuseOn(ctx, pactId, date);
  if (row?.outcome === "satisfied") return { kind: "satisfied" };
  if (row?.outcome === "excused") return { kind: "excused" };
  if (row?.outcome === "missed") {
    return {
      kind: "missed",
      penaltyCents: row.amount_cents!,
      held: excuse === "waiting",
      excusableUntil: new Date(new Date(row.judged_at!).getTime() + EXCUSE_WINDOW_MS),
    };
  }
  return {
    kind: "not-judged",
    opensAt: occurrence.opensAt,
    dueAt: occurrence.dueAt,
    evidenceWaiting: evidenceDecision(ctx, pactId, date) === "waiting",
    excuse,
  };
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
 * Whether judging at `t` reaches the pact's occurrence on `date`: it's on
 * or before the pact's `judged_through`, or due by `t` in the owner's
 * timezone now. The cursor counts on its own because a timezone change can
 * move a due time it already went past back into the future.
 */
export function judgingReached(ctx: CoreContext, pactId: string, date: LocalDate, t: Date): boolean {
  const [pact] = pactsToJudge(ctx, pactId);
  if (!pact) throw new Error(`no pact ${pactId}`);
  if (pact.judged_through !== null && date <= pact.judged_through) return true;
  return occurrencesOf(ctx, pactId, ownerZone(pact.timezone, pact.owner_account_id))
    .dueAfter(pact.judged_through, t)
    .some((occurrence) => occurrence.date === date);
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
      if (status.held) return "on-waiting-excuse";
      return status.excusableUntil.getTime() > now.getTime() ? null : "window-closed";
    case "not-judged":
      if (status.excuse === "waiting") return "on-waiting-excuse";
      return status.excuse === "approved" ? "excused" : null;
  }
}

/** SQL: the `pact` row's schedule is Weekly count. */
export const WEEKLY_COUNT_PACT = `json_extract(pact.schedule, '$.kind') = 'weekly-count'`;

/**
 * SQL: the Missed `occurrence` row (of the `pact` row) was judged through a
 * rejection. Any rejected evidence will do: on Fixed days and One-time a
 * rejection judges the occurrence at once. A Weekly count week's rejected
 * evidence just doesn't count, so a short week is never Missed through it.
 */
export const MISSED_THROUGH_REJECTION = `(NOT ${WEEKLY_COUNT_PACT} AND EXISTS (SELECT 1 FROM evidence
  WHERE evidence.pact_id = occurrence.pact_id AND evidence.occurrence_date = occurrence.date
    AND evidence.decision = 'rejected'))`;

/**
 * SQL: an excuse matching `condition` (on `excuse`) covers the occurrence of
 * pact `pact` on `date` (SQL expressions).
 */
export function excuseCoversSql(pact: string, date: string, condition: string): string {
  return `EXISTS (SELECT 1 FROM excuse_day JOIN excuse ON excuse.id = excuse_day.excuse_id
    WHERE excuse_day.pact_id = ${pact} AND excuse_day.date = ${date} AND ${condition})`;
}
