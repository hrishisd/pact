// The judging rules stated once: what an occurrence's outcome is, given the
// facts about it and the time. Pure, with no database and no clock: the
// facts loader (`occurrenceFacts`) reads the facts, and nothing in production
// calls `verdictOf` yet. Until `settle` replaces them (design review tickets
// 11 to 13), the seven judging call sites keep their own copies of these
// rules, and the scenario harness checks after every command and tick that
// what they stored is what `verdictOf` says (`testing/verdict-check.ts`).
//
// The verdict is replayed from the facts in time order, because a stored
// outcome is history: an occurrence judged Missed at its due time stays
// Missed from then, and only an approved cover (Missed to Excused) or
// approved evidence (Excused to Satisfied, vacation spec "Judging and money")
// moves it after that.

import type { ClockTime, LocalDate, Schedule } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { coverOn, type Cover } from "./covers.ts";
import { ANKI_CHECK_HOLDS_JUDGING_MS } from "./judging.ts";
import type { Occurrence, Occurrences } from "./occurrences.ts";
import { deadlineWallClock, wallClock } from "./oura-clock.ts";
import { ankiDeckOn, occurrencesOf, scheduleOf, termsOn, type ReviewOutcome } from "./rows.ts";

/** One submission of evidence for the occurrence (a Weekly count week: for one of its days). */
export interface EvidenceFact {
  day: LocalDate;
  submittedAt: Date;
  decision: ReviewOutcome | null;
  decidedAt: Date | null;
}

/** A bedtime night's Oura data: the first long_sleep period Oura reported for it, and when Pact got it. */
export interface OuraFact {
  kind: "oura";
  inBedBy: ClockTime;
  /**
   * As Oura reports it, with its UTC offset; null while none has arrived, and
   * for a night judged at its close before one arrived. One that arrives on the
   * first look after the close still judges the night.
   */
  firstBedtimeStart: string | null;
  arrivedAt: Date | null;
}

/** An Anki day's checks of AnkiWeb. */
export interface AnkiFact {
  kind: "anki";
  /** When the first check that found its deck finished before its due time started; null if none has. */
  finishedAt: Date | null;
  /** When that check's answer was recorded. */
  recordedAt: Date | null;
  /** Every check of the owner's AnkiWeb, and when its answer came back (null while it's running). */
  checks: AnkiCheckRun[];
}

export interface AnkiCheckRun {
  startedAt: Date;
  finishedAt: Date | null;
}

/** The cover that counts for the occurrence (`coverOn`), and when it was approved. */
export type CoverFact = Cover & { approvedAt: Date | null };

/** Everything judging an occurrence reads. */
export interface OccurrenceFacts {
  occurrence: Occurrence;
  /** The terms the occurrence was made with (`termsOn`). */
  terms: { schedule: Schedule; penaltyCents: number; recipientId: string };
  pactEndedAt: Date | null;
  evidence: EvidenceFact[];
  automatic: OuraFact | AnkiFact | null;
  cover: CoverFact | null;
}

export type Verdict =
  /** Due after the pact Ended, and not settled before it: no longer the pact's, never judged. */
  | { kind: "not-the-pacts" }
  /** Not due yet, and nothing has decided it. */
  | { kind: "open" }
  /** Due, and waiting for something that may still decide it. */
  | { kind: "waiting"; on: "evidence" | "oura" | "anki-check" }
  | { kind: "satisfied"; at: Date }
  | { kind: "excused"; at: Date; coverId: string }
  | { kind: "missed"; at: Date; penaltyCents: number; recipientId: string };

export type FinalVerdict = Extract<Verdict, { at: Date }>;

/**
 * What happens to an occurrence, in the order things happen: at `seenAt`,
 * judging it as of `at`. They differ for an Anki day: a check's answer is
 * recorded after the check started, and a check running at the due time
 * holds judging as of the due time until it's answered or given up.
 */
type Step = { at: Date; seenAt: Date } & (
  | { kind: "evidence-decided"; decision: ReviewOutcome }
  | { kind: "cover-approved" }
  | { kind: "anki-finished" }
  | { kind: "oura-arrived" }
  | { kind: "due" }
  | { kind: "closed" }
);

// At one instant, facts land before the due time and the close are judged.
const STEP_ORDER: Record<Step["kind"], number> = {
  "evidence-decided": 0,
  "anki-finished": 0,
  "oura-arrived": 0,
  "cover-approved": 1,
  due: 2,
  closed: 2,
};

/**
 * The occurrence's outcome as of `now`, or why it has none. The rules, for
 * every evidence kind:
 * - Approved evidence beats an approved cover, which beats a miss. Evidence
 *   waiting for a decision defers judging, unless an approved cover already
 *   holds the occurrence: then it's Excused, and a later approval makes it
 *   Satisfied.
 * - A Camera day is judged at its due time, or when a decision after that
 *   decides it. A rejection is final: with no approved cover it judges the day
 *   Missed at once, open or not. Rejected evidence on a Weekly count week
 *   just doesn't count; a week is short by its target less its approved days.
 * - An Anki day is Satisfied when a check finds its deck finished before its
 *   due time; at its due time it's judged as a Camera day with no evidence,
 *   unless a check that started before then is still running.
 * - A bedtime night is judged when Oura's first period for it arrives:
 *   Satisfied if it starts before the in-bed-by time, else Missed, or Excused
 *   under an approved cover. With none by the time it closes, it's Missed then,
 *   or Excused under an approved cover.
 * - An approved cover makes a Missed occurrence Excused when it's approved.
 * - An occurrence due after the pact Ended is not the pact's, unless it was
 *   judged before the end.
 */
export function verdictOf(facts: OccurrenceFacts, now: Date): Verdict {
  const { occurrence, terms, pactEndedAt, automatic, cover } = facts;
  const weekly = terms.schedule.kind === "weekly-count";
  const target = terms.schedule.kind === "weekly-count" ? terms.schedule.target : 1;
  const evidence = facts.evidence.filter((e) => e.submittedAt.getTime() <= now.getTime());
  const decidedBy = (e: EvidenceFact, t: Date) => e.decidedAt !== null && e.decidedAt.getTime() <= t.getTime();
  const approvedDays = (t: Date) =>
    new Set(evidence.filter((e) => e.decision === "approved" && decidedBy(e, t)).map((e) => e.day)).size;
  // Evidence the occurrence took waits from when it's submitted; a timezone change can move a due time before that.
  const waitingAt = (t: Date) => evidence.some((e) => !decidedBy(e, t));
  const coverApprovedBy = (t: Date) =>
    cover?.state === "approved" && cover.approvedAt !== null && cover.approvedAt.getTime() <= t.getTime();
  const satisfied = (at: Date): FinalVerdict => ({ kind: "satisfied", at });
  const excused = (at: Date): FinalVerdict => ({ kind: "excused", at, coverId: cover!.id });
  const missed = (at: Date): FinalVerdict => ({
    kind: "missed",
    at,
    penaltyCents: terms.penaltyCents * (target - (weekly ? approvedDays(at) : 0)),
    recipientId: terms.recipientId,
  });
  /** A Weekly count week as judged at `t`, or null while its waiting evidence could still change it. */
  const judgeWeek = (t: Date): FinalVerdict | null => {
    if (approvedDays(t) >= target) return satisfied(t);
    if (coverApprovedBy(t)) return excused(t);
    if (waitingAt(t)) return null;
    return missed(t);
  };

  const steps: Step[] = [];
  for (const e of evidence) {
    if (e.decision !== null && e.decidedAt !== null && e.decidedAt.getTime() <= now.getTime()) {
      steps.push({ kind: "evidence-decided", at: e.decidedAt, seenAt: e.decidedAt, decision: e.decision });
    }
  }
  if (cover?.state === "approved" && cover.approvedAt !== null && cover.approvedAt.getTime() <= now.getTime()) {
    steps.push({ kind: "cover-approved", at: cover.approvedAt, seenAt: cover.approvedAt });
  }
  let ouraOnTime = false;
  if (automatic?.kind === "oura") {
    if (automatic.firstBedtimeStart !== null && automatic.arrivedAt !== null) {
      const arrivedAt = automatic.arrivedAt;
      if (arrivedAt.getTime() <= now.getTime()) steps.push({ kind: "oura-arrived", at: arrivedAt, seenAt: arrivedAt });
      ouraOnTime = wallClock(automatic.firstBedtimeStart) < deadlineWallClock(occurrence.date, automatic.inBedBy);
    }
    // With no period by the time judging looks after the close, the night is judged at its close.
    if (automatic.arrivedAt === null && occurrence.closesAt.getTime() <= now.getTime()) {
      steps.push({ kind: "closed", at: occurrence.closesAt, seenAt: occurrence.closesAt });
    }
  } else {
    if (automatic?.kind === "anki" && automatic.finishedAt !== null && automatic.finishedAt < occurrence.dueAt) {
      const seenAt = automatic.recordedAt ?? automatic.finishedAt;
      if (seenAt.getTime() <= now.getTime()) steps.push({ kind: "anki-finished", at: automatic.finishedAt, seenAt });
    }
    const judgedFrom = dueJudgedFrom(facts, now);
    if (judgedFrom !== null) steps.push({ kind: "due", at: occurrence.dueAt, seenAt: judgedFrom });
  }
  steps.sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime() || STEP_ORDER[a.kind] - STEP_ORDER[b.kind]);

  const endedBeforeDue = pactEndedAt !== null && occurrence.dueAt.getTime() > pactEndedAt.getTime();
  let outcome: FinalVerdict | null = null;
  for (const step of steps) {
    // Once the pact has Ended, an occurrence due after the end is no longer judged.
    if (outcome === null && endedBeforeDue && step.seenAt.getTime() > pactEndedAt.getTime()) break;
    const past = step.at.getTime() >= occurrence.dueAt.getTime();
    switch (step.kind) {
      case "due":
        if (outcome !== null) break;
        if (weekly) outcome = judgeWeek(step.at);
        else if (approvedDays(step.at) > 0) outcome = satisfied(step.at);
        else if (coverApprovedBy(step.at)) outcome = excused(step.at);
        else if (!waitingAt(step.at)) outcome = missed(step.at);
        break;
      case "evidence-decided":
        if (outcome?.kind === "excused") {
          // Approved evidence still makes an occurrence under a cover Satisfied (vacation spec, "Judging and money").
          if (approvedDays(step.at) >= target) outcome = satisfied(step.at);
        } else if (outcome === null && weekly) {
          if (past) outcome = judgeWeek(step.at);
        } else if (outcome === null && step.decision === "approved") {
          if (past) outcome = satisfied(step.at);
        } else if (outcome === null) {
          if (!coverApprovedBy(step.at)) outcome = missed(step.at);
          else if (past) outcome = excused(step.at);
        }
        break;
      case "cover-approved":
        if (outcome?.kind === "missed" || (outcome === null && past && automatic?.kind !== "oura")) {
          outcome = excused(step.at);
        }
        break;
      case "anki-finished":
        outcome ??= satisfied(step.at);
        break;
      case "oura-arrived":
        if (outcome !== null) break;
        if (ouraOnTime) outcome = satisfied(step.at);
        else if (coverApprovedBy(step.at)) outcome = excused(step.at);
        else outcome = missed(step.at);
        break;
      case "closed":
        if (outcome !== null) break;
        outcome = coverApprovedBy(step.at) ? excused(step.at) : missed(step.at);
        break;
    }
  }
  if (outcome !== null) return outcome;
  if (endedBeforeDue && pactEndedAt.getTime() <= now.getTime()) return { kind: "not-the-pacts" };
  if (now.getTime() < occurrence.dueAt.getTime()) return { kind: "open" };
  if (automatic?.kind === "oura") return { kind: "waiting", on: "oura" };
  if (automatic?.kind === "anki") return { kind: "waiting", on: "anki-check" };
  return { kind: "waiting", on: "evidence" };
}

/**
 * From when judging can judge the occurrence as of its due time: its due
 * time, or for an Anki day, once every check of AnkiWeb that started before
 * then and was still running at it has been answered or given up. Null
 * while that hasn't come by `now`.
 */
export function dueJudgedFrom(facts: OccurrenceFacts, now: Date): Date | null {
  const { dueAt } = facts.occurrence;
  if (dueAt.getTime() > now.getTime()) return null;
  if (facts.automatic?.kind !== "anki") return dueAt;
  let from = dueAt;
  for (const check of facts.automatic.checks) {
    if (check.startedAt.getTime() >= dueAt.getTime()) continue;
    const givenUpAt = check.startedAt.getTime() + ANKI_CHECK_HOLDS_JUDGING_MS;
    const endedAt = Math.min(check.finishedAt?.getTime() ?? Infinity, givenUpAt);
    // One answered at the due time itself may have come after the tick that judged it, so it holds too.
    if (endedAt < dueAt.getTime()) continue;
    if (endedAt > now.getTime()) return null;
    if (endedAt > from.getTime()) from = new Date(endedAt);
  }
  return from;
}

/**
 * The facts `verdictOf` judges the pact's occurrence dated `date` by, as
 * stored, or null if the pact has no occurrence that day. Two facts aren't
 * stored yet: the checks of AnkiWeb and when each was answered, which only
 * the core holds, in memory (`ankiChecks`, none unless given; a finished check's
 * answer reads as recorded when it started), and a bedtime night's
 * first sleep period, which is stored on the occurrence only once a period
 * judged it Satisfied or Missed (design review ticket 12 stores it when it
 * arrives). Until then, a night judged Excused by a late period reads as
 * having none.
 */
export function occurrenceFacts(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  known: { ankiChecks?: AnkiCheckRun[]; occurrences?: Occurrences } = {},
): OccurrenceFacts | null {
  const pact = ctx.one<{ timezone: string; ended_at: string | null; evidence_kind: string; owner: string }>(
    `SELECT account.timezone, pact.ended_at, pact.evidence_kind, pact.owner_account_id AS owner
       FROM pact JOIN account ON account.id = pact.owner_account_id WHERE pact.id = ?`,
    pactId,
  );
  if (!pact) return null;
  const occurrences = known.occurrences ?? occurrencesOf(ctx, pactId, pact.timezone);
  const occurrence = occurrences.includes(date) ? occurrences.covering(date) : null;
  if (occurrence === null || occurrence.date !== date) return null;
  const terms = termsOn(ctx, pactId, date);
  const evidence = ctx
    .all<{ day: LocalDate; submitted_at: string; decision: ReviewOutcome | null; decided_at: string | null }>(
      `SELECT day, submitted_at, decision, decided_at FROM evidence WHERE pact_id = ? AND occurrence_date = ?
         ORDER BY submitted_at, id`,
      pactId,
      date,
    )
    .map((row) => ({
      day: row.day,
      submittedAt: new Date(row.submitted_at),
      decision: row.decision,
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
    }));
  const found = coverOn(ctx, pactId, date);
  const cover: CoverFact | null = found && {
    ...found,
    approvedAt: found.state === "approved" ? new Date(coverDecidedAt(ctx, found.id)) : null,
  };
  let automatic: OuraFact | AnkiFact | null = null;
  if (pact.evidence_kind === "oura") {
    const row = ctx.one<{ bedtime_start: string | null; judged_at: string | null }>(
      `SELECT bedtime_start, judged_at FROM occurrence WHERE pact_id = ? AND date = ?`,
      pactId,
      date,
    );
    const start = row?.bedtime_start ?? null;
    automatic = {
      kind: "oura",
      inBedBy: terms.in_bed_by!,
      firstBedtimeStart: start,
      arrivedAt: start === null ? null : new Date(row!.judged_at!),
    };
  } else if (pact.evidence_kind === "anki") {
    const finished = ctx.one<{ checked_at: string }>(
      `SELECT checked_at FROM anki_check
         WHERE account_id = ? AND deck_id = ? AND anki_date = ? AND as_of < ? AND checked_at < ?
           AND new_count + learn_count + review_count = 0
         ORDER BY checked_at, id LIMIT 1`,
      pact.owner,
      ankiDeckOn(ctx, pactId, date),
      date,
      occurrence.dueAt.toISOString(),
      occurrence.dueAt.toISOString(),
    );
    automatic = {
      kind: "anki",
      finishedAt: finished ? new Date(finished.checked_at) : null,
      recordedAt: finished ? new Date(finished.checked_at) : null,
      checks: known.ankiChecks ?? [],
    };
  }
  return {
    occurrence,
    terms: {
      schedule: scheduleOf(terms.schedule),
      penaltyCents: terms.penalty_cents,
      recipientId: terms.recipient_id,
    },
    pactEndedAt: pact.ended_at === null ? null : new Date(pact.ended_at),
    evidence,
    automatic,
    cover,
  };
}

function coverDecidedAt(ctx: CoreContext, coverId: string): string {
  return ctx.one<{ decided_at: string }>(`SELECT decided_at FROM cover_day_v WHERE id = ? LIMIT 1`, coverId)!
    .decided_at;
}
