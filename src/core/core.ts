// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { randomBytes, randomUUID } from "node:crypto";
import { firstFixedDaysOccurrence, localDateOf, midnightEnding, weekdayOf } from "./calendar.ts";
import { openDatabase, type Db } from "./db.ts";
import type { Clock, Notification, Notifier, OuraSource, PhotoStore } from "./ports.ts";
import {
  WEEKDAYS,
  type AcceptInviteResult,
  type AccountId,
  type AddRecipientResult,
  type CreatePactResult,
  type FirstOccurrenceResult,
  type Friend,
  type Health,
  type Invite,
  type InviteLookup,
  type NewPact,
  type NewRecipient,
  type PactSummary,
  type PactResult,
  type PactTerms,
  type Recipient,
  type Profile,
  type Schedule,
  type SetTimezoneResult,
  type SignInResult,
  type Today,
  type TodayComingUpCard,
  type TodaySection,
  type TodayToDoCard,
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
  signIn(
    identity: { email: string; name: string },
    options?: { inviteToken?: string },
  ): Promise<SignInResult>;
  /** The invite page's view of `token` for a signed-out visitor: a claimed invite shows as used. */
  invite(token: string): InviteLookup;
  /** The account signed in with `email` (whatever its case), or null if there is none. Never writes. */
  accountIdForEmail(email: string): AccountId | null;
  /** Commands and queries made as one account. */
  as(accountId: AccountId): AccountView;
  /** Runs everything due by `t` (nothing yet), records the tick, then delivers the outbox. */
  advanceTo(t: Date): Promise<void>;
  lastTick(): Date | null;
  /** Not ok when there's no tick in the last 5 minutes by the clock. */
  health(): Health;
  /** After a restore from backup: tells the operator how old the restored data is. */
  raiseRestoreAlert(): Promise<void>;
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
}

export function createPactCore(options: PactCoreOptions): PactCore {
  const db = openDatabase(options.dbPath);
  return new Core(db, options);
}

/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

class Core implements PactCore {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #notifier: Notifier;
  readonly #operatorEmailKey: string;
  readonly #log: (line: string) => void;
  /** Outbox deliveries run one at a time, in this chain. */
  #delivery: Promise<void> = Promise.resolve();

  constructor(db: Db, options: PactCoreOptions) {
    this.#db = db;
    this.#clock = options.clock;
    this.#notifier = options.notifier;
    this.#operatorEmailKey = emailKey(options.operatorEmail);
    this.#log = options.log ?? ((line) => console.log(line));
  }

  /**
   * Runs `change` as one transaction: all of it commits or none of it does.
   * Then runs `afterCommit` and delivers the outbox. A delivery failure
   * doesn't fail the command; the notification waits for the next attempt.
   */
  async #command<T>(change: () => T, afterCommit?: (result: T) => void): Promise<T> {
    const result = this.#db.transaction(change).immediate();
    afterCommit?.(result);
    await this.#deliverOutbox();
    return result;
  }

  /** Queues a notification in the current command's transaction. */
  #enqueue(notification: Notification): void {
    if (!this.#db.inTransaction) throw new Error("notifications are enqueued only inside a command");
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

  #deliverOutbox(): Promise<void> {
    this.#delivery = this.#delivery
      .then(() => this.#deliverPending())
      .catch((error: unknown) => this.#log(`outbox delivery stopped, will retry: ${String(error)}`));
    return this.#delivery;
  }

  async #deliverPending(): Promise<void> {
    const rows = this.#db
      .prepare(
        `SELECT id, recipient_account_id, kind, channel, payload
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
        await this.#notifier.deliver(notification);
        this.#db
          .prepare(`UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?`)
          .run(this.#clock.now().toISOString(), row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#db
          .prepare(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`)
          .run(message, row.id);
        this.#log(
          `notification ${row.id} (${row.kind} to ${row.recipient_account_id}) not delivered, will retry: ${message}`,
        );
      }
    }
  }

  signIn(
    identity: { email: string; name: string },
    options: { inviteToken?: string } = {},
  ): Promise<SignInResult> {
    return this.#command((): SignInResult => {
      const existing = this.accountIdForEmail(identity.email);
      if (existing !== null) return { ok: true, accountId: existing };

      const key = emailKey(identity.email);
      const isOperator =
        key === this.#operatorEmailKey &&
        !this.#db.prepare(`SELECT 1 FROM account WHERE is_operator = 1`).get();
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
      this.#db
        .prepare(`SELECT 1 FROM friendship WHERE account_a_id = ? AND account_b_id = ?`)
        .get(first, second) !== undefined
    );
  }

  accountIdForEmail(email: string): AccountId | null {
    const row = this.#db.prepare(`SELECT id FROM account WHERE email_key = ?`).get(emailKey(email)) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  as(accountId: AccountId): AccountView {
    const account = () => {
      const row = this.#db
        .prepare(`SELECT email, name, timezone FROM account WHERE id = ?`)
        .get(accountId) as { email: string; name: string; timezone: string | null } | undefined;
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
            .prepare(
              `INSERT INTO invite (token, inviter_account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
            )
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
          const schedule = normalSchedule(pact.schedule);
          if (schedule.days.length === 0) return { ok: false, reason: "no-days" };
          if (!Number.isSafeInteger(pact.penaltyCents) || pact.penaltyCents <= 0) {
            return { ok: false, reason: "invalid-penalty" };
          }
          if (timezone === null) return { ok: false, reason: "no-timezone" };
          const isOwnRecipient = this.#db
            .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
            .get(pact.recipientId, accountId);
          if (!isOwnRecipient) return { ok: false, reason: "unknown-recipient" };
          const reviewerIds = [...new Set(pact.reviewerIds)];
          if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
          if (!reviewerIds.every((id) => this.#areFriends(accountId, id))) return { ok: false, reason: "not-a-friend" };

          const now = this.#clock.now();
          const first = firstFixedDaysOccurrence(schedule.days, now, timezone);
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
              JSON.stringify(schedule),
              pact.penaltyCents,
              pact.recipientId,
              first.date,
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
        const { days } = normalSchedule(schedule);
        if (days.length === 0) return { ok: false, reason: "no-days" };
        return { ok: true, firstOccurrence: firstFixedDaysOccurrence(days, this.#clock.now(), timezone) };
      },
      pacts: () => {
        account();
        return this.#activePacts(accountId).map(({ id, name, schedule, penaltyCents }) => ({
          id,
          name,
          schedule,
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
        const pact: PactTerms = {
          id: row.id,
          name: row.name,
          description: row.description,
          evidenceKind: row.evidence_kind,
          schedule: JSON.parse(row.schedule) as Schedule,
          penaltyCents: row.penalty_cents,
          recipient,
          reviewers,
          stage: row.stage,
          firstOccurrence: { date: row.first_occurrence, dueAt: midnightEnding(row.first_occurrence, timezone) },
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
        const sections = timezone === null ? [] : this.#todaySections(accountId, timezone);
        const hasPacts = this.#db.prepare(`SELECT 1 FROM pact WHERE owner_account_id = ?`).get(accountId) !== undefined;
        return { hasPacts, alerts: [], sections, waiting: [], yesterday: [] };
      },
    };
  }

  /**
   * To do: Fixed-days pacts whose occurrence is open today (today, in the
   * owner's timezone, is a scheduled day on or after the first occurrence).
   * Coming up: pacts whose first occurrence hasn't opened yet. A pact on a
   * day it isn't due appears in neither. Empty sections are left out.
   */
  #todaySections(ownerId: AccountId, timezone: string): TodaySection[] {
    const today = localDateOf(this.#clock.now(), timezone);
    const toDo: TodayToDoCard[] = [];
    const comingUp: TodayComingUpCard[] = [];
    for (const pact of this.#activePacts(ownerId)) {
      const card = { pactId: pact.id, name: pact.name, penaltyCents: pact.penaltyCents };
      if (today < pact.firstOccurrence) {
        comingUp.push({ ...card, opensOn: pact.firstOccurrence });
      } else if (pact.schedule.days.includes(weekdayOf(today))) {
        toDo.push({ ...card, dueAt: midnightEnding(today, timezone) });
      }
    }
    // Rows come sorted by name, and the sorts are stable.
    toDo.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    comingUp.sort((a, b) => a.opensOn.localeCompare(b.opensOn));
    const sections: TodaySection[] = [];
    if (toDo.length > 0) sections.push({ kind: "to-do", cards: toDo });
    if (comingUp.length > 0) sections.push({ kind: "coming-up", cards: comingUp });
    return sections;
  }

  /** `ownerId`'s Active pacts, sorted by name. */
  #activePacts(ownerId: AccountId): ActivePact[] {
    const rows = this.#db
      .prepare(
        `SELECT id, name, schedule, penalty_cents, first_occurrence FROM pact
         WHERE owner_account_id = ? AND stage = 'active'
         ORDER BY name, created_at, id`,
      )
      .all(ownerId) as Pick<PactRow, "id" | "name" | "schedule" | "penalty_cents" | "first_occurrence">[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      schedule: JSON.parse(row.schedule) as Schedule,
      penaltyCents: row.penalty_cents,
      firstOccurrence: row.first_occurrence,
    }));
  }

  /** The recipients matching the SQL `condition` on `recipient`, sorted by name. */
  #selectRecipients(condition: string, ...params: string[]): Recipient[] {
    return this.#db
      .prepare(`SELECT id, name FROM recipient WHERE ${condition} ORDER BY name, id`)
      .all(...params) as Recipient[];
  }

  advanceTo(t: Date): Promise<void> {
    return this.#command(() => {
      this.#db
        .prepare(
          `INSERT INTO scheduler_state (id, last_tick_at) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET last_tick_at = excluded.last_tick_at`,
        )
        .run(t.toISOString());
    });
  }

  lastTick(): Date | null {
    const row = this.#db.prepare(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`).get() as
      | { last_tick_at: string }
      | undefined;
    return row ? new Date(row.last_tick_at) : null;
  }

  health(): Health {
    const lastTick = this.lastTick();
    const ok =
      lastTick !== null && this.#clock.now().getTime() - lastTick.getTime() <= HEALTHY_TICK_AGE_MS;
    return { ok, lastTick };
  }

  async raiseRestoreAlert(): Promise<void> {
    await this.#command(
      () => {
        const lastTick = this.lastTick()?.toISOString() ?? null;
        const operator = this.#db.prepare(`SELECT id FROM account WHERE is_operator = 1`).get() as
          | { id: string }
          | undefined;
        if (operator) {
          this.#enqueue({
            recipient: operator.id,
            kind: "operator-alert",
            channel: "push",
            payload: { alert: "database-restored", lastTick },
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
  }

  async close(): Promise<void> {
    await this.#delivery;
    this.#db.close();
  }
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

/** An Active pact as Today and the Pacts tab read it. `firstOccurrence` is its "YYYY-MM-DD" day. */
interface ActivePact {
  id: string;
  name: string;
  schedule: Schedule;
  penaltyCents: number;
  firstOccurrence: string;
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

interface OutboxRow {
  id: number;
  recipient_account_id: string;
  kind: string;
  channel: string;
  payload: string;
}

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`no account ${accountId}`);
    this.name = "UnknownAccountError";
  }
}

/** `schedule` with its days Monday first and without repeats, as stored. */
function normalSchedule(schedule: Schedule): Schedule {
  return { kind: "fixed-days", days: WEEKDAYS.filter((day) => schedule.days.includes(day)) };
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
