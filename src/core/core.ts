// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { createECDH, randomBytes, randomUUID } from "node:crypto";
import type { LocalDate } from "./calendar.ts";
import { openDatabase, type Db } from "./db.ts";
import { newOccurrenceTerms, occurrences, type Occurrence, type OccurrenceTerms } from "./occurrences.ts";
import type { Clock, Notification, NotificationKind, Notifier, OuraSource, Photo, PhotoStore } from "./ports.ts";
import { APP_PATHS } from "../shared/api.ts";
import { formatDate, money } from "../shared/format.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  NOTIFICATION_SETTINGS,
  type AcceptInviteResult,
  type AcceptMissResult,
  type AccountId,
  type AddRecipientResult,
  type CreatePactResult,
  type DecideResult,
  type EvidenceRejection,
  type FirstOccurrenceResult,
  type Friend,
  type Health,
  type Invite,
  type InviteLookup,
  type LedgerEntry,
  type LedgerPayment,
  type LedgerPaymentState,
  type LedgerPenalty,
  type LedgerResult,
  type LedgerSummary,
  type NewPact,
  type NewRecipient,
  type NotificationSetting,
  type NotificationSettingState,
  type PactSummary,
  type PactResult,
  type PactTerms,
  type Recipient,
  type NewPayment,
  type Profile,
  type PushDevice,
  type RecordPaymentRefusal,
  type RecordPaymentResult,
  type ReviewDecision,
  type ReviewItem,
  type SavePushSubscriptionResult,
  type Schedule,
  type SetTimezoneResult,
  type SignInResult,
  type SubmitEvidenceRefusal,
  type SubmitEvidenceResult,
  type Today,
  type TodayAlert,
  type TodayComingUpCard,
  type TodayMissedCard,
  type TodaySection,
  type TodayToDoCard,
  type TodayWaitingItem,
} from "../shared/types.ts";

export interface PactCoreOptions {
  /** SQLite file. Production: on the /data volume. */
  dbPath: string;
  clock: Clock;
  notifier: Notifier;
  ouraSource: OuraSource;
  photoStore: PhotoStore;
  /** The operator's email; their first sign-in may create an account without an invite. */
  operatorEmail: string;
  /** Where the core writes log lines (including OPERATOR_ALERT). Default: console.log. */
  log?: (line: string) => void;
}

export interface PactCore {
  /**
   * Idempotent. An existing account always signs in. A new identity gets an
   * account on the operator's first sign-in, or with a usable invite token,
   * which the new account then claims: no one else can sign in with it or
   * accept it. Signing in doesn't use the invite up (accepting it does).
   */
  signIn(identity: { email: string; name: string }, options?: { inviteToken?: string }): Promise<SignInResult>;
  /** The invite page's view of `token` for a signed-out visitor: a claimed invite shows as used. */
  invite(token: string): InviteLookup;
  /** The account signed in with `email` (whatever its case), or null if there is none. Never writes. */
  accountIdForEmail(email: string): AccountId | null;
  /** Commands and queries made as one account. */
  as(accountId: AccountId): AccountView;
  /**
   * Runs everything due by `t`, records the tick, then delivers the outbox.
   * Judges every occurrence due by `t` that isn't judged yet, catching up on
   * any it missed while stopped: approved evidence makes it Kept; evidence
   * still waiting leaves it for the decision; none makes it Missed and adds
   * the pact's penalty to the owner's ledger for its recipient. (Rejected
   * evidence already judged it.) Each is judged as of its due time. Running
   * it again for the same `t` changes nothing.
   */
  advanceTo(t: Date): Promise<void>;
  lastTick(): Date | null;
  /** Not ok when there's no tick in the last 5 minutes by the clock. */
  health(): Health;
  /** How many migrations this database has applied. */
  schemaVersion(): number;
  /** After a restore from backup: tells the operator how old the restored data is. */
  raiseRestoreAlert(): Promise<void>;
  /** Waits for the outbox deliveries started so far. Commands don't; the scheduler's tick and tests do. */
  deliveriesSettled(): Promise<void>;
  /** Waits for any delivery in progress, then closes the database. */
  close(): Promise<void>;
}

export interface AccountView {
  setTimezone(timezone: string): Promise<SetTimezoneResult>;
  /** A single-use invite link that expires 7 days from now. */
  createInvite(): Promise<Invite>;
  /** The invite page's view of `token` for this account: open to it if it claimed the invite. */
  invite(token: string): InviteLookup;
  /** Makes this account and the inviter friends and uses the invite up. A refusal changes nothing. */
  acceptInvite(token: string): Promise<AcceptInviteResult>;
  /** Sorted by name. */
  friends(): Friend[];
  /** Saves a recipient (a name, trimmed) to this owner's list. Names may repeat. */
  addRecipient(recipient: NewRecipient): Promise<AddRecipientResult>;
  /** This owner's saved recipients, sorted by name. */
  recipients(): Recipient[];
  /** Makes a pact, Active at once. A refusal writes nothing. */
  createPact(pact: NewPact): Promise<CreatePactResult>;
  /**
   * The first occurrence a pact with `schedule` would have if created now:
   * what the create form's Check step names. Same rule as `createPact`.
   */
  firstOccurrence(schedule: Schedule): FirstOccurrenceResult;
  /** This owner's Active pacts, for the Pacts tab, sorted by name. */
  pacts(): PactSummary[];
  /** The pact page's terms. Someone else's pact, or none, is not found. */
  pact(pactId: string): PactResult;
  profile(): Profile;
  today(): Today;
  /**
   * The owner submits photo evidence for the occurrence of `pactId` open now.
   * Accepted only while that occurrence is open when the server has received
   * every photo, so there's no backfilling. The pact's reviewers get a review
   * item. A refusal writes nothing (photos already stored stay unused).
   */
  submitEvidence(pactId: string, photos: Photo[]): Promise<SubmitEvidenceResult>;
  /**
   * The owner accepts a Missed occurrence of `pactId` (Take the L), dated
   * `occurrenceDate` ("YYYY-MM-DD" in the owner's timezone). It only takes
   * the occurrence off Today: its rejected-evidence alert, or its Missed card.
   * The ledger doesn't change. A refusal changes nothing.
   */
  acceptMiss(pactId: string, occurrenceDate: string): Promise<AcceptMissResult>;
  /**
   * A photo of some evidence, for the pact's owner or one of its reviewers;
   * anyone else is told it isn't found. A query: async only because the photo
   * store is, and it never writes.
   */
  photo(photoId: string): Promise<PhotoResult>;
  /**
   * Items waiting for this account's decision as a reviewer: evidence for
   * pacts it reviews, and payments to a recipient of any pact it reviews.
   * Oldest first, by when the evidence was submitted or the payment recorded.
   */
  reviewQueue(): ReviewItem[];
  /**
   * A reviewer decides an item in their queue: evidence by a reviewer of its
   * pact, a payment by a reviewer of any of the owner's pacts with its
   * recipient. The first decision is final: the item leaves every reviewer's
   * queue and the owner is told. A refusal changes nothing. An approved
   * payment lowers owed and raises lifetime paid; a rejected one changes
   * neither. For evidence, a rejection is final: it judges the occurrence Missed
   * there and then, with its penalty, whether it's still open or past its
   * due time, and it takes no more evidence. An approval after the due time
   * judges it Kept there and then; before it, judging at the due time does.
   */
  decide(itemId: string, decision: ReviewDecision): Promise<DecideResult>;
  /**
   * The owner records a payment they made to one of their recipients outside
   * the app, with one screenshot of it. It waits for a reviewer of any of the
   * owner's pacts with that recipient, and each of them gets a review item.
   * Refused if it's more than owed less payments already awaiting approval,
   * so the ledger never goes below zero. A refusal writes nothing (a
   * screenshot already stored stays unused).
   */
  recordPayment(payment: NewPayment, screenshot: Photo | null): Promise<RecordPaymentResult>;
  /** One ledger per recipient this owner's pacts name, sorted by name. */
  ledgers(): LedgerSummary[];
  /**
   * One of this owner's ledgers with its penalties, newest first. Another
   * owner's recipient, or none, is not found.
   */
  ledger(recipientId: string): LedgerResult;
  /** This account's notification settings, in display order. */
  notificationSettings(): NotificationSettingState[];
  /** Off, that kind records nothing for this account until it's turned back on. */
  setNotificationSetting(setting: NotificationSetting, enabled: boolean): Promise<NotificationSettingState[]>;
  /**
   * Notifications for this account go to this device too, from now on. Only
   * the known push services are accepted, since the server sends to whatever
   * is saved here. A device another account saved moves to this one.
   */
  savePushSubscription(device: PushDevice): Promise<SavePushSubscriptionResult>;
  /** Stops sending to this device, if it's this account's. */
  removePushSubscription(endpoint: string): Promise<void>;
}

export type PhotoResult = { ok: true; photo: Photo } | { ok: false; reason: "photo-not-found" };

export function createPactCore(options: PactCoreOptions): PactCore {
  const db = openDatabase(options.dbPath);
  return new Core(db, options);
}

/** Which setting turns a kind of notification off. Operator alerts can't be. */
const SETTING_OF_KIND: Record<NotificationKind, NotificationSetting | null> = {
  "operator-alert": null,
  "review-item": "review-item",
  "evidence-decided": "decision",
  "payment-decided": "decision",
  "missed-occurrence": "missed-occurrence",
};
/** The push services browsers use, as domains; a saved endpoint must be on one of them. */
const PUSH_SERVICE_DOMAINS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** A Missed occurrence stays on Today this long after it's judged. */
const TODAY_MISSED_MS = 48 * 60 * 60 * 1000;
/**
 * SQL: who reviews payments from `owner` to `recipient` (SQL expressions):
 * the reviewers of any of the owner's pacts with that recipient, with repeats.
 */
function paymentReviewersSql(owner: string, recipient: string): string {
  return `SELECT pact_reviewer.reviewer_account_id FROM pact_reviewer
    JOIN pact ON pact.id = pact_reviewer.pact_id
    WHERE pact.owner_account_id = ${owner} AND pact.recipient_id = ${recipient}`;
}
/** SQL: the account bound to the one `?` may decide the `payment` row: they review it. */
const MAY_DECIDE_PAYMENT = `? IN (${paymentReviewersSql("payment.owner_account_id", "payment.recipient_id")})`;
/**
 * SQL: the Missed `occurrence` row was judged through a rejection. Any
 * rejected evidence will do: a rejection judges the occurrence at once.
 */
const MISSED_THROUGH_REJECTION = `EXISTS (SELECT 1 FROM evidence
  WHERE evidence.pact_id = occurrence.pact_id AND evidence.occurrence_date = occurrence.date
    AND evidence.decision = 'rejected')`;

class Core implements PactCore {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #notifier: Notifier;
  readonly #photoStore: PhotoStore;
  readonly #operatorEmailKey: string;
  readonly #log: (line: string) => void;
  /** Outbox deliveries run one at a time, in this chain. */
  #delivery: Promise<void> = Promise.resolve();

  constructor(db: Db, options: PactCoreOptions) {
    this.#db = db;
    this.#clock = options.clock;
    this.#notifier = options.notifier;
    this.#photoStore = options.photoStore;
    this.#operatorEmailKey = emailKey(options.operatorEmail);
    this.#log = options.log ?? ((line) => console.log(line));
  }

  /**
   * Runs `change` as one transaction: all of it commits or none of it does.
   * Then runs `afterCommit` and starts delivering the outbox, without waiting:
   * a slow push service never holds up the person who tapped. A delivery failure
   * doesn't fail the command; the notification waits for the next attempt.
   */
  async #command<T>(change: () => T, afterCommit?: (result: T) => void): Promise<T> {
    const result = this.#db.transaction(change).immediate();
    afterCommit?.(result);
    void this.#deliverOutbox();
    return result;
  }

  /** Queues a notification in the current command's transaction. */
  #enqueue(notification: Notification): void {
    if (!this.#db.inTransaction) throw new Error("notifications are enqueued only inside a command");
    const setting = SETTING_OF_KIND[notification.kind];
    if (setting !== null && this.#settingIsOff(notification.recipient, setting)) return;
    this.#db
      .prepare(
        `INSERT INTO outbox (recipient_account_id, kind, channel, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        notification.recipient,
        notification.kind,
        notification.channel,
        JSON.stringify(notification.payload),
        this.#clock.now().toISOString(),
      );
  }

  #settingIsOff(accountId: AccountId, setting: NotificationSetting): boolean {
    return (
      this.#db
        .prepare(`SELECT 1 FROM notification_setting_off WHERE account_id = ? AND setting = ?`)
        .get(accountId, setting) !== undefined
    );
  }

  #notificationSettings(accountId: AccountId): NotificationSettingState[] {
    return NOTIFICATION_SETTINGS.map((setting) => ({ setting, enabled: !this.#settingIsOff(accountId, setting) }));
  }

  #deliverOutbox(): Promise<void> {
    this.#delivery = this.#delivery
      .then(() => this.#deliverPending())
      .catch((error: unknown) => this.#log(`outbox delivery stopped, will retry: ${String(error)}`));
    return this.#delivery;
  }

  async #deliverPending(): Promise<void> {
    const rows = this.#db
      .prepare(
        `SELECT id, recipient_account_id, kind, channel, payload, sent_to
         FROM outbox WHERE delivered_at IS NULL ORDER BY id`,
      )
      .all() as OutboxRow[];
    for (const row of rows) {
      const notification: Notification = {
        recipient: row.recipient_account_id,
        kind: row.kind as Notification["kind"],
        channel: row.channel as Notification["channel"],
        payload: JSON.parse(row.payload) as Notification["payload"],
      };
      try {
        const devices = this.#db
          .prepare(`SELECT endpoint, p256dh, auth FROM push_subscription WHERE account_id = ? ORDER BY endpoint`)
          .all(row.recipient_account_id) as PushDevice[];
        const sentTo = JSON.parse(row.sent_to) as string[];
        const toSend = devices.filter((device) => !sentTo.includes(device.endpoint));
        const { expired, failed } = await this.#notifier.deliver(notification, toSend);
        for (const endpoint of expired) {
          this.#db.prepare(`DELETE FROM push_subscription WHERE endpoint = ?`).run(endpoint);
        }
        if (failed.length > 0) {
          const unreached = new Set([...expired, ...failed.map((f) => f.endpoint)]);
          const reached = toSend.map((device) => device.endpoint).filter((endpoint) => !unreached.has(endpoint));
          this.#db
            .prepare(`UPDATE outbox SET sent_to = ? WHERE id = ?`)
            .run(JSON.stringify([...sentTo, ...reached]), row.id);
          throw new Error(failed.map((f) => f.error).join("; "));
        }
        this.#db
          .prepare(`UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?`)
          .run(this.#clock.now().toISOString(), row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#db.prepare(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(message, row.id);
        this.#log(
          `notification ${row.id} (${row.kind} to ${row.recipient_account_id}) not delivered, will retry: ${message}`,
        );
      }
    }
  }

  signIn(identity: { email: string; name: string }, options: { inviteToken?: string } = {}): Promise<SignInResult> {
    return this.#command((): SignInResult => {
      const existing = this.accountIdForEmail(identity.email);
      if (existing !== null) return { ok: true, accountId: existing };

      const key = emailKey(identity.email);
      const isOperator =
        key === this.#operatorEmailKey && !this.#db.prepare(`SELECT 1 FROM account WHERE is_operator = 1`).get();
      const invite = options.inviteToken === undefined ? undefined : this.#inviteRow(options.inviteToken);
      const invited = invite !== undefined && this.#inviteLookup(invite, null).ok;
      if (!isOperator && !invited) return { ok: false, reason: "invite-required" };

      const id = randomUUID();
      this.#db
        .prepare(
          `INSERT INTO account (id, email, email_key, name, is_operator, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, identity.email, key, identity.name, isOperator ? 1 : 0, this.#clock.now().toISOString());
      if (invited) {
        this.#db.prepare(`UPDATE invite SET claimed_by_account_id = ? WHERE token = ?`).run(id, invite.token);
      }
      return { ok: true, accountId: id };
    });
  }

  invite(token: string): InviteLookup {
    return this.#inviteLookup(this.#inviteRow(token), null);
  }

  /**
   * Whether `viewerId` (null: a signed-out visitor) may use the invite `row`.
   * One claimed by another account is as good as used.
   */
  #inviteLookup(row: InviteRow | undefined, viewerId: AccountId | null): InviteLookup {
    if (!row) return { ok: false, reason: "invite-not-found" };
    if (row.used_at !== null) return { ok: false, reason: "invite-used" };
    const expiresAt = new Date(row.expires_at);
    if (this.#clock.now().getTime() >= expiresAt.getTime()) return { ok: false, reason: "invite-expired" };
    const claimedBy = row.claimed_by_account_id;
    if (claimedBy !== null && claimedBy !== viewerId) return { ok: false, reason: "invite-used" };
    return { ok: true, inviterName: row.inviter_name, expiresAt };
  }

  #inviteRow(token: string): InviteRow | undefined {
    return this.#db
      .prepare(
        `SELECT invite.token, invite.inviter_account_id, account.name AS inviter_name, invite.expires_at,
                invite.used_at, invite.claimed_by_account_id
         FROM invite JOIN account ON account.id = invite.inviter_account_id
         WHERE invite.token = ?`,
      )
      .get(token) as InviteRow | undefined;
  }

  #areFriends(a: AccountId, b: AccountId): boolean {
    const [first, second] = friendshipPair(a, b);
    return (
      this.#db.prepare(`SELECT 1 FROM friendship WHERE account_a_id = ? AND account_b_id = ?`).get(first, second) !==
      undefined
    );
  }

  accountIdForEmail(email: string): AccountId | null {
    const row = this.#db.prepare(`SELECT id FROM account WHERE email_key = ?`).get(emailKey(email)) as
      { id: string } | undefined;
    return row?.id ?? null;
  }

  as(accountId: AccountId): AccountView {
    const account = () => {
      const row = this.#db.prepare(`SELECT email, name, timezone FROM account WHERE id = ?`).get(accountId) as
        { email: string; name: string; timezone: string | null } | undefined;
      if (!row) throw new UnknownAccountError(accountId);
      return row;
    };
    return {
      setTimezone: (timezone) =>
        this.#command((): SetTimezoneResult => {
          account();
          const zone = canonicalTimezone(timezone);
          if (zone === null) return { ok: false, reason: "invalid-timezone" };
          this.#db.prepare(`UPDATE account SET timezone = ? WHERE id = ?`).run(zone, accountId);
          return { ok: true, timezone: zone };
        }),
      createInvite: () =>
        this.#command((): Invite => {
          account();
          const token = randomBytes(24).toString("base64url");
          const now = this.#clock.now();
          const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
          this.#db
            .prepare(`INSERT INTO invite (token, inviter_account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
            .run(token, accountId, now.toISOString(), expiresAt.toISOString());
          return { token, expiresAt };
        }),
      invite: (token) => {
        account();
        return this.#inviteLookup(this.#inviteRow(token), accountId);
      },
      acceptInvite: (token) =>
        this.#command((): AcceptInviteResult => {
          account();
          const row = this.#inviteRow(token);
          if (!row) return { ok: false, reason: "invite-not-found" };
          const lookup = this.#inviteLookup(row, accountId);
          if (!lookup.ok) return lookup;
          const inviterId = row.inviter_account_id;
          if (inviterId === accountId) return { ok: false, reason: "own-invite" };
          if (this.#areFriends(accountId, inviterId)) return { ok: false, reason: "already-friends" };

          const now = this.#clock.now().toISOString();
          this.#db
            .prepare(`UPDATE invite SET used_at = ?, used_by_account_id = ? WHERE token = ?`)
            .run(now, accountId, token);
          this.#db
            .prepare(`INSERT INTO friendship (account_a_id, account_b_id, created_at) VALUES (?, ?, ?)`)
            .run(...friendshipPair(accountId, inviterId), now);
          return { ok: true, friend: { id: inviterId, name: lookup.inviterName } };
        }),
      friends: () => {
        account();
        return this.#db
          .prepare(
            `SELECT account.id, account.name FROM friendship
             JOIN account ON account.id =
               CASE WHEN friendship.account_a_id = ? THEN friendship.account_b_id ELSE friendship.account_a_id END
             WHERE friendship.account_a_id = ? OR friendship.account_b_id = ?
             ORDER BY account.name, account.id`,
          )
          .all(accountId, accountId, accountId) as Friend[];
      },
      addRecipient: (recipient) =>
        this.#command((): AddRecipientResult => {
          account();
          const name = recipient.name.trim();
          if (name === "") return { ok: false, reason: "blank-name" };
          const id = randomUUID();
          this.#db
            .prepare(`INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES (?, ?, ?, ?)`)
            .run(id, accountId, name, this.#clock.now().toISOString());
          return { ok: true, recipient: { id, name } };
        }),
      recipients: () => {
        account();
        return this.#selectRecipients(`owner_account_id = ?`, accountId);
      },
      createPact: (pact) =>
        this.#command((): CreatePactResult => {
          const { timezone } = account();
          // Oura Ring pacts come with the Oura connection (ticket 08).
          if (pact.evidenceKind !== "camera") return { ok: false, reason: "evidence-kind-unavailable" };
          const name = pact.name.trim();
          const description = pact.description.trim();
          if (name === "") return { ok: false, reason: "blank-name" };
          if (description === "") return { ok: false, reason: "blank-description" };
          if (timezone === null) return { ok: false, reason: "no-timezone" };
          const now = this.#clock.now();
          const timing = newOccurrenceTerms(pact.schedule, now, timezone);
          if (!timing.ok) return timing;
          if (!Number.isSafeInteger(pact.penaltyCents) || pact.penaltyCents <= 0) {
            return { ok: false, reason: "invalid-penalty" };
          }
          const isOwnRecipient = this.#db
            .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
            .get(pact.recipientId, accountId);
          if (!isOwnRecipient) return { ok: false, reason: "unknown-recipient" };
          const reviewerIds = [...new Set(pact.reviewerIds)];
          if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
          if (!reviewerIds.every((id) => this.#areFriends(accountId, id))) return { ok: false, reason: "not-a-friend" };

          const id = randomUUID();
          this.#db
            .prepare(
              `INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule,
                                 penalty_cents, recipient_id, stage, first_occurrence, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            )
            .run(
              id,
              accountId,
              name,
              description,
              pact.evidenceKind,
              JSON.stringify(timing.terms.schedule),
              pact.penaltyCents,
              pact.recipientId,
              timing.terms.firstOccurrence,
              now.toISOString(),
            );
          for (const reviewerId of reviewerIds) {
            this.#db
              .prepare(`INSERT INTO pact_reviewer (pact_id, reviewer_account_id) VALUES (?, ?)`)
              .run(id, reviewerId);
          }
          return { ok: true, pactId: id };
        }),
      firstOccurrence: (schedule) => {
        const { timezone } = account();
        if (timezone === null) return { ok: false, reason: "no-timezone" };
        const timing = newOccurrenceTerms(schedule, this.#clock.now(), timezone);
        if (!timing.ok) return timing;
        return { ok: true, firstOccurrence: { date: timing.first.date, dueAt: timing.first.dueAt } };
      },
      pacts: () => {
        account();
        return this.#activePacts(accountId).map(({ id, name, terms, penaltyCents }) => ({
          id,
          name,
          schedule: terms.schedule,
          penaltyCents,
        }));
      },
      pact: (pactId) => {
        const { timezone } = account();
        const row = this.#db
          .prepare(`SELECT * FROM pact WHERE id = ? AND owner_account_id = ?`)
          .get(pactId, accountId) as PactRow | undefined;
        if (!row || timezone === null) return { ok: false, reason: "pact-not-found" };
        const reviewers = this.#db
          .prepare(
            `SELECT account.id, account.name FROM pact_reviewer
             JOIN account ON account.id = pact_reviewer.reviewer_account_id
             WHERE pact_reviewer.pact_id = ?
             ORDER BY account.name, account.id`,
          )
          .all(pactId) as { id: AccountId; name: string }[];
        const [recipient] = this.#selectRecipients(`id = ?`, row.recipient_id);
        if (!recipient) throw new Error(`pact ${row.id} has no recipient ${row.recipient_id}`);
        const terms = occurrenceTermsOf(row);
        const first = occurrences(terms, timezone).first;
        const pact: PactTerms = {
          id: row.id,
          name: row.name,
          description: row.description,
          evidenceKind: row.evidence_kind,
          schedule: terms.schedule,
          penaltyCents: row.penalty_cents,
          recipient,
          reviewers,
          stage: row.stage,
          firstOccurrence: { date: first.date, dueAt: first.dueAt },
        };
        return { ok: true, pact };
      },
      profile: () => {
        const { email, name, timezone } = account();
        return { email, name, timezone };
      },
      today: () => {
        const { timezone } = account();
        // Every pact's owner has a timezone: creating one needs it.
        const { alerts, sections } =
          timezone === null ? { alerts: [], sections: [] } : this.#todayCards(accountId, timezone);
        const hasPacts = this.#db.prepare(`SELECT 1 FROM pact WHERE owner_account_id = ?`).get(accountId) !== undefined;
        return { hasPacts, alerts, sections, waiting: this.#waiting(accountId), yesterday: [] };
      },
      notificationSettings: () => {
        account();
        return this.#notificationSettings(accountId);
      },
      setNotificationSetting: (setting, enabled) =>
        this.#command(() => {
          account();
          if (enabled) {
            this.#db
              .prepare(`DELETE FROM notification_setting_off WHERE account_id = ? AND setting = ?`)
              .run(accountId, setting);
          } else {
            this.#db
              .prepare(
                `INSERT INTO notification_setting_off (account_id, setting) VALUES (?, ?) ON CONFLICT DO NOTHING`,
              )
              .run(accountId, setting);
          }
          return this.#notificationSettings(accountId);
        }),
      savePushSubscription: (device) =>
        this.#command((): SavePushSubscriptionResult => {
          account();
          if (!isPushDevice(device)) return { ok: false, reason: "invalid-subscription" };
          this.#db
            .prepare(
              `INSERT INTO push_subscription (endpoint, account_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (endpoint) DO UPDATE
               SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth`,
            )
            .run(device.endpoint, accountId, device.p256dh, device.auth, this.#clock.now().toISOString());
          return { ok: true };
        }),
      removePushSubscription: (endpoint) =>
        this.#command(() => {
          account();
          this.#db
            .prepare(`DELETE FROM push_subscription WHERE endpoint = ? AND account_id = ?`)
            .run(endpoint, accountId);
        }),
      submitEvidence: async (pactId, photos) => {
        const { timezone, name: ownerName } = account();
        // Refuse cheaply before storing anything, then check again at the time
        // the server received the photos, in the transaction that writes.
        const early = this.#evidenceAcceptance(accountId, timezone, pactId, photos.length, this.#clock.now());
        if (!early.ok) return early;
        const stored = await Promise.all(photos.map((photo) => this.#photoStore.store(photo)));
        const submittedAt = new Date(Math.max(...stored.map((p) => p.receivedAt.getTime())));
        return this.#command((): SubmitEvidenceResult => {
          const acceptance = this.#evidenceAcceptance(accountId, timezone, pactId, photos.length, submittedAt);
          if (!acceptance.ok) return acceptance;
          const { date } = acceptance.occurrence;
          this.#db
            .prepare(`INSERT INTO occurrence (pact_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
            .run(pactId, date);
          const evidenceId = randomUUID();
          this.#db
            .prepare(`INSERT INTO evidence (id, pact_id, occurrence_date, submitted_at) VALUES (?, ?, ?, ?)`)
            .run(evidenceId, pactId, date, submittedAt.toISOString());
          stored.forEach(({ photoId, receivedAt }, position) => {
            this.#db
              .prepare(`INSERT INTO evidence_photo (evidence_id, position, photo_id, received_at) VALUES (?, ?, ?, ?)`)
              .run(evidenceId, position, photoId, receivedAt.toISOString());
          });
          const pactName = this.#pactName(pactId);
          for (const { reviewer_account_id } of this.#db
            .prepare(`SELECT reviewer_account_id FROM pact_reviewer WHERE pact_id = ? ORDER BY reviewer_account_id`)
            .all(pactId) as { reviewer_account_id: AccountId }[]) {
            this.#enqueue({
              recipient: reviewer_account_id,
              kind: "review-item",
              channel: "push",
              payload: {
                itemKind: "evidence",
                itemId: evidenceId,
                pactId,
                title: `${ownerName} submitted evidence`,
                body: `${pactName} · ${formatDate(date)}`,
                url: APP_PATHS.review,
              },
            });
          }
          return { ok: true, evidenceId };
        });
      },
      acceptMiss: (pactId, occurrenceDate) =>
        this.#command((): AcceptMissResult => {
          account();
          const isOwn = this.#db
            .prepare(`SELECT 1 FROM pact WHERE id = ? AND owner_account_id = ?`)
            .get(pactId, accountId);
          if (!isOwn) return { ok: false, reason: "pact-not-found" };
          const accepted = this.#db
            .prepare(
              `UPDATE occurrence SET miss_accepted_at = ?
               WHERE pact_id = ? AND date = ? AND outcome = 'missed' AND miss_accepted_at IS NULL`,
            )
            .run(this.#clock.now().toISOString(), pactId, occurrenceDate);
          return accepted.changes === 1 ? { ok: true } : { ok: false, reason: "nothing-to-accept" };
        }),
      recordPayment: async (payment, screenshot) => {
        const { name: ownerName } = account();
        // Refuse cheaply before storing anything, then check again in the
        // transaction that writes, as another payment may have come first.
        const early = this.#paymentAcceptance(accountId, payment);
        if (!early.ok) return early;
        if (screenshot === null) return { ok: false, reason: "no-screenshot" };
        const { photoId } = await this.#photoStore.store(screenshot);
        return this.#command((): RecordPaymentResult => {
          const acceptance = this.#paymentAcceptance(accountId, payment);
          if (!acceptance.ok) return acceptance;
          const note = payment.note?.trim() ?? "";
          const paymentId = randomUUID();
          this.#db
            .prepare(
              `INSERT INTO payment (id, owner_account_id, recipient_id, amount_cents, note, photo_id, recorded_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              paymentId,
              accountId,
              payment.recipientId,
              payment.amountCents,
              note === "" ? null : note,
              photoId,
              this.#clock.now().toISOString(),
            );
          for (const reviewerId of this.#paymentReviewers(accountId, payment.recipientId)) {
            this.#enqueue({
              recipient: reviewerId,
              kind: "review-item",
              channel: "push",
              payload: {
                itemKind: "payment",
                itemId: paymentId,
                recipientId: payment.recipientId,
                title: `${ownerName} recorded a payment`,
                body: `${money(payment.amountCents)} to ${this.#recipientName(payment.recipientId)}`,
                url: APP_PATHS.review,
              },
            });
          }
          return { ok: true, paymentId };
        });
      },
      photo: async (photoId) => {
        account();
        const viewable =
          this.#mayViewEvidencePhoto(photoId, accountId) || this.#mayViewPaymentPhoto(photoId, accountId);
        const photo = viewable ? await this.#photoStore.fetch(photoId) : null;
        return photo ? { ok: true, photo } : { ok: false, reason: "photo-not-found" };
      },
      reviewQueue: () => {
        account();
        const rows = this.#db
          .prepare(
            `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, owner.name AS owner_name,
                    pact.description, evidence.submitted_at, evidence.occurrence_date,
                    pact.penalty_cents, recipient.name AS recipient_name
             FROM evidence
             JOIN pact ON pact.id = evidence.pact_id
             JOIN account AS owner ON owner.id = pact.owner_account_id
             JOIN recipient ON recipient.id = pact.recipient_id
             JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
             WHERE evidence.decision IS NULL
             ORDER BY evidence.submitted_at, evidence.id`,
          )
          .all(accountId) as {
          id: string;
          pact_id: string;
          pact_name: string;
          owner_name: string;
          description: string;
          submitted_at: string;
          occurrence_date: string;
          penalty_cents: number;
          recipient_name: string;
        }[];
        const evidence = rows.map((row): ReviewItem => ({
          kind: "evidence",
          id: row.id,
          pactId: row.pact_id,
          pactName: row.pact_name,
          ownerName: row.owner_name,
          description: row.description,
          photoIds: this.#evidencePhotoIds(row.id),
          submittedAt: new Date(row.submitted_at),
          occurrenceDate: row.occurrence_date,
          penaltyCents: row.penalty_cents,
          recipientName: row.recipient_name,
        }));
        return mergeByTime(
          (item) => (item.kind === "evidence" ? item.submittedAt : item.recordedAt),
          "oldest-first",
          evidence,
          this.#paymentsToReview(accountId),
        );
      },
      decide: (itemId, decision) =>
        this.#command((): DecideResult => {
          account();
          const evidence = this.#db
            .prepare(
              `SELECT evidence.id, evidence.pact_id, evidence.occurrence_date, evidence.decision,
                      pact.owner_account_id
               FROM evidence
               JOIN pact ON pact.id = evidence.pact_id
               JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
               WHERE evidence.id = ?`,
            )
            .get(accountId, itemId) as EvidenceToDecide | undefined;
          const payment = evidence ? undefined : this.#paymentToDecide(accountId, itemId);
          const item = evidence ?? payment;
          if (!item) return { ok: false, reason: "item-not-found" };
          if (item.decision !== null) return { ok: false, reason: "already-decided" };
          const reason = decision.kind === "reject" ? decision.reason.trim() : null;
          if (reason === "") return { ok: false, reason: "blank-reason" };
          const decided: Decided = { outcome: reason === null ? "approved" : "rejected", reason };
          if (evidence) this.#decideEvidence(evidence, decided, accountId);
          if (payment) this.#decidePayment(payment, decided, accountId);
          return { ok: true };
        }),
      ledgers: () => {
        account();
        return this.#ledgerSummaries(accountId);
      },
      ledger: (recipientId) => {
        account();
        const [summary] = this.#ledgerSummaries(accountId, recipientId);
        if (!summary) return { ok: false, reason: "recipient-not-found" };
        const penaltyRows = this.#db
          .prepare(
            `SELECT penalty.id, penalty.pact_id, pact.name AS pact_name, penalty.occurrence_date,
                    penalty.amount_cents, penalty.added_at
             FROM penalty JOIN pact ON pact.id = penalty.pact_id
             WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ?
             ORDER BY penalty.added_at DESC, penalty.occurrence_date DESC, pact.name, penalty.id`,
          )
          .all(accountId, recipientId) as {
          id: string;
          pact_id: string;
          pact_name: string;
          occurrence_date: string;
          amount_cents: number;
          added_at: string;
        }[];
        // Approved payments pay off penalties oldest first: walk the history
        // backwards, giving each penalty what's left of the approved total.
        let unallocatedCents = summary.paidCents;
        const penalties = penaltyRows
          .toReversed()
          .map((row): LedgerPenalty => {
            const paidCents = Math.min(row.amount_cents, unallocatedCents);
            unallocatedCents -= paidCents;
            // Missed with evidence means all of it was rejected.
            const rejection = this.#rejection(row.pact_id, row.occurrence_date);
            return {
              kind: "penalty",
              penaltyId: row.id,
              pactId: row.pact_id,
              pactName: row.pact_name,
              occurrenceDate: row.occurrence_date,
              amountCents: row.amount_cents,
              addedAt: new Date(row.added_at),
              paidCents,
              ...(rejection && { rejection }),
            };
          })
          .toReversed();
        // A payment recorded the instant a penalty was added came after it, so it's listed first.
        const history = mergeByTime<LedgerEntry>(
          (entry) => (entry.kind === "penalty" ? entry.addedAt : entry.recordedAt),
          "newest-first",
          this.#ledgerPayments(accountId, recipientId),
          penalties,
        );
        return { ok: true, ledger: { summary, history } };
      },
    };
  }

  /**
   * The owner's ledgers, sorted by name: one per recipient a pact names or a
   * penalty went to. Just the one for `recipientId`, if given.
   */
  #ledgerSummaries(ownerId: AccountId, recipientId?: string): LedgerSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT recipient.id, recipient.name,
                (SELECT COALESCE(SUM(amount_cents), 0) FROM penalty
                 WHERE penalty.owner_account_id = recipient.owner_account_id
                   AND penalty.recipient_id = recipient.id) AS penalty_cents,
                COALESCE(SUM(payment.amount_cents) FILTER (WHERE payment.decision = 'approved'), 0) AS paid_cents,
                COALESCE(SUM(payment.amount_cents) FILTER (WHERE payment.decision IS NULL), 0) AS awaiting_cents,
                COUNT(payment.id) FILTER (WHERE payment.decision IS NULL) AS awaiting_count
         FROM recipient
         LEFT JOIN payment
           ON payment.owner_account_id = recipient.owner_account_id AND payment.recipient_id = recipient.id
         WHERE recipient.owner_account_id = ?
           AND (? IS NULL OR recipient.id = ?)
           AND (EXISTS (SELECT 1 FROM pact WHERE pact.recipient_id = recipient.id)
                OR EXISTS (SELECT 1 FROM penalty WHERE penalty.recipient_id = recipient.id))
         GROUP BY recipient.id
         ORDER BY recipient.name, recipient.id`,
      )
      .all(ownerId, recipientId ?? null, recipientId ?? null) as {
      id: string;
      name: string;
      penalty_cents: number;
      paid_cents: number;
      awaiting_cents: number;
      awaiting_count: number;
    }[];
    return rows.map((row) => {
      const owedCents = row.penalty_cents - row.paid_cents;
      return {
        recipientId: row.id,
        name: row.name,
        owedCents,
        payableCents: Math.max(0, owedCents - row.awaiting_cents),
        awaitingCents: row.awaiting_cents,
        awaitingCount: row.awaiting_count,
        paidCents: row.paid_cents,
      };
    });
  }

  /** The owner's payments to `recipientId` and where each one's review stands, newest recorded first. */
  #ledgerPayments(ownerId: AccountId, recipientId: string): LedgerPayment[] {
    const rows = this.#db
      .prepare(
        `SELECT payment.id, payment.amount_cents, payment.note, payment.recorded_at, payment.decision,
                payment.decided_at, payment.reject_reason, reviewer.name AS reviewer_name
         FROM payment LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
         WHERE payment.owner_account_id = ? AND payment.recipient_id = ?
         ORDER BY payment.recorded_at DESC, payment.id`,
      )
      .all(ownerId, recipientId) as {
      id: string;
      amount_cents: number;
      note: string | null;
      recorded_at: string;
      decision: ReviewOutcome | null;
      decided_at: string | null;
      reject_reason: string | null;
      reviewer_name: string | null;
    }[];
    return rows.map((row) => {
      let state: LedgerPaymentState = { kind: "awaiting-approval" };
      if (row.decision !== null) {
        const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
        state =
          row.decision === "approved"
            ? { kind: "approved", ...decided }
            : { kind: "rejected", ...decided, reason: row.reject_reason! };
      }
      return {
        kind: "payment",
        paymentId: row.id,
        amountCents: row.amount_cents,
        note: row.note,
        recordedAt: new Date(row.recorded_at),
        state,
      };
    });
  }

  /**
   * Whether `ownerId` may record `payment`, screenshot aside: to one of their
   * recipients, a positive whole number of cents, and no more than the
   * ledger's `payableCents`: owed less payments already awaiting approval.
   */
  #paymentAcceptance(
    ownerId: AccountId,
    payment: NewPayment,
  ): { ok: true } | { ok: false; reason: RecordPaymentRefusal } {
    const isOwnRecipient = this.#db
      .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
      .get(payment.recipientId, ownerId);
    if (!isOwnRecipient) return { ok: false, reason: "recipient-not-found" };
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      return { ok: false, reason: "invalid-amount" };
    }
    // A recipient no pact names and with no penalties has no ledger: nothing is owed.
    const [ledger] = this.#ledgerSummaries(ownerId, payment.recipientId);
    if (payment.amountCents > (ledger?.payableCents ?? 0)) return { ok: false, reason: "payment-exceeds-owed" };
    return { ok: true };
  }

  /**
   * Records a reviewer's decision on waiting evidence and tells the owner.
   * A rejection is final: it judges the occurrence Missed as of now, open or
   * not. An approval judges it Kept as of now once judging has reached it,
   * since it was waiting on this decision; before that, judging at the due
   * time will.
   */
  #decideEvidence(evidence: EvidenceToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    const now = this.#clock.now();
    this.#db
      .prepare(
        `UPDATE evidence SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, now.toISOString(), reason, evidence.id);
    if (
      !this.#isJudged(evidence.pact_id, evidence.occurrence_date) &&
      (outcome === "rejected" || this.#judgingReached(evidence.pact_id, evidence.occurrence_date, now))
    ) {
      this.#judge(evidence.pact_id, evidence.occurrence_date, outcome === "approved" ? "kept" : "missed", now);
    }
    this.#enqueue({
      recipient: evidence.owner_account_id,
      kind: "evidence-decided",
      channel: "push",
      payload: {
        itemKind: "evidence",
        itemId: evidence.id,
        pactId: evidence.pact_id,
        decision: outcome,
        ...(reason !== null && { reason }),
        title: `${this.#accountName(reviewerId)} ${outcome} your evidence`,
        body: `${this.#pactName(evidence.pact_id)} · ${
          reason === null ? formatDate(evidence.occurrence_date) : `“${reason}”`
        }`,
        // A rejection shows as an alert on Today, where the owner can respond to it.
        url: outcome === "approved" ? APP_PATHS.pact(evidence.pact_id) : APP_PATHS.today,
      },
    });
  }

  #accountName(accountId: AccountId): string {
    return (this.#db.prepare(`SELECT name FROM account WHERE id = ?`).get(accountId) as { name: string }).name;
  }

  #pactName(pactId: string): string {
    return (this.#db.prepare(`SELECT name FROM pact WHERE id = ?`).get(pactId) as { name: string }).name;
  }

  #recipientName(recipientId: string): string {
    return (this.#db.prepare(`SELECT name FROM recipient WHERE id = ?`).get(recipientId) as { name: string }).name;
  }

  /** Payments awaiting approval that `reviewerId` may decide, oldest recorded first. */
  #paymentsToReview(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#db
      .prepare(
        `SELECT payment.id, owner.name AS owner_name, recipient.name AS recipient_name, payment.amount_cents,
                payment.note, payment.photo_id, payment.recorded_at,
                (SELECT COALESCE(SUM(penalty.amount_cents), 0) FROM penalty
                 WHERE penalty.owner_account_id = payment.owner_account_id
                   AND penalty.recipient_id = payment.recipient_id)
                - (SELECT COALESCE(SUM(approved.amount_cents), 0) FROM payment AS approved
                   WHERE approved.owner_account_id = payment.owner_account_id
                     AND approved.recipient_id = payment.recipient_id AND approved.decision = 'approved')
                  AS owed_cents
         FROM payment
         JOIN account AS owner ON owner.id = payment.owner_account_id
         JOIN recipient ON recipient.id = payment.recipient_id
         WHERE payment.decision IS NULL AND ${MAY_DECIDE_PAYMENT}
         ORDER BY payment.recorded_at, payment.id`,
      )
      .all(reviewerId) as {
      id: string;
      owner_name: string;
      recipient_name: string;
      amount_cents: number;
      note: string | null;
      photo_id: string;
      recorded_at: string;
      owed_cents: number;
    }[];
    return rows.map((row) => ({
      kind: "payment",
      id: row.id,
      ownerName: row.owner_name,
      recipientName: row.recipient_name,
      amountCents: row.amount_cents,
      note: row.note,
      photoId: row.photo_id,
      recordedAt: new Date(row.recorded_at),
      owedCents: row.owed_cents,
      owedAfterApprovalCents: Math.max(0, row.owed_cents - row.amount_cents),
    }));
  }

  /** Who reviews payments from `ownerId` to `recipientId`, each once. */
  #paymentReviewers(ownerId: AccountId, recipientId: string): AccountId[] {
    return (
      this.#db
        .prepare(
          `SELECT DISTINCT reviewer_account_id FROM (${paymentReviewersSql("?", "?")})
           ORDER BY reviewer_account_id`,
        )
        .all(ownerId, recipientId) as { reviewer_account_id: AccountId }[]
    ).map((row) => row.reviewer_account_id);
  }

  /**
   * The payment `itemId`, if `reviewerId` may decide it: they review any of
   * the owner's pacts with its recipient.
   */
  #paymentToDecide(reviewerId: AccountId, itemId: string): PaymentToDecide | undefined {
    return this.#db
      .prepare(
        `SELECT payment.id, payment.owner_account_id, payment.recipient_id, payment.decision
         FROM payment
         WHERE payment.id = ? AND ${MAY_DECIDE_PAYMENT}`,
      )
      .get(itemId, reviewerId) as PaymentToDecide | undefined;
  }

  /**
   * Records a reviewer's decision on a payment awaiting approval and tells
   * the owner. Approved, it counts against the ledger; rejected, it never did.
   */
  #decidePayment(payment: PaymentToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    this.#db
      .prepare(
        `UPDATE payment SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, this.#clock.now().toISOString(), reason, payment.id);
    const { amount_cents } = this.#db.prepare(`SELECT amount_cents FROM payment WHERE id = ?`).get(payment.id) as {
      amount_cents: number;
    };
    const paid = `${money(amount_cents)} to ${this.#recipientName(payment.recipient_id)}`;
    this.#enqueue({
      recipient: payment.owner_account_id,
      kind: "payment-decided",
      channel: "push",
      payload: {
        itemKind: "payment",
        itemId: payment.id,
        recipientId: payment.recipient_id,
        decision: outcome,
        ...(reason !== null && { reason }),
        title: `${this.#accountName(reviewerId)} ${outcome} your payment`,
        body: reason === null ? paid : `${paid} · “${reason}”`,
        url: APP_PATHS.ledger(payment.recipient_id),
      },
    });
  }

  /**
   * Whether judging at `t` reaches the pact's occurrence on `date`: it's on
   * or before the pact's `judged_through`, or due by `t` in the owner's
   * timezone now. The cursor counts on its own because a timezone change can
   * move a due time it already went past back into the future.
   */
  #judgingReached(pactId: string, date: LocalDate, t: Date): boolean {
    const [pact] = this.#pactsToJudge(pactId);
    if (!pact) throw new Error(`no pact ${pactId}`);
    if (pact.judged_through !== null && date <= pact.judged_through) return true;
    // Every pact's owner has a timezone: creating one needs it.
    if (pact.timezone === null) return false;
    return occurrences(occurrenceTermsOf(pact), pact.timezone)
      .dueAfter(pact.judged_through, t)
      .some((occurrence) => occurrence.date === date);
  }

  /** Whether `photoId` is a photo of some evidence and `accountId` owns or reviews its pact. */
  #mayViewEvidencePhoto(photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM evidence_photo
           JOIN evidence ON evidence.id = evidence_photo.evidence_id
           JOIN pact ON pact.id = evidence.pact_id
           WHERE evidence_photo.photo_id = ?
             AND (pact.owner_account_id = ?
                  OR EXISTS (SELECT 1 FROM pact_reviewer
                             WHERE pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?))`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /**
   * Whether `photoId` is a payment's screenshot and `accountId` made the
   * payment or reviews any of the owner's pacts with its recipient: those who
   * may decide it.
   */
  #mayViewPaymentPhoto(photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM payment
           WHERE payment.photo_id = ?
             AND (payment.owner_account_id = ? OR ${MAY_DECIDE_PAYMENT})`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /** The photos of some evidence, in the order taken. */
  #evidencePhotoIds(evidenceId: string): string[] {
    return (
      this.#db
        .prepare(`SELECT photo_id FROM evidence_photo WHERE evidence_id = ? ORDER BY position`)
        .all(evidenceId) as { photo_id: string }[]
    ).map((row) => row.photo_id);
  }

  /**
   * Whether `ownerId` may submit evidence with `photoCount` photos for
   * `pactId` at `at`, and if so for which occurrence: the one open at `at`,
   * unless evidence for it is already waiting or approved, or it's already
   * judged (a rejection judges it Missed at once).
   */
  #evidenceAcceptance(
    ownerId: AccountId,
    timezone: string | null,
    pactId: string,
    photoCount: number,
    at: Date,
  ): { ok: true; occurrence: Occurrence } | { ok: false; reason: SubmitEvidenceRefusal } {
    const row = this.#db
      .prepare(`SELECT schedule, first_occurrence FROM pact WHERE id = ? AND owner_account_id = ?`)
      .get(pactId, ownerId) as Pick<PactRow, "schedule" | "first_occurrence"> | undefined;
    if (!row || timezone === null) return { ok: false, reason: "pact-not-found" };
    if (photoCount === 0) return { ok: false, reason: "no-photos" };
    if (photoCount > MAX_EVIDENCE_PHOTOS) return { ok: false, reason: "too-many-photos" };
    const occurrence = occurrences(occurrenceTermsOf(row), timezone).openAt(at);
    if (!occurrence) return { ok: false, reason: "not-open" };
    const decision = this.#evidenceDecision(pactId, occurrence.date);
    if (decision === "waiting") return { ok: false, reason: "evidence-waiting" };
    if (decision === "approved") return { ok: false, reason: "already-approved" };
    if (this.#isJudged(pactId, occurrence.date)) return { ok: false, reason: "already-judged" };
    return { ok: true, occurrence };
  }

  /** Where the evidence for an occurrence stands: waiting or approved if any is, else rejected or none. */
  #evidenceDecision(pactId: string, date: LocalDate): ReviewOutcome | "waiting" | "none" {
    const decisions = (
      this.#db.prepare(`SELECT decision FROM evidence WHERE pact_id = ? AND occurrence_date = ?`).all(pactId, date) as {
        decision: ReviewOutcome | null;
      }[]
    ).map((row) => row.decision ?? "waiting");
    if (decisions.includes("waiting")) return "waiting";
    if (decisions.includes("approved")) return "approved";
    return decisions.length > 0 ? "rejected" : "none";
  }

  /** The owner's evidence and payments still waiting for a decision, newest first. */
  #waiting(ownerId: AccountId): TodayWaitingItem[] {
    const payments = (
      this.#db
        .prepare(
          `SELECT payment.id, payment.recipient_id, recipient.name AS recipient_name, payment.amount_cents,
                  payment.recorded_at
           FROM payment JOIN recipient ON recipient.id = payment.recipient_id
           WHERE payment.owner_account_id = ? AND payment.decision IS NULL
           ORDER BY payment.recorded_at DESC, payment.id`,
        )
        .all(ownerId) as {
        id: string;
        recipient_id: string;
        recipient_name: string;
        amount_cents: number;
        recorded_at: string;
      }[]
    ).map((row): TodayWaitingItem => ({
      kind: "payment",
      id: row.id,
      recipientId: row.recipient_id,
      recipientName: row.recipient_name,
      amountCents: row.amount_cents,
      recordedAt: new Date(row.recorded_at),
    }));
    return mergeByTime(
      (item) => (item.kind === "evidence" ? item.submittedAt : item.recordedAt),
      "newest-first",
      this.#waitingEvidence(ownerId),
      payments,
    );
  }

  /** The owner's evidence still waiting for a decision, newest first. */
  #waitingEvidence(ownerId: AccountId): TodayWaitingItem[] {
    const rows = this.#db
      .prepare(
        `SELECT evidence.id, evidence.pact_id, pact.name, evidence.occurrence_date, evidence.submitted_at
         FROM evidence JOIN pact ON pact.id = evidence.pact_id
         WHERE pact.owner_account_id = ? AND evidence.decision IS NULL
         ORDER BY evidence.submitted_at DESC, evidence.id`,
      )
      .all(ownerId) as { id: string; pact_id: string; name: string; occurrence_date: string; submitted_at: string }[];
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
   * Alerts: occurrences Missed through a rejection, until accepted. To do:
   * pacts with an occurrence open now that still needs evidence. Missed:
   * other occurrences judged Missed in the last 48 hours and not accepted.
   * Coming up: pacts whose first
   * occurrence hasn't opened yet. A pact on a day it isn't due appears in
   * neither To do nor Coming up. Empty sections are left out.
   */
  #todayCards(ownerId: AccountId, timezone: string): { alerts: TodayAlert[]; sections: TodaySection[] } {
    const now = this.#clock.now();
    const toDo: TodayToDoCard[] = [];
    const comingUp: TodayComingUpCard[] = [];
    for (const pact of this.#activePacts(ownerId)) {
      const card = { pactId: pact.id, name: pact.name, penaltyCents: pact.penaltyCents };
      const { first, openAt } = occurrences(pact.terms, timezone);
      const open = openAt(now);
      // Judged while still open: its evidence was rejected, so it's an alert.
      if (open && this.#isJudged(pact.id, open.date)) continue;
      if (open) {
        // Evidence waiting or approved: Waiting for approval, or done.
        const decision = this.#evidenceDecision(pact.id, open.date);
        if (decision === "waiting" || decision === "approved") continue;
        toDo.push({ ...card, dueAt: open.dueAt });
      } else if (now.getTime() < first.opensAt.getTime()) {
        comingUp.push({ ...card, opensOn: first.date });
      }
    }
    // Rows come sorted by name, and the sorts are stable.
    toDo.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    comingUp.sort((a, b) => a.opensOn.localeCompare(b.opensOn));
    const sections: TodaySection[] = [];
    if (toDo.length > 0) sections.push({ kind: "to-do", cards: toDo });
    const missed = this.#recentlyMissed(ownerId, now);
    if (missed.length > 0) sections.push({ kind: "missed", cards: missed });
    if (comingUp.length > 0) sections.push({ kind: "coming-up", cards: comingUp });
    return { alerts: this.#rejectedEvidenceAlerts(ownerId), sections };
  }

  /**
   * One alert per occurrence of the owner's judged Missed through a
   * rejection and not accepted yet, newest rejection first. No time limit.
   */
  #rejectedEvidenceAlerts(ownerId: AccountId): TodayAlert[] {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, occurrence.date, penalty.amount_cents, recipient.name AS recipient_name
         FROM occurrence
         JOIN pact ON pact.id = occurrence.pact_id
         JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         JOIN recipient ON recipient.id = penalty.recipient_id
         WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND occurrence.miss_accepted_at IS NULL
           AND ${MISSED_THROUGH_REJECTION}
         ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
      )
      .all(ownerId) as { id: string; name: string; date: LocalDate; amount_cents: number; recipient_name: string }[];
    return rows.map((row) => {
      const rejection = this.#rejection(row.id, row.date);
      if (!rejection) throw new Error(`no rejected evidence for pact ${row.id} on ${row.date}`);
      return {
        kind: "evidence-rejected",
        pactId: row.id,
        name: row.name,
        ...rejection,
        occurrenceDate: row.date,
        penaltyCents: row.amount_cents,
        recipientName: row.recipient_name,
      };
    });
  }

  /**
   * The owner's occurrences judged Missed in the 48 hours before `now`,
   * latest first, but not accepted misses, nor those Missed through a
   * rejection: those are alerts.
   */
  #recentlyMissed(ownerId: AccountId, now: Date): TodayMissedCard[] {
    const since = new Date(now.getTime() - TODAY_MISSED_MS);
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, penalty.amount_cents, occurrence.date, occurrence.judged_at
         FROM occurrence
         JOIN pact ON pact.id = occurrence.pact_id
         JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND occurrence.judged_at > ?
           AND occurrence.miss_accepted_at IS NULL AND NOT ${MISSED_THROUGH_REJECTION}
         ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
      )
      .all(ownerId, since.toISOString()) as {
      id: string;
      name: string;
      amount_cents: number;
      date: LocalDate;
      judged_at: string;
    }[];
    return rows.map((row) => ({
      pactId: row.id,
      name: row.name,
      penaltyCents: row.amount_cents,
      occurrenceDate: row.date,
      missedAt: new Date(row.judged_at),
    }));
  }

  /** Who rejected the latest rejected evidence for an occurrence, and why; null if none was rejected. */
  #rejection(pactId: string, date: LocalDate): EvidenceRejection | null {
    const row = this.#db
      .prepare(
        `SELECT account.name, evidence.reject_reason FROM evidence
         JOIN account ON account.id = evidence.decided_by_account_id
         WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'rejected'
         ORDER BY evidence.decided_at DESC, evidence.submitted_at DESC
         LIMIT 1`,
      )
      .get(pactId, date) as { name: string; reject_reason: string } | undefined;
    return row ? { reviewerName: row.name, reason: row.reject_reason } : null;
  }

  /** `ownerId`'s Active pacts, sorted by name. */
  #activePacts(ownerId: AccountId): ActivePact[] {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, pact.schedule, pact.penalty_cents, pact.first_occurrence,
                recipient.name AS recipient_name
         FROM pact JOIN recipient ON recipient.id = pact.recipient_id
         WHERE pact.owner_account_id = ? AND pact.stage = 'active'
         ORDER BY pact.name, pact.created_at, pact.id`,
      )
      .all(ownerId) as (Pick<PactRow, "id" | "name" | "schedule" | "penalty_cents" | "first_occurrence"> & {
      recipient_name: string;
    })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      penaltyCents: row.penalty_cents,
      recipientName: row.recipient_name,
      terms: occurrenceTermsOf(row),
    }));
  }

  /** The recipients matching the SQL `condition` on `recipient`, sorted by name. */
  #selectRecipients(condition: string, ...params: string[]): Recipient[] {
    return this.#db
      .prepare(`SELECT id, name FROM recipient WHERE ${condition} ORDER BY name, id`)
      .all(...params) as Recipient[];
  }

  async advanceTo(t: Date): Promise<void> {
    await this.#command(() => {
      this.#judgeDueBy(t);
      this.#db
        .prepare(
          `INSERT INTO scheduler_state (id, last_tick_at) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET last_tick_at = excluded.last_tick_at`,
        )
        .run(t.toISOString());
    });
    await this.#delivery;
  }

  /**
   * Judges each pact's occurrences due by `t`, from where judging got to last
   * time (the pact's `judged_through`), so a stopped scheduler catches up.
   */
  #judgeDueBy(t: Date): void {
    for (const pact of this.#pactsToJudge()) {
      // Every pact's owner has a timezone: creating one needs it.
      if (pact.timezone === null) continue;
      const due = occurrences(occurrenceTermsOf(pact), pact.timezone).dueAfter(pact.judged_through, t);
      for (const occurrence of due) this.#judgeAtDueTime(pact.id, occurrence);
      const last = due.at(-1);
      if (last) this.#db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(last.date, pact.id);
    }
  }

  /** Every pact (or just `pactId`) with what judging reads of it: its terms, cursor and owner's timezone. */
  #pactsToJudge(pactId?: string): PactToJudge[] {
    return this.#db
      .prepare(
        `SELECT pact.id, pact.schedule, pact.first_occurrence, pact.judged_through, account.timezone
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE ? IS NULL OR pact.id = ?`,
      )
      .all(pactId ?? null, pactId ?? null) as PactToJudge[];
  }

  /**
   * Judges an occurrence as of its due time, unless a decision after that
   * already judged it or its evidence is still waiting for one.
   */
  #judgeAtDueTime(pactId: string, occurrence: Occurrence): void {
    if (this.#isJudged(pactId, occurrence.date)) return;
    const decision = this.#evidenceDecision(pactId, occurrence.date);
    if (decision === "waiting") return;
    const outcome = decision === "approved" ? "kept" : "missed";
    this.#judge(pactId, occurrence.date, outcome, occurrence.dueAt);
    if (outcome === "missed") this.#enqueueMissed(pactId, occurrence.date);
  }

  /** Only for judging at the due time: a rejection already told the owner, with the reason. */
  #enqueueMissed(pactId: string, date: LocalDate): void {
    const pact = this.#db
      .prepare(`SELECT owner_account_id, name, recipient_id, penalty_cents FROM pact WHERE id = ?`)
      .get(pactId) as { owner_account_id: AccountId; name: string; recipient_id: string; penalty_cents: number };
    this.#enqueue({
      recipient: pact.owner_account_id,
      kind: "missed-occurrence",
      channel: "push",
      payload: {
        pactId,
        occurrenceDate: date,
        title: `${pact.name} is Missed`,
        body: `${formatDate(date)} · ${money(pact.penalty_cents)} to ${this.#recipientName(pact.recipient_id)}`,
        url: APP_PATHS.pact(pactId),
      },
    });
  }

  /** Whether the occurrence already has an outcome, Kept or Missed. */
  #isJudged(pactId: string, date: LocalDate): boolean {
    return (
      this.#db
        .prepare(`SELECT 1 FROM occurrence WHERE pact_id = ? AND date = ? AND outcome IS NOT NULL`)
        .get(pactId, date) !== undefined
    );
  }

  /**
   * Records an occurrence's outcome as of `at`. Missed adds the pact's
   * penalty to the owner's ledger for the pact's recipient.
   */
  #judge(pactId: string, date: LocalDate, outcome: "kept" | "missed", at: Date): void {
    const pact = this.#db
      .prepare(`SELECT owner_account_id, recipient_id, penalty_cents FROM pact WHERE id = ?`)
      .get(pactId) as Pick<PactRow, "recipient_id" | "penalty_cents"> & { owner_account_id: AccountId };
    this.#db
      .prepare(
        `INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (pact_id, date) DO UPDATE SET outcome = excluded.outcome, judged_at = excluded.judged_at`,
      )
      .run(pactId, date, outcome, at.toISOString());
    if (outcome === "missed") {
      this.#db
        .prepare(
          `INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          pact.owner_account_id,
          pact.recipient_id,
          pactId,
          date,
          pact.penalty_cents,
          at.toISOString(),
        );
    }
  }

  lastTick(): Date | null {
    const row = this.#db.prepare(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`).get() as
      { last_tick_at: string } | undefined;
    return row ? new Date(row.last_tick_at) : null;
  }

  health(): Health {
    const lastTick = this.lastTick();
    const ok = lastTick !== null && this.#clock.now().getTime() - lastTick.getTime() <= HEALTHY_TICK_AGE_MS;
    return { ok, lastTick };
  }

  schemaVersion(): number {
    return this.#db.pragma("user_version", { simple: true }) as number;
  }

  async raiseRestoreAlert(): Promise<void> {
    await this.#command(
      () => {
        const lastTick = this.lastTick()?.toISOString() ?? null;
        const operator = this.#db.prepare(`SELECT id FROM account WHERE is_operator = 1`).get() as
          { id: string } | undefined;
        if (operator) {
          this.#enqueue({
            recipient: operator.id,
            kind: "operator-alert",
            channel: "push",
            payload: {
              alert: "database-restored",
              lastTick,
              title: "Operator alert",
              body: `Database restored from backup. Last tick: ${lastTick ?? "none"}`,
              url: APP_PATHS.today,
            },
          });
        }
        return lastTick;
      },
      // The log line is the alert's channel that never depends on delivery.
      (lastTick) =>
        this.#log(
          `OPERATOR_ALERT database restored from backup; last scheduler tick before the restore: ${lastTick ?? "none"}`,
        ),
    );
    await this.#delivery;
  }

  deliveriesSettled(): Promise<void> {
    return this.#delivery;
  }

  async close(): Promise<void> {
    await this.#delivery;
    this.#db.close();
  }
}

function isPushDevice({ endpoint, p256dh, auth }: PushDevice): boolean {
  if (!URL.canParse(endpoint)) return false;
  const { protocol, hostname } = new URL(endpoint);
  return (
    protocol === "https:" &&
    PUSH_SERVICE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
    isBase64UrlOfLength(p256dh, P256DH_BYTES) &&
    isBase64UrlOfLength(auth, AUTH_BYTES) &&
    isPointOnCurve(p256dh)
  );
}

/** Encrypting for a key that isn't a real P-256 point throws, for every notification to it. */
function isPointOnCurve(publicKey: string): boolean {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  try {
    ecdh.computeSecret(Buffer.from(publicKey, "base64url"));
    return true;
  } catch {
    return false;
  }
}

function isBase64UrlOfLength(text: string, bytes: number): boolean {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(text) && Buffer.from(text, "base64url").length === bytes;
}

interface InviteRow {
  token: string;
  inviter_account_id: string;
  inviter_name: string;
  expires_at: string;
  used_at: string | null;
  claimed_by_account_id: string | null;
}

/** A friendship row's two account ids, in the order the table stores them. */
function friendshipPair(a: AccountId, b: AccountId): [AccountId, AccountId] {
  return a < b ? [a, b] : [b, a];
}

/** An Active pact as Today and the Pacts tab read it. */
interface ActivePact {
  id: string;
  name: string;
  penaltyCents: number;
  recipientName: string;
  terms: OccurrenceTerms;
}

/** A pact row's occurrence terms: the one place a stored schedule is read. */
function occurrenceTermsOf(row: Pick<PactRow, "schedule" | "first_occurrence">): OccurrenceTerms {
  return { schedule: JSON.parse(row.schedule) as Schedule, firstOccurrence: row.first_occurrence };
}

interface PactRow {
  id: string;
  name: string;
  description: string;
  evidence_kind: PactTerms["evidenceKind"];
  schedule: string;
  penalty_cents: number;
  recipient_id: string;
  stage: PactTerms["stage"];
  first_occurrence: string;
}

/** A pact as judging reads it. */
type PactToJudge = Pick<PactRow, "id" | "schedule" | "first_occurrence"> & {
  judged_through: LocalDate | null;
  timezone: string | null;
};

/** Evidence a reviewer is deciding on, as `decide` reads it. */
interface EvidenceToDecide {
  id: string;
  pact_id: string;
  occurrence_date: LocalDate;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

/** A payment a reviewer is deciding on, as `decide` reads it. */
interface PaymentToDecide {
  id: string;
  owner_account_id: AccountId;
  recipient_id: string;
  decision: ReviewOutcome | null;
}

/** A reviewer's decision on some evidence or a payment, as stored. */
type ReviewOutcome = "approved" | "rejected";

/** A checked review decision, as `decide` hands it on: a rejection's reason is trimmed and never blank. */
interface Decided {
  outcome: ReviewOutcome;
  reason: string | null;
}

/**
 * `lists` merged into one sorted by `at`, oldest or newest first. Ties keep
 * the order they have in `lists`, as the sort is stable.
 */
function mergeByTime<T>(at: (item: T) => Date, direction: "oldest-first" | "newest-first", ...lists: T[][]): T[] {
  const sign = direction === "oldest-first" ? 1 : -1;
  return lists.flat().sort((a, b) => sign * (at(a).getTime() - at(b).getTime()));
}

interface OutboxRow {
  id: number;
  recipient_account_id: string;
  kind: string;
  channel: string;
  payload: string;
  sent_to: string;
}

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`no account ${accountId}`);
    this.name = "UnknownAccountError";
  }
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The IANA zone's canonical name, or null if `timezone` isn't an IANA zone. */
function canonicalTimezone(timezone: string): string | null {
  // Intl also accepts UTC offsets like "+05:00"; an account needs a real zone.
  if (timezone.trim() === "" || /^[+-]/.test(timezone)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
