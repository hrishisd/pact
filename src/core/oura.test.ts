// The Oura adapter at its boundary: what it asks Oura's token and sleep
// endpoints, and what it makes of the answers. A fake Oura answers; nothing
// reaches the network. Tokens go in the scenario's real database.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ouraAdapter, type OuraClient } from "./oura.ts";
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
  /** Holds token responses until released, so two refreshes can overlap. */
  hold: Promise<void> = Promise.resolve();
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
        const refresh = body.get("refresh_token")!;
        if (!this.#validRefresh.delete(refresh)) return Response.json({ error: "invalid_grant" }, { status: 400 });
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

async function connected(s: Scenario, options: { timeoutMs?: number } = {}) {
  const oura = new FakeOura();
  const adapter = ouraAdapter(s.dbPath, CLIENT, s.clock, {
    fetch: oura.fetch as typeof fetch,
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

  test("a server error throws, so the tick fails and the next retries", async () => {
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
    await expect(hanging.sleepPeriods(owner.id, RANGE)).rejects.toThrow();
    hanging.close();
    adapter.close();
  });
});

function secret() {
  return { client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret };
}
