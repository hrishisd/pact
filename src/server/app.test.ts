// The server's HTTP surface, end to end through Hono and Better Auth's real
// sign-in code. Google is faked at its HTTP boundary: its token endpoint
// answers the code exchange with an (unsigned) id token for the test's
// email. Better Auth's own tables are checked directly here: the acceptance
// criterion is that a refused sign-in leaves no user, account or session row
// anywhere.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { scenario } from "../core/testing/scenario.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  INVITE_REQUIRED_PATH,
  type HealthResponse,
  type MeResponse,
  type SetTimezoneResponse,
  type TodayResponse,
} from "../shared/api.ts";
import { createApp } from "./app.ts";
import { createAuth, INVITE_REQUIRED_CODE } from "./auth.ts";
import { loadConfig } from "./config.ts";

const ORIGIN = "http://localhost:5173";
/** The scenario harness's operator. */
const OPERATOR = "owner@example.test";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * `canonicalOrigin` is the config's: null unless the server is in production.
 * `diskUsedFraction` stands in for the volume's disk use: half full unless a test says otherwise.
 */
async function server({
  canonicalOrigin = null,
  diskUsedFraction = () => 0.5,
}: { canonicalOrigin?: string | null; diskUsedFraction?: () => number } = {}) {
  const s = scenario();
  // The scenario's temporary directory doubles as the built SPA.
  const staticDir = dirname(s.dbPath);
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Pact</title><div id=root></div>");
  const { auth, migrate, close } = createAuth({
    core: s.core,
    dbPath: s.dbPath,
    secret: "test-secret-0123456789-0123456789-0123456789",
    baseURL: ORIGIN,
    google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
  });
  await migrate();
  const app = createApp({ core: s.core, auth, staticDir, canonicalOrigin, diskUsedFraction });
  // Runs before the scenario's cleanup (finished hooks run in reverse order).
  onTestFinished(() => close());

  /** `origin` is the one the browser is on: its host is the request's Host header. */
  const request = (path: string, { origin = ORIGIN, ...init }: RequestInit & { cookie?: string; origin?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (init.cookie) headers.set("Cookie", init.cookie);
    return app.request(`${origin}${path}`, { ...init, headers });
  };

  return {
    clock: s.clock,
    core: s.core,
    staticDir,
    request,
    /**
     * Signs in through Google's redirect, as the browser would: starts sign-in,
     * then comes back to the callback with a code that Google's (faked) token
     * endpoint exchanges for `email`. Returns the callback's response and the
     * cookies it set.
     */
    async signIn(email: string) {
      fakeGoogle(email);
      const start = await request(`${AUTH_BASE_PATH}/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: AUTH_ERROR_PATH }),
      });
      const { url } = (await start.json()) as { url: string };
      const state = new URL(url).searchParams.get("state")!;
      const response = await request(`${AUTH_BASE_PATH}/callback/google?code=test-code&state=${state}`, {
        cookie: cookieFrom(start),
      });
      return { response, cookie: cookieFrom(response) };
    },
    async setTimezone(cookie: string, timezone: string) {
      return request(API_PATHS.timezone, {
        method: "POST",
        cookie,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
    },
    /** Rows in Better Auth's tables. */
    authRows() {
      const db = new Database(s.dbPath, { readonly: true });
      try {
        const count = (table: string) =>
          (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
        return { user: count("auth_user"), account: count("auth_account"), session: count("auth_session") };
      } finally {
        db.close();
      }
    },
  };
}

/** Google's token endpoint, answering the code exchange with an id token for `email`. Any other fetch fails. */
function fakeGoogle(email: string): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(GOOGLE_TOKEN_ENDPOINT)) throw new Error(`unexpected fetch ${url}`);
    return Response.json({
      access_token: "access",
      id_token: unsignedJwt({ sub: `google-${email}`, email, email_verified: true, name: email.split("@")[0] }),
      expires_in: 3600,
      token_type: "Bearer",
    });
  });
}

/** Better Auth reads the profile from the token endpoint's id token without re-verifying it. */
function unsignedJwt(claims: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
}

/** The cookies a response set, as a Cookie header; cleared ones are left out. */
function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]!)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sign-in", () => {
  test("a Google account without an invite is refused, and no auth rows are created", async () => {
    const s = await server();

    const { response, cookie } = await s.signIn("stranger@example.test");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(new RegExp(`^${AUTH_ERROR_PATH}\\?error=${INVITE_REQUIRED_CODE}`));
    expect(cookie).not.toContain("session_token");
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });

    // Trying again goes down the same path: there is no half-made user to sign in as.
    const again = await s.signIn("stranger@example.test");
    expect(again.response.headers.get("Location")).toMatch(new RegExp(`^${AUTH_ERROR_PATH}\\?error=${INVITE_REQUIRED_CODE}`));
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("a refused sign-in lands on the invite-required page", async () => {
    const s = await server();

    const { response } = await s.signIn("stranger@example.test");

    const redirect = await s.request(response.headers.get("Location")!);
    expect(redirect.headers.get("Location")).toBe(INVITE_REQUIRED_PATH);
    const page = await s.request(INVITE_REQUIRED_PATH);
    expect(page.status).toBe(403);
    expect(await page.text()).toContain("You need an invite");
  });

  test("a posted Google id token is not a way in, even for the operator", async () => {
    const s = await server();

    const response = await s.request(`${AUTH_BASE_PATH}/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: unsignedJwt({ email: OPERATOR }) } }),
    });

    expect(response.ok).toBe(false);
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("starting sign-in hands back Google's authorization URL with our callback", async () => {
    const s = await server();

    const response = await s.request(`${AUTH_BASE_PATH}/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });

    const { url } = (await response.json()) as { url: string };
    const google = new URL(url);
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("redirect_uri")).toBe(`${ORIGIN}${AUTH_BASE_PATH}/callback/google`);
    expect(google.searchParams.get("client_id")).toBe("test-client-id");
  });

  test("the operator signs in, confirms a timezone, and sees an empty Today", async () => {
    const s = await server();

    const { response, cookie } = await s.signIn(OPERATOR);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(s.authRows()).toEqual({ user: 1, account: 1, session: 1 });

    const me = await s.request(API_PATHS.me, { cookie });
    expect(await me.json()).toEqual({ email: OPERATOR, name: "owner", timezone: null } satisfies MeResponse);

    const set = await s.setTimezone(cookie, "America/Los_Angeles");
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true, timezone: "America/Los_Angeles" } satisfies SetTimezoneResponse);
    const after = (await (await s.request(API_PATHS.me, { cookie })).json()) as MeResponse;
    expect(after.timezone).toBe("America/Los_Angeles");

    const today = await s.request(API_PATHS.today, { cookie });
    expect(await today.json()).toEqual({ alerts: [], sections: [], waiting: [], yesterday: [] } satisfies TodayResponse);
  });

  test("the operator signing in again gets the same account", async () => {
    const s = await server();
    const first = await s.signIn(OPERATOR);
    await s.setTimezone(first.cookie, "Europe/London");

    const second = await s.signIn(OPERATOR);

    expect(second.response.headers.get("Location")).toBe("/");
    const me = (await (await s.request(API_PATHS.me, { cookie: second.cookie })).json()) as MeResponse;
    expect(me.timezone).toBe("Europe/London");
    expect(s.authRows()).toMatchObject({ user: 1, account: 1 });
  });

  test("an invalid timezone is refused as data, not as an error", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const set = await s.setTimezone(cookie, "Mars/Olympus_Mons");

    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: false, reason: "invalid-timezone" } satisfies SetTimezoneResponse);
  });
});

describe("api", () => {
  test("every API route needs a session", async () => {
    const s = await server();

    for (const path of [API_PATHS.me, API_PATHS.today]) {
      const response = await s.request(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    }
  });

  test("a timezone request without a timezone is an invalid request", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const set = await s.request(API_PATHS.timezone, {
      method: "POST",
      cookie,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(set.status).toBe(400);
    expect(await set.json()).toEqual({ error: "invalid-request" });
  });
});

describe("health", () => {
  test("fails before the first tick, passes after one, and fails once ticks stop for 5 minutes", async () => {
    const s = await server();
    expect((await s.request("/health")).status).toBe(503);

    await s.core.advanceTo(s.clock.now());
    const ok = await s.request("/health");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as HealthResponse).ok).toBe(true);

    s.clock.set(new Date(s.clock.now().getTime() + 6 * 60 * 1000));
    expect((await s.request("/health")).status).toBe(503);
  });

  test("passes with the volume up to 80% full and fails past it, reporting the disk use", async () => {
    let diskUsed = 0.79;
    const s = await server({ diskUsedFraction: () => diskUsed });
    await s.core.advanceTo(s.clock.now());
    const health = async () => {
      const response = await s.request("/health");
      return { status: response.status, body: (await response.json()) as HealthResponse };
    };

    expect(await health()).toMatchObject({ status: 200, body: { ok: true, diskUsedPercent: 79 } });
    diskUsed = 0.8;
    expect(await health()).toMatchObject({ status: 200, body: { ok: true, diskUsedPercent: 80 } });
    diskUsed = 0.813;
    expect(await health()).toMatchObject({ status: 503, body: { ok: false, diskUsedPercent: 81.3 } });
  });

  test("a stale tick fails however empty the disk is", async () => {
    const s = await server({ diskUsedFraction: () => 0 });
    await s.core.advanceTo(s.clock.now());
    s.clock.set(new Date(s.clock.now().getTime() + 6 * 60 * 1000));

    const response = await s.request("/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, diskUsedPercent: 0 });
  });

  test("liveness ignores the disk, so a full volume alerts without taking the app offline", async () => {
    const s = await server({ diskUsedFraction: () => 0.99 });
    await s.core.advanceTo(s.clock.now());

    expect((await s.request("/health")).status).toBe(503);
    expect((await s.request("/healthz")).status).toBe(200);
  });

  test("liveness passes whatever the scheduler is doing, so a stuck scheduler doesn't take the app offline", async () => {
    const s = await server();
    const live = async () => {
      const response = await s.request("/healthz");
      return { status: response.status, body: await response.json() };
    };
    expect(await live()).toEqual({ status: 200, body: { ok: true } });

    await s.core.advanceTo(s.clock.now());
    s.clock.set(new Date(s.clock.now().getTime() + 6 * 60 * 1000));

    expect((await s.request("/health")).status).toBe(503);
    expect(await live()).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("spa", () => {
  test("client routes fall back to index.html; unknown API routes don't", async () => {
    const s = await server();

    const page = await s.request("/some/client/route");
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-cache");
    expect(await page.text()).toContain("<div id=root>");

    const { cookie } = await s.signIn(OPERATOR);
    expect((await s.request("/api/nope", { cookie })).status).toBe(404);
  });

  test("hashed build assets are cached for good; index.html and other files revalidate", async () => {
    const s = await server();
    mkdirSync(join(s.staticDir, "assets"));
    writeFileSync(join(s.staticDir, "assets", "index-abc123.js"), "console.log('pact')");
    writeFileSync(join(s.staticDir, "manifest.webmanifest"), "{}");

    const asset = await s.request("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    // A missing asset (e.g. from an old deploy) is a 404, not index.html cached for good.
    const missing = await s.request("/assets/index-old999.js");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBeNull();
    for (const path of ["/", "/index.html", "/manifest.webmanifest"]) {
      const response = await s.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
    }
    expect((await s.request("/health")).headers.get("Cache-Control")).toBeNull();
  });
});

describe("canonical host", () => {
  const CANONICAL = "https://pact.example.test";
  /** Fly's own hostname for the app, which also reaches it. */
  const FLY_HOST = "https://pact-example.fly.dev";
  const production = () =>
    server({
      canonicalOrigin: loadConfig({
        NODE_ENV: "production",
        PACT_DB_PATH: "/data/pact.db",
        OPERATOR_EMAIL: OPERATOR,
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        BETTER_AUTH_SECRET: "test-secret-0123456789-0123456789-0123456789",
        BETTER_AUTH_URL: CANONICAL,
      }).canonicalOrigin,
    });

  test("a page on another host redirects permanently to the same path and query on the canonical origin", async () => {
    const s = await production();

    const response = await s.request("/some/route?x=1&y=two", { origin: FLY_HOST });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(`${CANONICAL}/some/route?x=1&y=two`);
  });

  test("a POST on another host is redirected with 308, so it keeps its method and body", async () => {
    const s = await production();

    const response = await s.request(`${AUTH_BASE_PATH}/sign-in/social`, {
      origin: FLY_HOST,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(`${CANONICAL}${AUTH_BASE_PATH}/sign-in/social`);
  });

  test("health checks answer on any host", async () => {
    const s = await production();

    for (const origin of [FLY_HOST, "http://172.19.0.2:8080"]) {
      expect((await s.request("/healthz", { origin })).status).toBe(200);
      expect((await s.request("/health", { origin })).status).toBe(503);
    }
  });

  test("the canonical host is served, whatever the Host header's case or default port", async () => {
    const s = await production();

    // Behind Fly's proxy the request arrives as plain http, with the browser's Host header.
    for (const origin of [CANONICAL, "http://pact.example.test", "http://PACT.Example.test:443"]) {
      const page = await s.request("/some/client/route", { origin });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<div id=root>");
    }
  });

  test("outside production every host is served", async () => {
    const s = await server({ canonicalOrigin: loadConfig({ BETTER_AUTH_URL: CANONICAL }).canonicalOrigin });

    const page = await s.request("/some/client/route", { origin: "http://localhost:3000" });

    expect(page.status).toBe(200);
  });
});
