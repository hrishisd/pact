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
import { MAX_EVIDENCE_PHOTOS } from "../shared/types.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  DEV_SIGN_IN_PATH,
  EVIDENCE_PHOTO_FIELD,
  INVITE_REQUIRED_PATH,
  INVITE_TOKEN_SIGN_IN_KEY,
  invitePath,
  MAX_PHOTO_BYTES,
  type AcceptInviteResponse,
  type AddRecipientResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type DecideRequest,
  type DecideResponse,
  type FirstOccurrenceResponse,
  type FriendsResponse,
  type HealthResponse,
  type InviteLookupResponse,
  type LedgerResponse,
  type LedgersResponse,
  type PactResponse,
  type PactsResponse,
  type RecipientsResponse,
  type MeResponse,
  type ReviewQueueResponse,
  type SetTimezoneResponse,
  type SubmitEvidenceResponse,
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
  production = false,
}: { canonicalOrigin?: string | null; diskUsedFraction?: () => number; production?: boolean } = {}) {
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
  const app = createApp({
    core: s.core,
    auth,
    staticDir,
    canonicalOrigin,
    diskUsedFraction,
    production,
    operatorEmail: OPERATOR,
  });
  // Runs before the scenario's cleanup (finished hooks run in reverse order).
  onTestFinished(() => close());

  /** `origin` is the one the browser is on: its host is the request's Host header. */
  const request = (
    path: string,
    { origin = ORIGIN, ...init }: RequestInit & { cookie?: string; origin?: string } = {},
  ) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (init.cookie) headers.set("Cookie", init.cookie);
    return app.request(`${origin}${path}`, { ...init, headers });
  };

  return {
    at: s.at,
    clock: s.clock,
    core: s.core,
    photoStore: s.photoStore,
    staticDir,
    request,
    /**
     * Signs in through Google's redirect, as the browser would: starts sign-in,
     * then comes back to the callback with a code that Google's (faked) token
     * endpoint exchanges for `email`. Returns the callback's response and the
     * cookies it set. With `inviteToken`, signs in as the invite page does.
     */
    async signIn(email: string, { inviteToken }: { inviteToken?: string } = {}) {
      fakeGoogle(email);
      // As the invite page does: come back to the invite, carrying its token.
      const fromInvite =
        inviteToken === undefined
          ? { callbackURL: "/" }
          : { callbackURL: invitePath(inviteToken), additionalData: { [INVITE_TOKEN_SIGN_IN_KEY]: inviteToken } };
      const start = await request(`${AUTH_BASE_PATH}/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", errorCallbackURL: AUTH_ERROR_PATH, ...fromInvite }),
      });
      const { url } = (await start.json()) as { url: string };
      const state = new URL(url).searchParams.get("state")!;
      const response = await request(`${AUTH_BASE_PATH}/callback/google?code=test-code&state=${state}`, {
        cookie: cookieFrom(start),
      });
      return { response, cookie: cookieFrom(response) };
    },
    /** A JSON request to the API, as the account whose `cookie` is given (none by default). */
    async api<T = unknown>(
      path: string,
      { cookie = "", method = "GET", body }: { cookie?: string; method?: string; body?: unknown } = {},
    ) {
      const response = await request(path, {
        method,
        cookie,
        ...(body !== undefined && {
          headers: { "Content-Type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      });
      return { status: response.status, body: (await response.json()) as T };
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
        const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
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
    expect(again.response.headers.get("Location")).toMatch(
      new RegExp(`^${AUTH_ERROR_PATH}\\?error=${INVITE_REQUIRED_CODE}`),
    );
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
    expect(await today.json()).toEqual({
      hasPacts: false,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [],
    } satisfies TodayResponse);
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

/** The operator, signed in with a confirmed timezone, and an invite they made at "Mon 09:00". */
async function operatorWithInvite(s: Awaited<ReturnType<typeof server>>) {
  const { cookie } = await s.signIn(OPERATOR);
  await s.setTimezone(cookie, "America/New_York");
  const invite = await s.api<CreateInviteResponse>(API_PATHS.invites, { cookie, method: "POST" });
  expect(invite.status).toBe(200);
  return { cookie, token: invite.body.token };
}

/** The operator and a friend, both signed in, with a saved recipient, "Sam"; and a pact to create. */
async function ownerWithFriend() {
  const s = await server();
  const owner = await operatorWithInvite(s);
  const friend = await s.signIn("friend@example.test", { inviteToken: owner.token });
  await s.api(API_PATHS.acceptInvite(owner.token), { cookie: friend.cookie, method: "POST" });
  const friends = await s.api<FriendsResponse>(API_PATHS.friends, { cookie: owner.cookie });
  const friendId = friends.body[0]!.id;
  const added = await s.api<AddRecipientResponse>(API_PATHS.recipients, {
    cookie: owner.cookie,
    method: "POST",
    body: { name: "Sam" },
  });
  if (!added.body.ok) throw new Error(added.body.reason);
  const pact: CreatePactRequest = {
    evidenceKind: "camera",
    name: "Gym",
    description: "Me at the gym",
    schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
    penaltyCents: 500,
    recipientId: added.body.recipient.id,
    reviewerIds: [friendId],
  };
  return { s, owner, friend, friendId, pact };
}

const REFUSED_SIGN_IN = new RegExp(`^${AUTH_ERROR_PATH}\\?error=${INVITE_REQUIRED_CODE}`);

describe("invites", () => {
  test("the invite page's lookup works signed out and names the inviter", async () => {
    const s = await server();
    const { token } = await operatorWithInvite(s);

    const lookup = await s.api<InviteLookupResponse>(API_PATHS.invite(token));

    expect(lookup).toEqual({
      status: 200,
      body: { ok: true, inviterName: "owner", expiresAt: "2026-01-12T14:00:00.000Z" } satisfies InviteLookupResponse,
    });
    expect(await s.api(API_PATHS.invite("no-such-token"))).toEqual({
      status: 200,
      body: { ok: false, reason: "invite-not-found" },
    });
  });

  test("a new Google account with an invite signs in, accepts, and both are friends", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);

    const { response, cookie } = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(invitePath(owner.token));
    expect(s.authRows()).toEqual({ user: 2, account: 2, session: 2 });
    const accept = await s.api<AcceptInviteResponse>(API_PATHS.acceptInvite(owner.token), { cookie, method: "POST" });
    expect(accept).toMatchObject({ status: 200, body: { ok: true, friend: { name: "owner" } } });

    expect((await s.api<FriendsResponse>(API_PATHS.friends, { cookie })).body).toEqual([
      { id: expect.any(String), name: "owner" },
    ]);
    expect((await s.api<FriendsResponse>(API_PATHS.friends, { cookie: owner.cookie })).body).toEqual([
      { id: expect.any(String), name: "friend" },
    ]);
  });

  test("a forwarded link: once a new account claims it, a stranger sees it as used and can't sign in", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const claimant = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-used" });
    expect((await s.api(API_PATHS.invite(owner.token), { cookie: claimant.cookie })).body).toMatchObject({
      ok: true,
      inviterName: "owner",
    });
    const stranger = await s.signIn("stranger@example.test", { inviteToken: owner.token });
    expect(stranger.response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(s.authRows()).toEqual({ user: 2, account: 2, session: 2 });
  });

  test("a used invite shows as used, can't be accepted again, and lets no new account in", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const first = await s.signIn("friend@example.test", { inviteToken: owner.token });
    await s.api(API_PATHS.acceptInvite(owner.token), { cookie: first.cookie, method: "POST" });

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-used" });
    const again = await s.api(API_PATHS.acceptInvite(owner.token), { cookie: first.cookie, method: "POST" });
    expect(again).toEqual({ status: 200, body: { ok: false, reason: "invite-used" } });

    const stranger = await s.signIn("stranger@example.test", { inviteToken: owner.token });
    expect(stranger.response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(s.authRows()).toEqual({ user: 2, account: 2, session: 2 });
  });

  test("an invite 7 days old shows as expired and can't be accepted", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const { cookie } = await s.signIn("friend@example.test", { inviteToken: owner.token });

    s.clock.set(s.at("2026-01-12T14:00:00Z"));

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-expired" });
    const accept = await s.api(API_PATHS.acceptInvite(owner.token), { cookie, method: "POST" });
    expect(accept).toEqual({ status: 200, body: { ok: false, reason: "invite-expired" } });
    expect((await s.api(API_PATHS.friends, { cookie })).body).toEqual([]);
  });

  test("an expired invite lets no new account in", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    s.clock.set(s.at("2026-01-12T14:00:00Z"));

    const { response } = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect(response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(s.authRows()).toEqual({ user: 1, account: 1, session: 1 });
  });
});

describe("dev sign-in", () => {
  test("outside production, the operator signs in without Google and lands on Today", async () => {
    const s = await server();

    const response = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(s.authRows()).toEqual({ user: 1, account: 0, session: 1 });
    const me = await s.api<MeResponse>(API_PATHS.me, { cookie: cookieFrom(response) });
    expect(me).toEqual({ status: 200, body: { email: OPERATOR, name: "owner", timezone: null } });
  });

  test("in production the route doesn't exist: it answers as any unknown API route, and signs no one in", async () => {
    const s = await server({ production: true });

    const response = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(cookieFrom(response)).not.toContain("session_token");
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("on a host that isn't loopback it is refused, as an unknown API route", async () => {
    const s = await server();

    for (const origin of ["http://192.168.1.20:5173", "https://pact.hrishisd.com"]) {
      const response = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`, { origin });
      expect(response.status).toBe(401);
    }
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("through Vite's proxy, a browser that isn't on this machine is refused", async () => {
    const s = await server();

    // Vite's proxy rewrites Host to the server's; it forwards the browser's host and address.
    for (const forwarded of [
      { "X-Forwarded-Host": "192.168.1.20:5173", "X-Forwarded-For": "192.168.1.20" },
      { "X-Forwarded-Host": "localhost:5173", "X-Forwarded-For": "192.168.1.20" },
    ]) {
      const response = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`, {
        origin: "http://localhost:3000",
        headers: forwarded,
      });
      expect(response.status).toBe(401);
    }
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });

    const local = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`, {
      origin: "http://localhost:3000",
      headers: { "X-Forwarded-Host": "localhost:5173", "X-Forwarded-For": "::1" },
    });
    expect(local.status).toBe(302);
  });

  test("Better Auth doesn't serve it over HTTP itself", async () => {
    const s = await server();

    const response = await s.request(`${AUTH_BASE_PATH}/dev/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: OPERATOR, name: "owner" }),
    });

    expect(response.status).toBe(404);
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("a second person signs in with an invite token, claims it, and lands on the invite to accept", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);

    const response = await s.request(`${DEV_SIGN_IN_PATH}?email=friend@example.test&name=Friend&invite=${owner.token}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(invitePath(owner.token));
    const cookie = cookieFrom(response);
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body).toMatchObject({
      email: "friend@example.test",
      name: "Friend",
    });
    // Claimed: a stranger now sees it as used.
    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-used" });
    const accept = await s.api<AcceptInviteResponse>(API_PATHS.acceptInvite(owner.token), { cookie, method: "POST" });
    expect(accept.body).toMatchObject({ ok: true, friend: { name: "owner" } });
  });

  test("without a usable invite the core refuses, as it does Google's, and no auth rows are created", async () => {
    const s = await server();

    for (const query of ["email=stranger@example.test", "email=stranger@example.test&invite=no-such-invite"]) {
      const response = await s.request(`${DEV_SIGN_IN_PATH}?${query}`);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(INVITE_REQUIRED_PATH);
      expect(cookieFrom(response)).not.toContain("session_token");
    }
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });
  });

  test("signing in again as the same person reuses the user and adds a session", async () => {
    const s = await server();

    await s.request(`${DEV_SIGN_IN_PATH}?as=operator`);
    const again = await s.request(`${DEV_SIGN_IN_PATH}?email=${OPERATOR}`);

    expect(again.status).toBe(302);
    expect(s.authRows()).toEqual({ user: 1, account: 0, session: 2 });
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie: cookieFrom(again) })).status).toBe(200);
  });
});

describe("pacts", () => {
  test("an owner creates a Camera pact and sees it on Today, in Pacts and on its page", async () => {
    const { s, owner, pact, friendId } = await ownerWithFriend();
    const cookie = owner.cookie;
    expect((await s.api<RecipientsResponse>(API_PATHS.recipients, { cookie })).body).toEqual([
      { id: pact.recipientId, name: "Sam" },
    ] satisfies RecipientsResponse);
    // Monday's midnight in New York.
    const firstOccurrence = { date: "2026-01-05", dueAt: "2026-01-06T05:00:00.000Z" };

    const check = await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: { schedule: pact.schedule } });
    expect(check.body).toEqual({ ok: true, firstOccurrence } satisfies FirstOccurrenceResponse);

    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: pact });
    if (!created.body.ok) throw new Error(created.body.reason);
    const { pactId } = created.body;

    expect((await s.api(API_PATHS.today, { cookie })).body).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [{ kind: "to-do", cards: [{ pactId, name: "Gym", penaltyCents: 500, dueAt: firstOccurrence.dueAt }] }],
      waiting: [],
      yesterday: [],
    } satisfies TodayResponse);
    expect((await s.api(API_PATHS.pacts, { cookie })).body).toEqual([
      { id: pactId, name: "Gym", schedule: pact.schedule, penaltyCents: 500 },
    ] satisfies PactsResponse);
    expect((await s.api(API_PATHS.pact(pactId), { cookie })).body).toEqual({
      ok: true,
      pact: {
        id: pactId,
        name: "Gym",
        description: "Me at the gym",
        evidenceKind: "camera",
        schedule: pact.schedule,
        penaltyCents: 500,
        recipient: { id: pact.recipientId, name: "Sam" },
        reviewers: [{ id: friendId, name: "friend" }],
        stage: "active",
        firstOccurrence,
      },
    } satisfies PactResponse);
  });

  test("a reviewer who isn't a friend is refused as data", async () => {
    const { s, owner, pact } = await ownerWithFriend();

    const created = await s.api(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: { ...pact, reviewerIds: ["someone-else"] },
    });

    expect(created).toEqual({ status: 200, body: { ok: false, reason: "not-a-friend" } });
    expect((await s.api(API_PATHS.pacts, { cookie: owner.cookie })).body).toEqual([]);
  });

  test("a malformed pact, recipient or schedule is an invalid request", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const cookie = owner.cookie;
    const malformedPacts: unknown[] = [
      "not json",
      {},
      { ...pact, evidenceKind: 3 },
      { ...pact, name: null },
      { ...pact, schedule: { kind: "fixed-days", days: ["monday"] } },
      { ...pact, schedule: { kind: "weekly-count", days: ["mon"] } },
      { ...pact, penaltyCents: "500" },
      { ...pact, penaltyCents: 5.5 },
      { ...pact, reviewerIds: "someone" },
      { ...pact, reviewerIds: [1] },
    ];

    for (const sent of malformedPacts) {
      const created = await s.api(API_PATHS.pacts, { cookie, method: "POST", body: sent });
      expect({ sent, ...created }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
    const recipient = await s.api(API_PATHS.recipients, { cookie, method: "POST", body: { name: 5 } });
    expect(recipient).toEqual({ status: 400, body: { error: "invalid-request" } });
    const check = await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: {} });
    expect(check).toEqual({ status: 400, body: { error: "invalid-request" } });
  });

  test("someone else's pact, or one that doesn't exist, is not found, as data", async () => {
    const { s, owner, friend, pact } = await ownerWithFriend();
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: pact,
    });
    if (!created.body.ok) throw new Error(created.body.reason);

    const other = await s.api(API_PATHS.pact(created.body.pactId), { cookie: friend.cookie });

    const notFound = { status: 200, body: { ok: false, reason: "pact-not-found" } satisfies PactResponse };
    expect(other).toEqual(notFound);
    expect(await s.api(API_PATHS.pact("no-such-pact"), { cookie: owner.cookie })).toEqual(notFound);
  });
});

describe("evidence", () => {
  /** A JPEG-typed file of `bytes` bytes, as the client sends a shrunk photo. */
  const jpeg = (bytes = 3, fill = 1) =>
    new File([new Uint8Array(bytes).fill(fill)], "photo.jpg", { type: "image/jpeg" });

  /** The owner of a Mon/Wed/Fri Camera pact, created on Monday, that the friend reviews. */
  async function ownerWithPact() {
    const setup = await ownerWithFriend();
    const created = await setup.s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: setup.owner.cookie,
      method: "POST",
      body: setup.pact,
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    return { ...setup, pactId: created.body.pactId };
  }

  /** Posts `files` as the evidence form's `photo` fields. */
  async function submit(
    s: Awaited<ReturnType<typeof server>>,
    cookie: string,
    pactId: string,
    files: (File | string)[],
  ) {
    const form = new FormData();
    for (const file of files) form.append(EVIDENCE_PHOTO_FIELD, file);
    const response = await s.request(API_PATHS.evidence(pactId), { method: "POST", cookie, body: form });
    return { status: response.status, body: (await response.json()) as unknown };
  }

  test("an owner submits photos; Today shows it waiting, and its photos are served to the owner and reviewer only", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    const stranger = await s.signIn("stranger@example.test", {
      inviteToken: (await s.api<CreateInviteResponse>(API_PATHS.invites, { cookie: owner.cookie, method: "POST" })).body
        .token,
    });

    const submitted = await submit(s, owner.cookie, pactId, [jpeg(3, 1), jpeg(5, 2)]);

    expect(submitted).toEqual({
      status: 200,
      body: { ok: true, evidenceId: expect.any(String) } satisfies SubmitEvidenceResponse,
    });
    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
    expect(today.body.sections).toEqual([]);
    expect(today.body.waiting).toEqual([
      {
        kind: "evidence",
        id: (submitted.body as { evidenceId: string }).evidenceId,
        pactId,
        name: "Gym",
        occurrenceDate: "2026-01-05",
        submittedAt: "2026-01-05T14:00:00.000Z",
      },
    ] satisfies TodayResponse["waiting"]);

    const [first, second] = s.photoStore.photoIds;
    for (const cookie of [owner.cookie, friend.cookie]) {
      const response = await s.request(API_PATHS.photo(second!), { cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Cache-Control")).toBe("private");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
    }
    for (const path of [API_PATHS.photo(first!), API_PATHS.photo("no-such-photo")]) {
      const response = await s.request(path, { cookie: stranger.cookie });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not-found" });
    }
  });

  test("a refusal is data: evidence on a day the schedule skips", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    s.clock.set(s.at("Tue 10:00"));

    expect(await submit(s, owner.cookie, pactId, [jpeg()])).toEqual({
      status: 200,
      body: { ok: false, reason: "not-open" } satisfies SubmitEvidenceResponse,
    });
  });

  test("a photo over the size cap is refused before the core sees any of them", async () => {
    const { s, owner, pactId } = await ownerWithPact();

    const submitted = await submit(s, owner.cookie, pactId, [jpeg(), jpeg(MAX_PHOTO_BYTES + 1)]);

    expect(submitted).toEqual({ status: 400, body: { error: "photo-too-large" } });
    expect(s.photoStore.photoIds).toEqual([]);
    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
    expect(today.body.waiting).toEqual([]);
    // Exactly at the cap is fine.
    expect((await submit(s, owner.cookie, pactId, [jpeg(MAX_PHOTO_BYTES)])).body).toMatchObject({ ok: true });
  });

  test("too many photos is the core's refusal, as data", async () => {
    const { s, owner, pactId } = await ownerWithPact();

    expect(
      await submit(
        s,
        owner.cookie,
        pactId,
        Array.from({ length: MAX_EVIDENCE_PHOTOS + 1 }, () => jpeg()),
      ),
    ).toEqual({ status: 200, body: { ok: false, reason: "too-many-photos" } satisfies SubmitEvidenceResponse });
    expect(s.photoStore.photoIds).toEqual([]);
  });

  test("a field that isn't a file, or a file that isn't a JPEG, is an invalid request", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    const malformed: (File | string)[][] = [
      ["not a file"],
      [new File(["<script>"], "page.html", { type: "text/html" })],
      [new File([new Uint8Array([0x89, 0x50])], "photo.png", { type: "image/png" })],
    ];

    for (const files of malformed) {
      expect(await submit(s, owner.cookie, pactId, files)).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    expect(s.photoStore.photoIds).toEqual([]);
  });

  describe("review", () => {
    test("the reviewer sees the evidence in their queue, fetches its photos, and approves it once", async () => {
      const { s, owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(s, owner.cookie, pactId, [jpeg(3, 1), jpeg(4, 2)]);
      const { evidenceId } = submitted.body as { evidenceId: string };

      const queue = await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, { cookie: friend.cookie });

      expect(queue).toEqual({
        status: 200,
        body: [
          {
            kind: "evidence",
            id: evidenceId,
            pactId,
            pactName: "Gym",
            ownerName: "owner",
            description: "Me at the gym",
            photoIds: s.photoStore.photoIds,
            submittedAt: "2026-01-05T14:00:00.000Z",
            occurrenceDate: "2026-01-05",
          },
        ] satisfies ReviewQueueResponse,
      });
      const photo = await s.request(API_PATHS.photo(queue.body[0]!.photoIds[1]!), { cookie: friend.cookie });
      expect(photo.status).toBe(200);
      expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array(4).fill(2));

      const approve = { kind: "approve" } satisfies DecideRequest;
      const decided = await s.api(API_PATHS.decide(evidenceId), {
        cookie: friend.cookie,
        method: "POST",
        body: approve,
      });
      expect(decided).toEqual({ status: 200, body: { ok: true } satisfies DecideResponse });
      expect((await s.api(API_PATHS.reviewQueue, { cookie: friend.cookie })).body).toEqual([]);
      const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
      expect(today.body).toMatchObject({ alerts: [], sections: [], waiting: [] });

      // A refusal is data.
      const again = await s.api(API_PATHS.decide(evidenceId), { cookie: friend.cookie, method: "POST", body: approve });
      expect(again).toEqual({
        status: 200,
        body: { ok: false, reason: "already-decided" } satisfies DecideResponse,
      });
    });

    test("a rejection with its reason shows on the owner's Today as an alert", async () => {
      const { s, owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(s, owner.cookie, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };

      const reject = { kind: "reject", reason: "Blurry" } satisfies DecideRequest;
      const decided = await s.api(API_PATHS.decide(evidenceId), {
        cookie: friend.cookie,
        method: "POST",
        body: reject,
      });

      expect(decided).toEqual({ status: 200, body: { ok: true } });
      const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
      expect(today.body.alerts).toEqual([
        {
          kind: "evidence-rejected",
          pactId,
          name: "Gym",
          reviewerName: "friend",
          reason: "Blurry",
          occurrenceDate: "2026-01-05",
        },
      ] satisfies TodayResponse["alerts"]);
    });

    test("a decision of the wrong shape is an invalid request; a blank reason is refused as data", async () => {
      const { s, owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(s, owner.cookie, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };
      const decide = (body: unknown) =>
        s.api(API_PATHS.decide(evidenceId), { cookie: friend.cookie, method: "POST", body });

      for (const body of ["not json", {}, { kind: "maybe" }, { kind: "reject" }, { kind: "reject", reason: 3 }]) {
        expect(await decide(body)).toEqual({ status: 400, body: { error: "invalid-request" } });
      }
      expect(await decide({ kind: "reject", reason: " " })).toEqual({
        status: 200,
        body: { ok: false, reason: "blank-reason" },
      });
      expect((await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, { cookie: friend.cookie })).body).toHaveLength(1);
    });
  });
});

describe("ledgers", () => {
  test("a Missed occurrence's penalty shows on the recipient's ledger, and its history", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: pact,
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    s.clock.set(s.at("Tue 00:00"));
    await s.core.advanceTo(s.clock.now());

    const ledgers = await s.api<LedgersResponse>(API_PATHS.ledgers, { cookie: owner.cookie });

    const summary = { recipientId: pact.recipientId, name: "Sam", owedCents: 500, paidCents: 0 };
    expect(ledgers).toEqual({ status: 200, body: [summary] satisfies LedgersResponse });
    const ledger = await s.api(API_PATHS.ledger(pact.recipientId), { cookie: owner.cookie });
    expect(ledger).toEqual({
      status: 200,
      body: {
        ok: true,
        ledger: {
          summary,
          history: [
            {
              penaltyId: expect.any(String),
              pactId: created.body.pactId,
              pactName: "Gym",
              occurrenceDate: "2026-01-05",
              amountCents: 500,
              addedAt: "2026-01-06T05:00:00.000Z",
            },
          ],
        },
      } satisfies LedgerResponse,
    });
  });

  test("another account's recipient, or none, is not found, as data", async () => {
    const { s, friend, pact } = await ownerWithFriend();

    const notFound = { status: 200, body: { ok: false, reason: "recipient-not-found" } satisfies LedgerResponse };
    expect(await s.api(API_PATHS.ledger(pact.recipientId), { cookie: friend.cookie })).toEqual(notFound);
    expect(await s.api(API_PATHS.ledger("no-such-recipient"), { cookie: friend.cookie })).toEqual(notFound);
    expect((await s.api(API_PATHS.ledgers, { cookie: friend.cookie })).body).toEqual([]);
  });
});

describe("api", () => {
  test("every API route needs a session", async () => {
    const s = await server();

    const reads = [
      API_PATHS.me,
      API_PATHS.today,
      API_PATHS.friends,
      API_PATHS.recipients,
      API_PATHS.pacts,
      API_PATHS.pact("some-pact"),
      API_PATHS.photo("some-photo"),
      API_PATHS.reviewQueue,
    ];
    for (const path of reads) {
      const response = await s.request(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    }
    const writes = [
      API_PATHS.invites,
      API_PATHS.acceptInvite("some-token"),
      API_PATHS.recipients,
      API_PATHS.pacts,
      API_PATHS.firstOccurrence,
      API_PATHS.evidence("some-pact"),
      API_PATHS.decide("some-item"),
    ];
    for (const path of writes) {
      expect((await s.request(path, { method: "POST" })).status).toBe(401);
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

    for (const path of ["/some/client/route", invitePath("some-token")]) {
      const page = await s.request(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("Cache-Control")).toBe("no-cache");
      expect(await page.text()).toContain("<div id=root>");
    }

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
        PHOTOS_BUCKET: "test-photos",
        PHOTOS_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
        PHOTOS_ACCESS_KEY_ID: "test-access-key-id",
        PHOTOS_SECRET_ACCESS_KEY: "test-secret-access-key",
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
