// Evidence: submitting it, accepting a miss, the evidence page, deciding it,
// and the alerts a rejection leaves.

import { APP_PATHS } from "../shared/api.ts";
import { formatDate } from "../shared/format.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  type AcceptMissResult,
  type AccountId,
  type EvidenceResult,
  type EvidenceView,
  type LocalDate,
  type ReviewItem,
  type SubmitEvidenceRefusal,
  type SubmitEvidenceResult,
  type TodayAlert,
  type TodayWaitingItem,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import type { Command, CoreContext } from "./context.ts";
import { judge, judgeWeek } from "./judging.ts";
import {
  dueAfterEnd,
  evidenceDecision,
  excuseCoversSql,
  excuseOn,
  isJudged,
  judgingReached,
  MISSED_THROUGH_REJECTION,
  rejection,
  WEEKLY_COUNT_PACT,
  weekProgress,
} from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import { editWindowClosesAt, EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import type { Photo, PhotoStore } from "./ports.ts";
import {
  accountName,
  accountRow,
  decisionDetails,
  editWindowCutoff,
  friendsSortedByName,
  isWeekly,
  occurrencesOf,
  ownPact,
  pactName,
  recipientName,
  recordDecision,
  reviewersOf,
  reviewStateColumns,
  reviewStateOf,
  scheduleOf,
  termsOn,
  thread,
  type Decided,
  type PactRow,
  type ReviewOutcome,
  type ReviewStateRow,
} from "./rows.ts";

export async function submitEvidence(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  photos: Photo[],
  photoStore: PhotoStore,
  command: Command,
): Promise<SubmitEvidenceResult> {
  const { timezone, name: ownerName } = accountRow(ctx, accountId);
  // Refuse cheaply before storing anything, then check again at the time
  // the server received the photos, in the transaction that writes.
  const early = evidenceAcceptance(ctx, accountId, timezone, pactId, photos.length, ctx.clock.now());
  if (!early.ok) return early;
  const stored = await Promise.all(photos.map((photo) => photoStore.store(photo)));
  const submittedAt = new Date(Math.max(...stored.map((p) => p.receivedAt.getTime())));
  return command((): SubmitEvidenceResult => {
    const acceptance = evidenceAcceptance(ctx, accountId, timezone, pactId, photos.length, submittedAt);
    if (!acceptance.ok) return acceptance;
    const { occurrence, day } = acceptance;
    ctx.db
      .prepare(`INSERT INTO occurrence (pact_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(pactId, occurrence.date);
    const evidenceId = ctx.newId();
    ctx.db
      .prepare(`INSERT INTO evidence (id, pact_id, occurrence_date, day, submitted_at) VALUES (?, ?, ?, ?, ?)`)
      .run(evidenceId, pactId, occurrence.date, day, submittedAt.toISOString());
    stored.forEach(({ photoId, receivedAt }, position) => {
      ctx.db
        .prepare(`INSERT INTO evidence_photo (evidence_id, position, photo_id, received_at) VALUES (?, ?, ?, ?)`)
        .run(evidenceId, position, photoId, receivedAt.toISOString());
    });
    // Evidence from inside the edit window waits for closeEditWindows to
    // tell its reviewers; if they were told already, it missed that and goes now.
    const pact = ownPact(ctx, accountId, pactId);
    if (pact && (pact.reviewers_notified_at !== null || editWindowClosesAt(pact, submittedAt) === null)) {
      enqueueEvidenceReviewItems(ctx, pactId, evidenceId, day, ownerName);
    }
    return { ok: true, evidenceId };
  });
}

export function acceptMiss(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  occurrenceDate: string,
): AcceptMissResult {
  accountRow(ctx, accountId);
  const isOwn = ctx.db.prepare(`SELECT 1 FROM pact WHERE id = ? AND owner_account_id = ?`).get(pactId, accountId);
  if (!isOwn) return { ok: false, reason: "pact-not-found" };
  const now = ctx.clock.now().toISOString();
  const accepted = ctx.db
    .prepare(
      `UPDATE occurrence SET miss_accepted_at = ?
       WHERE pact_id = ? AND date = ? AND outcome = 'missed' AND miss_accepted_at IS NULL`,
    )
    .run(now, pactId, occurrenceDate);
  if (accepted.changes === 1) return { ok: true };
  // On Weekly count, a rejected day isn't a miss, but its alert goes the same way.
  const rejected = ctx.db
    .prepare(
      `UPDATE evidence SET rejection_accepted_at = ?
       WHERE pact_id = ? AND day = ? AND decision = 'rejected' AND rejection_accepted_at IS NULL
         AND (SELECT json_extract(schedule, '$.kind') FROM pact WHERE id = ?) = 'weekly-count'`,
    )
    .run(now, pactId, occurrenceDate, pactId);
  return rejected.changes > 0 ? { ok: true } : { ok: false, reason: "nothing-to-accept" };
}

export function evidencePage(ctx: CoreContext, accountId: AccountId, evidenceId: string): EvidenceResult {
  accountRow(ctx, accountId);
  const row = ctx.one<ReviewStateRow & EvidenceViewRow>(
    `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, evidence.occurrence_date, evidence.day,
              evidence.submitted_at, ${reviewStateColumns("evidence")}
       FROM evidence
       JOIN pact ON pact.id = evidence.pact_id
       LEFT JOIN account AS reviewer ON reviewer.id = evidence.decided_by_account_id
       WHERE evidence.id = ? AND pact.owner_account_id = ?`,
    evidenceId,
    accountId,
  );
  if (!row) return { ok: false, reason: "evidence-not-found" };
  return {
    ok: true,
    evidence: {
      ...evidenceView(ctx, row),
      state: reviewStateOf(row),
      reviewerNames: friendsSortedByName(ctx, reviewersOf(ctx, row.pact_id)).map((friend) => friend.name),
      thread: thread(ctx, row.id, row.decision === null),
    },
  };
}

/** The evidence columns `evidenceView` reads. `day` is the day it was for; `occurrence_date` its occurrence's. */
export interface EvidenceViewRow {
  id: string;
  pact_id: string;
  pact_name: string;
  occurrence_date: LocalDate;
  day: LocalDate;
  submitted_at: string;
}

/** Evidence a reviewer is deciding on, as `decide` reads it. */
export interface EvidenceToDecide {
  id: string;
  pact_id: string;
  occurrence_date: LocalDate;
  /** The day it counts for: on Weekly count, the day of the week. */
  day: LocalDate;
  /** The owner's: every pact's owner has one, as creating a pact needs it. */
  timezone: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

/** Evidence as its reviewers and its owner see it, with what counts from `terms`: the occurrence's day's. */
export function evidenceView(
  ctx: CoreContext,
  row: EvidenceViewRow,
  terms = termsOn(ctx, row.pact_id, row.occurrence_date),
): EvidenceView {
  return {
    id: row.id,
    pactId: row.pact_id,
    pactName: row.pact_name,
    occurrenceDate: row.day,
    description: terms.description,
    photoIds: evidencePhotoIds(ctx, row.id),
    submittedAt: new Date(row.submitted_at),
  };
}

/** Evidence waiting for approval that `reviewerId` may decide: for pacts they review, past the edit window. */
export function evidenceToReview(ctx: CoreContext, reviewerId: AccountId): ReviewItem[] {
  const rows = ctx.all<EvidenceViewRow & { owner_name: string; weekly: 0 | 1 }>(
    `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, owner.name AS owner_name,
              evidence.submitted_at, evidence.occurrence_date, evidence.day, ${WEEKLY_COUNT_PACT} AS weekly
       FROM evidence
       JOIN pact ON pact.id = evidence.pact_id
       JOIN account AS owner ON owner.id = pact.owner_account_id
       JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
       WHERE evidence.decision IS NULL AND pact.created_at <= ?
       ORDER BY evidence.submitted_at, evidence.id`,
    reviewerId,
    editWindowCutoff(ctx),
  );
  return rows.map((row): ReviewItem => {
    // What counts, and what rejecting costs: the terms of the occurrence's day.
    const terms = termsOn(ctx, row.pact_id, row.occurrence_date);
    return {
      kind: "evidence",
      ...evidenceView(ctx, row, terms),
      ownerName: row.owner_name,
      penaltyCents: terms.penalty_cents,
      recipientName: recipientName(ctx, terms.recipient_id),
      ...(row.weekly === 1 && { week: weekProgress(ctx, row.pact_id, row.occurrence_date) }),
      thread: thread(ctx, row.id, true),
    };
  });
}

/**
 * Records a reviewer's decision on waiting evidence and tells the owner.
 * A rejection is final: it judges the occurrence Missed as of now, open or
 * not. An approval judges it Satisfied as of now once judging has reached it,
 * since it was waiting on this decision; before that, judging at the due
 * time will.
 */
export function decideEvidence(
  ctx: CoreContext,
  evidence: EvidenceToDecide,
  decided: Decided,
  reviewerId: AccountId,
): void {
  const { outcome, reason } = decided;
  const now = ctx.clock.now();
  recordDecision(ctx, "evidence", evidence.id, decided, reviewerId, now);
  // A day ahead with an approved excuse or vacation stays for judging at its due time, which makes it Excused.
  const excusedAhead = excuseOn(ctx, evidence.pact_id, evidence.occurrence_date) === "approved";
  const occurrence = occurrencesOf(ctx, evidence.pact_id, evidence.timezone).covering(evidence.occurrence_date);
  if (occurrence === null || dueAfterEnd(ctx, evidence.pact_id, occurrence)) {
    // The pact Ended before the day fell due: it's never judged.
  } else if (isWeekly(ctx, evidence.pact_id)) {
    // A week waiting on this decision past its due time is judged now; the decision told the owner.
    if (
      !isJudged(ctx, evidence.pact_id, evidence.occurrence_date) &&
      judgingReached(ctx, evidence.pact_id, evidence.occurrence_date, now)
    ) {
      judgeWeek(ctx, evidence.pact_id, occurrence, now, false);
    }
  } else if (
    !isJudged(ctx, evidence.pact_id, evidence.occurrence_date) &&
    ((outcome === "rejected" && !excusedAhead) || judgingReached(ctx, evidence.pact_id, evidence.occurrence_date, now))
  ) {
    const judged = outcome === "approved" ? "satisfied" : excusedAhead ? "excused" : "missed";
    judge(ctx, evidence.pact_id, evidence.occurrence_date, judged, now);
  }
  ctx.enqueue({
    recipient: evidence.owner_account_id,
    kind: "evidence-decided",
    payload: {
      itemKind: "evidence",
      itemId: evidence.id,
      pactId: evidence.pact_id,
      ...decisionDetails(decided),
      title: `${accountName(ctx, reviewerId)} ${outcome} your evidence`,
      body: `${pactName(ctx, evidence.pact_id)} · ${reason === null ? formatDate(evidence.day) : `“${reason}”`}`,
      // A rejection shows as an alert on Today, where the owner can respond to it.
      url: outcome === "approved" ? APP_PATHS.pact(evidence.pact_id) : APP_PATHS.today,
    },
  });
}

/** The photos of some evidence, in the order taken. */
export function evidencePhotoIds(ctx: CoreContext, evidenceId: string): string[] {
  return ctx
    .all<{ photo_id: string }>(
      `SELECT photo_id FROM evidence_photo WHERE evidence_id = ? ORDER BY position`,
      evidenceId,
    )
    .map((row) => row.photo_id);
}

/**
 * Whether `ownerId` may submit evidence with `photoCount` photos for
 * `pactId` at `at`, and if so for which occurrence and day: the one open at
 * `at`, unless evidence for it is already waiting or approved, or it's
 * already judged (a rejection judges it Missed at once). On Weekly count
 * that's for the day: one day of evidence counts per day, and a day whose
 * evidence was rejected is made up on another.
 */
export function evidenceAcceptance(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string | null,
  pactId: string,
  photoCount: number,
  at: Date,
): { ok: true; occurrence: Occurrence; day: LocalDate } | { ok: false; reason: SubmitEvidenceRefusal } {
  const row = ctx.one<Pick<PactRow, "schedule" | "first_occurrence" | "evidence_kind" | "stage">>(
    `SELECT schedule, first_occurrence, evidence_kind, stage FROM pact WHERE id = ? AND owner_account_id = ?`,
    pactId,
    ownerId,
  );
  if (!row || timezone === null) return { ok: false, reason: "pact-not-found" };
  // Oura reports a bedtime night; there's never a photo to submit.
  if (row.evidence_kind !== "camera") return { ok: false, reason: "not-open" };
  if (photoCount === 0) return { ok: false, reason: "no-photos" };
  if (photoCount > MAX_EVIDENCE_PHOTOS) return { ok: false, reason: "too-many-photos" };
  const { kind } = scheduleOf(row.schedule);
  const occurrences = occurrencesOf(ctx, pactId, timezone);
  const occurrence = occurrences.openAt(at);
  // One-time evidence is for its one occurrence, whichever day it comes.
  const day = occurrence && kind === "one-time" ? occurrence.date : localDateOf(at, timezone);
  // Past its due-by time, the day takes no more evidence.
  if (!occurrence || at.getTime() >= occurrences.dayDueAt(localDateOf(at, timezone))!.getTime()) {
    return { ok: false, reason: "not-open" };
  }
  const decision = evidenceDecision(ctx, pactId, day, "day");
  if (decision === "waiting") return { ok: false, reason: "evidence-waiting" };
  if (decision === "approved") return { ok: false, reason: "already-approved" };
  if ((kind === "weekly-count" && decision === "rejected") || isJudged(ctx, pactId, occurrence.date)) {
    return { ok: false, reason: "already-judged" };
  }
  // An Ended pact has no day open any more.
  if (row.stage === "ended") return { ok: false, reason: "not-open" };
  return { ok: true, occurrence, day };
}

/** The owner's evidence still waiting for a decision (or just that for `pactId`), newest first. */
export function waitingEvidence(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
  const rows = ctx.all<{
    id: string;
    pact_id: string;
    name: string;
    occurrence_date: string;
    submitted_at: string;
  }>(
    `SELECT evidence.id, evidence.pact_id, pact.name, evidence.day AS occurrence_date, evidence.submitted_at
       FROM evidence JOIN pact ON pact.id = evidence.pact_id
       WHERE pact.owner_account_id = ? AND evidence.decision IS NULL AND (? IS NULL OR pact.id = ?)
       ORDER BY evidence.submitted_at DESC, evidence.id`,
    ownerId,
    pactId ?? null,
    pactId ?? null,
  );
  return rows.map((row) => ({
    kind: "evidence",
    id: row.id,
    pactId: row.pact_id,
    name: row.name,
    occurrenceDate: row.occurrence_date,
    submittedAt: new Date(row.submitted_at),
  }));
}

/**
 * One alert per occurrence of the owner's judged Missed through a
 * rejection, newest rejection first, with when it was judged. No time
 * limit. It goes once the owner accepts the miss, or files an excuse or a
 * vacation for the day (one waiting before the rejection counts too); a
 * rejected excuse's or vacation's own alert takes over then.
 */
export function rejectedEvidenceAlerts(ctx: CoreContext, ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
  const rows = ctx.all<{
    id: string;
    name: string;
    date: LocalDate;
    judged_at: string;
    amount_cents: number;
    recipient_name: string;
  }>(
    `SELECT pact.id, pact.name, occurrence.date, occurrence.judged_at, penalty.amount_cents,
              recipient.name AS recipient_name
       FROM occurrence
       JOIN pact ON pact.id = occurrence.pact_id
       JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
       JOIN recipient ON recipient.id = penalty.recipient_id
       WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND occurrence.miss_accepted_at IS NULL
         AND ${MISSED_THROUGH_REJECTION}
         AND NOT ${excuseCoversSql(
           "occurrence.pact_id",
           "occurrence.date",
           "(excuse.decision IS NULL OR excuse.filed_at >= occurrence.judged_at)",
         )}
       ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
    ownerId,
  );
  return rows.map((row) => {
    const rejected = rejection(ctx, row.id, row.date);
    if (!rejected) throw new Error(`no rejected evidence for pact ${row.id} on ${row.date}`);
    const judgedAt = new Date(row.judged_at);
    return {
      at: judgedAt,
      alert: {
        kind: "evidence-rejected",
        pactId: row.id,
        name: row.name,
        ...rejected,
        occurrenceDate: row.date,
        penaltyCents: row.amount_cents,
        recipientName: row.recipient_name,
        excusableUntil: new Date(judgedAt.getTime() + EXCUSE_WINDOW_MS),
        week: false,
      },
    };
  });
}

/**
 * One alert per Weekly count day of the owner's whose evidence was
 * rejected, newest rejection first, with when it was rejected: nothing is
 * Missed, and the day can be made up another day. It goes once the owner
 * takes the L on it, an excuse or a vacation covers the week (one rejected after the
 * rejection has its own alert), or the week is judged.
 */
export function rejectedDayAlerts(ctx: CoreContext, ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
  const rows = ctx.all<{
    id: string;
    name: string;
    occurrence_date: LocalDate;
    day: LocalDate;
    decided_at: string;
    reject_reason: string;
    reviewer_name: string;
  }>(
    `SELECT pact.id, pact.name, evidence.occurrence_date, evidence.day, evidence.decided_at,
              evidence.reject_reason, reviewer.name AS reviewer_name
       FROM evidence
       JOIN pact ON pact.id = evidence.pact_id
       JOIN account AS reviewer ON reviewer.id = evidence.decided_by_account_id
       WHERE pact.owner_account_id = ? AND ${WEEKLY_COUNT_PACT}
         AND evidence.decision = 'rejected' AND evidence.rejection_accepted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM occurrence
                         WHERE occurrence.pact_id = evidence.pact_id AND occurrence.date = evidence.occurrence_date
                           AND occurrence.outcome IS NOT NULL)
         AND NOT ${excuseCoversSql(
           "evidence.pact_id",
           "evidence.occurrence_date",
           "(excuse.decision IS NULL OR excuse.decision = 'approved' OR excuse.filed_at >= evidence.decided_at)",
         )}
       ORDER BY evidence.decided_at DESC, pact.name, pact.id`,
    ownerId,
  );
  return rows.map((row) => {
    const terms = termsOn(ctx, row.id, row.occurrence_date);
    return {
      at: new Date(row.decided_at),
      alert: {
        kind: "evidence-rejected",
        pactId: row.id,
        name: row.name,
        reviewerName: row.reviewer_name,
        reason: row.reject_reason,
        occurrenceDate: row.day,
        penaltyCents: terms.penalty_cents,
        recipientName: recipientName(ctx, terms.recipient_id),
        excusableUntil: null,
        week: true,
      },
    };
  });
}

export function enqueueEvidenceReviewItems(
  ctx: CoreContext,
  pactId: string,
  evidenceId: string,
  date: LocalDate,
  ownerName: string,
): void {
  tellAll(ctx, reviewersOf(ctx, pactId), "review-item", {
    itemKind: "evidence",
    itemId: evidenceId,
    pactId,
    title: `${ownerName} submitted evidence`,
    body: `${pactName(ctx, pactId)} · ${formatDate(date)}`,
    url: APP_PATHS.review,
  });
}
