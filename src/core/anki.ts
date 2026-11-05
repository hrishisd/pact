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
import type { AccountId, AnkiDeck } from "../shared/types.ts";
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
  /** Where the adapter writes log lines (an OPERATOR_ALERT for a protocol error). Default: console.log. */
  log?: (line: string) => void;
}

export type AnkiLoginResult = { ok: true } | { ok: false; reason: "wrong-login" | "unreachable" };

export interface AnkiConnector {
  /** Trades the AnkiWeb email and password for a host key and stores it. The password is dropped. */
  login(account: AccountId, username: string, password: string): Promise<AnkiLoginResult>;
  /** Deletes the account's host key and its collection copy, once it has disconnected AnkiWeb. */
  forget(account: AccountId): void;
}

export type AnkiAdapter = AnkiSource & AnkiConnector & { close(): void };

const SCRIPT = join(import.meta.dirname, "anki_check.py");
const DEFAULT_TIMEOUT_MS = 120_000;
/** The script's answer can hold a whole deck list. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export function ankiAdapter(
  dbPath: string,
  setup: AnkiSetup,
  clock: Clock,
  options: AnkiAdapterOptions = {},
): AnkiAdapter {
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
 * no decks.
 */
export function devAnki(dir: string, clock: Clock): AnkiSource & AnkiConnector {
  const file = join(dir, "anki-decks.json");
  const read = (): { rolloverHour: number; timezone: string; decks: AnkiDeck[] } => {
    const stored = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Partial<{
          rolloverHour: number;
          timezone: string;
          decks: AnkiDeck[];
        }>)
      : {};
    return {
      rolloverHour: stored.rolloverHour ?? 4,
      timezone: stored.timezone ?? "America/New_York",
      decks: stored.decks ?? [],
    };
  };
  return {
    login: async (_account, _username, password) =>
      password === "wrong"
        ? { ok: false, reason: "wrong-login" }
        : password === "unreachable"
          ? { ok: false, reason: "unreachable" }
          : { ok: true },
    forget: () => {},
    decks: async () => {
      const { decks, rolloverHour } = read();
      return { ok: true, decks, rolloverHour };
    },
    deckCounts: async (_account, deckIds) => {
      const { decks, rolloverHour, timezone } = read();
      const asOf = clock.now();
      return {
        ok: true,
        ankiDate: localDateOf(new Date(asOf.getTime() - rolloverHour * 60 * 60 * 1000), timezone),
        asOf,
        decks: Object.fromEntries(deckIds.map((id) => [id, decks.find((deck) => deck.id === id)?.counts ?? null])),
      };
    },
  };
}

/** The script's answers, as anki_check.py writes them. */
type ScriptAnswer =
  | { ok: true; hostKey: string; endpoint: string | null }
  | { ok: true; decks: AnkiDeck[]; rolloverHour: number; endpoint: string | null }
  | {
      ok: true;
      ankiDate: string;
      asOf: number;
      decks: Record<string, AnkiDeck["counts"] | null>;
      endpoint: string | null;
    }
  | { ok: false; error: "auth" | "network" | "protocol"; message: string };

class Anki implements AnkiAdapter {
  readonly #db: Db;
  readonly #box: SecretBox;
  readonly #clock: Clock;
  readonly #collectionsDir: string;
  readonly #run: AnkiScriptRunner;
  readonly #loginEndpoint: string | undefined;
  readonly #log: (line: string) => void;
  /** The operation running for each account: the next waits for it. */
  readonly #running = new Map<AccountId, Promise<unknown>>();

  constructor(db: Db, setup: AnkiSetup, clock: Clock, options: AnkiAdapterOptions) {
    this.#db = db;
    this.#clock = clock;
    this.#box = secretBox(setup.tokenKey, "Anki token key");
    this.#collectionsDir = setup.collectionsDir;
    this.#log = options.log ?? console.log;
    this.#loginEndpoint = options.loginEndpoint;
    this.#run = options.run ?? pythonRunner(options.python ?? "python3", options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  async login(account: AccountId, username: string, password: string): Promise<AnkiLoginResult> {
    const answer = await this.#oneAtATime(account, () =>
      this.#ask({
        op: "login",
        username,
        password,
        ...(this.#loginEndpoint !== undefined && { endpoint: this.#loginEndpoint }),
      }).catch(() => null),
    );
    if (answer === null || !answer.ok) {
      return { ok: false, reason: answer?.ok === false && answer.error === "auth" ? "wrong-login" : "unreachable" };
    }
    if (!("hostKey" in answer)) throw new Error("AnkiWeb login answered without a host key");
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
  }

  forget(account: AccountId): void {
    this.#db.prepare(`DELETE FROM anki_connection WHERE account_id = ?`).run(account);
    this.#removeCopy(account);
  }

  async decks(account: AccountId): Promise<AnkiDeckListResult> {
    const answer = await this.#withLogin(account, (login) => this.#ask({ op: "decks", ...login }));
    if (answer === null) return { ok: false, reason: "disconnected" };
    if (!("rolloverHour" in answer)) throw new Error("AnkiWeb deck list answered without decks");
    return { ok: true, decks: answer.decks, rolloverHour: answer.rolloverHour };
  }

  async deckCounts(account: AccountId, deckIds: readonly string[]): Promise<AnkiCountsResult> {
    const answer = await this.#withLogin(account, (login) =>
      this.#ask({ op: "counts", ...login, deckIds: [...deckIds] }),
    );
    if (answer === null) return { ok: false, reason: "disconnected" };
    if (!("ankiDate" in answer)) throw new Error("AnkiWeb counts answered without counts");
    return { ok: true, ankiDate: answer.ankiDate, asOf: new Date(answer.asOf), decks: answer.decks };
  }

  close(): void {
    this.#db.close();
  }

  /**
   * Runs `operation` with the account's stored login, one at a time per
   * account, and keeps the endpoint AnkiWeb moved it to. Null when there's no
   * login, or AnkiWeb refused it. A network or protocol error throws.
   */
  async #withLogin(
    account: AccountId,
    operation: (login: { hostKey: string; endpoint: string | null; collection: string }) => Promise<ScriptAnswer>,
  ): Promise<Extract<ScriptAnswer, { ok: true }> | null> {
    return this.#oneAtATime(account, async () => {
      const row = this.#db
        .prepare(`SELECT host_key, endpoint FROM anki_connection WHERE account_id = ?`)
        .get(account) as { host_key: string; endpoint: string | null } | undefined;
      if (!row) return null;
      const hostKey = this.#box.decrypt(row.host_key);
      const answer = await operation({ hostKey, endpoint: row.endpoint, collection: this.#copyOf(account) });
      if (!answer.ok) {
        if (answer.error === "auth") return null;
        if (answer.error === "protocol") {
          this.#log(
            `OPERATOR_ALERT AnkiWeb protocol error for account ${account}: ${answer.message}. ` +
              `AnkiWeb may have changed its sync protocol; the pinned anki package may need updating.`,
          );
        }
        throw new Error(`AnkiWeb ${answer.error} error: ${answer.message}`);
      }
      if (answer.endpoint !== row.endpoint && answer.endpoint !== null) {
        this.#db.prepare(`UPDATE anki_connection SET endpoint = ? WHERE account_id = ?`).run(answer.endpoint, account);
      }
      return answer;
    });
  }

  /** The script's answer to `request`, checked to be one. */
  async #ask(request: AnkiScriptRequest): Promise<ScriptAnswer> {
    const answer = await this.#run(request);
    if (typeof answer !== "object" || answer === null || typeof (answer as { ok?: unknown }).ok !== "boolean") {
      throw new Error("the Anki script's answer wasn't one");
    }
    return answer as ScriptAnswer;
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
