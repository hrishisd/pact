// What covers an occurrence: an excuse or a vacation, read as one kind of
// cover. Their filing rules differ on purpose (which days, which deciders);
// once filed, a cover does the same to an occurrence whatever its kind. Every
// read of an occurrence's cover goes through here or `cover_day_v`.
//
// An occurrence is identified by `(pact_id, date)` alone (for Weekly count,
// the week's Monday), and the tables of facts about one (evidence, penalties,
// cover days) have no foreign key that follows it when it moves or goes. Two
// places must handle every such table: `moveOneTimeOccurrence` (pacts.ts),
// when a One-time deadline moves, and `uncoverRemovedDays` (here), when a
// change takes a day off the schedule. scripts/check-conventions.ts refuses a
// migration that adds one neither names, unless its allow list says why.

import type { LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";

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
 * SQL: when the 48-hour excuse window of the occurrence of pact `pact` on
 * `date`, judged at `judgedAt` (SQL expressions; ISO strings), opens: the
 * later of its judging and the rejection or withdrawal of a vacation that
 * covered it while it waited (R3). A rejected or withdrawn excuse doesn't
 * move it (v0:256), and nothing reopens it once its penalty is on a bill: a
 * billed penalty can't be excused (`settle`). Bills now wait out a reopened
 * window, but bills made before R3 may hold a released penalty. Every read
 * of the window goes through here or `excusableUntil`.
 */
export function excuseWindowOpensSql(pact: string, date: string, judgedAt: string): string {
  return `MAX(${judgedAt}, COALESCE((SELECT MAX(COALESCE(released.withdrawn_at, released.decided_at))
    FROM cover_day_v AS released
    WHERE released.kind = 'vacation' AND released.pact_id = ${pact} AND released.date = ${date}
      AND (released.withdrawn_at IS NOT NULL OR released.decision = 'rejected')
      AND NOT EXISTS (SELECT 1 FROM penalty AS billed
                      WHERE billed.pact_id = ${pact} AND billed.occurrence_date = ${date} AND billed.bill_id IS NOT NULL)),
    ${judgedAt}))`;
}

/** When the excuse window that opens at `opensAt` (from `excuseWindowOpensSql`) closes. */
export function excusableUntil(opensAt: string): Date {
  return new Date(new Date(opensAt).getTime() + EXCUSE_WINDOW_MS);
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

/**
 * Deletes the excuse and vacation days on the pact's occurrences dated
 * `from` onward that its schedule no longer has (`scheduled` says which it
 * has), unless judged: a change took the day off, and one that adds it back
 * finds it not covered (vac:61). A cover left with no days still waits.
 */
export function uncoverRemovedDays(
  ctx: CoreContext,
  pactId: string,
  from: LocalDate,
  scheduled: (date: LocalDate) => boolean,
): void {
  const removed = ctx
    .all<{ date: LocalDate }>(
      `SELECT DISTINCT date FROM cover_day_v
         WHERE pact_id = ? AND date >= ?
           AND NOT EXISTS (SELECT 1 FROM occurrence
                             WHERE occurrence.pact_id = cover_day_v.pact_id AND occurrence.date = cover_day_v.date
                               AND occurrence.outcome IS NOT NULL)
         ORDER BY date`,
      pactId,
      from,
    )
    .map((row) => row.date)
    .filter((date) => !scheduled(date));
  for (const date of removed) {
    ctx.db.prepare(`DELETE FROM excuse_day WHERE pact_id = ? AND date = ?`).run(pactId, date);
    ctx.db.prepare(`DELETE FROM vacation_day WHERE pact_id = ? AND date = ?`).run(pactId, date);
  }
}
