// Review: the Review Queue, deciding an item, a reviewer's question and the
// owner's reply, and who may see a photo.

import { APP_PATHS } from "../shared/api.ts";
import type {
  AccountId,
  AskOwnerResult,
  DecideResult,
  ReplyResult,
  ReviewDecision,
  ReviewItem,
  Withdrawal,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import type { AnkiChecksRunning } from "./judging.ts";
import { tellAll } from "./outbox.ts";
import type { Photo, PhotoStore } from "./ports.ts";
import { REQUEST_HANDLERS } from "./request-kinds.ts";
import {
  isWaiting,
  thread,
  withdrawalOf,
  type Decided,
  type QueuedItem,
  type RequestKindHandler,
  type RequestRow,
} from "./requests.ts";
import { textTooLong } from "./text-limits.ts";
import { accountRow } from "./rows.ts";

export type PhotoResult = { ok: true; photo: Photo } | { ok: false; reason: "photo-not-found" };

export async function viewPhoto(
  ctx: CoreContext,
  accountId: AccountId,
  photoId: string,
  photoStore: PhotoStore,
): Promise<PhotoResult> {
  accountRow(ctx, accountId);
  // Those who may see a photo: the item's owner and whoever may decide it.
  const viewable = REQUEST_HANDLERS.some((handler) =>
    (handler.itemsWithPhoto?.(ctx, photoId) ?? []).some((itemId) => {
      const item = handler.load(ctx, itemId);
      return (
        item !== undefined && (item.owner_account_id === accountId || handler.deciders(ctx, item).includes(accountId))
      );
    }),
  );
  const photo = viewable ? await photoStore.fetch(photoId) : null;
  return photo ? { ok: true, photo } : { ok: false, reason: "photo-not-found" };
}

export function reviewQueue(ctx: CoreContext, accountId: AccountId): ReviewItem[] {
  accountRow(ctx, accountId);
  return queuedItems(ctx, accountId)
    .filter(({ item }) => !item.thread.waitingOnReply)
    .map(({ item }) => item);
}

/**
 * The reviewer's Review Queue, each item with when it came to them: when it
 * was sent for a decision, or the owner's latest reply if later, which sent
 * it back. For the daily reminder about items waiting too long (R2).
 */
export function reviewQueueWaits(ctx: CoreContext, reviewerId: AccountId): QueuedItem[] {
  return queuedItems(ctx, reviewerId)
    .filter(({ item }) => !item.thread.waitingOnReply)
    .map(({ item, since }) => {
      const reply = item.thread.comments.findLast((comment) => comment.fromOwner);
      return { item, since: reply && reply.sentAt > since ? reply.sentAt : since };
    });
}

export function waitingOnReply(ctx: CoreContext, accountId: AccountId): ReviewItem[] {
  accountRow(ctx, accountId);
  return queuedItems(ctx, accountId)
    .filter(({ item }) => item.thread.waitingOnReply)
    .map(({ item }) => item);
}

/** How a notification names the review item `itemId` after "your" or "their", and the owner's page for it. */
export function describeItem(ctx: CoreContext, itemId: string): { what: string; ownerPath: string } {
  const item = findItem(ctx, itemId);
  if (!item) throw new Error(`no review item ${itemId}`);
  return item.handler.describe(ctx, item.row);
}

export function askOwner(ctx: CoreContext, accountId: AccountId, itemId: string, question: string): AskOwnerResult {
  const { name } = accountRow(ctx, accountId);
  const item = itemToDecide(ctx, accountId, itemId);
  if (!item) return { ok: false, reason: "item-not-found" };
  if (item.row.decision !== null) return { ok: false, reason: "already-decided" };
  const text = question.trim();
  if (text === "") return { ok: false, reason: "blank-question" };
  if (textTooLong(text)) return { ok: false, reason: "text-too-long" };
  addComment(ctx, itemId, accountId, false, text);
  const { what, ownerPath } = item.handler.describe(ctx, item.row);
  ctx.enqueue({
    recipient: item.row.owner_account_id,
    kind: "reviewer-question",
    payload: {
      itemKind: item.row.kind,
      itemId,
      title: `${name} asked about your ${what}`,
      body: `“${text}”`,
      url: ownerPath,
    },
  });
  return { ok: true };
}

export function ownerReply(ctx: CoreContext, accountId: AccountId, itemId: string, reply: string): ReplyResult {
  const { name } = accountRow(ctx, accountId);
  const item = ownItem(ctx, accountId, itemId);
  if (!item) return { ok: false, reason: "item-not-found" };
  if (!isWaiting(item.row)) return { ok: false, reason: "not-waiting" };
  if (!thread(ctx, itemId, true).waitingOnReply) return { ok: false, reason: "no-question" };
  const text = reply.trim();
  if (text === "") return { ok: false, reason: "blank-reply" };
  if (textTooLong(text)) return { ok: false, reason: "text-too-long" };
  addComment(ctx, itemId, accountId, true, text);
  tellAll(ctx, item.handler.deciders(ctx, item.row), "owner-replied", {
    itemKind: item.row.kind,
    itemId,
    title: `${name} replied about their ${item.handler.describe(ctx, item.row).what}`,
    body: `“${text}” It's back in your queue.`,
    url: APP_PATHS.review,
  });
  return { ok: true };
}

export function decide(
  ctx: CoreContext,
  accountId: AccountId,
  itemId: string,
  decision: ReviewDecision,
  ankiChecksRunning: AnkiChecksRunning,
): DecideResult {
  accountRow(ctx, accountId);
  const found = findItem(ctx, itemId);
  const withdrawn = found && mayDecide(ctx, accountId, found) ? withdrawalOfItem(ctx, found) : null;
  if (withdrawn) return { ok: false, reason: "withdrawn", withdrawal: withdrawn };
  const item = itemToDecide(ctx, accountId, itemId);
  if (!item) return { ok: false, reason: "item-not-found" };
  if (item.row.decision !== null) return { ok: false, reason: "already-decided" };
  const reason = decision.kind === "reject" ? decision.reason.trim() : null;
  if (reason === "") return { ok: false, reason: "blank-reason" };
  if (reason !== null && textTooLong(reason)) return { ok: false, reason: "text-too-long" };
  const decided: Decided = reason === null ? { outcome: "approved", reason: null } : { outcome: "rejected", reason };
  const refusal = item.handler.checkDecision?.(ctx, item.row, decided, ankiChecksRunning) ?? null;
  if (refusal !== null) {
    // Catching judging up may have Ended the pact, which withdrew the item.
    const reloaded = findItem(ctx, itemId);
    const withdrawal = reloaded ? withdrawalOfItem(ctx, reloaded) : null;
    return withdrawal ? { ok: false, reason: "withdrawn", withdrawal } : { ok: false, reason: refusal };
  }
  item.handler.apply(ctx, item.row, decided, accountId, ankiChecksRunning);
  return { ok: true };
}

/** A review item with its kind's handler. */
interface FoundItem {
  handler: RequestKindHandler<RequestRow>;
  row: RequestRow;
}

/** The review item `itemId`, of whatever kind, with its handler. */
function findItem(ctx: CoreContext, itemId: string): FoundItem | undefined {
  for (const handler of REQUEST_HANDLERS) {
    const row = handler.load(ctx, itemId);
    if (row) return { handler, row };
  }
  return undefined;
}

/**
 * The review item `itemId`, if `reviewerId` may decide it (decided or not):
 * they're one of its deciders, it isn't withdrawn, and its kind lets them
 * act on it yet (`reviewable`).
 */
function itemToDecide(ctx: CoreContext, reviewerId: AccountId, itemId: string): FoundItem | undefined {
  const item = findItem(ctx, itemId);
  if (!item || item.row.withdrawn_at !== null || !mayDecide(ctx, reviewerId, item)) return undefined;
  return (item.handler.reviewable?.(ctx, item.row) ?? true) ? item : undefined;
}

/** Whether `reviewerId` is one of the item's deciders. */
function mayDecide(ctx: CoreContext, reviewerId: AccountId, { handler, row }: FoundItem): boolean {
  return handler.deciders(ctx, row).includes(reviewerId);
}

/** When and why the item was withdrawn, or null if it wasn't. */
function withdrawalOfItem(ctx: CoreContext, { handler, row }: FoundItem): Withdrawal | null {
  return withdrawalOf(row, () => handler.pactNames(ctx, row));
}

/**
 * Withdraws every waiting review item that's moot at `now` (R8): deciding it
 * either way could no longer change any outcome, penalty or terms. Each
 * records its reason, and nobody is told; it leaves every queue and waiting
 * list, and its question alert goes. Run after every command and tick.
 */
export function withdrawMoot(ctx: CoreContext, now: Date): void {
  for (const handler of REQUEST_HANDLERS) {
    if (!handler.moot) continue;
    for (const id of handler.moot.waitingIds(ctx)) {
      const row = handler.load(ctx, id)!;
      const reason = handler.moot.reason(ctx, row, now);
      if (reason !== null) handler.moot.withdraw(ctx, row, reason, now);
    }
  }
}

/** One of `ownerId`'s review items. */
function ownItem(ctx: CoreContext, ownerId: AccountId, itemId: string): FoundItem | undefined {
  const item = findItem(ctx, itemId);
  return item?.row.owner_account_id === ownerId ? item : undefined;
}

/** Adds a question (a reviewer's) or a reply (the owner's) to an item's thread. */
function addComment(ctx: CoreContext, itemId: string, authorId: AccountId, fromOwner: boolean, text: string): void {
  ctx.db
    .prepare(`INSERT INTO comment (item_id, author_account_id, from_owner, text, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .run(itemId, authorId, fromOwner ? 1 : 0, text, ctx.clock.now().toISOString());
}

/**
 * Every item `reviewerId` may decide, waiting on the owner's reply or not:
 * the kinds listed first (change requests), then the rest oldest first.
 * Items at the same time keep the registry's order of kinds.
 */
function queuedItems(ctx: CoreContext, reviewerId: AccountId): QueuedItem[] {
  const queued = REQUEST_HANDLERS.flatMap((handler) =>
    handler.queue(ctx, reviewerId).map((entry) => ({ ...entry, first: handler.queueFirst === true })),
  );
  return queued
    .sort((a, b) => Number(b.first) - Number(a.first) || a.since.getTime() - b.since.getTime())
    .map(({ item, since }) => ({ item, since }));
}
