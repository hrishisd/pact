// Settling: bringing an occurrence's stored outcome, judging time and penalty
// in line with what `verdictOf` says of it, and telling the owner when that
// makes it Missed. The tick, evidence decisions, cover decisions, bedtime
// nights and Anki checks all judge through here. A One-time pact Ends here,
// through `endPact` (ending.ts).

import type { AccountId, EvidenceKind, LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { endPact } from "./ending.ts";
import { enqueueMissed, noteAnkiMiss } from "./judging.ts";
import { isJudged, pactsToJudge, type PactToJudge } from "./occurrence-state.ts";
import { occurrencesOf } from "./rows.ts";
import { ankiCheckHolds, occurrenceFacts, verdictOf, type Verdict } from "./verdict.ts";

/** What settling changed: the occurrence's stored outcome before, and its verdict now. */
export interface Transition {
  from: "satisfied" | "missed" | "excused" | null;
  to: Extract<Verdict, { at: Date }>;
}

/**
 * Settles the pact's occurrence dated `date` as of `now`: if it isn't judged
 * and its verdict is final, stores the outcome as of the verdict's time, with
 * the penalty for a Missed one, and ends a One-time pact. An outcome once
 * stored is kept, with two exceptions. A Missed one an approved cover now
 * excuses becomes Excused, without its penalty. That penalty can't be on a
 * bill yet (the excuse window closes before billing takes it): if it is,
 * this throws, and the command changes nothing. And an Excused one that
 * approved evidence now makes Satisfied (vacation spec, "Judging and money")
 * becomes Satisfied as of the approval; a One-time pact has Ended already.
 *
 * The owner is told whenever this makes an occurrence Missed, except when
 * a rejection judged a Fixed day or One-time occurrence (the rejection's push
 * told them, with the reason), or when a cover is filed for it (they asked for
 * it to be excused). Returns what changed, or null if nothing did.
 */
export function settle(ctx: CoreContext, pactId: string, date: LocalDate, now: Date): Transition | null {
  const from =
    ctx.one<{ outcome: Transition["from"] }>(
      `SELECT outcome FROM occurrence WHERE pact_id = ? AND date = ?`,
      pactId,
      date,
    )?.outcome ?? null;
  // Only a Missed outcome may still change, to Excused, and an Excused one, to Satisfied.
  if (from === "satisfied") return null;
  const facts = occurrenceFacts(ctx, pactId, date);
  if (facts === null) return null;
  const verdict = verdictOf(facts, now);
  if (!("at" in verdict)) return null;
  if (from !== null) {
    if (verdict.kind !== (from === "missed" ? "excused" : "satisfied")) return null;
    if (from === "missed") deletePenalties(ctx, pactId, date);
    ctx.db
      .prepare(`UPDATE occurrence SET outcome = ?, judged_at = ? WHERE pact_id = ? AND date = ?`)
      .run(verdict.kind, verdict.at.toISOString(), pactId, date);
    return { from, to: verdict };
  }
  const owner = ctx.one<{ owner_account_id: string }>(`SELECT owner_account_id FROM pact WHERE id = ?`, pactId)!;
  ctx.db
    .prepare(
      `INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pact_id, date) DO UPDATE SET outcome = excluded.outcome, judged_at = excluded.judged_at`,
    )
    .run(pactId, date, verdict.kind, verdict.at.toISOString());
  const weekly = facts.terms.schedule.kind === "weekly-count";
  // A One-time pact has no occurrence left once its one is judged.
  if (facts.terms.schedule.kind === "one-time") endPact(ctx, pactId, "one-time-judged", verdict.at);
  if (verdict.kind === "missed") {
    ctx.db
      .prepare(
        `INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.newId(),
        owner.owner_account_id,
        verdict.recipientId,
        pactId,
        date,
        verdict.penaltyCents,
        verdict.at.toISOString(),
      );
    const toldByRejection = !weekly && facts.evidence.some((e) => e.decision === "rejected");
    if (!toldByRejection && facts.cover === null) enqueueMissed(ctx, pactId, date);
  }
  return { from, to: verdict };
}

/** Deletes the occurrence's penalties; throws, before deleting any, if one is on a bill. */
function deletePenalties(ctx: CoreContext, pactId: string, date: LocalDate): void {
  const billed = ctx.one<{ id: string; bill_id: string }>(
    `SELECT id, bill_id FROM penalty WHERE pact_id = ? AND occurrence_date = ? AND bill_id IS NOT NULL LIMIT 1`,
    pactId,
    date,
  );
  if (billed) {
    throw new Error(
      `penalty ${billed.id} for pact ${pactId} on ${date} is billed (bill ${billed.bill_id}): it can't change`,
    );
  }
  ctx.db.prepare(`DELETE FROM penalty WHERE pact_id = ? AND occurrence_date = ?`).run(pactId, date);
}

/**
 * Settles the pact's occurrences that take in `dates`, the days of a cover
 * just decided or withdrawn, as of `now`. Approved: a Missed one becomes Excused, and one not judged yet
 * whose due time has passed (its evidence was waiting) is judged Excused
 * now, unless approved evidence makes it Satisfied, as at its due time; the
 * rest are judged Excused at their due time. Rejected or withdrawn:
 * the cover no longer counts, and nothing changes. A bedtime night not
 * judged yet is left to judging (`judgeNights`), which waits for Oura until
 * the night closes, and takes a period on its first look after the close.
 */
export function settleCoverDays(ctx: CoreContext, pactId: string, dates: readonly LocalDate[], now: Date): void {
  const pact = ctx.one<{ timezone: string; evidence_kind: EvidenceKind }>(
    `SELECT account.timezone, pact.evidence_kind
       FROM pact JOIN account ON account.id = pact.owner_account_id WHERE pact.id = ?`,
    pactId,
  )!;
  const { covering } = occurrencesOf(ctx, pactId, pact.timezone);
  const settled = new Set<LocalDate>();
  for (const day of dates) {
    const occurrence = covering(day);
    if (occurrence === null || settled.has(occurrence.date)) continue;
    settled.add(occurrence.date);
    if (pact.evidence_kind === "oura" && !isJudged(ctx, pactId, occurrence.date)) continue;
    settle(ctx, pactId, occurrence.date, now);
  }
}

/**
 * The tick's judging: settles each Active pact's Camera and Anki occurrences
 * due by `t`, from where judging got to last time (the pact's
 * `judged_through`), so a stopped scheduler catches up. Oura reports bedtime
 * nights (`judgeNights`).
 */
export function settleAll(ctx: CoreContext, t: Date): void {
  for (const pact of pactsToJudge(ctx)) settlePactDueBy(ctx, pact, t);
}

/**
 * Settles one Camera or Anki pact's occurrences due by `t`, from where
 * judging got to. An Anki day still not judged is Missed then, with the
 * last check that counted for it, unless a check that started before its
 * due time is still running: judging stops there, and a later tick judges
 * it once the check is recorded.
 */
export function settlePactDueBy(ctx: CoreContext, pact: PactToJudge, t: Date): void {
  if (pact.evidence_kind === "oura") return;
  settleBehindCursor(ctx, pact, t);
  const due = occurrencesOf(ctx, pact.id, pact.timezone).dueAfter(pact.judged_through, t);
  let through: LocalDate | null = null;
  for (const occurrence of due) {
    const isAnki = pact.evidence_kind === "anki";
    if (isAnki && !isJudged(ctx, pact.id, occurrence.date)) {
      if (ankiCheckHolds(ctx, pact.id, occurrence.date, t)) break;
      if (settle(ctx, pact.id, occurrence.date, t)?.to.kind === "missed") noteAnkiMiss(ctx, pact, occurrence);
    } else {
      settle(ctx, pact.id, occurrence.date, t);
    }
    through = occurrence.date;
  }
  if (through !== null) ctx.db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(through, pact.id);
}

/**
 * Settles the pact's days behind its cursor that evidence still holds. A
 * decision settles such a day once it's past its due time, but an owner's
 * move west can put a due time the cursor went past back in the future; a
 * decision before then leaves the day for the tick at its new due time.
 */
function settleBehindCursor(ctx: CoreContext, pact: PactToJudge, t: Date): void {
  if (pact.judged_through === null) return;
  const days = ctx.all<{ date: LocalDate }>(
    `SELECT DISTINCT evidence.occurrence_date AS date FROM evidence
       LEFT JOIN occurrence ON occurrence.pact_id = evidence.pact_id AND occurrence.date = evidence.occurrence_date
       WHERE evidence.pact_id = ? AND evidence.occurrence_date <= ? AND occurrence.outcome IS NULL
       ORDER BY date`,
    pact.id,
    pact.judged_through,
  );
  for (const { date } of days) settle(ctx, pact.id, date, t);
}
