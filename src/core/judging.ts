// Judging's helpers for `settle`: how long a running check of AnkiWeb can
// hold judging, the Missed push, and what decided an Anki day. Ending pacts is
// `ending.ts`.

import { APP_PATHS } from "../shared/api.ts";
import { formatDate, money, periodName } from "../shared/format.ts";
import { isPeriodSchedule } from "../shared/schedules.ts";
import type { AccountId, AnkiCheck, LocalDate } from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import { periodProgress, type PactToJudge } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { lastAnkiCheck, recipientName, scheduleOf, termsOn } from "./rows.ts";

/**
 * How long a check of AnkiWeb still running can hold judging the account's
 * Anki days due after it started: the adapter gives up after 2 minutes
 * (anki.ts), plus a margin.
 */
export const ANKI_CHECK_HOLDS_JUDGING_MS = 3 * 60 * 1000;

/**
 * When each check of AnkiWeb still running started, by account. `Core` keeps
 * it in memory; judging only reads it, from the context
 * (`ctx.ankiChecksRunning`).
 */
export type AnkiChecksRunning = ReadonlyMap<AccountId, ReadonlySet<{ startedAt: number }>>;

/** Tells the owner the occurrence is Missed, with what it costs; `settle` decides when. */
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
  let body = `${isPeriodSchedule(schedule) ? periodName(schedule, date) : formatDate(date)} · ${money(pact.penalty_cents)} penalty to ${recipient}`;
  if (schedule.kind === "weekly-count") {
    const { sessions, target } = periodProgress(ctx, pactId, date);
    const short = target - sessions;
    body = `Week of ${formatDate(date)} · ${short} ${short === 1 ? "day" : "days"} short · ${money(short * pact.penalty_cents)} penalty to ${recipient}`;
  }
  ctx.enqueue({
    recipient: pact.owner_account_id,
    kind: "missed-occurrence",
    payload: { pactId, occurrenceDate: date, title: `You missed ${pact.name}`, body, url: APP_PATHS.pact(pactId) },
  });
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
