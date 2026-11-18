// The Oura adapter: the production OuraSource, plus the OAuth2 steps the
// server's connect routes take. It talks to Oura over HTTPS and keeps each
// account's tokens, encrypted, in the `oura_token` table (which the core's
// migrations create and only this file touches).
//
// Oura's refresh tokens are single-use, so every refresh goes through
// `#refresh`, one at a time per account, and the new pair is stored before
// anything uses it, unless a connect (or a forget) changed the stored pair
// while Oura answered. A sleep request gives up after `timeoutMs`; a token
// request waits longer (`tokenTimeoutMs`), because giving up on a refresh
// Oura has granted loses the new pair, and the old refresh token is spent.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openWithPragmas, type Db } from "./db.ts";
import { secretBox, type SecretBox } from "./secret-box.ts";
import type { AccountId } from "../shared/types.ts";
import type { RaiseOperatorAlert } from "./operator-alerts.ts";
import type { Clock, OuraDateRange, OuraSleepPeriod, OuraSleepResult, OuraSource } from "./ports.ts";

export interface OuraClient {
  clientId: string;
  clientSecret: string;
  /** Where Oura sends the browser back with a code: the server's callback route. */
  redirectUri: string;
  /** The server's address, named in the User-Agent of every request, as Oura asks. */
  appUrl: string;
  /** 32 bytes, base64: encrypts the stored tokens. */
  tokenKey: string;
}

export interface OuraAdapterOptions {
  fetch?: typeof fetch;
  /** Oura's addresses; tests point them elsewhere. */
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
  /** For sleep requests. */
  timeoutMs?: number;
  /** For token requests: longer, since a refresh abandoned after Oura granted it can't be recovered. */
  tokenTimeoutMs?: number;
  /**
   * The operator alert path (operator-alerts.ts), for a refresh token a lost
   * answer spent, and for Oura refusing Pact's own app.
   */
  raiseOperatorAlert: RaiseOperatorAlert;
}

export interface OuraConnector {
  /** Oura's authorize page for this browser's `state`. */
  authorizeUrl(state: string): string;
  /** Exchanges the code Oura's callback carried and stores the account's tokens. */
  connect(account: AccountId, code: string): Promise<{ ok: true } | { ok: false; reason: "exchange-failed" }>;
  /** Deletes the account's stored tokens, once it has disconnected Oura. */
  forget(account: AccountId): void;
}

export type OuraAdapter = OuraSource & OuraConnector & { close(): void };

const DEFAULTS = {
  authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
  // Oura's login server since 2026, from its discovery document. Its docs
  // still name api.ouraring.com/oauth/token, which refuses codes from apps
  // made on the new developer portal.
  tokenUrl: "https://moi.ouraring.com/oauth/v2/ext/oauth-token",
  apiBase: "https://api.ouraring.com",
  timeoutMs: 10_000,
  tokenTimeoutMs: 30_000,
};

/** An access token this close to expiring is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000;
/** A few nights' sleep fits in a page or two; more pages than this means Oura's paging has gone wrong. */
const MAX_SLEEP_PAGES = 20;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Tokens as stored: which pair they are, and whether a refresh of them went unanswered. */
interface StoredTokens extends Tokens {
  generation: number;
  refreshOutcomeUnknownAt: string | null;
}

export function ouraAdapter(
  dbPath: string,
  client: OuraClient,
  clock: Clock,
  options: OuraAdapterOptions,
): OuraAdapter {
  return new Oura(openWithPragmas(dbPath), client, clock, options);
}

/**
 * Production without Oura credentials: no account can connect, so there is
 * never sleep. Never the dev stand-in, which would read sleep from a file.
 */
export const unavailableOura: OuraSource = {
  sleepPeriods: async () => ({ ok: false, reason: "disconnected" }),
};

/**
 * Development only, for running the app without Oura credentials: connecting
 * skips Oura's page (it sends the browser straight to `callbackPath`), and
 * sleep comes from `oura-sleep.json` in `dir`, an array of periods in Oura's
 * shape, read on every call. With no file there's no sleep.
 */
export function devOura(dir: string, callbackPath: string): OuraAdapter {
  const file = join(dir, "oura-sleep.json");
  return {
    authorizeUrl: (state) => `${callbackPath}?code=dev&state=${encodeURIComponent(state)}`,
    connect: async () => ({ ok: true }),
    forget: () => {},
    close: () => {},
    async sleepPeriods(_account, range) {
      const periods = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as OuraSleepPeriod[]) : [];
      return { ok: true, periods: periods.filter((p) => p.day >= range.startDate && p.day <= range.endDate) };
    },
  };
}

class Oura implements OuraAdapter {
  readonly #db: Db;
  readonly #client: OuraClient;
  readonly #clock: Clock;
  readonly #fetch: typeof fetch;
  readonly #urls: { authorizeUrl: string; tokenUrl: string; apiBase: string };
  readonly #timeoutMs: number;
  readonly #tokenTimeoutMs: number;
  readonly #raiseOperatorAlert: RaiseOperatorAlert;
  readonly #box: SecretBox;
  /** Refreshes in progress, by account: a second caller waits for the first's result. */
  readonly #refreshing = new Map<AccountId, Promise<Tokens | null>>();
  /**
   * Whether Oura refusing Pact's app has been emailed: each further refusal
   * is only logged until a token request succeeds again, as every account's
   * refresh would otherwise email each tick. In memory: a restart costs at
   * most one more email.
   */
  #appRefusalEmailed = false;

  constructor(db: Db, client: OuraClient, clock: Clock, options: OuraAdapterOptions) {
    this.#db = db;
    this.#client = client;
    this.#clock = clock;
    this.#fetch = options.fetch ?? fetch;
    this.#urls = {
      authorizeUrl: options.authorizeUrl ?? DEFAULTS.authorizeUrl,
      tokenUrl: options.tokenUrl ?? DEFAULTS.tokenUrl,
      apiBase: options.apiBase ?? DEFAULTS.apiBase,
    };
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.#tokenTimeoutMs = options.tokenTimeoutMs ?? DEFAULTS.tokenTimeoutMs;
    this.#raiseOperatorAlert = options.raiseOperatorAlert;
    this.#box = secretBox(client.tokenKey, "Oura token key");
  }

  authorizeUrl(state: string): string {
    const url = new URL(this.#urls.authorizeUrl);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.#client.clientId,
      redirect_uri: this.#client.redirectUri,
      scope: "daily",
      state,
    }).toString();
    return url.toString();
  }

  async connect(account: AccountId, code: string) {
    const tokens = await this.#tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.#client.redirectUri,
    });
    if (!tokens) return { ok: false as const, reason: "exchange-failed" as const };
    this.#connect(account, tokens);
    return { ok: true as const };
  }

  forget(account: AccountId): void {
    this.#db.prepare(`DELETE FROM oura_token WHERE account_id = ?`).run(account);
  }

  async sleepPeriods(account: AccountId, range: OuraDateRange): Promise<OuraSleepResult> {
    let tokens: Tokens | null = this.#load(account);
    if (!tokens) return { ok: false, reason: "disconnected" };
    if (tokens.expiresAt.getTime() - this.#clock.now().getTime() <= EXPIRY_MARGIN_MS) {
      tokens = await this.#refresh(account, tokens.accessToken);
      if (!tokens) return { ok: false, reason: "disconnected" };
    }
    const periods: OuraSleepPeriod[] = [];
    const seen = new Set<string>();
    let nextToken: string | null = null;
    do {
      if (seen.size >= MAX_SLEEP_PAGES) throw new Error(`Oura sleep request ran past ${MAX_SLEEP_PAGES} pages`);
      const url = new URL("/v2/usercollection/sleep", this.#urls.apiBase);
      url.search = new URLSearchParams({
        start_date: range.startDate,
        end_date: range.endDate,
        ...(nextToken !== null && { next_token: nextToken }),
      }).toString();
      let response = await this.#get(url, tokens.accessToken);
      if (response.status === 401) {
        // Revoked or expired early: one refresh, then one more try.
        tokens = await this.#refresh(account, tokens.accessToken);
        if (!tokens) return { ok: false, reason: "disconnected" };
        response = await this.#get(url, tokens.accessToken);
        if (response.status === 401) return { ok: false, reason: "disconnected" };
      }
      // A lapsed membership.
      if (response.status === 403) return { ok: false, reason: "disconnected" };
      if (!response.ok) throw new Error(`Oura sleep request failed: HTTP ${response.status}`);
      const page = (await response.json()) as { data?: unknown; next_token?: string | null };
      if (!Array.isArray(page.data)) throw new Error("Oura sleep page had no data");
      periods.push(...(page.data as OuraSleepPeriod[]));
      nextToken = page.next_token ?? null;
      // A token given again would page round in a circle.
      if (nextToken !== null && seen.has(nextToken)) throw new Error("Oura sleep request repeated a next_token");
      if (nextToken !== null) seen.add(nextToken);
    } while (nextToken !== null);
    return { ok: true, periods };
  }

  close(): void {
    this.#db.close();
  }

  #get(url: URL, accessToken: string): Promise<Response> {
    return this.#fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": this.#userAgent() },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }

  /**
   * New tokens for `account`, one refresh at a time: a caller that comes
   * while one runs gets its result. `stale` is the access token the caller
   * found wanting; if the stored one has changed since, another refresh
   * already replaced it, so that one is used instead of spending the refresh
   * token again. The new pair is stored only over the pair whose refresh
   * token it spent; if a connect or a forget changed that while Oura
   * answered, whatever is stored now is used instead. Null when Oura refuses
   * the refresh token, or there is none.
   *
   * A refresh that throws (a timeout, a network error, a 5xx) may still have
   * spent the refresh token, so it's marked; if Oura then refuses that
   * refresh token, an operator alert says the lost answer most likely spent it.
   * One Oura refused for Pact's app spent nothing, so it isn't marked.
   */
  #refresh(account: AccountId, stale: string): Promise<Tokens | null> {
    const running = this.#refreshing.get(account);
    if (running) return running;
    const refreshing = (async () => {
      const current = this.#load(account);
      if (!current) return null;
      if (current.accessToken !== stale) return current;
      let tokens: Tokens | null;
      try {
        tokens = await this.#tokenRequest({ grant_type: "refresh_token", refresh_token: current.refreshToken });
      } catch (error) {
        if (error instanceof AppRefused) throw error;
        this.#db
          .prepare(`UPDATE oura_token SET refresh_outcome_unknown_at = ? WHERE account_id = ? AND generation = ?`)
          .run(this.#clock.now().toISOString(), account, current.generation);
        throw error;
      }
      if (tokens && this.#replace(account, current.generation, tokens)) return tokens;
      const latest = this.#load(account);
      if (latest && latest.generation !== current.generation) return latest;
      if (!tokens && latest?.refreshOutcomeUnknownAt) {
        this.#raiseOperatorAlert({
          title: "Oura refresh token refused",
          text:
            `Oura refresh token for account ${account} was refused after a refresh at ` +
            `${latest.refreshOutcomeUnknownAt} got no answer; that lost answer most likely spent it, ` +
            `so the owner has to reconnect Oura`,
        });
        this.#db
          .prepare(`UPDATE oura_token SET refresh_outcome_unknown_at = NULL WHERE account_id = ? AND generation = ?`)
          .run(account, current.generation);
      }
      return null;
    })().finally(() => this.#refreshing.delete(account));
    this.#refreshing.set(account, refreshing);
    return refreshing;
  }

  /**
   * Oura's token endpoint. Null when it refuses the grant (`invalid_grant`);
   * throws on anything else. Any other 400 or 401 (`invalid_client`, say, or
   * no readable error) means Pact's app is set up wrong, not that the
   * account's code or refresh token is no good: it raises an operator alert
   * and throws an AppRefused.
   */
  async #tokenRequest(grant: Record<string, string>): Promise<Tokens | null> {
    const response = await this.#fetch(this.#urls.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.#userAgent() },
      body: new URLSearchParams({
        ...grant,
        client_id: this.#client.clientId,
        client_secret: this.#client.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(this.#tokenTimeoutMs),
    });
    if (response.status === 400 || response.status === 401) {
      const error = await oauthErrorOf(response);
      if (error === "invalid_grant") return null;
      this.#alertAppRefused(response.status, error);
      throw new AppRefused(`Oura token request refused Pact's app: HTTP ${response.status} ${error ?? "no error"}`);
    }
    if (!response.ok) throw new Error(`Oura token request failed: HTTP ${response.status}`);
    this.#appRefusalEmailed = false;
    const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(this.#clock.now().getTime() + body.expires_in * 1000),
    };
  }

  /**
   * Oura asks every client to name itself: a missing or generic User-Agent
   * may be refused with a 403, which a sleep request reads as a lapsed
   * membership.
   */
  #userAgent(): string {
    return `Pact (+${this.#client.appUrl})`;
  }

  #alertAppRefused(status: number, error: string | null): void {
    this.#raiseOperatorAlert({
      title: "Oura refused Pact's app",
      text:
        `Oura's token endpoint refused Pact's app: HTTP ${status}, ${error ?? "no error"}. ` +
        `Check the Oura app's credentials (OURA_CLIENT_ID, OURA_CLIENT_SECRET); accounts keep their tokens ` +
        `and are tried again each tick`,
      withoutEmail: this.#appRefusalEmailed,
    });
    this.#appRefusalEmailed = true;
  }

  #load(account: AccountId): StoredTokens | null {
    const row = this.#db
      .prepare(
        `SELECT access_token, refresh_token, expires_at, generation, refresh_outcome_unknown_at
         FROM oura_token WHERE account_id = ?`,
      )
      .get(account) as
      | {
          access_token: string;
          refresh_token: string;
          expires_at: string;
          generation: number;
          refresh_outcome_unknown_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      accessToken: this.#decrypt(row.access_token),
      refreshToken: this.#decrypt(row.refresh_token),
      expiresAt: new Date(row.expires_at),
      generation: row.generation,
      refreshOutcomeUnknownAt: row.refresh_outcome_unknown_at,
    };
  }

  /** A connect's tokens replace whatever is stored. */
  #connect(account: AccountId, tokens: Tokens): void {
    this.#db
      .prepare(
        `INSERT INTO oura_token (account_id, access_token, refresh_token, expires_at, updated_at, generation)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (account_id) DO UPDATE SET access_token = excluded.access_token,
           refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at,
           generation = oura_token.generation + 1, refresh_outcome_unknown_at = NULL`,
      )
      .run(
        account,
        this.#encrypt(tokens.accessToken),
        this.#encrypt(tokens.refreshToken),
        tokens.expiresAt.toISOString(),
        this.#clock.now().toISOString(),
      );
  }

  /** A refresh's tokens replace the pair `generation`, if that is still the one stored. True if they did. */
  #replace(account: AccountId, generation: number, tokens: Tokens): boolean {
    const replaced = this.#db
      .prepare(
        `UPDATE oura_token SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?,
           generation = generation + 1, refresh_outcome_unknown_at = NULL
         WHERE account_id = ? AND generation = ?`,
      )
      .run(
        this.#encrypt(tokens.accessToken),
        this.#encrypt(tokens.refreshToken),
        tokens.expiresAt.toISOString(),
        this.#clock.now().toISOString(),
        account,
        generation,
      );
    return replaced.changes === 1;
  }

  #encrypt(text: string): string {
    return this.#box.encrypt(text);
  }

  #decrypt(stored: string): string {
    return this.#box.decrypt(stored);
  }
}

/** Oura refused Pact's own app at its token endpoint: the account's grant wasn't spent. */
class AppRefused extends Error {}

/** The `error` of an OAuth error answer (RFC 6749 section 5.2), or null when there's none to read. */
async function oauthErrorOf(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : null;
}
