// Reads the other parts of the core share: pact rows and the terms an
// occurrence follows, accounts, names, friends, reviewers and recipients, each
// pact's occurrences, connections and Anki decks.

import type {
  AccountId,
  AnkiCheck,
  AnkiDeck,
  AnkiTerms,
  ClockTime,
  Connection,
  ConnectionProblem,
  ConnectionService,
  EvidenceKind,
  Friend,
  LocalDate,
  PactTerms,
  Recipient,
  Schedule,
} from "../shared/types.ts";
import { addDays } from "../shared/calendar.ts";
import { laterDate, localDateOf, zoneOffsetAt } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import {
  hasSchedule,
  occurrencesOverTime,
  utcOffsetMs,
  type EarlierTerms,
  type EarlierTimezone,
  type Occurrences,
  type OccurrenceTerms,
  type OneTimeTerms,
  type OuraOffset,
  type RecurringTerms,
} from "./occurrences.ts";
import { utcOffsetOf } from "./oura-clock.ts";
import { dayClockOf, EDIT_WINDOW_MS } from "./pact-rules.ts";

export interface PactRow {
  id: string;
  name: string;
  description: string;
  evidence_kind: EvidenceKind;
  schedule: string;
  in_bed_by: string | null;
  due_by: string | null;
  start_date: string | null;
  end_date: string | null;
  penalty_cents: number;
  recipient_id: string;
  stage: PactTerms["stage"];
  first_occurrence: string;
  created_at: string;
  reviewers_notified_at: string | null;
  ended_at: string | null;
  /** When an end was approved that waits for the occurrence open then (`endAfter`, ending.ts). */
  end_approved_at: string | null;
  /** JSON: "HH:MM" each, in the order they go off. */
  reminders: string;
  reminded_through: string | null;
  owner_account_id: AccountId;
  anki_deck_id: string | null;
  anki_rollover_hour: number | null;
}

/** The terms an occurrence follows: the pact's, as they stood when it opened. */
export type DatedTerms = Pick<
  PactRow,
  "description" | "schedule" | "in_bed_by" | "due_by" | "penalty_cents" | "recipient_id" | "anki_deck_id"
>;

/** What a pact's day clock and One-time occurrence follow from, besides its times. */
export type PactClock = Pick<PactRow, "evidence_kind" | "anki_rollover_hour" | "created_at">;

/** A pact row's occurrence terms, its stored schedule parsed. */
export function occurrenceTermsOf(
  row: PactClock & Pick<PactRow, "schedule" | "first_occurrence" | "in_bed_by" | "due_by" | "end_date">,
): OccurrenceTerms {
  const terms = scheduleTermsOf(row, scheduleOf(row.schedule), row.in_bed_by, row.due_by);
  return { ...terms, firstOccurrence: row.first_occurrence, endDate: row.end_date };
}

/** `pact`'s terms on `schedule` with the times `inBedBy` and `dueBy`, as its columns store them. */
export function scheduleTermsOf(
  pact: PactClock,
  schedule: Schedule,
  inBedBy: ClockTime | null,
  dueBy: ClockTime | null,
): RecurringTerms | OneTimeTerms {
  switch (schedule.kind) {
    case "fixed-days":
      return { schedule, day: dayClockOf(pact, inBedBy, dueBy) };
    case "weekly-count":
      return { schedule, dueBy };
    case "one-time":
      return { schedule, dueBy, createdAt: new Date(pact.created_at) };
  }
}

/** A pact's stored schedule. Its kind never changes once the edit window has closed. */
export function scheduleOf(json: string): Schedule {
  return JSON.parse(json) as Schedule;
}

/** A pact's stored reminders: "HH:MM" times, or dated ones on One-time. */
export function remindersOf(json: string): string[] {
  return JSON.parse(json) as string[];
}

/**
 * Orders people (accounts or recipients) by name the same way on every page:
 * by the en-US collation, so "alice" comes before "Bob", ties broken by id.
 */
export function byName(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id, "en-US");
}

/** `ownerId`'s pact `pactId`, if it is one. */
export function ownPact(ctx: CoreContext, ownerId: AccountId, pactId: string): PactRow | undefined {
  return ctx.one<PactRow>(`SELECT * FROM pact WHERE id = ? AND owner_account_id = ?`, pactId, ownerId);
}

/** The terms the pact's occurrence dated `date` follows: those in force when it opened. */
export function termsOn(ctx: CoreContext, pactId: string, date: LocalDate): DatedTerms {
  const columns = `description, schedule, in_bed_by, due_by, penalty_cents, recipient_id, anki_deck_id`;
  const earlier = ctx.one<DatedTerms>(
    `SELECT ${columns} FROM pact_earlier_terms WHERE pact_id = ? AND until > ? ORDER BY until LIMIT 1`,
    pactId,
    date,
  );
  return earlier ?? (ctx.db.prepare(`SELECT ${columns} FROM pact WHERE id = ?`).get(pactId) as DatedTerms);
}

export function reviewersOf(ctx: CoreContext, pactId: string): AccountId[] {
  return ctx
    .all<{ reviewer_account_id: AccountId }>(
      `SELECT reviewer_account_id FROM pact_reviewer WHERE pact_id = ? ORDER BY reviewer_account_id`,
      pactId,
    )
    .map((row) => row.reviewer_account_id);
}

export function accountName(ctx: CoreContext, accountId: AccountId): string {
  return (ctx.db.prepare(`SELECT name FROM account WHERE id = ?`).get(accountId) as { name: string }).name;
}

export function pactName(ctx: CoreContext, pactId: string): string {
  return (ctx.db.prepare(`SELECT name FROM pact WHERE id = ?`).get(pactId) as { name: string }).name;
}

export function recipientName(ctx: CoreContext, recipientId: string): string {
  return (ctx.db.prepare(`SELECT name FROM recipient WHERE id = ?`).get(recipientId) as { name: string }).name;
}

/** The recipients matching the SQL `condition` on `recipient`, sorted by name. */
export function selectRecipients(ctx: CoreContext, condition: string, ...params: string[]): Recipient[] {
  const recipients = ctx.db.prepare(`SELECT id, name FROM recipient WHERE ${condition}`).all(...params);
  return (recipients as Recipient[]).sort(byName);
}

/** The accounts `ids` as friends, sorted by name. */
export function friendsSortedByName(ctx: CoreContext, ids: AccountId[]): Friend[] {
  return ids.map((id) => ({ id, name: accountName(ctx, id) })).sort(byName);
}

/**
 * The timing terms `pact` had before each change, oldest first. A One-time
 * change applies to its one occurrence, so it has none that count.
 */
export function earlierTermsOf(ctx: CoreContext, pact: PactClock & Pick<PactRow, "id">): EarlierTerms[] {
  const rows = ctx.all<{ until: LocalDate; schedule: string; in_bed_by: string | null; due_by: string | null }>(
    `SELECT until, schedule, in_bed_by, due_by FROM pact_earlier_terms WHERE pact_id = ? ORDER BY until`,
    pact.id,
  );
  return rows.flatMap((row) => {
    const terms = scheduleTermsOf(pact, scheduleOf(row.schedule), row.in_bed_by, row.due_by);
    return hasSchedule(terms, "one-time") ? [] : [{ ...terms, until: row.until }];
  });
}

/**
 * The timezones `pact`'s owner had before each change since it was made,
 * oldest first (`setTimezone`, accounts.ts), each with the Oura clock a
 * bedtime night there closes on (`ouraOffset`).
 */
export function earlierTimezonesOf(
  ctx: CoreContext,
  pact: Pick<PactRow, "id" | "evidence_kind" | "owner_account_id">,
): EarlierTimezone[] {
  const rows = ctx.all<{ until: LocalDate; timezone: string }>(
    `SELECT until, timezone FROM pact_earlier_timezone WHERE pact_id = ? ORDER BY until`,
    pact.id,
  );
  return rows.map(({ until, timezone }) => ({
    until,
    timezone,
    ouraOffset: pact.evidence_kind === "oura" ? ouraOffset(ctx, pact.owner_account_id, timezone) : null,
  }));
}

/**
 * The last day an occurrence of `pactId` may have opened by `at`: today in
 * the owner's `timezone`, or after a move west, the day it still is in the
 * timezone they moved from, whose occurrence is open and keeps that
 * timezone. A change applies from the day after (`firstDayNotOpen`).
 */
export function lastDayOpened(ctx: CoreContext, pactId: string, timezone: string, at: Date): LocalDate {
  const today = localDateOf(at, timezone);
  const latest = ctx.one<{ until: LocalDate }>(
    `SELECT until FROM pact_earlier_timezone WHERE pact_id = ? ORDER BY until DESC LIMIT 1`,
    pactId,
  );
  return latest === undefined ? today : laterDate(today, addDays(latest.until, -1));
}

/**
 * The occurrences of pact `pactId` with its owner now in `timezone`, each
 * dated one on the terms it opened with, in the timezone it opened in. A
 * bedtime night closes on Oura's clock where the owner is (`ouraOffset`).
 */
export function occurrencesOf(ctx: CoreContext, pactId: string, timezone: string): Occurrences {
  const pact = ctx.one<
    Pick<
      PactRow,
      | "id"
      | "schedule"
      | "first_occurrence"
      | "in_bed_by"
      | "due_by"
      | "end_date"
      | "created_at"
      | "evidence_kind"
      | "owner_account_id"
      | "anki_rollover_hour"
    >
  >(
    `SELECT id, schedule, first_occurrence, in_bed_by, due_by, end_date, created_at, owner_account_id,
              evidence_kind, anki_rollover_hour
       FROM pact WHERE id = ?`,
    pactId,
  );
  if (!pact) throw new Error(`no pact ${pactId}`);
  const offset = pact.evidence_kind === "oura" ? ouraOffset(ctx, pact.owner_account_id, timezone) : null;
  const terms = occurrenceTermsOf(pact);
  return occurrencesOverTime(terms, earlierTermsOf(ctx, pact), timezone, offset, earlierTimezonesOf(ctx, pact));
}

/**
 * The UTC offset a bedtime night with no period yet closes on: the one on
 * the latest sleep Oura reported for `account`. Null, the account's
 * `timezone`, when Oura hasn't reported one with an offset, or when that
 * offset is the timezone's own at that moment: the owner was at home, and
 * the timezone also knows when its clocks change.
 */
export function ouraOffset(ctx: CoreContext, account: AccountId, timezone: string): OuraOffset {
  const row = ctx.one<{ oura_latest_bedtime_start: string | null }>(
    `SELECT oura_latest_bedtime_start FROM account WHERE id = ?`,
    account,
  );
  const latest = row?.oura_latest_bedtime_start ?? null;
  const offset = latest === null ? null : utcOffsetOf(latest);
  if (latest === null || offset === null) return null;
  return utcOffsetMs(offset) === zoneOffsetAt(new Date(latest), timezone) ? null : offset;
}

/** The deck an Anki pact's day `date` is judged on: the one in force when it opened. */
export function ankiDeckOn(ctx: CoreContext, pactId: string, date: LocalDate): string {
  const deckId = termsOn(ctx, pactId, date).anki_deck_id;
  if (deckId === null) throw new Error(`pact ${pactId} has no Anki deck`);
  return deckId;
}

/**
 * The latest check of the Anki pact's deck for its day `date`: all of
 * them, or with `before`, only those that count for a day due then, made
 * and evaluated before it.
 */
export function lastAnkiCheck(ctx: CoreContext, pactId: string, date: LocalDate, before?: Date): AnkiCheck | null {
  const until = before?.toISOString() ?? "9999-12-31T23:59:59.999Z";
  const row = ctx.one<{ cards_left: number; checked_at: string }>(
    `SELECT anki_check.new_count + anki_check.learn_count + anki_check.review_count AS cards_left,
              anki_check.checked_at
       FROM anki_check JOIN pact ON pact.owner_account_id = anki_check.account_id
       WHERE pact.id = ? AND anki_check.deck_id = ? AND anki_check.anki_date = ? AND anki_check.as_of < ?
         AND anki_check.checked_at < ?
       ORDER BY anki_check.checked_at DESC, anki_check.id DESC
       LIMIT 1`,
    pactId,
    ankiDeckOn(ctx, pactId, date),
    date,
    until,
    until,
  );
  return row ? { cardsLeft: row.cards_left, checkedAt: new Date(row.checked_at) } : null;
}

/** The account's email, name and timezone; throws `UnknownAccountError` when there's no such account. */
export function accountRow(ctx: CoreContext, accountId: AccountId): { email: string; name: string; timezone: string } {
  const row = ctx.one<{ email: string; name: string; timezone: string }>(
    `SELECT email, name, timezone FROM account WHERE id = ?`,
    accountId,
  );
  if (!row) throw new UnknownAccountError(accountId);
  return row;
}

/** A friendship row's two account ids, in the order the table stores them. */
export function friendshipPair(a: AccountId, b: AccountId): [AccountId, AccountId] {
  return a < b ? [a, b] : [b, a];
}

/**
 * `lists` merged into one sorted by `at`, oldest or newest first. Ties keep
 * the order they have in `lists`, as the sort is stable.
 */
export function mergeByTime<T>(
  at: (item: T) => Date,
  direction: "oldest-first" | "newest-first",
  ...lists: T[][]
): T[] {
  const sign = direction === "oldest-first" ? 1 : -1;
  return lists.flat().sort((a, b) => sign * (at(a).getTime() - at(b).getTime()));
}

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`no account ${accountId}`);
    this.name = "UnknownAccountError";
  }
}

export function areFriends(ctx: CoreContext, a: AccountId, b: AccountId): boolean {
  const [first, second] = friendshipPair(a, b);
  return (
    ctx.db.prepare(`SELECT 1 FROM friendship WHERE account_a_id = ? AND account_b_id = ?`).get(first, second) !==
    undefined
  );
}

export function hasConnection(ctx: CoreContext, accountId: AccountId, service: ConnectionService): boolean {
  return (
    ctx.db.prepare(`SELECT 1 FROM connection WHERE account_id = ? AND service = ?`).get(accountId, service) !==
    undefined
  );
}

/** Why the service can't be read for the account, or null when its connection works. */
export function connectionProblem(
  ctx: CoreContext,
  accountId: AccountId,
  service: ConnectionService,
): ConnectionProblem | null {
  const row = ctx.one<{ status: Connection["status"] }>(
    `SELECT status FROM connection WHERE account_id = ? AND service = ?`,
    accountId,
    service,
  );
  if (!row) return "not-connected";
  return row.status === "connected" ? null : row.status;
}

/** The account's deck list as AnkiWeb last gave it, or null before the first. */
export function ankiDeckList(
  ctx: CoreContext,
  accountId: AccountId,
): { decks: AnkiDeck[]; rolloverHour: number } | null {
  const row = ctx.one<{ decks: string; rollover_hour: number }>(
    `SELECT decks, rollover_hour FROM anki_deck_list WHERE account_id = ?`,
    accountId,
  );
  return row ? { decks: JSON.parse(row.decks) as AnkiDeck[], rolloverHour: row.rollover_hour } : null;
}

/** The deck's name as the last deck list or check found it, or null once it's gone from the list. */
export function ankiDeckName(ctx: CoreContext, accountId: AccountId, deckId: string): string | null {
  const listed = ankiDeckList(ctx, accountId)?.decks.find((deck) => deck.id === deckId)?.name;
  return listed ?? ankiPactDeck(ctx, accountId, deckId)?.name ?? null;
}

/** A deck an Anki pact is on, as checks last found it; undefined before the first check. */
export function ankiPactDeck(
  ctx: CoreContext,
  accountId: AccountId,
  deckId: string,
): { name: string | null; missing_since: string | null } | undefined {
  return ctx.one<{ name: string | null; missing_since: string | null }>(
    `SELECT name, missing_since FROM anki_pact_deck WHERE account_id = ? AND deck_id = ?`,
    accountId,
    deckId,
  );
}

/** Whether the last check found the deck gone from the account's collection. */
export function ankiDeckMissing(ctx: CoreContext, accountId: AccountId, deckId: string): boolean {
  return (ankiPactDeck(ctx, accountId, deckId)?.missing_since ?? null) !== null;
}

/** An Anki pact's deck and rollover hour; null for any other pact. */
export function ankiTerms(
  ctx: CoreContext,
  pact: Pick<PactRow, "owner_account_id" | "anki_deck_id" | "anki_rollover_hour">,
): AnkiTerms | null {
  if (pact.anki_deck_id === null || pact.anki_rollover_hour === null) return null;
  return {
    deckId: pact.anki_deck_id,
    deckName: ankiDeckName(ctx, pact.owner_account_id, pact.anki_deck_id),
    deckMissing: ankiDeckMissing(ctx, pact.owner_account_id, pact.anki_deck_id),
    rolloverHour: pact.anki_rollover_hour,
  };
}

/** Whether the pact's schedule is Weekly count. It keeps its kind once its edit window has closed. */
export function isWeekly(ctx: CoreContext, pactId: string): boolean {
  const row = ctx.db.prepare(`SELECT schedule FROM pact WHERE id = ?`).get(pactId) as { schedule: string };
  return scheduleOf(row.schedule).kind === "weekly-count";
}

/** Pacts created by this time, as an ISO string, are past their edit window: for comparing in SQL. */
export function editWindowCutoff(ctx: CoreContext, at = ctx.clock.now()): string {
  return new Date(at.getTime() - EDIT_WINDOW_MS).toISOString();
}
