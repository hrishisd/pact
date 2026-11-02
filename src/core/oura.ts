// The Oura adapter: the production OuraSource, plus the OAuth2 steps the
// server's connect routes take. It talks to Oura over HTTPS and keeps each
// account's tokens, encrypted, in the `oura_token` table (which the core's
// migrations create and only this file touches).
//
// Oura's refresh tokens are single-use, so every refresh goes through
// `#refresh`, one at a time per account, and the new pair is stored before
// anything uses it. Each HTTP call gives up after `timeoutMs`.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openWithPragmas, type Db } from "./db.ts";
import type { AccountId } from "../shared/types.ts";
import type { Clock, OuraDateRange, OuraSleepPeriod, OuraSleepResult, OuraSource } from "./ports.ts";

export interface OuraClient {
  clientId: string;
  clientSecret: string;
  /** Where Oura sends the browser back with a code: the server's callback route. */
  redirectUri: string;
  /** 32 bytes, base64: encrypts the stored tokens. */
  tokenKey: string;
}

export interface OuraAdapterOptions {
  fetch?: typeof fetch;
  /** Oura's addresses; tests point them elsewhere. */
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
  timeoutMs?: number;
}

export interface OuraConnector {
  /** Oura's authorize page for this browser's `state`. */
  authorizeUrl(state: string): string;
  /** Exchanges the code Oura's callback carried and stores the account's tokens. */
  connect(account: AccountId, code: string): Promise<{ ok: true } | { ok: false; reason: "exchange-failed" }>;
}

export type OuraAdapter = OuraSource & OuraConnector & { close(): void };

const DEFAULTS = {
  authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
  tokenUrl: "https://api.ouraring.com/oauth/token",
  apiBase: "https://api.ouraring.com",
  timeoutMs: 10_000,
};

/** An access token this close to expiring is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export function ouraAdapter(dbPath: string, client: OuraClient, clock: Clock, options: OuraAdapterOptions = {}) {
  return new Oura(openWithPragmas(dbPath), client, clock, options);
}

/**
 * Development only, for running the app without Oura credentials: connecting
 * skips Oura's page (it sends the browser straight to `callbackPath`), and
 * sleep comes from `oura-sleep.json` in `dir`, an array of periods in Oura's
 * shape, read on every call. With no file there's no sleep.
 */
export function devOura(dir: string, callbackPath: string): OuraSource & OuraConnector {
  const file = join(dir, "oura-sleep.json");
  return {
    authorizeUrl: (state) => `${callbackPath}?code=dev&state=${encodeURIComponent(state)}`,
    connect: async () => ({ ok: true }),
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
  readonly #key: Buffer;
  /** Refreshes in progress, by account: a second caller waits for the first's result. */
  readonly #refreshing = new Map<AccountId, Promise<Tokens | null>>();

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
    this.#key = Buffer.from(client.tokenKey, "base64");
    if (this.#key.length !== 32) throw new Error("the Oura token key must be 32 bytes, base64");
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
    this.#store(account, tokens);
    return { ok: true as const };
  }

  async sleepPeriods(account: AccountId, range: OuraDateRange): Promise<OuraSleepResult> {
    let tokens = this.#load(account);
    if (!tokens) return { ok: false, reason: "disconnected" };
    if (tokens.expiresAt.getTime() - this.#clock.now().getTime() <= EXPIRY_MARGIN_MS) {
      tokens = await this.#refresh(account, tokens.accessToken);
      if (!tokens) return { ok: false, reason: "disconnected" };
    }
    const periods: OuraSleepPeriod[] = [];
    let nextToken: string | null = null;
    do {
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
      const page = (await response.json()) as { data: OuraSleepPeriod[]; next_token: string | null };
      periods.push(...page.data);
      nextToken = page.next_token ?? null;
    } while (nextToken !== null);
    return { ok: true, periods };
  }

  close(): void {
    this.#db.close();
  }

  #get(url: URL, accessToken: string): Promise<Response> {
    return this.#fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }

  /**
   * New tokens for `account`, one refresh at a time: a caller that comes
   * while one runs gets its result. `stale` is the access token the caller
   * found wanting; if the stored one has changed since, another refresh
   * already replaced it, so that one is used instead of spending the refresh
   * token again. Null when Oura refuses the refresh token, or there is none.
   */
  #refresh(account: AccountId, stale: string): Promise<Tokens | null> {
    const running = this.#refreshing.get(account);
    if (running) return running;
    const refreshing = (async () => {
      const current = this.#load(account);
      if (!current) return null;
      if (current.accessToken !== stale) return current;
      const tokens = await this.#tokenRequest({ grant_type: "refresh_token", refresh_token: current.refreshToken });
      if (tokens) this.#store(account, tokens);
      return tokens;
    })().finally(() => this.#refreshing.delete(account));
    this.#refreshing.set(account, refreshing);
    return refreshing;
  }

  /** Oura's token endpoint. Null when it refuses the grant (a 400 or 401); throws on anything else. */
  async #tokenRequest(grant: Record<string, string>): Promise<Tokens | null> {
    const response = await this.#fetch(this.#urls.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...grant,
        client_id: this.#client.clientId,
        client_secret: this.#client.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status === 400 || response.status === 401) return null;
    if (!response.ok) throw new Error(`Oura token request failed: HTTP ${response.status}`);
    const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(this.#clock.now().getTime() + body.expires_in * 1000),
    };
  }

  #load(account: AccountId): Tokens | null {
    const row = this.#db
      .prepare(`SELECT access_token, refresh_token, expires_at FROM oura_token WHERE account_id = ?`)
      .get(account) as { access_token: string; refresh_token: string; expires_at: string } | undefined;
    if (!row) return null;
    return {
      accessToken: this.#decrypt(row.access_token),
      refreshToken: this.#decrypt(row.refresh_token),
      expiresAt: new Date(row.expires_at),
    };
  }

  #store(account: AccountId, tokens: Tokens): void {
    this.#db
      .prepare(
        `INSERT INTO oura_token (account_id, access_token, refresh_token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET access_token = excluded.access_token,
           refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .run(
        account,
        this.#encrypt(tokens.accessToken),
        this.#encrypt(tokens.refreshToken),
        tokens.expiresAt.toISOString(),
        this.#clock.now().toISOString(),
      );
  }

  /** AES-256-GCM: "iv.tag.ciphertext", each base64url. */
  #encrypt(text: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
  }

  #decrypt(stored: string): string {
    const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64url")) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}
