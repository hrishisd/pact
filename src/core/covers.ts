// What covers an occurrence: an excuse or a vacation, read as one kind of
// cover. Their filing rules differ on purpose (which days, which deciders);
// once filed, a cover does the same to an occurrence whatever its kind. Every
// read of an occurrence's cover goes through here or `cover_day_v`.

import type { LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";

export type CoverKind = "excuse" | "vacation";

/** An excuse or vacation covering an occurrence, waiting for approval or approved. */
export interface Cover {
  id: string;
  kind: CoverKind;
  state: "waiting" | "approved";
}

/** What a cover of each kind does to its occurrences while it waits. */
interface CoverPolicy {
  /** Whether Today keeps the To do card, and reminders keep firing, while it waits. One flag, read by both (R7). */
  keepsToDoWhileWaiting: boolean;
}

const COVER_POLICIES: Record<CoverKind, CoverPolicy> = {
  // The owner asked for the day off now: Today lists it under Waiting for approval, and it isn't theirs to do.
  excuse: { keepsToDoWhileWaiting: false },
  // A vacation is filed ahead and may not be approved in time: its days keep their To do cards
  // and reminders until it is (vacation spec, "Judging and money" and "Today").
  vacation: { keepsToDoWhileWaiting: true },
};

/**
 * Every excuse or vacation covering the pact's occurrence on `date` (for
 * Weekly count, its Monday) that waits for approval or is approved. A
 * rejected or withdrawn one covers nothing.
 */
export function coversOn(ctx: CoreContext, pactId: string, date: LocalDate): Cover[] {
  return ctx
    .all<{ id: string; kind: CoverKind; decision: "approved" | null }>(
      `SELECT id, kind, decision FROM cover_day_v
         WHERE pact_id = ? AND date = ? AND withdrawn_at IS NULL AND (decision IS NULL OR decision = 'approved')
         ORDER BY kind, id`,
      pactId,
      date,
    )
    .map((row) => ({ id: row.id, kind: row.kind, state: row.decision === null ? "waiting" : "approved" }));
}

/**
 * The one cover that counts for the pact's occurrence on `date`, or null:
 * an excuse waiting for approval, else an approved excuse, else an approved
 * vacation, else a vacation waiting for approval. An approved vacation
 * counts exactly as an approved excuse does.
 */
export function coverOn(ctx: CoreContext, pactId: string, date: LocalDate): Cover | null {
  const covers = coversOn(ctx, pactId, date);
  return (
    covers.find((c) => c.kind === "excuse" && c.state === "waiting") ??
    covers.find((c) => c.kind === "excuse") ??
    covers.find((c) => c.state === "approved") ??
    covers[0] ??
    null
  );
}

/** Whether an approved vacation covers the pact's occurrence on `date`: the owner is off that day. */
export function onApprovedVacation(ctx: CoreContext, pactId: string, date: LocalDate): boolean {
  return coversOn(ctx, pactId, date).some((c) => c.kind === "vacation" && c.state === "approved");
}

/**
 * Whether an occurrence with `cover` is still the owner's to do, as far as
 * its cover goes: nothing covers it, or a cover waiting for approval whose
 * kind keeps its days (a vacation). Today and reminders both read this.
 */
export function keepsToDo(cover: Cover | null): boolean {
  return cover === null || (cover.state === "waiting" && COVER_POLICIES[cover.kind].keepsToDoWhileWaiting);
}

/**
 * SQL: an excuse or vacation not withdrawn covers the occurrence of pact
 * `pact` on `date` (SQL expressions), in `state`: waiting for approval,
 * approved, or "any" (rejected included). `condition`, if given, narrows it
 * further and reads the cover as `cover` (`cover_day_v`'s columns).
 */
export function coveredSql(pact: string, date: string, state: "waiting" | "approved" | "any", condition = "1"): string {
  const stateCondition = {
    waiting: "cover.decision IS NULL",
    approved: "cover.decision = 'approved'",
    any: "1",
  }[state];
  return `EXISTS (SELECT 1 FROM cover_day_v AS cover
    WHERE cover.pact_id = ${pact} AND cover.date = ${date} AND cover.withdrawn_at IS NULL
      AND ${stateCondition} AND (${condition}))`;
}

/**
 * Moves the covers on the pact's occurrence dated `from` to `to`, as a
 * One-time deadline's new date. An excuse moves with it; a vacation only if
 * its dates take in `to`, else it no longer covers the occurrence.
 */
export function moveCovers(ctx: CoreContext, pactId: string, from: LocalDate, to: LocalDate): void {
  ctx.db.prepare(`UPDATE excuse_day SET date = ? WHERE pact_id = ? AND date = ?`).run(to, pactId, from);
  ctx.db
    .prepare(
      `UPDATE vacation_day SET date = ? WHERE pact_id = ? AND date = ?
         AND vacation_id IN (SELECT id FROM vacation WHERE first_day <= ? AND last_day >= ?)`,
    )
    .run(to, pactId, from, to, to);
  ctx.db.prepare(`DELETE FROM vacation_day WHERE pact_id = ? AND date = ?`).run(pactId, from);
}
