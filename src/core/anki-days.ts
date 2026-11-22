// Anki days: the deck picker's list, checking AnkiWeb (by the scheduler or
// check now), and judging a day Satisfied once a check finds its deck done.

import type { AccountId, AnkiDecksResult, CheckNowResult } from "../shared/types.ts";
import { checkedWithin, errorText, markDisconnected } from "./connections.ts";
import type { Command, CoreContext } from "./context.ts";
import { noteAnkiResult } from "./judging.ts";
import { coverOn } from "./covers.ts";
import { isJudged } from "./occurrence-state.ts";
import { OperatorAlerted, type AnkiCountsResult, type AnkiSource } from "./ports.ts";
import { ankiPactsToRemind } from "./reminders.ts";
import { settle } from "./settle.ts";
import { ankiDeckList, ankiDeckName, ankiDeckOn, hasConnection, occurrencesOf } from "./rows.ts";

/** The core ignores a check of AnkiWeb now this soon after the account's last one. */
const ANKI_CHECK_INTERVAL_MS = 15_000;
/** While an account has an Anki day open and not judged, the scheduler checks AnkiWeb this often. */
const ANKI_POLL_INTERVAL_MS = 60 * 60 * 1000;
/**
 * In the last hour before a waiting day's due time, the scheduler checks this
 * often instead: only a check before the due time can satisfy the day, so a
 * deck finished late isn't Missed for want of a check.
 */
const ANKI_LAST_HOUR_POLL_INTERVAL_MS = 10 * 60 * 1000;
const ANKI_LAST_HOUR_MS = 60 * 60 * 1000;

/**
 * What the core keeps in memory about checking AnkiWeb, by account. `Core`
 * makes one and holds it for its lifetime.
 */
export interface AnkiPolling {
  /** When each account last checked AnkiWeb now. In memory, as Core's `#ouraChecks`. */
  readonly checks: Map<AccountId, number>;
  /**
   * When each account's AnkiWeb was last checked, by a tick or check now. In
   * memory: a restart costs at most one more call. A check that fails is
   * forgotten, so the next tick tries again.
   */
  readonly polls: Map<AccountId, number>;
  /**
   * When each check of AnkiWeb still running started, by account, from a tick
   * or check now. In memory: a check doesn't outlive the process. Judging
   * reads it through the context (`ctx.ankiChecksRunning`).
   */
  readonly checksRunning: Map<AccountId, Set<{ startedAt: number }>>;
}

export async function ankiDecks(
  ctx: CoreContext,
  accountId: AccountId,
  ankiSource: AnkiSource,
  command: Command,
): Promise<AnkiDecksResult> {
  if (!hasConnection(ctx, accountId, "anki")) return { ok: false, reason: "not-connected" };
  const askedAt = ctx.clock.now();
  let result;
  try {
    result = await ankiSource.decks(accountId);
  } catch (error) {
    ctx.log(`AnkiWeb deck list for account ${accountId} failed: ${errorText(error)}`);
    return { ok: false, reason: "unreachable" };
  }
  if (!result.ok) {
    await command(() => markDisconnected(ctx, "anki", accountId, askedAt));
    return result;
  }
  const { decks, rolloverHour } = result;
  await command(() => {
    ctx.db
      .prepare(
        `INSERT INTO anki_deck_list (account_id, decks, rollover_hour, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET decks = excluded.decks, rollover_hour = excluded.rollover_hour,
           fetched_at = excluded.fetched_at`,
      )
      .run(accountId, JSON.stringify(decks), rolloverHour, ctx.clock.now().toISOString());
  });
  return { ok: true, decks, rolloverHour };
}

export async function checkAnki(
  ctx: CoreContext,
  accountId: AccountId,
  polling: AnkiPolling,
  ankiSource: AnkiSource,
  command: Command,
): Promise<CheckNowResult> {
  const now = ctx.clock.now();
  if (checkedWithin(polling.checks, accountId, now, ANKI_CHECK_INTERVAL_MS)) return { ok: true };
  if (ankiDaysWaiting(ctx, now, accountId).length === 0) return { ok: true };
  polling.checks.set(accountId, now.getTime());
  const fetched = await fetchAnki(ctx, ankiSource, polling, now, accountId);
  await command(() => recordAnkiChecks(ctx, fetched.checks));
  return fetched.unreached.includes(accountId) ? { ok: false, reason: "unreachable" } : { ok: true };
}

/**
 * Each Active Anki pact (of `owner`, or everyone's) whose day is open at
 * `t`, before its due time, not judged yet and not covered by an approved
 * excuse, with a working AnkiWeb connection: what a check is for.
 */
function ankiDaysWaiting(
  ctx: CoreContext,
  t: Date,
  owner?: AccountId,
): { pactId: string; account: AccountId; deckId: string; dueAt: Date }[] {
  const pacts = ctx.all<{ id: string; owner_account_id: AccountId; timezone: string }>(
    `SELECT pact.id, pact.owner_account_id, account.timezone
       FROM pact
       JOIN account ON account.id = pact.owner_account_id
       JOIN connection ON connection.account_id = pact.owner_account_id AND connection.service = 'anki'
       WHERE pact.stage = 'active' AND pact.evidence_kind = 'anki' AND connection.status = 'connected'
         AND (? IS NULL OR pact.owner_account_id = ?)
       ORDER BY pact.created_at, pact.id`,
    owner ?? null,
    owner ?? null,
  );
  return pacts.flatMap((pact) => {
    const open = occurrencesOf(ctx, pact.id, pact.timezone).openAt(t);
    if (!open || t.getTime() >= open.dueAt.getTime() || isJudged(ctx, pact.id, open.date)) return [];
    // An approved excuse or vacation covers it: it's Excused at its due time whatever the deck shows.
    if (coverOn(ctx, pact.id, open.date)?.state === "approved") return [];
    return [
      {
        pactId: pact.id,
        account: pact.owner_account_id,
        deckId: ankiDeckOn(ctx, pact.id, open.date),
        dueAt: open.dueAt,
      },
    ];
  });
}

/**
 * Checks AnkiWeb for each account (or just `owner`) with an Anki day
 * waiting: one call per account, for every deck its waiting pacts are on.
 * A tick checks an account at most every hour, or every 10 minutes once one
 * of its waiting days is due within the hour, and always when a reminder
 * for one of its waiting days goes off this tick (so a deck finished since
 * the last check stops it); `owner`'s check now always does. Accounts are checked at once, so a slow AnkiWeb delays the
 * tick by its own call only, never by the sum of everyone's. A call that
 * throws is logged and forgotten, so the next tick tries again; its account
 * is in `unreached`, unless the failure was raised as an operator alert. A
 * "disconnected" answer checks nothing, and `recordAnkiChecks` marks the
 * connection Needs reconnecting. While a call runs, it holds judging
 * the days it may still satisfy (`ankiCheckHolds`).
 */
export async function fetchAnki(
  ctx: CoreContext,
  ankiSource: AnkiSource,
  polling: AnkiPolling,
  t: Date,
  owner?: AccountId,
): Promise<{ checks: FetchedAnki[]; unreached: AccountId[] }> {
  const unreached: AccountId[] = [];
  const decks = new Map<AccountId, string[]>();
  /** Accounts with a waiting day due within the hour: checked more often. */
  const dueSoon = new Set<AccountId>();
  /** Accounts with a reminder going off this tick for a waiting day: checked now. */
  const reminding = new Set<AccountId>();
  const toRemind = owner === undefined ? ankiPactsToRemind(ctx, t) : new Set<string>();
  for (const { pactId, account, deckId, dueAt } of ankiDaysWaiting(ctx, t, owner)) {
    const list = decks.get(account) ?? [];
    if (!list.includes(deckId)) list.push(deckId);
    decks.set(account, list);
    if (dueAt.getTime() - t.getTime() <= ANKI_LAST_HOUR_MS) dueSoon.add(account);
    if (toRemind.has(pactId)) reminding.add(account);
  }
  const check = async (account: AccountId, deckIds: string[]): Promise<FetchedAnki | null> => {
    const last = polling.polls.get(account);
    const interval = dueSoon.has(account) ? ANKI_LAST_HOUR_POLL_INTERVAL_MS : ANKI_POLL_INTERVAL_MS;
    const shouldCheck =
      owner !== undefined || reminding.has(account) || last === undefined || t.getTime() - last >= interval;
    if (!shouldCheck) return null;
    polling.polls.set(account, t.getTime());
    const running = { startedAt: t.getTime() };
    const checks = polling.checksRunning.get(account) ?? new Set();
    polling.checksRunning.set(account, checks.add(running));
    try {
      const result = await ankiSource.deckCounts(account, deckIds);
      return { account, result, checkedAt: t };
    } catch (error) {
      polling.polls.delete(account);
      ctx.log(`AnkiWeb check for account ${account} failed, nothing checked: ${errorText(error)}`);
      if (!(error instanceof OperatorAlerted)) unreached.push(account);
      return null;
    } finally {
      checks.delete(running);
      if (checks.size === 0) polling.checksRunning.delete(account);
    }
  };
  const settled = await Promise.allSettled([...decks].map(([account, deckIds]) => check(account, deckIds)));
  const checks = settled.flatMap((outcome) => (outcome.status === "fulfilled" && outcome.value ? [outcome.value] : []));
  return { checks, unreached };
}

/**
 * Records each check AnkiWeb answered, deck by deck, and settles the day of
 * each Active Anki pact on a checked deck it found finished (New, Learn and
 * Due all 0) for that day, evaluated before its due time: Satisfied as of
 * the check (`verdictOf`). A deck
 * gone from the collection records nothing. A refused login marks the
 * connection Needs reconnecting.
 */
export function recordAnkiChecks(ctx: CoreContext, fetched: FetchedAnki[]): void {
  for (const { account, result, checkedAt } of fetched) {
    if (!result.ok) {
      markDisconnected(ctx, "anki", account, checkedAt);
      continue;
    }
    renameAnkiDecks(ctx, account, result.names);
    const { ankiDate, asOf } = result;
    for (const [deckId, counts] of Object.entries(result.decks)) {
      notePactDeck(ctx, account, deckId, counts === null ? null : (result.names[deckId] ?? null), checkedAt);
      if (counts === null) continue;
      ctx.db
        .prepare(
          `INSERT INTO anki_check (account_id, deck_id, new_count, learn_count, review_count, anki_date, as_of,
                                   checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          account,
          deckId,
          counts.new,
          counts.learn,
          counts.review,
          ankiDate,
          asOf.toISOString(),
          checkedAt.toISOString(),
        );
    }
    const pacts = ctx.all<{ id: string; timezone: string }>(
      `SELECT pact.id, account.timezone FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.owner_account_id = ? AND pact.stage = 'active' AND pact.evidence_kind = 'anki'
         ORDER BY pact.created_at, pact.id`,
      account,
    );
    for (const pact of pacts) {
      const { includes, covering } = occurrencesOf(ctx, pact.id, pact.timezone);
      const day = includes(ankiDate) ? covering(ankiDate) : null;
      if (!day || asOf.getTime() >= day.dueAt.getTime() || checkedAt.getTime() >= day.dueAt.getTime()) continue;
      // The deck the day is on: a deck change approved since it opened applies from the next.
      const counts = result.decks[ankiDeckOn(ctx, pact.id, day.date)];
      if (!counts || counts.new + counts.learn + counts.review > 0) continue;
      const settled = settle(ctx, pact.id, day.date, checkedAt);
      if (settled?.to.kind === "satisfied") noteAnkiResult(ctx, pact.id, day.date, { cardsLeft: 0, checkedAt });
    }
  }
}

/**
 * Gives the checked decks in the account's stored deck list the names the
 * check found, so a deck renamed in Anki shows its new name before the deck
 * picker loads again.
 */
function renameAnkiDecks(ctx: CoreContext, accountId: AccountId, names: Record<string, string>): void {
  const list = ankiDeckList(ctx, accountId);
  if (!list) return;
  let renamed = false;
  const decks = list.decks.map((deck) => {
    const name = names[deck.id];
    if (name === undefined || name === deck.name) return deck;
    renamed = true;
    return { ...deck, name };
  });
  if (!renamed) return;
  ctx.db.prepare(`UPDATE anki_deck_list SET decks = ? WHERE account_id = ?`).run(JSON.stringify(decks), accountId);
}

/**
 * Keeps what a check found of a deck an Anki pact is on: its name, or with
 * `name` null, that it's gone from the collection since `checkedAt`, under
 * the last name Pact knew.
 */
function notePactDeck(
  ctx: CoreContext,
  account: AccountId,
  deckId: string,
  name: string | null,
  checkedAt: Date,
): void {
  if (name !== null) {
    ctx.db
      .prepare(
        `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, NULL)
         ON CONFLICT (account_id, deck_id) DO UPDATE SET name = excluded.name, missing_since = NULL`,
      )
      .run(account, deckId, name);
    return;
  }
  ctx.db
    .prepare(
      `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, ?)
       ON CONFLICT (account_id, deck_id) DO UPDATE SET name = COALESCE(anki_pact_deck.name, excluded.name),
         missing_since = COALESCE(anki_pact_deck.missing_since, excluded.missing_since)`,
    )
    .run(account, deckId, ankiDeckName(ctx, account, deckId), checkedAt.toISOString());
}

/** One check `fetchAnki` got an answer to: whose collection, what AnkiWeb found, and when Pact checked. */
interface FetchedAnki {
  account: AccountId;
  result: AnkiCountsResult;
  /** When AnkiWeb was asked. */
  checkedAt: Date;
}
