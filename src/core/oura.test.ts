// The Oura adapter at its boundary: what it asks Oura's token and sleep
// endpoints, and what it makes of the answers. A fake Oura answers; nothing
// reaches the network. Tokens go in the scenario's real database.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { openWithPragmas } from "./db.ts";
import { ouraAdapter, type OuraAdapterOptions, type OuraClient } from "./oura.ts";
import { sleep } from "./testing/bedtime-pact.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";
import type { OuraSleepPeriod } from "./ports.ts";

const CLIENT: OuraClient = {
  clientId: "pact-client",
  clientSecret: "pact-secret",
  redirectUri: "https://pact.example/api/oura/callback",
  tokenKey: Buffer.alloc(32, 7).toString("base64"),
};
const RANGE = { startDate: "2026-01-05", endDate: "2026-01-06" };

/** Oura's side: issues tokens (each refresh token works once) and serves sleep to a valid access token. */
class FakeOura {
  readonly tokenRequests: URLSearchParams[] = [];
  readonly sleepRequests: { url: URL; authorization: string | null }[] = [];
  periods: OuraSleepPeriod[] = [sleep("Mon 23:00")];
  pageSize = Infinity;
  /** What the sleep endpoint answers instead, when set. */
  sleepStatus: number | null = null;
  /** The body of every sleep page instead, when set: a broken answer. */
  sleepPage: unknown = null;
  /** Holds token responses until released, so two refreshes can overlap. */
  hold: Promise<void> = Promise.resolve();
  /**
   * The next refresh's answer goes missing: "after-grant" spends the refresh
   * token and issues a pair that never arrives; "before-grant" is a 502
   * that spends nothing.
   */
  loseNextRefresh: "after-grant" | "before-grant" | null = null;
  #issued = 0;
  #validAccess = new Set<string>();
  #validRefresh = new Set<string>();

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === "/oauth/token") {
      const body = new URLSearchParams(String(init?.body));
      this.tokenRequests.push(body);
      await this.hold;
      if (body.get("client_id") !== CLIENT.clientId || body.get("client_secret") !== CLIENT.clientSecret) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      if (body.get("grant_type") === "authorization_code" && body.get("code") !== "good-code") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      if (body.get("grant_type") === "refresh_token") {
        const lose = this.loseNextRefresh;
        this.loseNextRefresh = null;
        if (lose === "before-grant") return new Response(null, { status: 502 });
        const refresh = body.get("refresh_token")!;
        if (!this.#validRefresh.delete(refresh)) return Response.json({ error: "invalid_grant" }, { status: 400 });
        if (lose === "after-grant") {
          this.issue();
          throw new TypeError("fetch failed");
        }
      }
      return Response.json(this.issue());
    }
    if (url.pathname === "/v2/usercollection/sleep") {
      const authorization = new Headers(init?.headers).get("Authorization");
      this.sleepRequests.push({ url, authorization });
      if (this.sleepStatus !== null) return new Response(null, { status: this.sleepStatus });
      if (!this.#validAccess.has(authorization?.replace("Bearer ", "") ?? "")) {
        return new Response(null, { status: 401 });
      }
      if (this.sleepPage !== null) return Response.json(this.sleepPage);
      const start = Number(url.searchParams.get("next_token") ?? 0);
      const end = Math.min(this.periods.length, start + this.pageSize);
      return Response.json({
        data: this.periods.slice(start, end),
        next_token: end < this.periods.length ? String(end) : null,
      });
    }
    return new Response(null, { status: 404 });
  };

  issue(expiresIn = 86_400) {
    this.#issued += 1;
    const tokens = { access_token: `access-${this.#issued}`, refresh_token: `refresh-${this.#issued}` };
    this.#validAccess.add(tokens.access_token);
    this.#validRefresh.add(tokens.refresh_token);
    return { ...tokens, token_type: "bearer", expires_in: expiresIn };
  }

  revokeAccess(): void {
    this.#validAccess.clear();
  }
}

async function connected(s: Scenario, options: OuraAdapterOptions = {}) {
  const oura = new FakeOura();
  const adapter = ouraAdapter(s.dbPath, CLIENT, s.clock, {
    fetch: oura.fetch as typeof fetch,
    log: (line) => s.logs.push(line),
    authorizeUrl: "https://cloud.oura.test/oauth/authorize",
    tokenUrl: "https://api.oura.test/oauth/token",
    apiBase: "https://api.oura.test",
    ...options,
  });
  const owner = await s.signIn("owner");
  expect(await adapter.connect(owner.id, "good-code")).toEqual({ ok: true });
  return { oura, adapter, owner };
}

test("the authorize page asks for the daily scope, with the browser's state", () => {
  const s = scenario();
  const adapter = ouraAdapter(s.dbPath, CLIENT, s.clock);
  const url = new URL(adapter.authorizeUrl("state-123"));
  expect(url.origin + url.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: "pact-client",
    redirect_uri: "https://pact.example/api/oura/callback",
    scope: "daily",
    state: "state-123",
  });
  adapter.close();
});

describe("connecting", () => {
  test("exchanges the code and stores the tokens encrypted", async () => {
    const s = scenario();
    const { oura, adapter } = await connected(s);
    expect(Object.fromEntries(oura.tokenRequests[0]!)).toEqual({
      grant_type: "authorization_code",
      code: "good-code",
      redirect_uri: CLIENT.redirectUri,
      client_id: CLIENT.clientId,
      client_secret: CLIENT.clientSecret,
    });
    adapter.close();
    await s.core.close();
    const bytes = [s.dbPath, `${s.dbPath}-wal`]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "latin1"))
      .join("");
    expect(bytes).toContain("oura_token");
    expect(bytes).not.toContain("access-1");
    expect(bytes).not.toContain("refresh-1");
    await s.restart();
  });

  test("a stored token whose authentication tag was cut short is refused", async () => {
    const s = scenario();
    const { adapter, owner } = await connected(s);
    const db = openWithPragmas(s.dbPath);
    const { access_token: stored } = db.prepare(`SELECT access_token FROM oura_token`).get() as {
      access_token: string;
    };
    const [iv, tag, encrypted] = stored.split(".") as [string, string, string];
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    db.prepare(`UPDATE oura_token SET access_token = ?`).run([iv, shortTag, encrypted].join("."));
    db.close();

    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("Invalid authentication tag length");
    adapter.close();
  });

  test("forgetting an account deletes its tokens: it's disconnected, with no call to Oura", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    adapter.forget(owner.id);
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    expect(oura.sleepRequests).toEqual([]);
    adapter.close();
  });

  test("a code Oura refuses connects nothing", async () => {
    const s = scenario();
    const { adapter, owner } = await connected(s);
    expect(await adapter.connect(owner.id, "bad-code")).toEqual({ ok: false, reason: "exchange-failed" });
    adapter.close();
  });
});

describe("sleep periods", () => {
  test("asks for the days with the access token, and follows next_token", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.periods = [sleep("Mon 23:00"), sleep("Tue 19:00", "late_nap"), sleep("Tue 23:30")];
    oura.pageSize = 2;

    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: true, periods: oura.periods });
    expect(oura.sleepRequests.map((r) => [Object.fromEntries(r.url.searchParams), r.authorization])).toEqual([
      [{ start_date: "2026-01-05", end_date: "2026-01-06" }, "Bearer access-1"],
      [{ start_date: "2026-01-05", end_date: "2026-01-06", next_token: "2" }, "Bearer access-1"],
    ]);
    adapter.close();
  });

  test("a next_token Oura gives again, or pages without end, stop the call instead of looping", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.sleepPage = { data: [sleep("Mon 23:00")], next_token: "same" };
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("next_token");
    expect(oura.sleepRequests).toHaveLength(2);

    let page = 0;
    oura.sleepPage = {
      data: [],
      get next_token() {
        return `page-${++page}`;
      },
    };
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("pages");
    expect(oura.sleepRequests.length).toBeLessThan(200);
    adapter.close();
  });

  test("a page without a data array stops the call", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.sleepPage = { next_token: null };
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("no data");
    adapter.close();
  });

  test("an account that never connected is disconnected", async () => {
    const s = scenario();
    const { adapter } = await connected(s);
    const other = await s.befriend(await s.signIn("owner"), "friend");
    expect(await adapter.sleepPeriods(other.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    adapter.close();
  });

  test("an expired access token is refreshed first, and the new refresh token is the one used next", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    await adapter.sleepPeriods(owner.id, RANGE);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    await adapter.sleepPeriods(owner.id, RANGE);

    expect(oura.tokenRequests.map((r) => r.get("refresh_token"))).toEqual([null, "refresh-1", "refresh-2"]);
    expect(oura.sleepRequests.map((r) => r.authorization)).toEqual(["Bearer access-2", "Bearer access-3"]);
    adapter.close();
  });

  test("two concurrent calls with an expired token make one refresh and never reuse its refresh token", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    let release!: () => void;
    oura.hold = new Promise((resolve) => (release = resolve));

    const both = Promise.all([adapter.sleepPeriods(owner.id, RANGE), adapter.sleepPeriods(owner.id, RANGE)]);
    release();
    expect(await both).toEqual([
      { ok: true, periods: oura.periods },
      { ok: true, periods: oura.periods },
    ]);
    expect(oura.tokenRequests.map((r) => r.get("refresh_token"))).toEqual([null, "refresh-1"]);
    adapter.close();
  });

  test("a reconnect while a refresh is in flight keeps the reconnect's tokens", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    let release!: () => void;
    oura.hold = new Promise((resolve) => (release = resolve));
    const reading = adapter.sleepPeriods(owner.id, RANGE);
    oura.hold = Promise.resolve();
    expect(await adapter.connect(owner.id, "good-code")).toEqual({ ok: true });
    release();

    // The reconnect's pair (2) is used, not the refresh's (3), now and at the next expiry.
    expect(await reading).toEqual({ ok: true, periods: oura.periods });
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    await adapter.sleepPeriods(owner.id, RANGE);
    expect(oura.tokenRequests.map((r) => r.get("refresh_token"))).toEqual([null, "refresh-1", null, "refresh-2"]);
    expect(oura.sleepRequests.map((r) => r.authorization)).toEqual(["Bearer access-2", "Bearer access-4"]);
    adapter.close();
  });

  test("forgetting an account while a refresh is in flight stores nothing: it stays disconnected", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    let release!: () => void;
    oura.hold = new Promise((resolve) => (release = resolve));
    const reading = adapter.sleepPeriods(owner.id, RANGE);
    adapter.forget(owner.id);
    release();

    expect(await reading).toEqual({ ok: false, reason: "disconnected" });
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    expect(oura.sleepRequests).toEqual([]);
    adapter.close();
  });

  test("a refresh whose answer was lost, then refused, is disconnected with one operator alert", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    oura.loseNextRefresh = "after-grant";
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("fetch failed");
    expect(s.logs.filter((line) => line.includes("OPERATOR_ALERT"))).toEqual([]);

    // Not stuck on the failed refresh: the next call asks again, and Oura refuses the spent token.
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    expect(oura.tokenRequests.map((r) => r.get("refresh_token"))).toEqual([null, "refresh-1", "refresh-1"]);
    expect(s.logs.filter((line) => line.includes("OPERATOR_ALERT"))).toEqual([
      expect.stringMatching(new RegExp(`OPERATOR_ALERT Oura refresh token for account ${owner.id} .*lost`)),
    ]);
    adapter.close();
  });

  test("a refresh that failed and then worked raises no alert when a later one is refused", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    oura.loseNextRefresh = "before-grant";
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("HTTP 502");
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: true, periods: oura.periods });

    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    // Spent elsewhere: Oura no longer takes it.
    await oura.fetch("https://api.oura.test/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "refresh-2", ...secret() }).toString(),
    });
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    expect(s.logs.filter((line) => line.includes("OPERATOR_ALERT"))).toEqual([]);
    adapter.close();
  });

  test("the token request waits longer than a sleep request before giving up", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    const slow = ouraAdapter(s.dbPath, CLIENT, s.clock, {
      tokenUrl: "https://api.oura.test/oauth/token",
      apiBase: "https://api.oura.test",
      timeoutMs: 20,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        if (new URL(String(input)).pathname === "/oauth/token") {
          // Answer once three sleep timeouts have passed, unless the token request's own timeout fires first.
          const outlasted = AbortSignal.timeout(60);
          await new Promise<void>((resolve, reject) => {
            outlasted.addEventListener("abort", () => resolve());
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          });
        }
        return oura.fetch(input, init);
      }) as typeof fetch,
    });
    expect(await slow.sleepPeriods(owner.id, RANGE)).toEqual({ ok: true, periods: oura.periods });
    slow.close();
    adapter.close();
  });

  test("a 401 refreshes once and tries again", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.revokeAccess();
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: true, periods: oura.periods });
    expect(oura.sleepRequests.map((r) => r.authorization)).toEqual(["Bearer access-1", "Bearer access-2"]);
    adapter.close();
  });

  test("a refused refresh token, or a 403 (lapsed membership), is disconnected", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.sleepStatus = 403;
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });

    oura.sleepStatus = null;
    s.clock.set(new Date(s.clock.now().getTime() + 86_400_000));
    // Spent elsewhere: Oura no longer takes it.
    await oura.fetch("https://api.oura.test/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "refresh-1", ...secret() }).toString(),
    });
    expect(await adapter.sleepPeriods(owner.id, RANGE)).toEqual({ ok: false, reason: "disconnected" });
    adapter.close();
  });

  test("a server error throws, so that account has no data this tick and the next retries", async () => {
    const s = scenario();
    const { oura, adapter, owner } = await connected(s);
    oura.sleepStatus = 500;
    await expect(adapter.sleepPeriods(owner.id, RANGE)).rejects.toThrow("HTTP 500");
    adapter.close();
  });

  test("a call that takes too long is abandoned", async () => {
    const s = scenario();
    const { adapter, owner } = await connected(s, { timeoutMs: 20 });
    const hanging = ouraAdapter(s.dbPath, CLIENT, s.clock, {
      apiBase: "https://api.oura.test",
      timeoutMs: 20,
      fetch: ((_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        )) as typeof fetch,
    });
    // The timeout itself, not some other failure on the way.
    await expect(hanging.sleepPeriods(owner.id, RANGE)).rejects.toMatchObject({ name: "TimeoutError" });
    hanging.close();
    adapter.close();
  });
});

function secret() {
  return { client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret };
}
