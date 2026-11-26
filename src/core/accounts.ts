// Accounts: signing in, invites, friends, recipients, the timezone, notification
// settings (the daily summary's too) and push subscriptions.

import { randomBytes } from "node:crypto";
import type {
  AcceptInviteResult,
  AccountId,
  AddRecipientResult,
  DailySummarySetting,
  Friend,
  Invite,
  InviteLookup,
  LocalDate,
  NewRecipient,
  NotificationSetting,
  NotificationSettingState,
  PushDevice,
  Recipient,
  SavePushSubscriptionResult,
  SetTimezoneResult,
  SignInResult,
} from "../shared/types.ts";
import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate, pactNamesText } from "../shared/format.ts";
import { billInstant, lastBillDay } from "./bill-math.ts";
import { laterDate, localDateOf, startOfDay } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { notificationSettings } from "./outbox.ts";
import { isPushDevice } from "./push-devices.ts";
import {
  accountName,
  areFriends,
  byName,
  friendshipPair,
  reviewersOf,
  scheduleOf,
  selectRecipients,
  UnknownAccountError,
} from "./rows.ts";
import { nameTooLong } from "./text-limits.ts";

export function signIn(
  ctx: CoreContext,
  operatorEmailKey: string,
  identity: { email: string; name: string },
  options: { inviteToken?: string; timezone?: string },
): SignInResult {
  const existing = accountIdForEmail(ctx, identity.email);
  if (existing !== null) return { ok: true, accountId: existing };

  const key = emailKey(identity.email);
  const isOperator = key === operatorEmailKey && !ctx.db.prepare(`SELECT 1 FROM account WHERE is_operator = 1`).get();
  const invite = options.inviteToken === undefined ? undefined : inviteRow(ctx, options.inviteToken);
  const invited = invite !== undefined && inviteLookup(ctx, invite, null).ok;
  if (!isOperator && !invited) return { ok: false, reason: "invite-required" };

  const id = ctx.newId();
  // The browser's zone; a sign-in that brings none Intl accepts gets UTC, which Profile can change.
  const timezone = (options.timezone === undefined ? null : canonicalTimezone(options.timezone)) ?? "UTC";
  ctx.db
    .prepare(
      `INSERT INTO account (id, email, email_key, name, timezone, is_operator, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, identity.email, key, identity.name, timezone, isOperator ? 1 : 0, ctx.clock.now().toISOString());
  if (invited) {
    ctx.db.prepare(`UPDATE invite SET claimed_by_account_id = ? WHERE token = ?`).run(id, invite.token);
  }
  return { ok: true, accountId: id };
}

export function accountIdForEmail(ctx: CoreContext, email: string): AccountId | null {
  const row = ctx.one<{ id: string }>(`SELECT id FROM account WHERE email_key = ?`, emailKey(email));
  return row?.id ?? null;
}

/**
 * Moves the account to `timezone`. It applies only to the occurrences of
 * the account's pacts that haven't opened: each pact keeps the old timezone
 * for those dated before the day after today there, or today in the new one
 * if that's later (`pact_earlier_timezone`; a second change that day keeps
 * the first one's). Everything else, from reminders to what today is,
 * follows the new one at once; billing goes on from the last Wednesday
 * billed, so no Wednesday is billed twice or skipped.
 */
export function setTimezone(ctx: CoreContext, accountId: AccountId, timezone: string): SetTimezoneResult {
  const zone = canonicalTimezone(timezone);
  if (zone === null) return { ok: false, reason: "invalid-timezone" };
  const account = ctx.one<{ timezone: string; created_at: string; billed_through: string | null }>(
    `SELECT timezone, created_at, billed_through FROM account WHERE id = ?`,
    accountId,
  );
  if (!account) throw new UnknownAccountError(accountId);
  const before = account.timezone;
  if (zone === before) return { ok: true, timezone: zone };
  const now = ctx.clock.now();
  // Every date before `until` keeps the old timezone, every date from it takes the new one, so no
  // date is in both or neither. Today in the old timezone has opened, so it's before. So is today
  // in the new one, after a move east: it hasn't opened in the old timezone, but taking the new
  // one would open it before the move and could make it due already. Every date from `until`
  // opens after the move. After a move east the old today and the next day, in the new timezone,
  // can be open together: the older is the open one until it's due (`openAt`). After a move west
  // the old today may be tomorrow in the new timezone, and stays open in the old one
  // (`lastDayOpened`, rows.ts).
  const until = addDays(laterDate(localDateOf(now, before), localDateOf(now, zone)), 1);
  ctx.db
    .prepare(
      `INSERT INTO pact_earlier_timezone (pact_id, until, timezone)
       SELECT id, ?, ? FROM pact WHERE owner_account_id = ?
         AND NOT EXISTS (SELECT 1 FROM pact_earlier_timezone AS earlier WHERE earlier.pact_id = pact.id AND earlier.until >= ?)`,
    )
    .run(until, before, accountId, until);
  const billedThrough = new Date(account.billed_through ?? account.created_at);
  const lastBilled = billInstant(lastBillDay(billedThrough, before), zone);
  ctx.db
    .prepare(`UPDATE account SET timezone = ?, billed_through = ? WHERE id = ?`)
    .run(zone, lastBilled.toISOString(), accountId);
  tellReviewersOfLaterDueTimes(ctx, accountId, before, zone, until);
  return { ok: true, timezone: zone };
}

/**
 * When an owner's move from `from` to `to` makes due times later from
 * `until` on, tells each reviewer of their affected pacts once, naming only
 * the pacts that reviewer reviews. The shift is read at the start of
 * `until`, the first day in `to`. Affected: Active Camera, Anki and Apple
 * Health pacts whose reviewers have been told of them, with a day from
 * `until` that takes `to`: an Apple Health night is read on the account's
 * timezone, so its in-bed-by time moves with it. Oura Ring nights follow
 * the offset Oura reports. A move that makes due times earlier is stricter
 * and tells nobody.
 */
function tellReviewersOfLaterDueTimes(
  ctx: CoreContext,
  ownerId: AccountId,
  from: string,
  to: string,
  until: LocalDate,
): void {
  const shiftMs = startOfDay(until, to).getTime() - startOfDay(until, from).getTime();
  if (shiftMs <= 0) return;
  const pacts = ctx
    .all<{ id: string; name: string; schedule: string }>(
      `SELECT id, name, schedule FROM pact
       WHERE owner_account_id = ? AND stage = 'active' AND reviewers_notified_at IS NOT NULL
         AND evidence_kind IN ('camera', 'anki', 'apple_health') AND (end_date IS NULL OR end_date >= ?)
       ORDER BY created_at, id`,
      ownerId,
      until,
    )
    .filter((pact) => {
      const schedule = scheduleOf(pact.schedule);
      // A One-time occurrence that has opened keeps its timezone (`occurrencesOverTime`).
      return schedule.kind !== "one-time" || (!schedule.submitAnytime && schedule.deadline >= until);
    });
  const named = new Map<AccountId, string[]>();
  for (const pact of pacts) {
    for (const reviewerId of reviewersOf(ctx, pact.id))
      named.set(reviewerId, [...(named.get(reviewerId) ?? []), pact.name]);
  }
  const hours = Math.round(shiftMs / (30 * 60 * 1000)) / 2;
  const later = `${hours} ${hours === 1 ? "hour" : "hours"} later`;
  const title = `${accountName(ctx, ownerId)} changed their timezone`;
  for (const [recipient, names] of named) {
    ctx.enqueue({
      recipient,
      kind: "timezone-changed",
      payload: {
        ownerId,
        from,
        to,
        title,
        body: `From ${cityOf(from)} to ${cityOf(to)}. From ${formatDate(until)}, ${pactNamesText(names)} ${names.length === 1 ? "is" : "are"} due ${later}.`,
        url: APP_PATHS.review,
      },
    });
  }
}

/** A timezone by its city: "Buenos Aires" for "America/Argentina/Buenos_Aires"; "UTC" stays "UTC". */
function cityOf(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replaceAll("_", " ");
}

export function createInvite(ctx: CoreContext, accountId: AccountId): Invite {
  const token = randomBytes(24).toString("base64url");
  const now = ctx.clock.now();
  const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
  ctx.db
    .prepare(`INSERT INTO invite (token, inviter_account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(token, accountId, now.toISOString(), expiresAt.toISOString());
  return { token, expiresAt };
}

export function invitePage(ctx: CoreContext, accountId: AccountId, token: string): InviteLookup {
  return inviteLookup(ctx, inviteRow(ctx, token), accountId);
}

export function acceptInvite(ctx: CoreContext, accountId: AccountId, token: string): AcceptInviteResult {
  const row = inviteRow(ctx, token);
  if (!row) return { ok: false, reason: "invite-not-found" };
  const lookup = inviteLookup(ctx, row, accountId);
  if (!lookup.ok) return lookup;
  const inviterId = row.inviter_account_id;
  if (inviterId === accountId) return { ok: false, reason: "own-invite" };
  if (areFriends(ctx, accountId, inviterId)) return { ok: false, reason: "already-friends" };

  const now = ctx.clock.now().toISOString();
  ctx.db.prepare(`UPDATE invite SET used_at = ?, used_by_account_id = ? WHERE token = ?`).run(now, accountId, token);
  ctx.db
    .prepare(`INSERT INTO friendship (account_a_id, account_b_id, created_at) VALUES (?, ?, ?)`)
    .run(...friendshipPair(accountId, inviterId), now);
  return { ok: true, friend: { id: inviterId, name: lookup.inviterName } };
}

export function friendList(ctx: CoreContext, accountId: AccountId): Friend[] {
  const friends = ctx.all<Friend>(
    `SELECT account.id, account.name FROM friendship
       JOIN account ON account.id =
         CASE WHEN friendship.account_a_id = ? THEN friendship.account_b_id ELSE friendship.account_a_id END
       WHERE friendship.account_a_id = ? OR friendship.account_b_id = ?`,
    accountId,
    accountId,
    accountId,
  );
  return friends.sort(byName);
}

export function addRecipient(ctx: CoreContext, accountId: AccountId, recipient: NewRecipient): AddRecipientResult {
  const name = recipient.name.trim();
  if (name === "") return { ok: false, reason: "blank-name" };
  if (nameTooLong(name)) return { ok: false, reason: "text-too-long" };
  const id = ctx.newId();
  ctx.db
    .prepare(`INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, accountId, name, ctx.clock.now().toISOString());
  return { ok: true, recipient: { id, name } };
}

export function recipientList(ctx: CoreContext, accountId: AccountId): Recipient[] {
  return selectRecipients(ctx, `owner_account_id = ?`, accountId);
}

export function notificationSettingList(ctx: CoreContext, accountId: AccountId): NotificationSettingState[] {
  return notificationSettings(ctx, accountId);
}

export function setNotificationSetting(
  ctx: CoreContext,
  accountId: AccountId,
  setting: NotificationSetting,
  enabled: boolean,
): NotificationSettingState[] {
  if (enabled) {
    ctx.db.prepare(`DELETE FROM notification_setting_off WHERE account_id = ? AND setting = ?`).run(accountId, setting);
  } else {
    ctx.db
      .prepare(`INSERT INTO notification_setting_off (account_id, setting) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(accountId, setting);
  }
  return notificationSettings(ctx, accountId);
}

export function dailySummarySetting(ctx: CoreContext, accountId: AccountId): DailySummarySetting {
  const row = ctx.one<{ email: string; daily_summary_on_at: string | null }>(
    `SELECT email, daily_summary_on_at FROM account WHERE id = ?`,
    accountId,
  );
  if (!row) throw new UnknownAccountError(accountId);
  return { enabled: row.daily_summary_on_at !== null, to: row.email };
}

/** Turning it on again while on keeps when it was first turned on. */
export function setDailySummary(ctx: CoreContext, accountId: AccountId, enabled: boolean): DailySummarySetting {
  if (enabled) {
    ctx.db
      .prepare(`UPDATE account SET daily_summary_on_at = COALESCE(daily_summary_on_at, ?) WHERE id = ?`)
      .run(ctx.clock.now().toISOString(), accountId);
  } else {
    ctx.db.prepare(`UPDATE account SET daily_summary_on_at = NULL WHERE id = ?`).run(accountId);
  }
  return dailySummarySetting(ctx, accountId);
}

export function savePushSubscription(
  ctx: CoreContext,
  accountId: AccountId,
  device: PushDevice,
): SavePushSubscriptionResult {
  if (!isPushDevice(device)) return { ok: false, reason: "invalid-subscription" };
  ctx.db
    .prepare(
      `INSERT INTO push_subscription (endpoint, account_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE
       SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .run(device.endpoint, accountId, device.p256dh, device.auth, ctx.clock.now().toISOString());
  return { ok: true };
}

export function removePushSubscription(ctx: CoreContext, accountId: AccountId, endpoint: string): void {
  ctx.db.prepare(`DELETE FROM push_subscription WHERE endpoint = ? AND account_id = ?`).run(endpoint, accountId);
}

export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  token: string;
  inviter_account_id: string;
  inviter_name: string;
  expires_at: string;
  used_at: string | null;
  claimed_by_account_id: string | null;
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The IANA zone's canonical name, or null if `timezone` isn't an IANA zone. */
export function canonicalTimezone(timezone: string): string | null {
  // Intl also accepts UTC offsets like "+05:00"; an account needs a real zone.
  if (timezone.trim() === "" || /^[+-]/.test(timezone)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Whether `viewerId` (null: a signed-out visitor) may use the invite `row`.
 * One claimed by another account is as good as used.
 */
export function inviteLookup(ctx: CoreContext, row: InviteRow | undefined, viewerId: AccountId | null): InviteLookup {
  if (!row) return { ok: false, reason: "invite-not-found" };
  if (row.used_at !== null) return { ok: false, reason: "invite-used" };
  const expiresAt = new Date(row.expires_at);
  if (ctx.clock.now().getTime() >= expiresAt.getTime()) return { ok: false, reason: "invite-expired" };
  const claimedBy = row.claimed_by_account_id;
  if (claimedBy !== null && claimedBy !== viewerId) return { ok: false, reason: "invite-used" };
  return { ok: true, inviterName: row.inviter_name, expiresAt };
}

export function inviteRow(ctx: CoreContext, token: string): InviteRow | undefined {
  return ctx.one<InviteRow>(
    `SELECT invite.token, invite.inviter_account_id, account.name AS inviter_name, invite.expires_at,
              invite.used_at, invite.claimed_by_account_id
       FROM invite JOIN account ON account.id = invite.inviter_account_id
       WHERE invite.token = ?`,
    token,
  );
}
