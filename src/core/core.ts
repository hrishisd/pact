// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { randomUUID } from "node:crypto";
import { openDatabase, type Db } from "./db.ts";
import type { Clock, Notification, Notifier, OuraSource, PhotoStore } from "./ports.ts";
import type {
  AccountId,
  Health,
  Profile,
  SetTimezoneResult,
  SignInResult,
  Today,
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
  /** Idempotent. Creates an account only for the operator's first sign-in (invites: ticket 02). */
  signIn(identity: { email: string; name: string }): Promise<SignInResult>;
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
  profile(): Profile;
  today(): Today;
}

export function createPactCore(options: PactCoreOptions): PactCore {
  const db = openDatabase(options.dbPath);
  return new Core(db, options);
}

/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;

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

  signIn(identity: { email: string; name: string }): Promise<SignInResult> {
    return this.#command((): SignInResult => {
      const existing = this.accountIdForEmail(identity.email);
      if (existing !== null) return { ok: true, accountId: existing };

      const key = emailKey(identity.email);
      if (key !== this.#operatorEmailKey) return { ok: false, reason: "invite-required" };
      const operatorExists = this.#db.prepare(`SELECT 1 FROM account WHERE is_operator = 1`).get();
      if (operatorExists) return { ok: false, reason: "invite-required" };

      const id = randomUUID();
      this.#db
        .prepare(
          `INSERT INTO account (id, email, email_key, name, is_operator, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
        )
        .run(id, identity.email, key, identity.name, this.#clock.now().toISOString());
      return { ok: true, accountId: id };
    });
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
      profile: () => {
        const { email, name, timezone } = account();
        return { email, name, timezone };
      },
      today: () => {
        account();
        return { alerts: [], sections: [], waiting: [], yesterday: [] };
      },
    };
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
