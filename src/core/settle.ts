// Settling: bringing an occurrence's stored outcome, judging time and penalty
// in line with what `verdictOf` says of it, and telling the owner when that
// makes it Missed. The tick and evidence decisions judge through here;
// covers, bedtime and Anki still judge for themselves (design review ticket
// 12), and ending a pact is still `endPact` (ticket 13).

import type { LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { ankiCheckHolds, endPact, enqueueMissed, noteAnkiMiss, type AnkiChecksRunning } from "./judging.ts";
import { isJudged, pactsToJudge, type PactToJudge } from "./occurrence-state.ts";
import { occurrencesOf } from "./rows.ts";
import { occurrenceFacts, verdictOf, type AnkiCheckRun, type Verdict } from "./verdict.ts";

/** What settling changed: the occurrence's stored outcome before, and its verdict now. */
export interface Transition {
  from: "satisfied" | "missed" | "excused" | null;
  to: Extract<Verdict, { at: Date }>;
}

/**
 * Settles the pact's occurrence dated `date` as of `now`: if it isn't judged
 * and its verdict is final, stores the outcome as of the verdict's time, with
 * the penalty for a Missed one, and ends a One-time pact. An outcome once
 * stored is kept: cover approvals still change it themselves until design
 * review ticket 12 moves them here.
 *
 * The owner is told whenever this makes an occurrence Missed, except when
 * a rejection judged a Fixed day or One-time occurrence (the rejection's push
 * told them, with the reason), or when a cover is filed for it (they asked for
 * it to be excused). Returns what changed, or null if nothing did.
 */
export function settle(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  now: Date,
  ankiChecks: AnkiCheckRun[] = [],
): Transition | null {
  if (isJudged(ctx, pactId, date)) return null;
  const facts = occurrenceFacts(ctx, pactId, date, { ankiChecks });
  if (facts === null) return null;
  const verdict = verdictOf(facts, now);
  if (!("at" in verdict)) return null;
  const owner = ctx.one<{ owner_account_id: string }>(`SELECT owner_account_id FROM pact WHERE id = ?`, pactId)!;
  ctx.db
    .prepare(
      `INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pact_id, date) DO UPDATE SET outcome = excluded.outcome, judged_at = excluded.judged_at`,
    )
    .run(pactId, date, verdict.kind, verdict.at.toISOString());
  const weekly = facts.terms.schedule.kind === "weekly-count";
  // A One-time pact has no occurrence left once its one is judged.
  if (facts.terms.schedule.kind === "one-time") endPact(ctx, pactId, verdict.at);
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
  return { from: null, to: verdict };
}

/**
 * The tick's judging: settles each Active pact's Camera and Anki occurrences
 * due by `t`, from where judging got to last time (the pact's
 * `judged_through`), so a stopped scheduler catches up. Oura reports bedtime
 * nights (`judgeNights`).
 */
export function settleAll(ctx: CoreContext, t: Date, anki: AnkiChecksRunning): void {
  for (const pact of pactsToJudge(ctx)) settlePactDueBy(ctx, pact, t, anki);
}

/**
 * Settles one Camera or Anki pact's occurrences due by `t`, from where
 * judging got to. An Anki day still not judged is Missed then, with the
 * last check that counted for it, unless a check that started before its
 * due time is still running: judging stops there, and a later tick judges
 * it once the check is recorded.
 */
export function settlePactDueBy(ctx: CoreContext, pact: PactToJudge, t: Date, anki: AnkiChecksRunning): void {
  if (pact.evidence_kind === "oura") return;
  settleBehindCursor(ctx, pact, t);
  const due = occurrencesOf(ctx, pact.id, pact.timezone).dueAfter(pact.judged_through, t);
  const running = [...(anki.get(pact.owner_account_id) ?? [])].map(({ startedAt }) => ({
    startedAt: new Date(startedAt),
    finishedAt: null,
  }));
  let through: LocalDate | null = null;
  for (const occurrence of due) {
    const isAnki = pact.evidence_kind === "anki";
    if (isAnki && !isJudged(ctx, pact.id, occurrence.date)) {
      if (ankiCheckHolds(anki, pact.owner_account_id, occurrence, t)) break;
      if (settle(ctx, pact.id, occurrence.date, t, running)?.to.kind === "missed") noteAnkiMiss(ctx, pact, occurrence);
    } else {
      settle(ctx, pact.id, occurrence.date, t, running);
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
