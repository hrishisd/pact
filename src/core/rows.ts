// Reads the other parts of the core share: pact rows and the terms an
// occurrence follows, accounts, names, friends, reviewers and recipients, each
// pact's occurrences, connections and Anki decks, and question threads. Also
// the one write every review decision makes, `recordDecision`.

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
  QuestionThread,
  Recipient,
  ReviewState,
  Schedule,
  TodayWaitingItem,
} from "../shared/types.ts";
import { zoneOffsetAt } from "./calendar.ts";
import type { ChangeableTerms } from "./changes.ts";
import type { CoreContext } from "./context.ts";
import {
  hasSchedule,
  occurrencesOverTime,
  utcOffsetMs,
  type EarlierTerms,
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
 * A pact owner's timezone. Every pact's owner has one: creating a pact needs
 * it, and a timezone can be changed but never cleared.
 */
export function ownerZone(timezone: string | null, ownerId: AccountId): string {
  if (timezone === null) throw new Error(`account ${ownerId} owns a pact but has no timezone`);
  return timezone;
}

/** The timezone of an account that owns a pact, read from its row. */
export function timezoneOf(ctx: CoreContext, accountId: AccountId): string {
  return ownerZone(accountRow(ctx, accountId).timezone, accountId);
}

/**
 * Orders people (accounts or recipients) by name the same way on every page:
 * by the en-US collation, so "alice" comes before "Bob", ties broken by id.
 */
export function byName(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id, "en-US");
}

/** A reviewer's decision on some evidence or a payment, as stored. */
export type ReviewOutcome = "approved" | "rejected";

/** SQL: the columns `reviewStateOf` reads from `table`, joined to its deciding reviewer as `reviewer`. */
export function reviewStateColumns(table: "evidence" | "excuse" | "payment"): string {
  return `${table}.decision, ${table}.decided_at, ${table}.reject_reason, reviewer.name AS reviewer_name`;
}

export interface ReviewStateRow {
  decision: ReviewOutcome | null;
  decided_at: string | null;
  reject_reason: string | null;
  reviewer_name: string | null;
}

export function reviewStateOf(row: ReviewStateRow): ReviewState {
  if (row.decision === null) return { kind: "waiting" };
  const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
  return row.decision === "approved"
    ? { kind: "approved", ...decided }
    : { kind: "rejected", ...decided, reason: row.reject_reason! };
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
 * The occurrences of pact `pactId` in `timezone`, each dated one on the
 * terms it opened with. A bedtime night closes on Oura's clock where the
 * owner is (`ouraOffset`).
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
  return occurrencesOverTime(occurrenceTermsOf(pact), earlierTermsOf(ctx, pact), timezone, offset);
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
export function accountRow(
  ctx: CoreContext,
  accountId: AccountId,
): { email: string; name: string; timezone: string | null } {
  const row = ctx.one<{ email: string; name: string; timezone: string | null }>(
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

/** A checked review decision, as `decide` hands it on: a rejection's reason is trimmed and never blank. */
export type Decided = { outcome: "approved"; reason: null } | { outcome: "rejected"; reason: string };

/** A decision as its notification's details carry it: a rejection with its reason. */
export function decisionDetails(decided: Decided): { decision: "approved" } | { decision: "rejected"; reason: string } {
  return decided.outcome === "approved" ? { decision: "approved" } : { decision: "rejected", reason: decided.reason };
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

/**
 * An item's questions and replies, oldest first. `waiting` says the item is
 * still waiting for a decision; only then can it be waiting on a reply.
 */
export function thread(ctx: CoreContext, itemId: string, waiting: boolean): QuestionThread {
  const comments = ctx
    .all<{ from_owner: 0 | 1; name: string; text: string; sent_at: string }>(
      `SELECT comment.from_owner, account.name, comment.text, comment.sent_at
         FROM comment JOIN account ON account.id = comment.author_account_id
         WHERE comment.item_id = ? ORDER BY comment.id`,
      itemId,
    )
    .map((row) => ({
      fromOwner: row.from_owner === 1,
      authorName: row.name,
      text: row.text,
      sentAt: new Date(row.sent_at),
    }));
  return { comments, waitingOnReply: waiting && comments.at(-1)?.fromOwner === false };
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

/** The penalty the occurrence of `occurrences` open `today` keeps, when it differs from `after`'s; else null. */
export function todayKeeps(
  ctx: CoreContext,
  pactId: string,
  occurrences: Occurrences,
  today: LocalDate,
  after: Pick<ChangeableTerms, "penaltyCents">,
): number | null {
  const open = occurrences.covering(today);
  if (!open) return null;
  const { penalty_cents: penalty } = termsOn(ctx, pactId, open.date);
  return penalty !== after.penaltyCents ? penalty : null;
}

/** The owner's change requests waiting for a decision (or just that for `pactId`), newest first. */
export function waitingChangeRequests(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
  const rows = ctx.all<{
    id: string;
    pact_id: string;
    name: string;
    ends_pact: 0 | 1;
    requested_at: string;
  }>(
    `SELECT change_request.id, change_request.pact_id, pact.name, change_request.ends_pact,
              change_request.requested_at
       FROM change_request JOIN pact ON pact.id = change_request.pact_id
       WHERE pact.owner_account_id = ? AND change_request.decision IS NULL AND change_request.withdrawn_at IS NULL
         AND (? IS NULL OR pact.id = ?)
       ORDER BY change_request.requested_at DESC, change_request.id`,
    ownerId,
    pactId ?? null,
    pactId ?? null,
  );
  return rows.map((row) => ({
    kind: "change-request",
    id: row.id,
    pactId: row.pact_id,
    name: row.name,
    endsPact: row.ends_pact === 1,
    requestedAt: new Date(row.requested_at),
  }));
}

/** Stores a reviewer's decision on the review item `id` in `table`. */
export function recordDecision(
  ctx: CoreContext,
  table: "evidence" | "excuse" | "payment" | "change_request",
  id: string,
  { outcome, reason }: Decided,
  reviewerId: AccountId,
  at: Date,
): void {
  ctx.db
    .prepare(
      `UPDATE ${table} SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
       WHERE id = ?`,
    )
    .run(outcome, reviewerId, at.toISOString(), reason, id);
}
