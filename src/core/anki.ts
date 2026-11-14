// The Anki adapter: the production AnkiSource, plus the AnkiWeb login the
// server's connect route takes. It runs anki_check.py (Anki's own `anki`
// package) once per operation, with JSON on stdin and stdout, and keeps each
// account's AnkiWeb host key, encrypted, in the `anki_connection` table (which
// the core's migrations create and only this file touches). The password is
// traded for the host key and never stored.
//
// The host key can write to the owner's collection, so the script only ever
// checks for changes and downloads; it never uploads or syncs. Each account's
// downloaded collection lives in `collectionsDir`, outside pact.db, and is
// deleted on disconnect. One operation runs at a time per account.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { localDateOf } from "./calendar.ts";
import { openWithPragmas, type Db } from "./db.ts";
import { secretBox, type SecretBox } from "./secret-box.ts";
import type { AccountId, AnkiCounts, AnkiDeck } from "../shared/types.ts";
import type { RaiseOperatorAlert } from "./operator-alerts.ts";
import type { AnkiCountsResult, AnkiDeckListResult, AnkiSource, Clock } from "./ports.ts";

export interface AnkiSetup {
  /** 32 bytes, base64: encrypts the stored host keys. */
  tokenKey: string;
  /** Where each account's downloaded collection is kept: on the data volume, outside pact.db. */
  collectionsDir: string;
}

/** What the adapter asks the script. */
export type AnkiScriptRequest =
  | { op: "login"; username: string; password: string; endpoint?: string }
  | { op: "decks"; hostKey: string; endpoint: string | null; collection: string }
  | { op: "counts"; hostKey: string; endpoint: string | null; collection: string; deckIds: string[] };

/** Runs the script once: the request in, its parsed answer out. Throws if it can't run or answer. */
export type AnkiScriptRunner = (request: AnkiScriptRequest) => Promise<unknown>;

export interface AnkiAdapterOptions {
  /** Tests answer for the script; production runs it with `python`. */
  run?: AnkiScriptRunner;
  /** Where to log in instead of AnkiWeb, such as a local Anki sync server for a check by hand. */
  loginEndpoint?: string;
  /** The Python with the pinned `anki` package. Default: python3. */
  python?: string;
  /** How long one run may take: a download of a large collection takes a while. Default 120s. */
  timeoutMs?: number;
  /** Where the adapter writes log lines (a failed login). Default: console.log. */
  log?: (line: string) => void;
  /** The operator alert path (operator-alerts.ts), for a protocol error. */
  raiseOperatorAlert: RaiseOperatorAlert;
}

export type AnkiLoginResult = { ok: true } | { ok: false; reason: "wrong-login" | "unreachable" };

export interface AnkiConnector {
  /** Trades the AnkiWeb email and password for a host key and stores it. The password is dropped. */
  login(account: AccountId, username: string, password: string): Promise<AnkiLoginResult>;
  /**
   * Deletes the account's host key and its collection copy, once it has
   * disconnected AnkiWeb. Waits for an operation already running for it.
   */
  forget(account: AccountId): Promise<void>;
}

export type AnkiAdapter = AnkiSource & AnkiConnector & { close(): void };

const SCRIPT = join(import.meta.dirname, "anki_check.py");
const DEFAULT_TIMEOUT_MS = 120_000;
/** The script's answer can hold a whole deck list. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export function ankiAdapter(dbPath: string, setup: AnkiSetup, clock: Clock, options: AnkiAdapterOptions): AnkiAdapter {
  return new Anki(openWithPragmas(dbPath), setup, clock, options);
}

/**
 * Production without an Anki token key: no account can connect, so there's
 * nothing to check. Never the dev stand-in, which would read decks from a file.
 */
export const unavailableAnki: AnkiSource = {
  decks: async () => ({ ok: false, reason: "disconnected" }),
  deckCounts: async () => ({ ok: false, reason: "disconnected" }),
};

/**
 * Development only, for running the app without AnkiWeb: any login works
 * except the password "wrong" (wrong-login) and "unreachable", and decks
 * come from `anki-decks.json` in `dir`, read on every call: `{ rolloverHour,
 * timezone, decks }`, with `decks` in the AnkiDeck shape. Counts are each
 * deck's, as of now, for the Anki day now falls in. With no file there are
 * no decks. With `refused: true` in the file, AnkiWeb refuses the login:
 * decks and counts answer "disconnected".
 */
export function devAnki(dir: string, clock: Clock): AnkiAdapter {
  const file = join(dir, "anki-decks.json");
  const read = (): { rolloverHour: number; timezone: string; decks: AnkiDeck[]; refused: boolean } => {
    const stored = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Partial<{
          rolloverHour: number;
          timezone: string;
          decks: AnkiDeck[];
          refused: boolean;
        }>)
      : {};
    return {
      rolloverHour: stored.rolloverHour ?? 4,
      timezone: stored.timezone ?? "America/New_York",
      decks: stored.decks ?? [],
      refused: stored.refused === true,
    };
  };
  return {
    login: async (_account, _username, password) =>
      password === "wrong"
        ? { ok: false, reason: "wrong-login" }
        : password === "unreachable"
          ? { ok: false, reason: "unreachable" }
          : { ok: true },
    forget: async () => {},
    close: () => {},
    decks: async () => {
      const { decks, rolloverHour, refused } = read();
      return refused ? { ok: false, reason: "disconnected" } : { ok: true, decks, rolloverHour };
    },
    deckCounts: async (_account, deckIds) => {
      const { decks, rolloverHour, timezone, refused } = read();
      if (refused) return { ok: false, reason: "disconnected" };
      const asOf = clock.now();
      const asked = decks.filter((deck) => deckIds.includes(deck.id));
      return {
        ok: true,
        ankiDate: localDateOf(new Date(asOf.getTime() - rolloverHour * 60 * 60 * 1000), timezone),
        asOf,
        decks: Object.fromEntries(deckIds.map((id) => [id, asked.find((deck) => deck.id === id)?.counts ?? null])),
        names: Object.fromEntries(asked.map((deck) => [deck.id, deck.name])),
      };
    },
  };
}

type ScriptOp = AnkiScriptRequest["op"];

/** The script's answer to each op when it succeeds, as anki_check.py writes it. */
interface ScriptAnswers {
  login: { hostKey: string; endpoint: string | null };
  decks: { decks: AnkiDeck[]; rolloverHour: number; endpoint: string | null };
  counts: {
    ankiDate: string;
    asOf: number;
    decks: Record<string, AnkiCounts | null>;
    names: Record<string, string>;
    endpoint: string | null;
  };
}

type ScriptFailure = { ok: false; error: "auth" | "network" | "protocol"; message: string };

/** The script's answer to an `op` request. */
type ScriptAnswer<Op extends ScriptOp> = ({ ok: true } & ScriptAnswers[Op]) | ScriptFailure;

/** A field each op's successful answer must have, and what's wrong when it doesn't. */
const ANSWER_CHECKS: { [Op in ScriptOp]: { field: keyof ScriptAnswers[Op]; missing: string } } = {
  login: { field: "hostKey", missing: "AnkiWeb login answered without a host key" },
  decks: { field: "rolloverHour", missing: "AnkiWeb deck list answered without decks" },
  counts: { field: "ankiDate", missing: "AnkiWeb counts answered without counts" },
};

/** The script said it succeeded but answered something else: its bug, not a failure to reach AnkiWeb. */
class WrongAnswer extends Error {}

class Anki implements AnkiAdapter {
  readonly #db: Db;
  readonly #box: SecretBox;
  readonly #clock: Clock;
  readonly #collectionsDir: string;
  readonly #run: AnkiScriptRunner;
  readonly #loginEndpoint: string | undefined;
  readonly #log: (line: string) => void;
  readonly #raiseOperatorAlert: RaiseOperatorAlert;
  /**
   * Accounts whose protocol error has been emailed since AnkiWeb last answered
   * them: each further one is only logged, as a check every 10 minutes would
   * otherwise email each time. In memory: a restart costs at most one more email.
   */
  readonly #protocolErrorEmailed = new Set<AccountId>();
  /** The operation running for each account: the next waits for it. */
  readonly #running = new Map<AccountId, Promise<unknown>>();

  constructor(db: Db, setup: AnkiSetup, clock: Clock, options: AnkiAdapterOptions) {
    this.#db = db;
    this.#clock = clock;
    this.#box = secretBox(setup.tokenKey, "Anki token key");
    this.#collectionsDir = setup.collectionsDir;
    this.#log = options.log ?? console.log;
    this.#raiseOperatorAlert = options.raiseOperatorAlert;
    this.#loginEndpoint = options.loginEndpoint;
    this.#run = options.run ?? pythonRunner(options.python ?? "python3", options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  async login(account: AccountId, username: string, password: string): Promise<AnkiLoginResult> {
    // The whole login, storing included, holds the account's turn: a disconnect or check waits for it.
    return this.#oneAtATime(account, async () => {
      let answer: ScriptAnswer<"login">;
      try {
        answer = await this.#ask({
          op: "login",
          username,
          password,
          ...(this.#loginEndpoint !== undefined && { endpoint: this.#loginEndpoint }),
        });
      } catch (error) {
        // A script bug, not AnkiWeb out of reach: it fails the login.
        if (error instanceof WrongAnswer) throw error;
        this.#log(`AnkiWeb login failed for account ${account}: ${error instanceof Error ? error.message : error}`);
        return { ok: false, reason: "unreachable" };
      }
      if (!answer.ok) {
        if (answer.error === "auth") return { ok: false, reason: "wrong-login" };
        if (answer.error === "protocol") this.#alertProtocolError(account, answer.message);
        else this.#log(`AnkiWeb login failed for account ${account}: ${answer.error} error: ${answer.message}`);
        return { ok: false, reason: "unreachable" };
      }
      this.#protocolErrorEmailed.delete(account);
      this.#db
        .prepare(
          `INSERT INTO anki_connection (account_id, host_key, endpoint, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (account_id) DO UPDATE SET host_key = excluded.host_key, endpoint = excluded.endpoint,
             updated_at = excluded.updated_at`,
        )
        .run(account, this.#box.encrypt(answer.hostKey), answer.endpoint, this.#clock.now().toISOString());
      // A new login may be another AnkiWeb account: its collection is downloaded afresh.
      this.#removeCopy(account);
      return { ok: true };
    });
  }

  /** Waits for any operation running for the account, so its download can't bring the copy back afterwards. */
  forget(account: AccountId): Promise<void> {
    return this.#oneAtATime(account, async () => {
      this.#db.prepare(`DELETE FROM anki_connection WHERE account_id = ?`).run(account);
      this.#removeCopy(account);
    });
  }

  async decks(account: AccountId): Promise<AnkiDeckListResult> {
    const answer = await this.#withLogin(account, (login) => this.#ask({ op: "decks", ...login }));
    if (answer === null) return { ok: false, reason: "disconnected" };
    return { ok: true, decks: answer.decks, rolloverHour: answer.rolloverHour };
  }

  async deckCounts(account: AccountId, deckIds: readonly string[]): Promise<AnkiCountsResult> {
    const answer = await this.#withLogin(account, (login) =>
      this.#ask({ op: "counts", ...login, deckIds: [...deckIds] }),
    );
    if (answer === null) return { ok: false, reason: "disconnected" };
    return {
      ok: true,
      ankiDate: answer.ankiDate,
      asOf: new Date(answer.asOf),
      decks: answer.decks,
      names: answer.names,
    };
  }

  close(): void {
    this.#db.close();
  }

  /**
   * Runs `operation` with the account's stored login, one at a time per
   * account, and keeps the endpoint AnkiWeb moved it to. Null when there's no
   * login, or AnkiWeb refused it. A network or protocol error throws.
   */
  async #withLogin<Op extends ScriptOp>(
    account: AccountId,
    operation: (login: { hostKey: string; endpoint: string | null; collection: string }) => Promise<ScriptAnswer<Op>>,
  ): Promise<({ ok: true } & ScriptAnswers[Op]) | null> {
    return this.#oneAtATime(account, async () => {
      const row = this.#db
        .prepare(`SELECT host_key, endpoint FROM anki_connection WHERE account_id = ?`)
        .get(account) as { host_key: string; endpoint: string | null } | undefined;
      if (!row) return null;
      const hostKey = this.#box.decrypt(row.host_key);
      const answer = await operation({ hostKey, endpoint: row.endpoint, collection: this.#copyOf(account) });
      if (!answer.ok) {
        if (answer.error === "auth") return null;
        if (answer.error === "protocol") this.#alertProtocolError(account, answer.message);
        throw new Error(`AnkiWeb ${answer.error} error: ${answer.message}`);
      }
      this.#protocolErrorEmailed.delete(account);
      if (answer.endpoint !== row.endpoint && answer.endpoint !== null) {
        this.#db.prepare(`UPDATE anki_connection SET endpoint = ? WHERE account_id = ?`).run(answer.endpoint, account);
      }
      return answer;
    });
  }

  #alertProtocolError(account: AccountId, message: string): void {
    this.#raiseOperatorAlert({
      title: "AnkiWeb protocol error",
      text:
        `AnkiWeb protocol error for account ${account}: ${message}. ` +
        `AnkiWeb may have changed its sync protocol; the pinned anki package may need updating.`,
      withoutEmail: this.#protocolErrorEmailed.has(account),
    });
    this.#protocolErrorEmailed.add(account);
  }

  /**
   * The script's answer to `request`, checked to be one: this is where the
   * script's output is trusted. An answer that says it succeeded but lacks
   * what the op returns throws a WrongAnswer.
   */
  async #ask<Op extends ScriptOp>(request: Extract<AnkiScriptRequest, { op: Op }>): Promise<ScriptAnswer<Op>> {
    const answer = await this.#run(request);
    if (typeof answer !== "object" || answer === null || !("ok" in answer) || typeof answer.ok !== "boolean") {
      throw new Error("the Anki script's answer wasn't one");
    }
    const { field, missing } = ANSWER_CHECKS[request.op];
    if (answer.ok && !(field in answer)) throw new WrongAnswer(missing);
    return answer as ScriptAnswer<Op>;
  }

  #oneAtATime<T>(account: AccountId, operation: () => Promise<T>): Promise<T> {
    const before = this.#running.get(account) ?? Promise.resolve();
    const next = before.catch(() => {}).then(operation);
    const settled = next.catch(() => {});
    this.#running.set(account, settled);
    void settled.then(() => {
      if (this.#running.get(account) === settled) this.#running.delete(account);
    });
    return next;
  }

  #copyOf(account: AccountId): string {
    return join(this.#collectionsDir, `${account}.anki2`);
  }

  /** The collection copy and the files SQLite keeps beside it. */
  #removeCopy(account: AccountId): void {
    const copy = this.#copyOf(account);
    for (const path of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) rmSync(path, { force: true });
  }
}

/** Runs anki_check.py with `python`, giving up after `timeoutMs`. */
function pythonRunner(python: string, timeoutMs: number): AnkiScriptRunner {
  return (request) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        python,
        // -I: isolated, so nothing beside the script or in the working directory is imported in its place.
        ["-I", SCRIPT],
        { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs + 5_000), maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout) => {
          if (error) return reject(new Error(`the Anki script failed: ${error.message.split("\n")[0]}`));
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("the Anki script's output wasn't JSON"));
          }
        },
      );
      child.stdin?.end(JSON.stringify(request));
    });
}
