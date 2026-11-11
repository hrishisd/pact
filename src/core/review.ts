// Review: the Review Queue, deciding an item, a reviewer's question and the
// owner's reply, and who may see a photo.

import { APP_PATHS } from "../shared/api.ts";
import { money } from "../shared/format.ts";
import type {
  AccountId,
  AskOwnerResult,
  DecideResult,
  ReplyResult,
  ReviewDecision,
  ReviewItem,
} from "../shared/types.ts";
import {
  approvableNow,
  changeRequestRow,
  changeRequestsToReview,
  decideChangeRequest,
  waitingChangeRequestId,
  type StoredChangeRequest,
} from "./change-requests.ts";
import type { CoreContext } from "./context.ts";
import { decideEvidence, evidenceToReview, type EvidenceToDecide } from "./evidence.ts";
import { decideExcuse, excusesToReview, type ExcuseToDecide } from "./excuses.ts";
import { judgePactDueBy, type AnkiChecksRunning } from "./judging.ts";
import {
  decidePayment,
  mayViewPaymentPhoto,
  paymentReviewers,
  paymentsToReview,
  paymentToDecide,
  type PaymentToDecide,
} from "./money.ts";
import { pactsToJudge } from "./occurrence-state.ts";
import { tellAll } from "./outbox.ts";
import {
  decideVacation,
  ownVacation,
  vacationsToReview,
  vacationToDecide,
  type VacationToDecide,
} from "./vacations.ts";
import type { Photo, PhotoStore } from "./ports.ts";
import { textTooLong } from "./text-limits.ts";
import {
  accountRow,
  editWindowCutoff,
  mergeByTime,
  pactName,
  recipientName,
  reviewersOf,
  thread,
  type Decided,
  type ReviewOutcome,
} from "./rows.ts";

export type PhotoResult = { ok: true; photo: Photo } | { ok: false; reason: "photo-not-found" };

export async function viewPhoto(
  ctx: CoreContext,
  accountId: AccountId,
  photoId: string,
  photoStore: PhotoStore,
): Promise<PhotoResult> {
  accountRow(ctx, accountId);
  const viewable =
    mayViewPactItemPhoto(ctx, "evidence", photoId, accountId) ||
    mayViewPactItemPhoto(ctx, "excuse", photoId, accountId) ||
    mayViewPaymentPhoto(ctx, photoId, accountId);
  const photo = viewable ? await photoStore.fetch(photoId) : null;
  return photo ? { ok: true, photo } : { ok: false, reason: "photo-not-found" };
}

export function reviewQueue(ctx: CoreContext, accountId: AccountId): ReviewItem[] {
  accountRow(ctx, accountId);
  return reviewItems(ctx, accountId).filter((item) => !item.thread.waitingOnReply);
}

export function waitingOnReply(ctx: CoreContext, accountId: AccountId): ReviewItem[] {
  accountRow(ctx, accountId);
  return reviewItems(ctx, accountId).filter((item) => item.thread.waitingOnReply);
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
  ctx.enqueue({
    recipient: item.row.owner_account_id,
    kind: "reviewer-question",
    payload: {
      itemKind: item.kind,
      itemId,
      title: `${name} asked about your ${itemWhat(ctx, item.kind, itemId)}`,
      body: `“${text}”`,
      url: itemPath(item.kind, itemId),
    },
  });
  return { ok: true };
}

export function ownerReply(ctx: CoreContext, accountId: AccountId, itemId: string, reply: string): ReplyResult {
  const { name } = accountRow(ctx, accountId);
  const item = ownItem(ctx, accountId, itemId);
  if (!item) return { ok: false, reason: "item-not-found" };
  if (!item.waiting) return { ok: false, reason: "not-waiting" };
  if (!thread(ctx, itemId, true).waitingOnReply) return { ok: false, reason: "no-question" };
  const text = reply.trim();
  if (text === "") return { ok: false, reason: "blank-reply" };
  if (textTooLong(text)) return { ok: false, reason: "text-too-long" };
  addComment(ctx, itemId, accountId, true, text);
  tellAll(ctx, item.reviewerIds, "owner-replied", {
    itemKind: item.kind,
    itemId,
    title: `${name} replied about their ${itemWhat(ctx, item.kind, itemId)}`,
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
  const item = itemToDecide(ctx, accountId, itemId);
  if (!item) return { ok: false, reason: "item-not-found" };
  if (item.row.decision !== null) return { ok: false, reason: "already-decided" };
  const reason = decision.kind === "reject" ? decision.reason.trim() : null;
  if (reason === "") return { ok: false, reason: "blank-reason" };
  if (reason !== null && textTooLong(reason)) return { ok: false, reason: "text-too-long" };
  const decided: Decided = reason === null ? { outcome: "approved", reason: null } : { outcome: "rejected", reason };
  switch (item.kind) {
    case "evidence":
      decideEvidence(ctx, item.row, decided, accountId);
      break;
    case "excuse":
      decideExcuse(ctx, item.row, decided, accountId);
      break;
    case "payment":
      decidePayment(ctx, item.row, decided, accountId);
      break;
    case "vacation":
      decideVacation(ctx, item.row, decided, accountId);
      break;
    case "change-request":
      if (decided.outcome === "approved") {
        // Judging catches up on the pact first, as the scheduler would have: a change never
        // rescues an occurrence already due. Judging may End it, which withdraws the request.
        const [pact] = pactsToJudge(ctx, item.row.pact_id);
        judgePactDueBy(ctx, pact!, ctx.clock.now(), ankiChecksRunning);
        if (waitingChangeRequestId(ctx, item.row.pact_id) !== item.row.id) {
          return { ok: false, reason: "item-not-found" };
        }
      }
      if (decided.outcome === "approved" && !approvableNow(ctx, item.row)) {
        return { ok: false, reason: "deadline-too-soon" };
      }
      decideChangeRequest(ctx, item.row, decided, accountId);
      break;
  }
  return { ok: true };
}

/**
 * The review item `itemId`, if `reviewerId` may decide it (decided or not):
 * evidence or an excuse for a pact they review (evidence once the pact's
 * edit window has closed), a payment to a recipient of any of the owner's
 * pacts they review, a change request not withdrawn, for an Active pact, or
 * a vacation not withdrawn that the owner picked them for.
 */
function itemToDecide(ctx: CoreContext, reviewerId: AccountId, itemId: string): ItemToDecide | undefined {
  const evidence = ctx.one<EvidenceToDecide>(
    `SELECT evidence.id, evidence.pact_id, evidence.occurrence_date, evidence.day, evidence.decision,
                pact.owner_account_id, owner.timezone
         FROM evidence
         JOIN pact ON pact.id = evidence.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE evidence.id = ? AND pact.created_at <= ?`,
    reviewerId,
    itemId,
    editWindowCutoff(ctx),
  );
  if (evidence) return { kind: "evidence", row: evidence };
  const excuse = ctx.one<ExcuseToDecide>(
    `SELECT excuse.id, excuse.pact_id, excuse.decision, pact.owner_account_id
       FROM excuse
       JOIN pact ON pact.id = excuse.pact_id
       JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
       WHERE excuse.id = ?`,
    reviewerId,
    itemId,
  );
  if (excuse) return { kind: "excuse", row: excuse };
  const payment = paymentToDecide(ctx, reviewerId, itemId);
  if (payment) return { kind: "payment", row: payment };
  const vacation = vacationToDecide(ctx, reviewerId, itemId);
  if (vacation) return { kind: "vacation", row: vacation };
  const mayDecideRequest =
    ctx.db
      .prepare(
        `SELECT 1 FROM change_request
         JOIN pact ON pact.id = change_request.pact_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                           AND pact_reviewer.reviewer_account_id = ?
         WHERE change_request.id = ? AND change_request.withdrawn_at IS NULL AND pact.stage = 'active'`,
      )
      .get(reviewerId, itemId) !== undefined;
  const changeRequest = mayDecideRequest ? changeRequestRow(ctx, itemId) : undefined;
  return changeRequest && { kind: "change-request", row: changeRequest };
}

/**
 * One of `ownerId`'s review items: its kind, whether it's still waiting for
 * a decision (not decided, nor a change request withdrawn), and who may
 * decide it.
 */
function ownItem(
  ctx: CoreContext,
  ownerId: AccountId,
  itemId: string,
): { kind: ReviewItem["kind"]; waiting: boolean; reviewerIds: AccountId[] } | undefined {
  const ofPact = (table: "evidence" | "excuse") =>
    ctx.one<{ pact_id: string; decision: ReviewOutcome | null }>(
      `SELECT ${table}.pact_id, ${table}.decision FROM ${table}
         JOIN pact ON pact.id = ${table}.pact_id
         WHERE ${table}.id = ? AND pact.owner_account_id = ?`,
      itemId,
      ownerId,
    );
  for (const kind of ["evidence", "excuse"] as const) {
    const row = ofPact(kind);
    if (row) return { kind, waiting: row.decision === null, reviewerIds: reviewersOf(ctx, row.pact_id) };
  }
  const payment = ctx.one<{ recipient_id: string; decision: ReviewOutcome | null }>(
    `SELECT recipient_id, decision FROM payment WHERE id = ? AND owner_account_id = ?`,
    itemId,
    ownerId,
  );
  if (payment) {
    return {
      kind: "payment",
      waiting: payment.decision === null,
      reviewerIds: paymentReviewers(ctx, ownerId, payment.recipient_id),
    };
  }
  const request = changeRequestRow(ctx, itemId);
  if (request && request.owner_account_id === ownerId) {
    return {
      kind: "change-request",
      waiting: request.decision === null && request.withdrawn_at === null,
      reviewerIds: reviewersOf(ctx, request.pact_id),
    };
  }
  const vacation = ownVacation(ctx, ownerId, itemId);
  if (vacation) return { kind: "vacation", ...vacation };
  return undefined;
}

/** How a notification names a review item after "your" or "their": "evidence for Gym", "$10 payment to Sam". */
function itemWhat(ctx: CoreContext, kind: ReviewItem["kind"], itemId: string): string {
  switch (kind) {
    case "evidence":
    case "excuse": {
      const { name } = ctx.db
        .prepare(`SELECT pact.name FROM ${kind} JOIN pact ON pact.id = ${kind}.pact_id WHERE ${kind}.id = ?`)
        .get(itemId) as { name: string };
      return `${kind} for ${name}`;
    }
    case "payment": {
      const { amount_cents, recipient_id } = ctx.db
        .prepare(`SELECT amount_cents, recipient_id FROM payment WHERE id = ?`)
        .get(itemId) as { amount_cents: number; recipient_id: string };
      return `${money(amount_cents)} payment to ${recipientName(ctx, recipient_id)}`;
    }
    case "change-request": {
      const row = changeRequestRow(ctx, itemId)!;
      const name = pactName(ctx, row.pact_id);
      return row.request.kind === "end" ? `request to end ${name}` : `change to ${name}`;
    }
    case "vacation":
      return "vacation";
  }
}

/** Adds a question (a reviewer's) or a reply (the owner's) to an item's thread. */
function addComment(ctx: CoreContext, itemId: string, authorId: AccountId, fromOwner: boolean, text: string): void {
  ctx.db
    .prepare(`INSERT INTO comment (item_id, author_account_id, from_owner, text, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .run(itemId, authorId, fromOwner ? 1 : 0, text, ctx.clock.now().toISOString());
}

/**
 * Every item `reviewerId` may decide, waiting on the owner's reply or not:
 * change requests first, then the rest (vacations included) oldest first.
 */
function reviewItems(ctx: CoreContext, reviewerId: AccountId): ReviewItem[] {
  // Change requests first: one waiting holds up any other change to its pact.
  return [
    ...changeRequestsToReview(ctx, reviewerId),
    ...mergeByTime(
      reviewItemSince,
      "oldest-first",
      evidenceToReview(ctx, reviewerId),
      excusesToReview(ctx, reviewerId),
      paymentsToReview(ctx, reviewerId),
      vacationsToReview(ctx, reviewerId),
    ),
  ];
}

/** Whether `photoId` is a photo of some evidence or excuse (`table`) and `accountId` owns or reviews its pact. */
function mayViewPactItemPhoto(
  ctx: CoreContext,
  table: "evidence" | "excuse",
  photoId: string,
  accountId: AccountId,
): boolean {
  return (
    ctx.db
      .prepare(
        `SELECT 1 FROM ${table}_photo
         JOIN ${table} ON ${table}.id = ${table}_photo.${table}_id
         JOIN pact ON pact.id = ${table}.pact_id
         WHERE ${table}_photo.photo_id = ?
           AND (pact.owner_account_id = ?
                OR EXISTS (SELECT 1 FROM pact_reviewer
                           WHERE pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?))`,
      )
      .get(photoId, accountId, accountId) !== undefined
  );
}

/** A review item a reviewer may decide, as `decide` and `askOwner` read it. */
type ItemToDecide =
  | { kind: "evidence"; row: EvidenceToDecide }
  | { kind: "excuse"; row: ExcuseToDecide }
  | { kind: "payment"; row: PaymentToDecide }
  | { kind: "change-request"; row: StoredChangeRequest }
  | { kind: "vacation"; row: VacationToDecide };

/** The owner's page for a review item: where a question about it opens. */
function itemPath(kind: ReviewItem["kind"], itemId: string): string {
  switch (kind) {
    case "evidence":
      return APP_PATHS.evidence(itemId);
    case "excuse":
      return APP_PATHS.excuse(itemId);
    case "payment":
      return APP_PATHS.payment(itemId);
    case "change-request":
      return APP_PATHS.changeRequest(itemId);
    case "vacation":
      return APP_PATHS.profile;
  }
}

/** When a review item was sent for a decision: for ordering the Review Queue. */
function reviewItemSince(item: ReviewItem): Date {
  switch (item.kind) {
    case "evidence":
      return item.submittedAt;
    case "excuse":
      return item.filedAt;
    case "payment":
      return item.recordedAt;
    case "change-request":
      return item.requestedAt;
    case "vacation":
      return item.filedAt;
  }
}
