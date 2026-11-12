// Moot review items (R8): when deciding an item either way can no longer
// change any outcome, penalty or terms, the system withdraws it, records
// why, and tells nobody. Each kind's handler says whether one of its items is
// moot (`RequestKindHandler.moot`); evidence, excuses and vacations ask
// `mootReason` here, which judges each occurrence the item touches both
// ways through `verdictOf`. `withdrawMoot` (review.ts) runs after every
// command and tick.

import type { LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import type { MootReason } from "./requests.ts";
import { decisionEffect } from "./verdict.ts";

/** An occurrence an item touches: a pact's, by its date (a Weekly count week by its Monday). */
export interface TouchedOccurrence {
  pact_id: string;
  date: LocalDate;
}

/**
 * Why deciding the waiting evidence, excuse or vacation `itemId` at `now`
 * could no longer change anything, or null while it could. It's moot when
 * approving and rejecting it give every occurrence it touches the same final
 * verdict and penalty (evidence approved with the occurrence's other waiting
 * evidence, which on a Weekly count week may reach the target only together),
 * or it touches none any more: `pact-ended` when one of
 * them is past the pact's end (or gone with it), else `no-longer-needed`.
 */
export function mootReason(
  ctx: CoreContext,
  itemId: string,
  touched: readonly TouchedOccurrence[],
  now: Date,
): MootReason | null {
  let pactEnded = false;
  for (const { pact_id: pactId, date } of touched) {
    const effect = decisionEffect(ctx, pactId, date, itemId, now);
    if (effect === "matters") return null;
    if (effect === "not-the-pacts" || (effect === "gone" && endedOrEnding(ctx, pactId))) pactEnded = true;
  }
  return pactEnded ? "pact-ended" : "no-longer-needed";
}

/** Whether the pact has Ended, or its end is approved and waits for the occurrence open then. */
function endedOrEnding(ctx: CoreContext, pactId: string): boolean {
  return (
    ctx.one(`SELECT 1 FROM pact WHERE id = ? AND (stage = 'ended' OR end_approved_at IS NOT NULL)`, pactId) !==
    undefined
  );
}

/**
 * Throws if a penalty stands on an occurrence a moot excuse or vacation
 * covers: one would have been Missed, and approving the cover would excuse
 * it, so the cover wasn't moot. Withdrawing a moot cover releases nothing.
 */
export function assertHoldsNoPenalty(ctx: CoreContext, coverId: string, touched: readonly TouchedOccurrence[]): void {
  for (const { pact_id: pactId, date } of touched) {
    const held = ctx.one(`SELECT 1 FROM penalty WHERE pact_id = ? AND occurrence_date = ?`, pactId, date);
    if (held) throw new Error(`cover ${coverId} withdrawn as moot holds the penalty of pact ${pactId} on ${date}`);
  }
}
