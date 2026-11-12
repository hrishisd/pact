// Review items: what the five kinds (evidence, excuse, payment, change
// request, vacation) share. Each kind's table carries the same lifecycle
// columns (decision, decided_by_account_id, decided_at, reject_reason, and
// for some withdrawn_at); each kind's handler (`RequestKindHandler`) says how
// to read one, who decides it, what deciding it does, and how it's listed.
// The registry of handlers is `REQUEST_KINDS` (request-kinds.ts); `review.ts`
// loops over it. Also the lifecycle helpers every kind's own code shares.

import type {
  AccountId,
  DecideRefusal,
  ItemState,
  QuestionThread,
  ReviewItem,
  ReviewState,
  TodayWaitingItem,
  Withdrawal,
  WithdrawnReason,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";

export type RequestKind = ReviewItem["kind"];

/** A reviewer's decision on a review item, as stored. */
export type ReviewOutcome = "approved" | "rejected";

/** A review item's lifecycle columns, read from its kind's own table. */
export interface RequestRow {
  id: string;
  kind: RequestKind;
  owner_account_id: AccountId;
  decision: ReviewOutcome | null;
  /** When it was withdrawn (by its owner, or because it was moot); always null for a payment. */
  withdrawn_at: string | null;
  withdrawn_reason: WithdrawnReason | null;
}

/** Why the system withdraws a moot item (R8): the owner's own withdrawal is never the system's. */
export type MootReason = Exclude<WithdrawnReason, "owner">;

/** A waiting review item in a reviewer's queue, with when it was sent for a decision. */
export interface QueuedItem {
  item: ReviewItem;
  since: Date;
}

/**
 * One kind of review item. `P` is the item as `load` reads it: its
 * lifecycle columns and what the kind's other methods need.
 */
export interface RequestKindHandler<P extends RequestRow> {
  kind: P["kind"];
  /** The item `id`, decided or not, if it's one of this kind. */
  load(ctx: CoreContext, id: string): P | undefined;
  /** Who may decide the item (and so is told the owner replied, and may see its photos). */
  deciders(ctx: CoreContext, item: P): AccountId[];
  /** Whether a decider may act on it yet; omitted, always (a withdrawn item never). */
  reviewable?(ctx: CoreContext, item: P): boolean;
  /**
   * A refusal a decision meets besides the shared ones, or null. May catch
   * judging up first (change request), as the scheduler would have.
   */
  checkDecision?(ctx: CoreContext, item: P, decided: Decided): DecideRefusal | null;
  /** Records the decision and does what it does: plain code, per kind. */
  apply(ctx: CoreContext, item: P, decided: Decided, reviewerId: AccountId): void;
  /**
   * How a notification names the item after "your" or "their" ("evidence for
   * Gym", "$10 payment to Sam"), and the owner's page for it.
   */
  describe(ctx: CoreContext, item: P): { what: string; ownerPath: string };
  /** The waiting items of this kind `reviewerId` may decide, as the Review Queue shows them, in the kind's order. */
  queue(ctx: CoreContext, reviewerId: AccountId): QueuedItem[];
  /** Listed before every other kind in the Review Queue, rather than by time. */
  queueFirst?: true;
  /** The owner's items of this kind waiting for a decision (or those for `pactId`), newest first. */
  waiting(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[];
  /** The ids of the items of this kind with the photo `photoId`; omitted for a kind without photos. */
  itemsWithPhoto?(ctx: CoreContext, photoId: string): string[];
  /** The names of the pacts the item concerns, oldest first: those a `pact-ended` withdrawal names. */
  pactNames(ctx: CoreContext, item: P): string[];
  /**
   * How the system withdraws the kind's items that are moot (R8); omitted for
   * a kind that never is (a payment: approving one always changes the ledger).
   */
  moot?: {
    /** The ids of every item of this kind still waiting for a decision. */
    waitingIds(ctx: CoreContext): string[];
    /**
     * Why deciding the waiting item either way at `now` could no longer
     * change any outcome, penalty or terms, or null while it could.
     */
    reason(ctx: CoreContext, item: P, now: Date): MootReason | null;
    /** Withdraws the item at `now` for `reason`, telling nobody, and settles what it held up. */
    withdraw(ctx: CoreContext, item: P, reason: MootReason, now: Date): void;
  };
}

/** Whether a review item still waits for a decision: not decided, nor withdrawn. */
export function isWaiting(item: RequestRow): boolean {
  return item.decision === null && item.withdrawn_at === null;
}

/** A checked review decision, as `decide` hands it on: a rejection's reason is trimmed and never blank. */
export type Decided = { outcome: "approved"; reason: null } | { outcome: "rejected"; reason: string };

/** A decision as its notification's details carry it: a rejection with its reason. */
export function decisionDetails(decided: Decided): { decision: "approved" } | { decision: "rejected"; reason: string } {
  return decided.outcome === "approved" ? { decision: "approved" } : { decision: "rejected", reason: decided.reason };
}

/** Stores a reviewer's decision on the review item `id` in `table`. */
export function recordDecision(
  ctx: CoreContext,
  table: "evidence" | "excuse" | "payment" | "change_request" | "vacation",
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

/** When and why the item was withdrawn, or null if it wasn't. `pactNames` names its pacts, for `pact-ended`. */
export function withdrawalOf(
  item: Pick<RequestRow, "withdrawn_at" | "withdrawn_reason">,
  pactNames: () => string[],
): Withdrawal | null {
  if (item.withdrawn_at === null) return null;
  const withdrawnAt = new Date(item.withdrawn_at);
  const reason = item.withdrawn_reason ?? "owner";
  return reason === "pact-ended" ? { reason, withdrawnAt, pactNames: pactNames() } : { reason, withdrawnAt };
}

/** Where an item of the owner's stands on its page: withdrawn (`withdrawal`), else as decided. */
export function itemStateOf(row: ReviewStateRow, withdrawal: Withdrawal | null): ItemState {
  // A decision outranks a withdrawal.
  if (withdrawal !== null && row.decision === null) return { kind: "withdrawn", ...withdrawal };
  return reviewStateOf(row);
}

export function reviewStateOf(row: ReviewStateRow): ReviewState {
  if (row.decision === null) return { kind: "waiting" };
  const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
  return row.decision === "approved"
    ? { kind: "approved", ...decided }
    : { kind: "rejected", ...decided, reason: row.reject_reason! };
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
