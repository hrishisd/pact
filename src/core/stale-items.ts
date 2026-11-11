// Stale-item reminders (R2): no review item decides itself, so the people who
// can move one are pushed once a day while it waits. A reviewer while an item
// in their Review Queue has waited more than 24 hours; an owner while a
// reviewer's question to them has gone unanswered that long. Both at 09:00 in
// the recipient's timezone.

import { APP_PATHS } from "../shared/api.ts";
import { addDays, dayCount } from "../shared/calendar.ts";
import type { AccountId } from "../shared/types.ts";
import { localDateOf, wallTime } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { describeItem, reviewQueueWaits } from "./review.ts";
import { questionAlerts } from "./today.ts";

/** How long an item waits, or a question goes unanswered, before its daily reminder starts. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** The local hour the daily reminders go at. */
const REMINDER_HOUR = 9;

/**
 * For each account at `t`, once the day's 09:00 in its timezone has passed:
 * pushes the reviewer reminder if an item in its Review Queue had waited more
 * than 24 hours by then, and the owner reminder if a reviewer's question to
 * it had gone unanswered that long. At most one of each since that 09:00,
 * restart or not (`stale_notice`).
 */
export function remindStale(ctx: CoreContext, t: Date): void {
  const accounts = ctx.all<{ id: AccountId; timezone: string }>(`SELECT id, timezone FROM account ORDER BY id`);
  for (const { id, timezone } of accounts) {
    const nine = latestReminderTime(t, timezone);
    const staleBefore = new Date(nine.getTime() - STALE_AFTER_MS);
    const notice = staleNotice(ctx, id);
    const notYet = (at: Date | null) => at === null || at < nine;
    const reviewer = notYet(notice.reviewerRemindedAt) && remindReviewer(ctx, id, timezone, t, staleBefore);
    const owner = notYet(notice.ownerRemindedAt) && remindOwner(ctx, id, timezone, t, staleBefore);
    if (!reviewer && !owner) continue;
    ctx.db
      .prepare(
        `INSERT INTO stale_notice (account_id, reviewer_reminded_at, owner_reminded_at) VALUES (?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE
         SET reviewer_reminded_at = excluded.reviewer_reminded_at, owner_reminded_at = excluded.owner_reminded_at`,
      )
      .run(
        id,
        reviewer ? t.toISOString() : (notice.reviewerRemindedAt?.toISOString() ?? null),
        owner ? t.toISOString() : (notice.ownerRemindedAt?.toISOString() ?? null),
      );
  }
}

/** Pushes the reviewer's reminder if an item in their queue came to them before `staleBefore`; whether it did. */
function remindReviewer(
  ctx: CoreContext,
  reviewerId: AccountId,
  timezone: string,
  t: Date,
  staleBefore: Date,
): boolean {
  const queue = reviewQueueWaits(ctx, reviewerId);
  const oldest = queue.reduce<(typeof queue)[number] | undefined>(
    (older, entry) => (older === undefined || entry.since < older.since ? entry : older),
    undefined,
  );
  if (!oldest || oldest.since >= staleBefore) return false;
  const { what } = describeItem(ctx, oldest.item.id);
  ctx.enqueue({
    recipient: reviewerId,
    kind: "stale-review-items",
    payload: {
      count: queue.length,
      oldestItemKind: oldest.item.kind,
      oldestItemId: oldest.item.id,
      title: queue.length === 1 ? "1 item waits for your review" : `${queue.length} items wait for your review`,
      body: `The oldest, ${oldest.item.ownerName}'s ${what}, has waited ${daysText(oldest.since, t, timezone)}.`,
      url: APP_PATHS.review,
    },
  });
  return true;
}

/** Pushes the owner's reminder if a reviewer's question to them was asked before `staleBefore`; whether it did. */
function remindOwner(ctx: CoreContext, ownerId: AccountId, timezone: string, t: Date, staleBefore: Date): boolean {
  const questions = questionAlerts(ctx, ownerId).flatMap(({ alert }) =>
    alert.kind === "reviewer-question" ? [alert] : [],
  );
  const oldest = questions.reduce<(typeof questions)[number] | undefined>(
    (older, question) => (older === undefined || question.askedAt < older.askedAt ? question : older),
    undefined,
  );
  if (!oldest || oldest.askedAt >= staleBefore) return false;
  const { what, ownerPath } = describeItem(ctx, oldest.item.id);
  ctx.enqueue({
    recipient: ownerId,
    kind: "unanswered-question",
    payload: {
      itemKind: oldest.item.kind,
      itemId: oldest.item.id,
      title: `${oldest.reviewerName} asked about your ${what} ${daysText(oldest.askedAt, t, timezone)} ago`,
      body: "Reply so they can decide.",
      url: ownerPath,
    },
  });
  return true;
}

/** The latest 09:00 in `timezone` at or before `t`. */
function latestReminderTime(t: Date, timezone: string): Date {
  const today = localDateOf(t, timezone);
  const nine = wallTime(today, REMINDER_HOUR, 0, timezone);
  return nine <= t ? nine : wallTime(addDays(today, -1), REMINDER_HOUR, 0, timezone);
}

/** How many calendar days in `timezone` run from `since` to `t`: "2 days". */
function daysText(since: Date, t: Date, timezone: string): string {
  const days = dayCount(localDateOf(since, timezone), localDateOf(t, timezone)) - 1;
  return days === 1 ? "1 day" : `${days} days`;
}

/** When the account was last sent each stale-item reminder, or null if never. */
function staleNotice(
  ctx: CoreContext,
  accountId: AccountId,
): { reviewerRemindedAt: Date | null; ownerRemindedAt: Date | null } {
  const row = ctx.one<{ reviewer_reminded_at: string | null; owner_reminded_at: string | null }>(
    `SELECT reviewer_reminded_at, owner_reminded_at FROM stale_notice WHERE account_id = ?`,
    accountId,
  );
  const date = (at: string | null | undefined) => (at ? new Date(at) : null);
  return { reviewerRemindedAt: date(row?.reviewer_reminded_at), ownerRemindedAt: date(row?.owner_reminded_at) };
}
