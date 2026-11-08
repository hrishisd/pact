// Excuses: what one would cover, filing it, the excuse page, deciding it, and
// the alerts a rejection leaves.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate } from "../shared/format.ts";
import {
  MAX_EXCUSE_PHOTOS,
  MAX_EXCUSE_SPAN_DAYS,
  type AcceptExcuseRejectionResult,
  type AccountId,
  type ExcuseDates,
  type ExcuseDatesRefusal,
  type ExcuseDay,
  type ExcuseDetail,
  type ExcuseOptionsResult,
  type ExcusePreview,
  type ExcusePreviewResult,
  type ExcuseResult,
  type ExcuseView,
  type FileExcuseRefusal,
  type FileExcuseResult,
  type LocalDate,
  type NewExcuse,
  type ReviewItem,
  type TodayAlert,
  type TodayWaitingItem,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import type { Command, CoreContext } from "./context.ts";
import { judge } from "./judging.ts";
import { dueAfterEnd, judgingReached, occurrenceStatus, skipReason } from "./occurrence-state.ts";
import { lastDayOf, type Occurrence } from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import { editWindowClosesAt, EXCUSE_WINDOW_MS, isLocalDate } from "./pact-rules.ts";
import type { Photo, PhotoStore } from "./ports.ts";
import {
  accountName,
  accountRow,
  decisionDetails,
  friendsSortedByName,
  isWeekly,
  occurrencesOf,
  ownPact,
  pactName,
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

export function excuseOptions(ctx: CoreContext, accountId: AccountId, pactId: string): ExcuseOptionsResult {
  const { timezone } = accountRow(ctx, accountId);
  const now = ctx.clock.now();
  const pact = ownPact(ctx, accountId, pactId);
  if (!pact || timezone === null) return { ok: false, reason: "pact-not-found" };
  if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
  const today = localDateOf(now, timezone);
  // Days before today an excuse could cover: Missed in the last 48 hours, or still waiting on evidence.
  const since = new Date(now.getTime() - EXCUSE_WINDOW_MS).toISOString();
  const earliest = (
    ctx.db
      .prepare(
        `SELECT MIN(date) AS date FROM occurrence
         WHERE pact_id = ? AND date < ? AND (outcome IS NULL OR (outcome = 'missed' AND judged_at > ?))`,
      )
      .get(pactId, today, since) as { date: LocalDate | null }
  ).date;
  const { overlapping } = occurrencesOf(ctx, pactId, timezone);
  const recentDays = overlapping(earliest ?? today, today)
    .filter((occurrence) => !dueAfterEnd(ctx, pactId, occurrence))
    .map((occurrence) => excuseDay(ctx, pactId, occurrence))
    .filter(({ status }) => skipReason(status, now) === null)
    .toReversed();
  return { ok: true, options: { today, recentDays } };
}

export async function fileExcuse(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  excuse: NewExcuse,
  photos: Photo[],
  photoStore: PhotoStore,
  command: Command,
): Promise<FileExcuseResult> {
  const { timezone, name: ownerName } = accountRow(ctx, accountId);
  const reason = excuse.reason.trim();
  // Refuse cheaply before storing anything, then check again at the time
  // the server received the photos, in the transaction that writes.
  const acceptance = (at: Date): { ok: true; preview: ExcusePreview } | { ok: false; reason: FileExcuseRefusal } => {
    const checked = excusePreview(ctx, accountId, timezone, pactId, excuse, at);
    if (!checked.ok) return checked;
    if (reason === "") return { ok: false, reason: "blank-reason" };
    if (photos.length > MAX_EXCUSE_PHOTOS) return { ok: false, reason: "too-many-photos" };
    if (checked.preview.covered.length === 0) return { ok: false, reason: "nothing-to-excuse" };
    return checked;
  };
  const early = acceptance(ctx.clock.now());
  if (!early.ok) return early;
  const stored = await Promise.all(photos.map((photo) => photoStore.store(photo)));
  // With no photos, the server received the excuse when it writes it.
  const lastReceived = stored.length === 0 ? null : Math.max(...stored.map((p) => p.receivedAt.getTime()));
  return command((): FileExcuseResult => {
    const filedAt = lastReceived === null ? ctx.clock.now() : new Date(lastReceived);
    const checked = acceptance(filedAt);
    if (!checked.ok) return checked;
    const excuseId = ctx.newId();
    ctx.db
      .prepare(`INSERT INTO excuse (id, pact_id, reason, filed_at) VALUES (?, ?, ?, ?)`)
      .run(excuseId, pactId, reason, filedAt.toISOString());
    for (const { date } of checked.preview.covered) {
      ctx.db.prepare(`INSERT INTO excuse_day (excuse_id, pact_id, date) VALUES (?, ?, ?)`).run(excuseId, pactId, date);
    }
    stored.forEach(({ photoId, receivedAt }, position) => {
      ctx.db
        .prepare(`INSERT INTO excuse_photo (excuse_id, position, photo_id, received_at) VALUES (?, ?, ?, ?)`)
        .run(excuseId, position, photoId, receivedAt.toISOString());
    });
    const name = pactName(ctx, pactId);
    const dates = excuseDatesText(ctx, excuseId);
    tellAll(ctx, reviewersOf(ctx, pactId), "review-item", {
      itemKind: "excuse",
      itemId: excuseId,
      pactId,
      title: `${ownerName} filed an excuse`,
      body: `${name} · ${dates}`,
      url: APP_PATHS.review,
    });
    return { ok: true, excuseId };
  });
}

export function excusePage(ctx: CoreContext, accountId: AccountId, excuseId: string): ExcuseResult {
  accountRow(ctx, accountId);
  const pact = excusePact(ctx, excuseId);
  if (!pact || pact.owner_account_id !== accountId) return { ok: false, reason: "excuse-not-found" };
  const row = ctx.db
    .prepare(
      `SELECT excuse.reason, excuse.filed_at, ${reviewStateColumns("excuse")}
       FROM excuse LEFT JOIN account AS reviewer ON reviewer.id = excuse.decided_by_account_id
       WHERE excuse.id = ?`,
    )
    .get(excuseId) as ReviewStateRow & { reason: string; filed_at: string };
  const reviewerNames = friendsSortedByName(ctx, reviewersOf(ctx, pact.id)).map((friend) => friend.name);
  const excuse: ExcuseDetail = {
    ...excuseView(ctx, {
      ...row,
      id: excuseId,
      pact_id: pact.id,
      pact_name: pact.name,
      timezone: pact.timezone,
    }),
    state: reviewStateOf(row),
    reviewerNames,
    thread: thread(ctx, excuseId, row.decision === null),
  };
  return { ok: true, excuse };
}

export function acceptExcuseRejection(
  ctx: CoreContext,
  accountId: AccountId,
  excuseId: string,
): AcceptExcuseRejectionResult {
  accountRow(ctx, accountId);
  const pact = excusePact(ctx, excuseId);
  if (!pact || pact.owner_account_id !== accountId) return { ok: false, reason: "excuse-not-found" };
  const now = ctx.clock.now().toISOString();
  const accepted = ctx.db
    .prepare(
      `UPDATE excuse SET rejection_accepted_at = ?
       WHERE id = ? AND decision = 'rejected' AND rejection_accepted_at IS NULL`,
    )
    .run(now, excuseId);
  if (accepted.changes !== 1) return { ok: false, reason: "nothing-to-accept" };
  ctx.db
    .prepare(
      `UPDATE occurrence SET miss_accepted_at = ?
       WHERE outcome = 'missed' AND miss_accepted_at IS NULL
         AND (pact_id, date) IN (SELECT pact_id, date FROM excuse_day WHERE excuse_id = ?)`,
    )
    .run(now, excuseId);
  return { ok: true };
}

/** The excuse columns `excuseView` reads, with the owner's timezone. */
export interface ExcuseViewRow {
  id: string;
  pact_id: string;
  pact_name: string;
  reason: string;
  filed_at: string;
  timezone: string;
}

/** An excuse a reviewer is deciding on, as `decide` reads it. */
export interface ExcuseToDecide {
  id: string;
  pact_id: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

export function previewExcuse(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  dates: ExcuseDates,
): ExcusePreviewResult {
  const { timezone } = accountRow(ctx, accountId);
  return excusePreview(ctx, accountId, timezone, pactId, dates, ctx.clock.now());
}

/**
 * The owner's pact `pactId` and the days an excuse for it with `dates`
 * would cover at `now`, or why the dates are refused.
 */
function excusePreview(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string | null,
  pactId: string,
  dates: ExcuseDates,
  now: Date,
): { ok: true; preview: ExcusePreview } | { ok: false; reason: ExcuseDatesRefusal } {
  const pact = ownPact(ctx, ownerId, pactId);
  if (!pact || timezone === null) return { ok: false, reason: "pact-not-found" };
  if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
  const { from, to } = dates;
  if (!isLocalDate(from) || !isLocalDate(to) || to < from) return { ok: false, reason: "invalid-dates" };
  if (to > addDays(from, MAX_EXCUSE_SPAN_DAYS - 1)) return { ok: false, reason: "too-many-days" };
  const preview: ExcusePreview = { covered: [], skipped: [], heldCents: 0 };
  // On Weekly count, a day of a week covers the whole week. An Ended pact has no days after its end.
  for (const occurrence of occurrencesOf(ctx, pactId, timezone).overlapping(from, to)) {
    if (dueAfterEnd(ctx, pactId, occurrence)) continue;
    const day = excuseDay(ctx, pactId, occurrence);
    const skipped = skipReason(day.status, now);
    if (skipped !== null) {
      preview.skipped.push({ date: occurrence.date, reason: skipped });
      continue;
    }
    preview.covered.push(day);
    if (day.status.kind === "missed") preview.heldCents += day.status.penaltyCents;
  }
  return { ok: true, preview };
}

/**
 * The days an excuse covers, oldest first, as they stand now. A day ahead
 * that an approved change took off the schedule isn't one any more.
 */
export function excuseDays(ctx: CoreContext, excuseId: string, pactId: string, timezone: string): ExcuseDay[] {
  const { between } = occurrencesOf(ctx, pactId, timezone);
  const dates = ctx
    .all<{
      date: LocalDate;
    }>(`SELECT date FROM excuse_day WHERE excuse_id = ? ORDER BY date`, excuseId)
    .map((row) => row.date);
  return dates.flatMap((date) => {
    const [occurrence] = between(date, date);
    return occurrence ? [excuseDay(ctx, pactId, occurrence)] : [];
  });
}

/** The pact's `occurrence` as an excuse's day: a Weekly count week runs through its Sunday. */
export function excuseDay(ctx: CoreContext, pactId: string, occurrence: Occurrence): ExcuseDay {
  const schedule = scheduleOf(termsOn(ctx, pactId, occurrence.date).schedule);
  return {
    date: occurrence.date,
    ...(schedule.kind === "weekly-count" && { through: lastDayOf(schedule, occurrence.date) }),
    status: occurrenceStatus(ctx, pactId, occurrence),
  };
}

/** The photos of an excuse, in the order added. */
export function excusePhotoIds(ctx: CoreContext, excuseId: string): string[] {
  return ctx
    .all<{
      photo_id: string;
    }>(`SELECT photo_id FROM excuse_photo WHERE excuse_id = ? ORDER BY position`, excuseId)
    .map((row) => row.photo_id);
}

/** The owner's timezone and the pact's terms, for an excuse's pact. */
export function excusePact(ctx: CoreContext, excuseId: string): (PactRow & { timezone: string }) | undefined {
  return ctx.one<PactRow & { timezone: string }>(
    `SELECT pact.*, account.timezone FROM excuse
       JOIN pact ON pact.id = excuse.pact_id
       JOIN account ON account.id = pact.owner_account_id
       WHERE excuse.id = ?`,
    excuseId,
  );
}

/** "Mon Jan 5", or "Mon Jan 5 – Fri Jan 9" for several days; "Week of Mon Jan 5" for a Weekly count week. */
export function excuseDatesText(ctx: CoreContext, excuseId: string): string {
  const {
    first,
    last,
    pact_id: pactId,
  } = ctx.db
    .prepare(`SELECT MIN(date) AS first, MAX(date) AS last, pact_id FROM excuse_day WHERE excuse_id = ?`)
    .get(excuseId) as { first: LocalDate; last: LocalDate; pact_id: string };
  const text = first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`;
  return isWeekly(ctx, pactId) ? `Week of ${text}` : text;
}

/**
 * Records a reviewer's decision on an excuse waiting for approval and tells
 * the owner. Approved: its Missed days become Excused as of now, without
 * their penalties, and its days not judged yet that judging has reached
 * (their evidence was waiting) are judged Excused now; the rest are judged
 * Excused at their due time. A bedtime night not judged yet is left to
 * judging, which waits for Oura until it closes. Days the pact no longer
 * has after it Ended are left alone. Rejected: nothing to change, as its
 * holds are released by no longer waiting and its days are judged as usual.
 */
export function decideExcuse(ctx: CoreContext, excuse: ExcuseToDecide, decided: Decided, reviewerId: AccountId): void {
  const { outcome, reason } = decided;
  const now = ctx.clock.now();
  recordDecision(ctx, "excuse", excuse.id, decided, reviewerId, now);
  if (outcome === "approved") {
    const dates = ctx.all<{
      date: LocalDate;
    }>(`SELECT date FROM excuse_day WHERE excuse_id = ?`, excuse.id);
    const { timezone, evidence_kind: evidenceKind } = excusePact(ctx, excuse.id)!;
    const { covering } = occurrencesOf(ctx, excuse.pact_id, timezone);
    for (const { date } of dates) {
      const occurrence = covering(date);
      // The pact Ended before the day fell due: it's never judged.
      if (occurrence === null || dueAfterEnd(ctx, excuse.pact_id, occurrence)) continue;
      const row = ctx.one<{ outcome: string | null }>(
        `SELECT outcome FROM occurrence WHERE pact_id = ? AND date = ?`,
        excuse.pact_id,
        date,
      );
      if (row?.outcome === "missed") {
        ctx.db.prepare(`DELETE FROM penalty WHERE pact_id = ? AND occurrence_date = ?`).run(excuse.pact_id, date);
        ctx.db
          .prepare(`UPDATE occurrence SET outcome = 'excused', judged_at = ? WHERE pact_id = ? AND date = ?`)
          .run(now.toISOString(), excuse.pact_id, date);
      } else if (
        (row?.outcome ?? null) === null &&
        // A bedtime night waits for Oura until it closes: an on-time bedtime beats the excuse.
        evidenceKind !== "oura" &&
        judgingReached(ctx, excuse.pact_id, date, now)
      ) {
        judge(ctx, excuse.pact_id, date, "excused", now);
      }
    }
  }
  const dates = excuseDatesText(ctx, excuse.id);
  ctx.enqueue({
    recipient: excuse.owner_account_id,
    kind: "excuse-decided",
    payload: {
      itemKind: "excuse",
      itemId: excuse.id,
      pactId: excuse.pact_id,
      ...decisionDetails(decided),
      title: `${accountName(ctx, reviewerId)} ${outcome} your excuse`,
      body: `${pactName(ctx, excuse.pact_id)} · ${reason === null ? dates : `“${reason}”`}`,
      // A rejection shows as an alert on Today, where the owner can respond to it.
      url: outcome === "approved" ? APP_PATHS.excuse(excuse.id) : APP_PATHS.today,
    },
  });
}

/** Excuses waiting for approval that `reviewerId` may decide: those for pacts they review. */
export function excusesToReview(ctx: CoreContext, reviewerId: AccountId): ReviewItem[] {
  const rows = ctx.all<ExcuseViewRow & { owner_name: string; recipient_name: string }>(
    `SELECT excuse.id, excuse.reason, excuse.filed_at, pact.id AS pact_id, pact.name AS pact_name,
              owner.name AS owner_name, owner.timezone, recipient.name AS recipient_name
       FROM excuse
       JOIN pact ON pact.id = excuse.pact_id
       JOIN account AS owner ON owner.id = pact.owner_account_id
       JOIN recipient ON recipient.id = pact.recipient_id
       JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
       WHERE excuse.decision IS NULL
       ORDER BY excuse.filed_at, excuse.id`,
    reviewerId,
  );
  return rows.map((row): ReviewItem => {
    const excuse = excuseView(ctx, row);
    return {
      kind: "excuse",
      ...excuse,
      ownerName: row.owner_name,
      heldCents: excuse.days.reduce((sum, { status }) => sum + (status.kind === "missed" ? status.penaltyCents : 0), 0),
      recipientName: row.recipient_name,
      thread: thread(ctx, row.id, true),
    };
  });
}

/** The owner's excuses waiting for a decision (or just those for `pactId`), newest first. */
export function waitingExcuses(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
  const rows = ctx.all<{
    id: string;
    pact_id: string;
    name: string;
    filed_at: string;
    first_date: string;
    last_date: string;
  }>(
    `SELECT excuse.id, excuse.pact_id, pact.name, excuse.filed_at,
              (SELECT MIN(date) FROM excuse_day WHERE excuse_id = excuse.id) AS first_date,
              (SELECT MAX(date) FROM excuse_day WHERE excuse_id = excuse.id) AS last_date
       FROM excuse JOIN pact ON pact.id = excuse.pact_id
       WHERE pact.owner_account_id = ? AND excuse.decision IS NULL AND (? IS NULL OR pact.id = ?)
       ORDER BY excuse.filed_at DESC, excuse.id`,
    ownerId,
    pactId ?? null,
    pactId ?? null,
  );
  return rows.map((row) => ({
    kind: "excuse",
    id: row.id,
    pactId: row.pact_id,
    name: row.name,
    firstDate: row.first_date,
    lastDate: row.last_date,
    filedAt: new Date(row.filed_at),
  }));
}

/**
 * One alert per rejected excuse of the owner's, newest rejection first,
 * until the owner takes the L on it or files a new excuse for any of its
 * days, and while it still covers a day on the schedule. With when it was
 * rejected, for ordering among the alerts.
 */
export function rejectedExcuseAlerts(
  ctx: CoreContext,
  ownerId: AccountId,
  now: Date,
): { at: Date; alert: TodayAlert }[] {
  const rows = ctx.all<{
    id: string;
    pact_id: string;
    reject_reason: string;
    decided_at: string;
    name: string;
    timezone: string;
    reviewer_name: string;
  }>(
    `SELECT excuse.id, excuse.pact_id, excuse.reject_reason, excuse.decided_at, pact.name, owner.timezone,
              reviewer.name AS reviewer_name
       FROM excuse
       JOIN pact ON pact.id = excuse.pact_id
       JOIN account AS owner ON owner.id = pact.owner_account_id
       JOIN account AS reviewer ON reviewer.id = excuse.decided_by_account_id
       WHERE pact.owner_account_id = ? AND excuse.decision = 'rejected' AND excuse.rejection_accepted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM excuse_day AS mine
                         JOIN excuse_day AS other ON other.pact_id = mine.pact_id AND other.date = mine.date
                         JOIN excuse AS later ON later.id = other.excuse_id
                         WHERE mine.excuse_id = excuse.id AND later.filed_at > excuse.filed_at)
       ORDER BY excuse.decided_at DESC, excuse.id`,
    ownerId,
  );
  return rows.flatMap((row) => {
    const days = excuseDays(ctx, row.id, row.pact_id, row.timezone);
    // An approved change took all its days off the schedule: nothing is owed and nothing is left to do.
    if (days.length === 0) return [];
    const { owed } = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(penalty.amount_cents), 0) AS owed FROM excuse_day
         JOIN penalty ON penalty.pact_id = excuse_day.pact_id AND penalty.occurrence_date = excuse_day.date
         WHERE excuse_day.excuse_id = ? AND penalty.added_at <= ?`,
      )
      .get(row.id, row.decided_at) as { owed: number };
    const excusable = days.filter(({ status }) => skipReason(status, now) === null);
    const closing = excusable.flatMap(({ status }) => (status.kind === "missed" ? [status.excusableUntil] : []));
    const closesAt = closing.length === 0 ? null : new Date(Math.min(...closing.map((d) => d.getTime())));
    return [
      {
        at: new Date(row.decided_at),
        alert: {
          kind: "excuse-rejected",
          excuseId: row.id,
          pactId: row.pact_id,
          name: row.name,
          reviewerName: row.reviewer_name,
          reason: row.reject_reason,
          firstDate: days[0]!.date,
          lastDate: days.at(-1)!.date,
          owedAgainCents: owed,
          hasDaysNotJudged: days.some(({ status }) => status.kind === "not-judged"),
          refile: excusable.length === 0 ? null : { closesAt },
        },
      },
    ];
  });
}

/** An excuse as its reviewers and its owner see it, its days as they stand now. */
export function excuseView(ctx: CoreContext, row: ExcuseViewRow): ExcuseView {
  return {
    id: row.id,
    pactId: row.pact_id,
    pactName: row.pact_name,
    reason: row.reason,
    photoIds: excusePhotoIds(ctx, row.id),
    filedAt: new Date(row.filed_at),
    days: excuseDays(ctx, row.id, row.pact_id, row.timezone),
  };
}
