// Judging: what the paths not yet moved onto `settle` write (covers,
// bedtime and Anki, design review ticket 12), the Missed push, and ending
// pacts.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate, money } from "../shared/format.ts";
import type { AccountId, AnkiCheck, LocalDate } from "../shared/types.ts";
import { startOfDay } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { isJudged, weekProgress, type PactToJudge } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { lastAnkiCheck, occurrencesOf, recipientName, scheduleOf, termsOn, type PactRow } from "./rows.ts";

/**
 * How long a check of AnkiWeb still running can hold judging the account's
 * Anki days due after it started: the adapter gives up after 2 minutes
 * (anki.ts), plus a margin.
 */
export const ANKI_CHECK_HOLDS_JUDGING_MS = 3 * 60 * 1000;

/**
 * When each check of AnkiWeb still running started, by account. `Core` keeps
 * it in memory; judging only reads it.
 */
export type AnkiChecksRunning = ReadonlyMap<AccountId, ReadonlySet<{ startedAt: number }>>;

/**
 * Whether a check of the account's AnkiWeb that started before `day`'s due
 * time is still running at `t`, and not for so long it's given up.
 */
export function ankiCheckHolds(
  ankiChecksRunning: AnkiChecksRunning,
  account: AccountId,
  day: Occurrence,
  t: Date,
): boolean {
  return [...(ankiChecksRunning.get(account) ?? [])].some(
    ({ startedAt }) => startedAt < day.dueAt.getTime() && t.getTime() - startedAt < ANKI_CHECK_HOLDS_JUDGING_MS,
  );
}

/**
 * Ends each Active pact whose end date has passed by `t`: at the start of
 * the next day, or once its last occurrence closes if that's later (a
 * bedtime night closes at 18:00 the next day). Judging has had its turn
 * first, so the last occurrence is judged unless its evidence still waits
 * for a decision, which judges it then. A pact whose last Anki day a running
 * check holds (`ankiCheckHolds`) ends on a later tick, once it's judged.
 */
export function endPastEndDate(ctx: CoreContext, t: Date, ankiChecksRunning: AnkiChecksRunning): void {
  const rows = ctx.all<{
    id: string;
    end_date: LocalDate;
    evidence_kind: PactRow["evidence_kind"];
    owner_account_id: AccountId;
    timezone: string;
  }>(`SELECT pact.id, pact.end_date, pact.evidence_kind, pact.owner_account_id, account.timezone
       FROM pact JOIN account ON account.id = pact.owner_account_id
       WHERE pact.stage = 'active' AND pact.end_date IS NOT NULL
       ORDER BY pact.created_at, pact.id`);
  for (const { id, end_date: endDate, evidence_kind: kind, owner_account_id: owner, timezone } of rows) {
    const dayAfter = startOfDay(addDays(endDate, 1), timezone);
    const last = occurrencesOf(ctx, id, timezone).between(addDays(endDate, -7), endDate).at(-1);
    const endsAt = last && last.closesAt.getTime() > dayAfter.getTime() ? last.closesAt : dayAfter;
    if (endsAt.getTime() > t.getTime()) continue;
    if (kind === "anki" && last && !isJudged(ctx, id, last.date) && ankiCheckHolds(ankiChecksRunning, owner, last, t))
      continue;
    endPact(ctx, id, endsAt);
  }
}

/** Tells the owner the occurrence is Missed, with what it costs; `settle` and `judgeNights` decide when. */
export function enqueueMissed(ctx: CoreContext, pactId: string, date: LocalDate): void {
  const pact = {
    ...(ctx.db.prepare(`SELECT owner_account_id, name FROM pact WHERE id = ?`).get(pactId) as {
      owner_account_id: AccountId;
      name: string;
    }),
    ...termsOn(ctx, pactId, date),
  };
  const schedule = scheduleOf(pact.schedule);
  const recipient = recipientName(ctx, pact.recipient_id);
  let body = `${formatDate(date)} · ${money(pact.penalty_cents)} to ${recipient}`;
  if (schedule.kind === "weekly-count") {
    const { sessions, target } = weekProgress(ctx, pactId, date);
    const short = target - sessions;
    body = `Week of ${formatDate(date)} · ${short} short · ${money(short * pact.penalty_cents)} to ${recipient}`;
  }
  ctx.enqueue({
    recipient: pact.owner_account_id,
    kind: "missed-occurrence",
    payload: { pactId, occurrenceDate: date, title: `${pact.name} is Missed`, body, url: APP_PATHS.pact(pactId) },
  });
}

/**
 * Records an occurrence's outcome as of `at`. Missed adds the penalty to
 * the owner's ledger for the recipient, both as the pact's terms stood when
 * the occurrence opened (held, while an excuse or vacation for it waits for approval):
 * for a Weekly count week, one penalty for each day short of its target.
 */
export function judge(
  ctx: CoreContext,
  pactId: string,
  date: LocalDate,
  outcome: "satisfied" | "missed" | "excused",
  at: Date,
): void {
  const pact = {
    ...(ctx.db.prepare(`SELECT owner_account_id FROM pact WHERE id = ?`).get(pactId) as {
      owner_account_id: AccountId;
    }),
    ...termsOn(ctx, pactId, date),
  };
  ctx.db
    .prepare(
      `INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pact_id, date) DO UPDATE SET outcome = excluded.outcome, judged_at = excluded.judged_at`,
    )
    .run(pactId, date, outcome, at.toISOString());
  const schedule = scheduleOf(pact.schedule);
  // A One-time pact has no occurrence left once its one is judged.
  if (schedule.kind === "one-time") endPact(ctx, pactId, at);
  if (outcome === "missed") {
    const short = schedule.kind === "weekly-count" ? schedule.target - weekProgress(ctx, pactId, date).sessions : 1;
    ctx.db
      .prepare(
        `INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.newId(),
        pact.owner_account_id,
        pact.recipient_id,
        pactId,
        date,
        pact.penalty_cents * short,
        at.toISOString(),
      );
  }
}

/**
 * Makes an Active pact Ended as of `at`. A change request still waiting
 * for it is withdrawn: there's nothing left for it to change.
 */
export function endPact(ctx: CoreContext, pactId: string, at: Date): void {
  ctx.db
    .prepare(`UPDATE pact SET stage = 'ended', ended_at = ? WHERE id = ? AND stage = 'active'`)
    .run(at.toISOString(), pactId);
  ctx.db
    .prepare(
      `UPDATE change_request SET withdrawn_at = ? WHERE pact_id = ? AND decision IS NULL AND withdrawn_at IS NULL`,
    )
    .run(at.toISOString(), pactId);
}

/** On an Anki day just judged Missed at its due time: why, from the last check that counted for it. */
export function noteAnkiMiss(ctx: CoreContext, pact: PactToJudge, day: Occurrence): void {
  const row = ctx.one<{ outcome: string | null }>(
    `SELECT outcome FROM occurrence WHERE pact_id = ? AND date = ?`,
    pact.id,
    day.date,
  );
  if (row?.outcome !== "missed") return;
  const check = lastAnkiCheck(ctx, pact.id, day.date, day.dueAt);
  noteAnkiResult(ctx, pact.id, day.date, check);
}

/** Stores the check that decided an Anki day; null when none reached AnkiWeb. */
export function noteAnkiResult(ctx: CoreContext, pactId: string, date: LocalDate, check: AnkiCheck | null): void {
  ctx.db
    .prepare(`UPDATE occurrence SET anki_cards_left = ?, anki_checked_at = ? WHERE pact_id = ? AND date = ?`)
    .run(check?.cardsLeft ?? null, check?.checkedAt.toISOString() ?? null, pactId, date);
}
