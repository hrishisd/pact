// The outbox: notifications a command queues in its transaction, and their
// delivery once it has committed. A row goes by one channel: a push to the
// account's devices, delivered after every command, or an email (the daily
// summary), delivered apart from the pushes and only from the scheduler's
// tick, so a slow mail server never holds up a push.

import { APP_PATHS } from "../shared/api.ts";
import { formatDate } from "../shared/format.ts";
import {
  NOTIFICATION_SETTINGS,
  type AccountId,
  type NotificationSetting,
  type NotificationSettingState,
  type PushDevice,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import type { Email, Mailer, Notification, NotificationKind, NotificationOf, Notifier } from "./ports.ts";

/**
 * Which setting turns a kind of notification off. Operator alerts can't be,
 * and reminders are set on each pact instead.
 */
const SETTING_OF_KIND: Record<NotificationKind, NotificationSetting | null> = {
  "operator-alert": null,
  "picked-as-reviewer": "picked-as-reviewer",
  "review-item": "review-item",
  "evidence-decided": "decision",
  "payment-decided": "decision",
  "missed-occurrence": "missed-occurrence",
  "excuse-decided": "decision",
  "change-request-decided": "decision",
  "vacation-decided": "decision",
  "reviewer-question": "comment",
  "owner-replied": "comment",
  "stale-review-items": "review-item",
  "unanswered-question": "comment",
  "new-bill": "new-bill",
  "overdue-bill": "overdue-bill",
  "connection-problem": "connection-problem",
  "timezone-changed": "reviewed-pact",
  "reviewer-added": "reviewed-pact",
  reminder: null,
};

interface OutboxRow {
  id: number;
  recipient_account_id: string;
  kind: string;
  payload: string;
  sent_to: string;
}

/** What is emailed through the outbox. Operator alert emails skip it (operator-alerts.ts). */
type EmailKind = "daily-summary";

/** How long a failing email is retried, from when it was queued, before it's given up. */
const EMAIL_GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** Queues a notification in the current command's transaction. */
export function enqueue<K extends NotificationKind>(ctx: CoreContext, notification: NotificationOf<K>): void {
  if (!ctx.db.inTransaction) throw new Error("notifications are enqueued only inside a command");
  const setting = SETTING_OF_KIND[notification.kind];
  if (setting !== null && settingIsOff(ctx, notification.recipient, setting)) return;
  ctx.db
    .prepare(
      `INSERT INTO outbox (recipient_account_id, kind, channel, payload, created_at)
       VALUES (?, ?, 'push', ?, ?)`,
    )
    .run(
      notification.recipient,
      notification.kind,
      JSON.stringify(notification.payload),
      ctx.clock.now().toISOString(),
    );
}

/** Queues an email to `recipient` in the current command's transaction. No push setting turns it off. */
export function enqueueEmail(ctx: CoreContext, recipient: AccountId, kind: EmailKind, email: Email): void {
  if (!ctx.db.inTransaction) throw new Error("emails are enqueued only inside a command");
  ctx.db
    .prepare(
      `INSERT INTO outbox (recipient_account_id, kind, channel, payload, created_at)
       VALUES (?, ?, 'email', ?, ?)`,
    )
    .run(recipient, kind, JSON.stringify(email), ctx.clock.now().toISOString());
}

/** An email given up after failing for 24 hours. */
export interface GivenUpEmail {
  to: string;
  recipient: { name: string; timezone: string };
  queuedAt: Date;
  lastError: string | null;
}

/**
 * Gives up each email not delivered 24 hours after it was queued, as of
 * `t`, unless it's being sent right now: it's never tried again. Returns
 * them, for the operator alert.
 */
export function giveUpEmails(ctx: CoreContext, t: Date): GivenUpEmail[] {
  const rows = ctx.all<{
    id: number;
    payload: string;
    created_at: string;
    last_error: string | null;
    name: string;
    timezone: string;
  }>(
    `SELECT outbox.id, outbox.payload, outbox.created_at, outbox.last_error, account.name, account.timezone
     FROM outbox JOIN account ON account.id = outbox.recipient_account_id
     WHERE outbox.channel = 'email' AND outbox.delivered_at IS NULL AND outbox.given_up_at IS NULL
       AND outbox.sending = 0 AND outbox.created_at <= ?
     ORDER BY outbox.id`,
    emailCutoff(t),
  );
  return rows.map((row) => {
    ctx.db.prepare(`UPDATE outbox SET given_up_at = ? WHERE id = ?`).run(t.toISOString(), row.id);
    return {
      // Stored by `enqueueEmail`.
      to: (JSON.parse(row.payload) as Email).to,
      recipient: { name: row.name, timezone: row.timezone },
      queuedAt: new Date(row.created_at),
      lastError: row.last_error,
    };
  });
}

/**
 * The operator alert for each email given up: pushed to the operator's
 * account in this transaction. Returns the log line's words for each, with
 * the last error, which go once it commits. Not by email, since email is
 * what failed.
 */
export function alertGivenUpEmails(ctx: CoreContext, givenUp: GivenUpEmail[]): string[] {
  const operator = ctx.one<{ id: AccountId }>(`SELECT id FROM account WHERE is_operator = 1`);
  return givenUp.map((email) => {
    const date = formatDate(localDateOf(email.queuedAt, email.recipient.timezone));
    const text = `The Pact Daily Summary for ${date} to ${email.recipient.name} (${email.to}) failed for 24 hours and was given up.`;
    if (operator) {
      ctx.enqueue({
        recipient: operator.id,
        kind: "operator-alert",
        payload: { alert: "email-given-up", to: email.to, title: "Operator alert", body: text, url: APP_PATHS.today },
      });
    }
    return `${text} Last error: ${email.lastError ?? "none"}`;
  });
}

/** An email queued at or before this, as of `t`, is too old to send: it's given up. */
function emailCutoff(t: Date): string {
  return new Date(t.getTime() - EMAIL_GIVE_UP_MS).toISOString();
}

/**
 * Sends each email waiting, oldest first. Each is claimed just before its
 * send, and only while it's still within its 24 hours and not given up, so a
 * row is delivered or given up, never both. A failed one waits for the
 * next tick's pass.
 */
export async function deliverEmails(ctx: CoreContext, mailer: Mailer): Promise<void> {
  const waiting = ctx.all<{ id: number }>(
    `SELECT id FROM outbox WHERE channel = 'email' AND delivered_at IS NULL AND given_up_at IS NULL ORDER BY id`,
  );
  for (const { id } of waiting) {
    const claimed = ctx.one<{ kind: EmailKind; recipient_account_id: string; payload: string }>(
      `UPDATE outbox SET sending = 1
       WHERE id = ? AND delivered_at IS NULL AND given_up_at IS NULL AND sending = 0 AND created_at > ?
       RETURNING kind, recipient_account_id, payload`,
      id,
      emailCutoff(ctx.clock.now()),
    );
    if (!claimed) continue;
    try {
      // Stored by `enqueueEmail`.
      await mailer.send(JSON.parse(claimed.payload) as Email);
      ctx.db
        .prepare(`UPDATE outbox SET delivered_at = ?, sending = 0, attempts = attempts + 1 WHERE id = ?`)
        .run(ctx.clock.now().toISOString(), id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.db
        .prepare(`UPDATE outbox SET sending = 0, attempts = attempts + 1, last_error = ? WHERE id = ?`)
        .run(message, id);
      ctx.log(
        `email ${id} (${claimed.kind} to ${claimed.recipient_account_id}) not sent, will retry next tick: ${message}`,
      );
    }
  }
}

/** No email is being sent when the core starts: a claim left by a stop mid-send is let go. */
export function releaseEmailClaims(ctx: CoreContext): void {
  ctx.db.prepare(`UPDATE outbox SET sending = 0 WHERE sending = 1`).run();
}

/** Queues the same notification to each of `recipients`. */
export function tellAll<K extends NotificationKind>(
  ctx: CoreContext,
  recipients: readonly AccountId[],
  kind: K,
  payload: NotificationOf<K>["payload"],
): void {
  for (const recipient of recipients) ctx.enqueue({ recipient, kind, payload });
}

export function settingIsOff(ctx: CoreContext, accountId: AccountId, setting: NotificationSetting): boolean {
  return (
    ctx.db
      .prepare(`SELECT 1 FROM notification_setting_off WHERE account_id = ? AND setting = ?`)
      .get(accountId, setting) !== undefined
  );
}

export function notificationSettings(ctx: CoreContext, accountId: AccountId): NotificationSettingState[] {
  return NOTIFICATION_SETTINGS.map((setting) => ({ setting, enabled: !settingIsOff(ctx, accountId, setting) }));
}

/** Delivers each push waiting, oldest first. Emails go apart (`deliverEmails`). */
export async function deliverPending(ctx: CoreContext, notifier: Notifier): Promise<void> {
  const rows = ctx.all<OutboxRow>(`SELECT id, recipient_account_id, kind, payload, sent_to
       FROM outbox WHERE channel = 'push' AND delivered_at IS NULL ORDER BY id`);
  for (const row of rows) {
    try {
      // Stored by `enqueue`, so the kind and its payload match.
      const notification = {
        recipient: row.recipient_account_id,
        kind: row.kind,
        payload: JSON.parse(row.payload) as unknown,
      } as Notification;
      const devices = ctx.all<PushDevice>(
        `SELECT endpoint, p256dh, auth FROM push_subscription WHERE account_id = ? ORDER BY endpoint`,
        row.recipient_account_id,
      );
      const sentTo = JSON.parse(row.sent_to) as string[];
      const toSend = devices.filter((device) => !sentTo.includes(device.endpoint));
      const { expired, failed } = await notifier.deliver(notification, toSend);
      for (const endpoint of expired) {
        ctx.db.prepare(`DELETE FROM push_subscription WHERE endpoint = ?`).run(endpoint);
      }
      if (failed.length > 0) {
        const unreached = new Set([...expired, ...failed.map((f) => f.endpoint)]);
        const reached = toSend.map((device) => device.endpoint).filter((endpoint) => !unreached.has(endpoint));
        ctx.db
          .prepare(`UPDATE outbox SET sent_to = ? WHERE id = ?`)
          .run(JSON.stringify([...sentTo, ...reached]), row.id);
        throw new Error(failed.map((f) => f.error).join("; "));
      }
      ctx.db
        .prepare(`UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?`)
        .run(ctx.clock.now().toISOString(), row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.db.prepare(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(message, row.id);
      ctx.log(
        `notification ${row.id} (${row.kind} to ${row.recipient_account_id}) not delivered, will retry: ${message}`,
      );
    }
  }
}
