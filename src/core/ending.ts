// Ending pacts: the one place a pact becomes Ended, for each cause, and an
// approved end request, which waits for the occurrence open at approval.

import { addDays } from "../shared/calendar.ts";
import type { EndTiming, LocalDate } from "../shared/types.ts";
import { localDateOf, startOfDay } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { isJudged } from "./occurrence-state.ts";
import { occurrencesOf, scheduleOf, type PactRow } from "./rows.ts";
import { ankiCheckHolds } from "./verdict.ts";

/**
 * Why a pact Ends: its end date passed (`end-date`), its One-time occurrence
 * was judged (`one-time-judged`), or an approved end request took effect
 * (`end-request`).
 */
export type EndCause = "end-date" | "one-time-judged" | "end-request";

/**
 * Makes an Active pact Ended as of `at`, for `cause`. A change request still
 * waiting for it is withdrawn, silently, for `pact-ended` (R8): there's
 * nothing left for it to change. Every cause does the same. Other items the
 * end leaves moot go after the command (`withdrawMoot`).
 */
export function endPact(ctx: CoreContext, pactId: string, cause: EndCause, at: Date): void {
  const ended = ctx.db
    .prepare(`UPDATE pact SET stage = 'ended', ended_at = ? WHERE id = ? AND stage = 'active'`)
    .run(at.toISOString(), pactId);
  if (ended.changes === 0) return;
  ctx.db
    .prepare(
      `UPDATE change_request SET withdrawn_at = ?, withdrawn_reason = 'pact-ended'
         WHERE pact_id = ? AND decision IS NULL AND withdrawn_at IS NULL`,
    )
    .run(at.toISOString(), pactId);
}

/**
 * When the pact would End if its end were approved at `now`: once the
 * occurrence (or week) open then closes, the last day of that occurrence's
 * period named; or at once, with none open. An occurrence is open from when
 * it opens until it closes (a bedtime night until 18:00 the next day),
 * unless it's already judged.
 */
export function endTiming(ctx: CoreContext, pactId: string, now: Date): EndTiming {
  const { timezone, schedule } = ctx.one<{ timezone: string; schedule: string }>(
    `SELECT account.timezone, pact.schedule FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.id = ?`,
    pactId,
  )!;
  const today = localDateOf(now, timezone);
  // A day either side as well: a move since may leave one open there, where it opened.
  const open = occurrencesOf(ctx, pactId, timezone)
    .overlapping(addDays(today, -2), addDays(today, 1))
    .filter(
      (occurrence) =>
        occurrence.opensAt.getTime() <= now.getTime() &&
        now.getTime() < occurrence.closesAt.getTime() &&
        !isJudged(ctx, pactId, occurrence.date),
    )
    .at(-1);
  if (open === undefined) return { kind: "at-once" };
  const weekly = scheduleOf(schedule).kind === "weekly-count";
  return { kind: "after", lastDay: weekly ? addDays(open.date, 6) : open.date };
}

/**
 * Records an approved end that waits for the occurrence open at `at`, whose
 * period's last day is `lastDay`: that day becomes the pact's end date (a
 * One-time pact has none, and Ends when its occurrence is judged), so it
 * makes no later occurrences, and `endPastEndDate` Ends it once that one
 * closes.
 */
export function endAfter(ctx: CoreContext, pactId: string, lastDay: LocalDate, at: Date): void {
  ctx.db
    .prepare(
      `UPDATE pact SET end_approved_at = COALESCE(end_approved_at, ?),
                       end_date = CASE WHEN json_extract(schedule, '$.kind') = 'one-time' THEN end_date
                                       WHEN end_date IS NULL OR end_date > ? THEN ?
                                       ELSE end_date END
       WHERE id = ? AND stage = 'active'`,
    )
    .run(at.toISOString(), lastDay, lastDay, pactId);
}

/**
 * An Active pact whose end was approved while an occurrence was open: the
 * last day it keeps. Null for any other pact.
 */
export function endingOf(
  row: Pick<PactRow, "id" | "stage" | "end_date" | "end_approved_at" | "schedule">,
): { lastDay: LocalDate } | null {
  if (row.stage !== "active" || row.end_approved_at === null) return null;
  const schedule = scheduleOf(row.schedule);
  if (schedule.kind === "one-time") return { lastDay: schedule.deadline };
  if (row.end_date === null) throw new Error(`pact ${row.id}: an approved end with no end date`);
  return { lastDay: row.end_date };
}

/**
 * Ends each Active pact whose end date has passed by `t`: at the start of
 * the next day, or once its last occurrence closes if that's later (a
 * bedtime night closes at 18:00 the next day). Judging has had its turn
 * first, so the last occurrence is judged unless its evidence still waits
 * for a decision, which judges it then. A pact whose last Anki day a running
 * check holds (`ankiCheckHolds`) ends on a later tick, once it's judged. An
 * end date an approved end request set Ends it for that request.
 */
export function endPastEndDate(ctx: CoreContext, t: Date): void {
  const rows = ctx.all<{
    id: string;
    end_date: LocalDate;
    end_approved_at: string | null;
    evidence_kind: PactRow["evidence_kind"];
    timezone: string;
  }>(`SELECT pact.id, pact.end_date, pact.end_approved_at, pact.evidence_kind, account.timezone
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.stage = 'active' AND pact.end_date IS NOT NULL
       ORDER BY pact.created_at, pact.id`);
  for (const row of rows) {
    const { id, end_date: endDate, evidence_kind: kind, timezone } = row;
    const dayAfter = startOfDay(addDays(endDate, 1), timezone);
    const last = occurrencesOf(ctx, id, timezone).between(addDays(endDate, -7), endDate).at(-1);
    const endsAt = last && last.closesAt.getTime() > dayAfter.getTime() ? last.closesAt : dayAfter;
    if (endsAt.getTime() > t.getTime()) continue;
    if (kind === "anki" && last && !isJudged(ctx, id, last.date) && ankiCheckHolds(ctx, id, last.date, t)) continue;
    endPact(ctx, id, row.end_approved_at === null ? "end-date" : "end-request", endsAt);
  }
}
