// The outbox: notifications a command queues in its transaction, and their
// delivery once it has committed.

import {
  NOTIFICATION_SETTINGS,
  type AccountId,
  type NotificationSetting,
  type NotificationSettingState,
  type PushDevice,
} from "../shared/types.ts";
import type { CoreContext } from "./context.ts";
import type { Notification, NotificationKind, NotificationOf, Notifier } from "./ports.ts";

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
  "new-bill": "new-bill",
  "overdue-bill": "overdue-bill",
  "connection-problem": "connection-problem",
  reminder: null,
};

interface OutboxRow {
  id: number;
  recipient_account_id: string;
  kind: string;
  payload: string;
  sent_to: string;
}

/** Queues a notification in the current command's transaction. */
export function enqueue<K extends NotificationKind>(ctx: CoreContext, notification: NotificationOf<K>): void {
  if (!ctx.db.inTransaction) throw new Error("notifications are enqueued only inside a command");
  const setting = SETTING_OF_KIND[notification.kind];
  if (setting !== null && settingIsOff(ctx, notification.recipient, setting)) return;
  // Push is the only channel; the column stays from the first migration.
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

export async function deliverPending(ctx: CoreContext, notifier: Notifier): Promise<void> {
  const rows = ctx.all<OutboxRow>(`SELECT id, recipient_account_id, kind, payload, sent_to
       FROM outbox WHERE delivered_at IS NULL ORDER BY id`);
  for (const row of rows) {
    // Stored by `enqueue`, so the kind and its payload match.
    const notification = {
      recipient: row.recipient_account_id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as unknown,
    } as Notification;
    try {
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
