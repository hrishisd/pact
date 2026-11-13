// Stale-item reminders (R2): no review item decides itself, so the people who
// can move one are pushed once a day while it waits. A reviewer while an item
// in their Review Queue has waited more than 24 hours; an owner while a
// reviewer's question to them has gone unanswered that long. Both at 09:00 in
// the recipient's timezone. The daily summary, for those who turn it on, is
// one email at the same moment listing all of both.

import { APP_PATHS } from "../shared/api.ts";
import { addDays, dayCount } from "../shared/calendar.ts";
import { dateSpan } from "../shared/format.ts";
import type { AccountId, ReviewItem, TodayAlert, TodayWaitingItem } from "../shared/types.ts";
import { localDateOf, wallTime } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { enqueueEmail } from "./outbox.ts";
import type { QueuedItem } from "./requests.ts";
import { describeItem, reviewQueueWaits } from "./review.ts";
import { summaryEmail, type SummaryLine } from "./summary-email.ts";
import { questionAlerts } from "./today.ts";

/** A reviewer's question the owner hasn't answered, as Today's alert has it. */
type Question = Extract<TodayAlert, { kind: "reviewer-question" }>;

/** How long an item waits, or a question goes unanswered, before its daily reminder starts. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** The local hour the daily reminders go at. */
const REMINDER_HOUR = 9;

/**
 * For each account at `t`, once the day's 09:00 in its timezone has passed,
 * if an item in its Review Queue had waited more than 24 hours by then, or a
 * reviewer's question to it had gone unanswered that long: pushes the
 * reviewer reminder, pushes the owner reminder, and with the daily summary
 * on, queues the email listing both. At most one of each a local day,
 * restart or timezone change or not (`stale_notice`). Links in the email start with `appUrl`.
 */
export function remindStale(ctx: CoreContext, t: Date, appUrl: string): void {
  const accounts = ctx.all<{ id: AccountId; email: string; timezone: string; daily_summary_on_at: string | null }>(
    `SELECT id, email, timezone, daily_summary_on_at FROM account ORDER BY id`,
  );
  for (const { id, email, timezone, daily_summary_on_at } of accounts) {
    const nine = latestReminderTime(t, timezone);
    const notice = staleNotice(ctx, id);
    // By local date, not instant: a move to a timezone further west can't bring a second one the same day.
    const today = localDateOf(nine, timezone);
    const notYet = (at: Date | null) => at === null || localDateOf(at, timezone) < today;
    const due = {
      reviewer: notYet(notice.reviewerRemindedAt),
      owner: notYet(notice.ownerRemindedAt),
      // The first goes at the first 09:00 after it was turned on.
      summary: daily_summary_on_at !== null && new Date(daily_summary_on_at) < nine && notYet(notice.summarySentAt),
    };
    if (!due.reviewer && !due.owner && !due.summary) continue;
    const staleBefore = new Date(nine.getTime() - STALE_AFTER_MS);
    // Each list only when something due needs it: until one goes, this runs every tick.
    const queue =
      due.reviewer || due.summary
        ? reviewQueueWaits(ctx, id).sort((a, b) => a.since.getTime() - b.since.getTime())
        : [];
    const waiting = queue.filter((entry) => entry.since < staleBefore);
    const questions =
      due.owner || due.summary
        ? questionAlerts(ctx, id)
            .flatMap(({ alert }) => (alert.kind === "reviewer-question" && alert.askedAt < staleBefore ? [alert] : []))
            .sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime())
        : [];
    const sent = {
      reviewer: due.reviewer && waiting.length > 0,
      owner: due.owner && questions.length > 0,
      summary: due.summary && (waiting.length > 0 || questions.length > 0),
    };
    if (sent.reviewer) remindReviewer(ctx, id, timezone, t, queue);
    if (sent.owner) remindOwner(ctx, id, timezone, t, questions[0]!);
    if (sent.summary) {
      const lines = summaryLines(timezone, t, waiting, questions);
      enqueueEmail(ctx, id, "daily-summary", summaryEmail(email, appUrl, lines));
    }
    if (!sent.reviewer && !sent.owner && !sent.summary) continue;
    const at = (now: boolean, before: Date | null) => (now ? t.toISOString() : (before?.toISOString() ?? null));
    ctx.db
      .prepare(
        `INSERT INTO stale_notice (account_id, reviewer_reminded_at, owner_reminded_at, summary_sent_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE
         SET reviewer_reminded_at = excluded.reviewer_reminded_at, owner_reminded_at = excluded.owner_reminded_at,
             summary_sent_at = excluded.summary_sent_at`,
      )
      .run(
        id,
        at(sent.reviewer, notice.reviewerRemindedAt),
        at(sent.owner, notice.ownerRemindedAt),
        at(sent.summary, notice.summarySentAt),
      );
  }
}

/** Pushes the reviewer's reminder about their Review Queue, `queue`, oldest first: its count and its oldest. */
function remindReviewer(ctx: CoreContext, reviewerId: AccountId, timezone: string, t: Date, queue: QueuedItem[]): void {
  const oldest = queue[0]!;
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
}

/** Pushes the owner's reminder about the oldest reviewer's question to them they haven't answered. */
function remindOwner(ctx: CoreContext, ownerId: AccountId, timezone: string, t: Date, oldest: Question): void {
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
}

/**
 * The daily summary's lines: who, what the item is, and the pact (a
 * payment's recipient, a vacation's dates), with no free text.
 */
function summaryLines(
  timezone: string,
  t: Date,
  waiting: QueuedItem[],
  questions: Question[],
): { waiting: SummaryLine[]; questions: SummaryLine[] } {
  return {
    waiting: waiting.map(({ item, since }) => ({
      title: `${item.ownerName}'s ${ITEM_NAMES[item.kind]}`,
      about: aboutText(item),
      age: `waited ${daysText(since, t, timezone)}`,
    })),
    questions: questions.map(({ item, reviewerName, askedAt }) => ({
      title: `${reviewerName} asked about your ${ITEM_NAMES[item.kind]}`,
      about: aboutText(item),
      age: `asked ${daysText(askedAt, t, timezone)} ago`,
    })),
  };
}

/** What a review item is, in a daily summary. */
const ITEM_NAMES: Record<ReviewItem["kind"], string> = {
  evidence: "evidence",
  excuse: "excuse",
  payment: "payment",
  "change-request": "change request",
  vacation: "vacation",
};

/** What an item is about, in a daily summary: its pact, a payment's recipient, or a vacation's dates. */
function aboutText(item: ReviewItem | TodayWaitingItem): string {
  switch (item.kind) {
    case "payment":
      return `To ${item.recipientName}`;
    case "vacation":
      return "from" in item ? dateSpan(item.from, item.to) : dateSpan(item.firstDate, item.lastDate);
    default:
      return "pactName" in item ? item.pactName : item.name;
  }
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

/** When the account was last sent each stale-item reminder and the daily summary, or null if never. */
function staleNotice(
  ctx: CoreContext,
  accountId: AccountId,
): { reviewerRemindedAt: Date | null; ownerRemindedAt: Date | null; summarySentAt: Date | null } {
  const row = ctx.one<{
    reviewer_reminded_at: string | null;
    owner_reminded_at: string | null;
    summary_sent_at: string | null;
  }>(
    `SELECT reviewer_reminded_at, owner_reminded_at, summary_sent_at FROM stale_notice WHERE account_id = ?`,
    accountId,
  );
  const date = (at: string | null | undefined) => (at ? new Date(at) : null);
  return {
    reviewerRemindedAt: date(row?.reviewer_reminded_at),
    ownerRemindedAt: date(row?.owner_reminded_at),
    summarySentAt: date(row?.summary_sent_at),
  };
}
