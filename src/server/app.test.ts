// The server's HTTP surface, end to end through Hono and Better Auth's real
// sign-in code. Google is faked at its HTTP boundary: its token endpoint
// answers the code exchange with an (unsigned) id token for the test's
// email. Better Auth's own tables are checked directly here: the acceptance
// criterion is that a refused sign-in leaves no user, account or session row
// anywhere.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { scenario } from "../core/testing/scenario.ts";
import { EVIDENCE_KINDS, MAX_EVIDENCE_PHOTOS } from "../shared/types.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  DEV_SIGN_IN_PATH,
  EVIDENCE_PHOTO_FIELD,
  INVITE_REQUIRED_PATH,
  INVITE_TOKEN_SIGN_IN_KEY,
  OURA_RECONNECT_PATH,
  invitePath,
  MAX_PHOTO_BYTES,
  PAYMENT_AMOUNT_FIELD,
  PAYMENT_NOTE_FIELD,
  type AcceptInviteResponse,
  type AcceptMissResponse,
  type AskOwnerRequest,
  type AskOwnerResponse,
  type EvidenceResponse,
  type PaymentResponse,
  type ReplyRequest,
  type ReplyResponse,
  type WaitingOnReplyResponse,
  type AddRecipientResponse,
  type AnkiDecksResponse,
  type CheckAnkiResponse,
  type ConnectAnkiRequest,
  type ConnectAnkiResponse,
  type DisconnectAnkiResponse,
  type ChangePactRequest,
  type ChangePactResponse,
  type ChangePreviewResponse,
  type ChangeRequestResponse,
  type EndPactResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type AcceptExcuseRejectionResponse,
  type CheckOuraResponse,
  type DisconnectOuraResponse,
  type DecideRequest,
  type ExcuseOptionsResponse,
  type ExcusePreviewResponse,
  type ExcuseResponse,
  type FileExcuseResponse,
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
  type RemovePushSubscriptionResponse,
  type MeResponse,
  type NotificationsResponse,
  type RecordPaymentResponse,
  type ReviewQueueResponse,
  type SavePushSubscriptionResponse,
  type SetNotificationSettingResponse,
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
const VAPID_PUBLIC_KEY = "test-vapid-public-key";
const OURA_AUTHORIZE = "https://cloud.oura.test/oauth/authorize";

/**
 * `canonicalOrigin` is the config's: null unless the server is in production.
 * `commit` is the config's: null unless the image was built with one.
 * `diskUsedFraction` stands in for the volume's disk use: half full unless a test says otherwise.
 * `ouraSetUp: false` is production without Oura credentials: no connector.
 * `ankiSetUp: false` is production without an Anki token key: no connector.
 */
async function server({
  canonicalOrigin = null,
  commit = null,
  diskUsedFraction = () => 0.5,
  production = false,
  ouraSetUp = true,
  ankiSetUp = true,
}: {
  canonicalOrigin?: string | null;
  commit?: string | null;
  diskUsedFraction?: () => number;
  production?: boolean;
  ouraSetUp?: boolean;
  ankiSetUp?: boolean;
} = {}) {
  const s = scenario();
  const ouraConnects: { account: string; code: string }[] = [];
  const ouraForgets: string[] = [];
  const ankiLogins: { account: string; username: string; password: string }[] = [];
  const ankiForgets: string[] = [];
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
    commit,
    diskUsedFraction,
    production,
    operatorEmail: OPERATOR,
    vapidPublicKey: VAPID_PUBLIC_KEY,
    oura: ouraSetUp
      ? {
          authorizeUrl: (state) => `${OURA_AUTHORIZE}?state=${state}`,
          async connect(account, code) {
            ouraConnects.push({ account, code });
            if (code === "throwing-code") throw new Error("token endpoint timed out");
            return code === "good-code" ? { ok: true } : { ok: false, reason: "exchange-failed" };
          },
          forget: (account) => void ouraForgets.push(account),
        }
      : null,
    anki: ankiSetUp
      ? {
          // AnkiWeb, faked: "right" is the password, "down" stands for AnkiWeb not answering,
          // and "throws" for the adapter failing outright.
          async login(account, username, password) {
            ankiLogins.push({ account, username, password });
            if (password === "down") return { ok: false, reason: "unreachable" };
            if (password === "throws") throw new Error("socket hang up");
            return password === "right" ? { ok: true } : { ok: false, reason: "wrong-login" };
          },
          forget: async (account) => void ankiForgets.push(account),
        }
      : null,
    log: (line) => s.logs.push(line),
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
    ouraConnects,
    ouraForgets,
    ouraSource: s.ouraSource,
    ankiLogins,
    ankiForgets,
    ankiSource: s.ankiSource,
    core: s.core,
    logs: s.logs,
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

// Nothing reaches the network: a test that needs Google stubs it with fakeGoogle.
beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unexpected fetch ${String(input instanceof Request ? input.url : input)}`);
  });
});

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
    expect(await me.json()).toEqual({
      email: OPERATOR,
      name: "owner",
      timezone: null,
      connections: [],
      ouraAvailable: true,
      ankiAvailable: true,
    } satisfies MeResponse);

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
    expect(me).toEqual({
      status: 200,
      body: {
        email: OPERATOR,
        name: "owner",
        timezone: null,
        connections: [],
        ouraAvailable: true,
        ankiAvailable: true,
      },
    });
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

  test("any other failure is a server error, not a refusal for want of an invite", async () => {
    const s = await server();
    vi.spyOn(s.core, "signIn").mockRejectedValue(new Error("database is locked"));

    const response = await s.request(`${DEV_SIGN_IN_PATH}?as=operator`);

    expect(response.status).toBe(500);
    expect(response.headers.get("Location")).toBeNull();
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
  test("an owner edits and deletes a new pact, and only in its edit window", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const { cookie } = owner;
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: pact });
    if (!created.body.ok) throw new Error(created.body.reason);
    const path = API_PATHS.pact(created.body.pactId);

    expect((await s.api(path, { cookie, method: "PUT", body: { nonsense: true } })).status).toBe(400);
    const edited = await s.api(path, { cookie, method: "PUT", body: { ...pact, name: "Morning gym" } });
    expect(edited).toMatchObject({ status: 200, body: { ok: true } });
    expect((await s.api(path, { cookie })).body).toMatchObject({ pact: { name: "Morning gym" } });
    expect(
      (
        await s.api(API_PATHS.firstOccurrence, {
          cookie,
          method: "POST",
          body: { schedule: pact.schedule, editing: created.body.pactId },
        })
      ).body,
    ).toMatchObject({ ok: true });

    expect((await s.api(path, { cookie, method: "DELETE" })).body).toEqual({ ok: true });
    expect((await s.api(path, { cookie })).body).toEqual({ ok: false, reason: "pact-not-found" });

    const again = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: pact });
    if (!again.body.ok) throw new Error(again.body.reason);
    s.clock.set(new Date(s.clock.now().getTime() + 10 * 60 * 1000));
    const late = API_PATHS.pact(again.body.pactId);
    const refused = { ok: false, reason: "edit-window-closed" };
    expect((await s.api(late, { cookie, method: "PUT", body: pact })).body).toEqual(refused);
    expect((await s.api(late, { cookie, method: "DELETE" })).body).toEqual(refused);
  });

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
    const editWindowClosesAt = new Date(s.clock.now().getTime() + 10 * 60 * 1000).toISOString();

    expect((await s.api(API_PATHS.today, { cookie })).body).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [
        {
          kind: "to-do",
          cards: [
            {
              kind: "evidence",
              pactId,
              name: "Gym",
              penaltyCents: 500,
              editWindowClosesAt,
              occurrenceDate: firstOccurrence.date,
              dueAt: firstOccurrence.dueAt,
              dueBy: null,
            },
          ],
        },
      ],
      waiting: [],
      yesterday: [],
    } satisfies TodayResponse);
    expect((await s.api(API_PATHS.pacts, { cookie })).body).toEqual([
      { id: pactId, name: "Gym", schedule: pact.schedule, penaltyCents: 500, stage: "active", editWindowClosesAt },
    ] satisfies PactsResponse);
    expect((await s.api(API_PATHS.pact(pactId), { cookie })).body).toEqual({
      ok: true,
      pact: {
        id: pactId,
        name: "Gym",
        description: "Me at the gym",
        evidenceKind: "camera",
        dueBy: null,
        startDate: null,
        endDate: null,
        schedule: pact.schedule,
        penaltyCents: 500,
        recipient: { id: pact.recipientId, name: "Sam" },
        reviewers: [{ id: friendId, name: "friend" }],
        reminders: [],
        stage: "active",
        firstOccurrence,
        editWindowClosesAt,
        newTerms: null,
        waiting: [],
        connectionProblem: null,
        history: {
          kind: "fixed-days",
          days: ["05", "06", "07", "08", "09", "10", "11"].map((day) => ({
            date: `2026-01-${day}`,
            occurrence: ["05", "07", "09"].includes(day)
              ? {
                  status: {
                    kind: "not-judged",
                    opensAt: `2026-01-${day}T05:00:00.000Z`,
                    dueAt: `2026-01-${String(Number(day) + 1).padStart(2, "0")}T05:00:00.000Z`,
                    evidenceWaiting: false,
                    excuse: null,
                  },
                  decidedBy: null,
                  recipientName: null,
                }
              : null,
          })),
        },
      },
    } satisfies PactResponse);
  });

  test("Today's Yesterday says how each pact due yesterday did", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: pact,
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    s.clock.set(s.at("Tue 10:00"));
    await s.core.advanceTo(s.at("Tue 10:00"));

    expect((await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie })).body.yesterday).toEqual([
      {
        pactId: created.body.pactId,
        name: "Gym",
        evidenceKind: "camera",
        occurrenceDate: "2026-01-05",
        occurrence: {
          status: { kind: "missed", penaltyCents: 500, held: false, excusableUntil: "2026-01-08T05:00:00.000Z" },
          decidedBy: null,
          recipientName: "Sam",
        },
      },
    ] satisfies TodayResponse["yesterday"]);
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
      { ...pact, evidenceKind: "fitbit" },
      { ...pact, name: null },
      { ...pact, schedule: { kind: "fixed-days", days: ["monday"] } },
      { ...pact, schedule: { kind: "weekly-count", days: ["mon"] } },
      { ...pact, schedule: { kind: "weekly-count", target: "3" } },
      { ...pact, schedule: { kind: "one-time", deadline: "2026-01-08" } },
      { ...pact, schedule: { kind: "one-time", deadline: 20260108, submitAnytime: false } },
      { ...pact, penaltyCents: "500" },
      { ...pact, reviewerIds: "someone" },
      { ...pact, reviewerIds: [1] },
      { ...pact, dueBy: 900 },
      { ...pact, startDate: null },
      { ...pact, endDate: ["2026-01-09"] },
      { ...pact, reminders: "18:00" },
      { ...pact, reminders: [1800] },
    ];

    for (const sent of malformedPacts) {
      const created = await s.api(API_PATHS.pacts, { cookie, method: "POST", body: sent });
      expect({ sent, ...created }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
    const recipient = await s.api(API_PATHS.recipients, { cookie, method: "POST", body: { name: 5 } });
    expect(recipient).toEqual({ status: 400, body: { error: "invalid-request" } });
    const check = await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: {} });
    expect(check).toEqual({ status: 400, body: { error: "invalid-request" } });
    const timing = { schedule: pact.schedule, dueBy: 9 };
    expect(await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: timing })).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
    for (const evidenceKind of ["fitbit", 3, null]) {
      const kind = { schedule: pact.schedule, evidenceKind };
      expect(await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: kind })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    // An editing id that isn't text, and JSON that isn't an object.
    for (const sent of [{ schedule: pact.schedule, editing: 5 }, [pact.schedule], '"schedule"', null]) {
      const check = await s.api(API_PATHS.firstOccurrence, { cookie, method: "POST", body: sent });
      expect({ sent, ...check }).toEqual({
        sent,
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("the Check step takes each evidence kind", async () => {
    const { s, owner, pact } = await ownerWithFriend();

    for (const evidenceKind of EVIDENCE_KINDS) {
      const body = { schedule: pact.schedule, evidenceKind };
      const check = await s.api(API_PATHS.firstOccurrence, { cookie: owner.cookie, method: "POST", body });
      expect({ evidenceKind, ...check }).toMatchObject({ evidenceKind, status: 200, body: { ok: true } });
    }
  });

  test("a fractional penalty is the core's refusal, as data, like a fractional payment", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const { cookie } = owner;
    const fractional = { ...pact, penaltyCents: 5.5 };

    const created = await s.api(API_PATHS.pacts, { cookie, method: "POST", body: fractional });

    expect(created).toEqual({ status: 200, body: { ok: false, reason: "invalid-penalty" } });
    // Editing in the edit window, and a change after it, read the same terms.
    const made = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: pact });
    if (!made.body.ok) throw new Error(JSON.stringify(made.body));
    const pactId = made.body.pactId;
    expect(await s.api(API_PATHS.pact(pactId), { cookie, method: "PUT", body: fractional })).toEqual(created);
    s.clock.set(new Date(s.clock.now().getTime() + 11 * 60 * 1000));
    for (const path of [API_PATHS.changePact(pactId), API_PATHS.changePreview(pactId)]) {
      const changed = await s.api(path, { cookie, method: "POST", body: fractional });
      expect({ path, ...changed }).toEqual({ path, ...created });
    }
  });

  test("a due-by time, start date and end date go through to the core, and its refusals come back as data", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const cookie = owner.cookie;
    const times = { dueBy: "21:00", startDate: "2026-01-12", endDate: "2026-01-31" };

    const check = await s.api(API_PATHS.firstOccurrence, {
      cookie,
      method: "POST",
      body: { schedule: pact.schedule, dueBy: times.dueBy, startDate: times.startDate },
    });
    expect(check.body).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-12", dueAt: "2026-01-13T02:00:00.000Z" },
    } satisfies FirstOccurrenceResponse);
    const refused = await s.api(API_PATHS.pacts, {
      cookie,
      method: "POST",
      body: { ...pact, ...times, endDate: "2026-01-09" },
    });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "end-date-too-early" } });

    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie,
      method: "POST",
      body: { ...pact, ...times },
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    const { pactId } = created.body;
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: { ...times, firstOccurrence: { date: "2026-01-12" } },
    });
    expect((await s.api<TodayResponse>(API_PATHS.today, { cookie })).body.sections).toEqual([
      { kind: "coming-up", cards: [expect.objectContaining({ opensOn: "2026-01-12", startDate: "2026-01-12" })] },
    ]);

    s.clock.set(s.at("Tue 10:00"));
    const { endDate: _endDate, ...rest } = times;
    const preview = await s.api(API_PATHS.changePreview(pactId), {
      cookie,
      method: "POST",
      body: { ...pact, ...rest, dueBy: "22:00" },
    });
    expect(preview.body).toEqual({
      ok: true,
      preview: {
        changes: [
          { term: "due-by", before: "21:00", after: "22:00", effect: "needs-approval" },
          { term: "end-date", before: "2026-01-31", after: null, effect: "stricter" },
        ],
        outcome: { kind: "needs-approval", reviewerNames: ["friend"], bundlesStricter: true },
      },
    });
  });

  test("a Weekly count pact goes through to the core: Today shows its week, the pact page its weeks, and its refusals are data", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const cookie = owner.cookie;
    const weekly = {
      ...pact,
      name: "Piano",
      schedule: { kind: "weekly-count", target: 3 },
    } satisfies CreatePactRequest;

    const check = await s.api(API_PATHS.firstOccurrence, {
      cookie,
      method: "POST",
      body: { schedule: weekly.schedule },
    });
    expect(check.body).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-12", dueAt: "2026-01-19T05:00:00.000Z" },
    } satisfies FirstOccurrenceResponse);
    const refused = await s.api(API_PATHS.pacts, {
      cookie,
      method: "POST",
      body: { ...weekly, schedule: { kind: "weekly-count", target: 8 } },
    });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "invalid-schedule" } });
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: weekly });
    if (!created.body.ok) throw new Error(created.body.reason);
    const { pactId } = created.body;

    s.clock.set(s.at("Tue+1 10:00"));
    expect((await s.api<TodayResponse>(API_PATHS.today, { cookie })).body.sections).toEqual([
      {
        kind: "to-do",
        cards: [
          {
            kind: "evidence",
            pactId,
            name: "Piano",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: "2026-01-12",
            dueAt: "2026-01-19T05:00:00.000Z",
            dueBy: null,
            week: { sessions: 0, waiting: 0, target: 3 },
          },
        ],
      },
    ] satisfies TodayResponse["sections"]);
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: {
        schedule: { kind: "weekly-count", target: 3 },
        history: { kind: "weekly-count", weeks: [{ date: "2026-01-12", progress: { sessions: 0, target: 3 } }] },
      },
    });
    const swapped = await s.api(API_PATHS.changePreview(pactId), {
      cookie,
      method: "POST",
      body: { ...weekly, schedule: pact.schedule },
    });
    expect(swapped).toEqual({ status: 200, body: { ok: false, reason: "schedule-kind-fixed" } });
    const lowered = await s.api(API_PATHS.changePreview(pactId), {
      cookie,
      method: "POST",
      body: { ...weekly, schedule: { kind: "weekly-count", target: 2 } },
    });
    expect(lowered.body).toMatchObject({
      ok: true,
      preview: { changes: [{ term: "schedule", effect: "needs-approval" }] },
    });
  });

  test("a One-time pact goes through to the core: Today shows it, the pact page its one occurrence, and its refusals are data", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const cookie = owner.cookie;
    const taxes = {
      ...pact,
      name: "Taxes",
      schedule: { kind: "one-time", deadline: "2026-01-08", submitAnytime: true },
      dueBy: "17:00",
      reminders: ["2026-01-07T09:00"],
    } satisfies CreatePactRequest;

    const check = await s.api(API_PATHS.firstOccurrence, {
      cookie,
      method: "POST",
      body: { schedule: taxes.schedule, dueBy: "17:00" },
    });
    expect(check.body).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-08", dueAt: "2026-01-08T22:00:00.000Z" },
    } satisfies FirstOccurrenceResponse);
    const tooSoon = await s.api(API_PATHS.firstOccurrence, {
      cookie,
      method: "POST",
      body: { schedule: { ...taxes.schedule, deadline: "2026-01-05" }, dueBy: "09:30" },
    });
    expect(tooSoon.body).toEqual({ ok: false, reason: "deadline-too-soon" } satisfies FirstOccurrenceResponse);
    const refused = await s.api(API_PATHS.pacts, {
      cookie,
      method: "POST",
      body: { ...taxes, startDate: "2026-01-06" },
    });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "invalid-start-date" } });
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, { cookie, method: "POST", body: taxes });
    if (!created.body.ok) throw new Error(created.body.reason);
    const { pactId } = created.body;

    s.clock.set(s.at("Tue 10:00"));
    expect((await s.api<TodayResponse>(API_PATHS.today, { cookie })).body.sections).toEqual([
      {
        kind: "to-do",
        cards: [
          {
            kind: "evidence",
            pactId,
            name: "Taxes",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: "2026-01-08",
            dueAt: "2026-01-08T22:00:00.000Z",
            dueBy: "17:00",
          },
        ],
      },
    ] satisfies TodayResponse["sections"]);
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: {
        schedule: taxes.schedule,
        reminders: ["2026-01-07T09:00"],
        history: { kind: "one-time", day: { date: "2026-01-08", occurrence: { status: { kind: "not-judged" } } } },
      },
    });
    const later = await s.api(API_PATHS.changePreview(pactId), {
      cookie,
      method: "POST",
      body: { ...taxes, schedule: { ...taxes.schedule, deadline: "2026-01-09" } },
    });
    expect(later.body).toMatchObject({
      ok: true,
      preview: { changes: [{ term: "schedule", effect: "needs-approval" }] },
    });
  });

  test("reminders go through to the core when creating and changing a pact, and its refusals come back as data", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const cookie = owner.cookie;

    const refused = await s.api(API_PATHS.pacts, { cookie, method: "POST", body: { ...pact, reminders: ["6pm"] } });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "invalid-reminders" } });
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie,
      method: "POST",
      body: { ...pact, reminders: ["18:00", "07:00"] },
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    const { pactId } = created.body;
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: { reminders: ["07:00", "18:00"] },
    });

    s.clock.set(s.at("Tue 10:00"));
    const changed = { ...pact, reminders: ["19:30"] };
    const preview = await s.api(API_PATHS.changePreview(pactId), { cookie, method: "POST", body: changed });
    expect(preview.body).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "reminders", before: ["07:00", "18:00"], after: ["19:30"], effect: "at-once" }],
        outcome: { kind: "at-once" },
      },
    });
    const sent = await s.api(API_PATHS.changePact(pactId), { cookie, method: "POST", body: changed });
    expect(sent.body).toEqual({ ok: true, outcome: { kind: "at-once" } });
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: { reminders: ["19:30"] },
    });
    const malformed = { ...pact, reminders: [7] };
    expect(await s.api(API_PATHS.changePact(pactId), { cookie, method: "POST", body: malformed })).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
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

/** A JPEG-typed file of `bytes` bytes, as the client sends a shrunk photo. */
const jpeg = (bytes = 3, fill = 1) => new File([new Uint8Array(bytes).fill(fill)], "photo.jpg", { type: "image/jpeg" });

/** The owner of a Mon/Wed/Fri Camera pact, created on Monday, that the friend reviews. */
async function ownerWithPact() {
  const setup = await ownerWithFriend();
  const created = await setup.s.api<CreatePactResponse>(API_PATHS.pacts, {
    cookie: setup.owner.cookie,
    method: "POST",
    body: setup.pact,
  });
  if (!created.body.ok) throw new Error(created.body.reason);
  // Past its edit window, when reviewers can see its evidence.
  setup.s.clock.set(new Date(setup.s.clock.now().getTime() + 11 * 60 * 1000));
  return { ...setup, pactId: created.body.pactId };
}

describe("evidence", () => {
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
        submittedAt: "2026-01-05T14:11:00.000Z",
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

  test("each upload logs one line with its sizes and timings, whatever became of it", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    const uploadLines = () => s.logs.filter((line) => line.startsWith("evidence-upload "));

    const submitted = await submit(s, owner.cookie, pactId, [jpeg(3, 1), jpeg(5, 2)]);
    const { evidenceId } = submitted.body as { evidenceId: string };
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^evidence-upload outcome=ok evidence=${evidenceId} photos=2 bytes=8 largestBytes=5 receiveMs=\\d+ storeMs=\\d+$`,
        ),
      ),
    ]);

    s.logs.length = 0;
    s.clock.set(s.at("Tue 10:00"));
    await submit(s, owner.cookie, pactId, [jpeg(4)]);
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        /^evidence-upload outcome=not-open photos=1 bytes=4 largestBytes=4 receiveMs=\d+ storeMs=\d+$/,
      ),
    ]);

    s.logs.length = 0;
    await submit(s, owner.cookie, pactId, [jpeg(MAX_PHOTO_BYTES + 1)]);
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^evidence-upload outcome=photo-too-large photos=1 bytes=${MAX_PHOTO_BYTES + 1} largestBytes=${MAX_PHOTO_BYTES + 1} receiveMs=\\d+$`,
        ),
      ),
    ]);

    // What a connection dropping partway through an upload looks like to the server.
    s.logs.length = 0;
    const cutOff = await s.request(API_PATHS.evidence(pactId), {
      method: "POST",
      cookie: owner.cookie,
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x\r\nnot the end of a form",
    });
    expect(cutOff.status).toBe(400);
    expect(uploadLines()).toEqual([expect.stringMatching(/^evidence-upload outcome=unreadable receiveMs=\d+$/)]);
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
            submittedAt: "2026-01-05T14:11:00.000Z",
            occurrenceDate: "2026-01-05",
            penaltyCents: 500,
            recipientName: "Sam",
            thread: { comments: [], waitingOnReply: false },
          },
        ] satisfies ReviewQueueResponse,
      });
      const photo = await s.request(API_PATHS.photo(s.photoStore.photoIds[1]!), { cookie: friend.cookie });
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

    test("a rejection with its reason shows on the owner's Today as an alert, and the day takes no more evidence", async () => {
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
          penaltyCents: 500,
          recipientName: "Sam",
          excusableUntil: expect.any(String),
        },
      ] satisfies TodayResponse["alerts"]);
      expect(today.body.sections).toEqual([]);
      expect(await submit(s, owner.cookie, pactId, [jpeg()])).toEqual({
        status: 200,
        body: { ok: false, reason: "already-judged" } satisfies SubmitEvidenceResponse,
      });
    });

    test("after a rejection the owner takes the L: the alert goes and the ledger stays; refusals are data", async () => {
      const { s, owner, friend, pactId, pact } = await ownerWithPact();
      const submitted = await submit(s, owner.cookie, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };
      await s.api(API_PATHS.decide(evidenceId), {
        cookie: friend.cookie,
        method: "POST",
        body: { kind: "reject", reason: "Blurry" } satisfies DecideRequest,
      });
      const take = (cookie: string, date = "2026-01-05") =>
        s.api(API_PATHS.acceptMiss(pactId, date), { cookie, method: "POST" });

      expect(await take(friend.cookie)).toEqual({
        status: 200,
        body: { ok: false, reason: "pact-not-found" } satisfies AcceptMissResponse,
      });
      expect(await take(owner.cookie, "2026-01-06")).toEqual({
        status: 200,
        body: { ok: false, reason: "nothing-to-accept" } satisfies AcceptMissResponse,
      });
      expect(await take(owner.cookie)).toEqual({ status: 200, body: { ok: true } satisfies AcceptMissResponse });
      expect(await take(owner.cookie)).toEqual({
        status: 200,
        body: { ok: false, reason: "nothing-to-accept" } satisfies AcceptMissResponse,
      });

      const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
      expect(today.body).toMatchObject({ alerts: [], sections: [] });
      const ledger = await s.api<LedgerResponse>(API_PATHS.ledger(pact.recipientId), { cookie: owner.cookie });
      expect(ledger.body).toMatchObject({
        ok: true,
        ledger: { summary: { owedCents: 500 }, history: [{ rejection: { reviewerName: "friend", reason: "Blurry" } }] },
      });
    });

    test("accepting a miss for a date that isn't a date is an invalid request", async () => {
      const { s, owner, pactId } = await ownerWithPact();

      for (const date of ["monday", "2026-1-5", "2026-01-05x", "20260105"]) {
        expect(await s.api(API_PATHS.acceptMiss(pactId, date), { cookie: owner.cookie, method: "POST" })).toEqual({
          status: 400,
          body: { error: "invalid-request" },
        });
      }
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

describe("excuses", () => {
  /** Posts an excuse form for `pactId`: its dates and reason, and `files` as its `photo` fields. */
  async function fileExcuse(
    s: Awaited<ReturnType<typeof server>>,
    cookie: string,
    pactId: string,
    fields: Partial<Record<"from" | "to" | "reason", string>>,
    files: File[] = [],
  ) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const file of files) form.append(EVIDENCE_PHOTO_FIELD, file);
    const response = await s.request(API_PATHS.excuses(pactId), { method: "POST", cookie, body: form });
    return { status: response.status, body: (await response.json()) as unknown };
  }

  test("the owner previews, files with a photo, sees it waiting and on its page; the reviewer approves it", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    s.clock.set(s.at("Tue 00:00"));
    await s.core.advanceTo(s.clock.now());
    s.clock.set(s.at("Tue 08:00"));
    const monday = { from: "2026-01-05", to: "2026-01-05" };

    const preview = await s.api<ExcusePreviewResponse>(
      `${API_PATHS.excusePreview(pactId)}?${new URLSearchParams(monday).toString()}`,
      { cookie: owner.cookie },
    );
    expect(preview.body).toMatchObject({
      ok: true,
      preview: { covered: [{ date: "2026-01-05", status: { kind: "missed", held: false } }], heldCents: 500 },
    });
    const options = await s.api<ExcuseOptionsResponse>(API_PATHS.excuseOptions(pactId), { cookie: owner.cookie });
    expect(options.body).toMatchObject({
      ok: true,
      options: { today: "2026-01-06", recentDays: [{ date: "2026-01-05" }] },
    });

    const filed = await fileExcuse(s, owner.cookie, pactId, { ...monday, reason: "Sick" }, [jpeg(3, 7)]);
    expect(filed).toEqual({ status: 200, body: { ok: true, excuseId: expect.any(String) } });
    const { excuseId } = filed.body as { excuseId: string };
    expect(s.logs).toContainEqual(expect.stringMatching(/^excuse-upload outcome=ok excuse=\S+ photos=1 bytes=3 /));

    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
    expect(today.body.waiting).toEqual([
      {
        kind: "excuse",
        id: excuseId,
        pactId,
        name: "Gym",
        firstDate: "2026-01-05",
        lastDate: "2026-01-05",
        filedAt: s.at("Tue 08:00").toISOString(),
      },
    ] satisfies TodayResponse["waiting"]);
    const page = await s.api<ExcuseResponse>(API_PATHS.excuse(excuseId), { cookie: owner.cookie });
    expect(page.body).toMatchObject({ ok: true, excuse: { reason: "Sick", reviewerNames: ["friend"] } });
    expect((await s.api(API_PATHS.excuse(excuseId), { cookie: friend.cookie })).body).toEqual({
      ok: false,
      reason: "excuse-not-found",
    });
    const [photoId] = s.photoStore.photoIds;
    expect((await s.request(API_PATHS.photo(photoId!), { cookie: friend.cookie })).status).toBe(200);

    const queue = await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, { cookie: friend.cookie });
    expect(queue.body).toEqual([expect.objectContaining({ kind: "excuse", id: excuseId, heldCents: 500 })]);
    const decided = await s.api(API_PATHS.decide(excuseId), {
      cookie: friend.cookie,
      method: "POST",
      body: { kind: "approve" } satisfies DecideRequest,
    });
    expect(decided).toEqual({ status: 200, body: { ok: true } });
    expect((await s.api<LedgersResponse>(API_PATHS.ledgers, { cookie: owner.cookie })).body).toEqual([
      expect.objectContaining({ owedCents: 0 }),
    ]);
  });

  test("a rejected excuse is an alert; Take the L on it is a 200, and so is its refusal", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    s.clock.set(s.at("Tue 00:00"));
    await s.core.advanceTo(s.clock.now());
    const filed = await fileExcuse(s, owner.cookie, pactId, { from: "2026-01-05", to: "2026-01-05", reason: "Sick" });
    const { excuseId } = filed.body as { excuseId: string };
    await s.api(API_PATHS.decide(excuseId), {
      cookie: friend.cookie,
      method: "POST",
      body: { kind: "reject", reason: "No" } satisfies DecideRequest,
    });

    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
    expect(today.body.alerts).toEqual([expect.objectContaining({ kind: "excuse-rejected", excuseId })]);
    const accept = () =>
      s.api<AcceptExcuseRejectionResponse>(API_PATHS.acceptExcuseRejection(excuseId), {
        cookie: owner.cookie,
        method: "POST",
      });
    expect(await accept()).toEqual({ status: 200, body: { ok: true } });
    expect(await accept()).toEqual({ status: 200, body: { ok: false, reason: "nothing-to-accept" } });
  });

  test("the core's refusals are 200s; a form missing a field, or a preview without dates, is a 400", async () => {
    const { s, owner, pactId } = await ownerWithPact();

    expect(await fileExcuse(s, owner.cookie, pactId, { from: "2026-01-05", to: "2026-01-05", reason: " " })).toEqual({
      status: 200,
      body: { ok: false, reason: "blank-reason" } satisfies FileExcuseResponse,
    });
    const four = [jpeg(3, 1), jpeg(3, 2), jpeg(3, 3), jpeg(3, 4)];
    expect(
      await fileExcuse(s, owner.cookie, pactId, { from: "2026-01-05", to: "2026-01-05", reason: "Sick" }, four),
    ).toEqual({ status: 200, body: { ok: false, reason: "too-many-photos" } });
    expect(await fileExcuse(s, owner.cookie, pactId, { from: "2026-01-05", reason: "Sick" })).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
    expect(await s.api(`${API_PATHS.excusePreview(pactId)}?from=2026-01-05`, { cookie: owner.cookie })).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
  });
});

describe("change requests", () => {
  test("the owner previews and sends a change, sees it waiting, withdraws it, then asks to end the pact; the reviewer approves", async () => {
    const { s, owner, friend, pact, pactId } = await ownerWithPact();
    const { cookie } = owner;
    const lower: ChangePactRequest = { ...pact, penaltyCents: 200, note: "Tight month" };

    const preview = await s.api<ChangePreviewResponse>(API_PATHS.changePreview(pactId), {
      cookie,
      method: "POST",
      body: lower,
    });
    expect(preview.body).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "penalty", before: 500, after: 200, effect: "needs-approval" }],
        outcome: { kind: "needs-approval", reviewerNames: ["friend"], bundlesStricter: false },
      },
    } satisfies ChangePreviewResponse);
    const sent = await s.api<ChangePactResponse>(API_PATHS.changePact(pactId), { cookie, method: "POST", body: lower });
    if (!sent.body.ok || sent.body.outcome.kind !== "needs-approval") throw new Error(JSON.stringify(sent.body));
    const id = sent.body.outcome.changeRequestId;
    const page = await s.api<ChangeRequestResponse>(API_PATHS.changeRequest(id), { cookie });
    expect(page.body).toMatchObject({ ok: true, changeRequest: { note: "Tight month", state: { kind: "waiting" } } });
    expect((await s.api(API_PATHS.changeRequest(id), { cookie: friend.cookie })).body).toEqual({
      ok: false,
      reason: "change-request-not-found",
    });
    expect((await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, { cookie: friend.cookie })).body).toEqual([
      expect.objectContaining({ kind: "change-request", id }),
    ]);
    const withdraw = () => s.api(API_PATHS.withdrawChangeRequest(id), { cookie, method: "POST" });
    expect(await withdraw()).toEqual({ status: 200, body: { ok: true } });
    expect(await withdraw()).toEqual({ status: 200, body: { ok: false, reason: "not-waiting" } });

    const end = await s.api<EndPactResponse>(API_PATHS.endPact(pactId), {
      cookie,
      method: "POST",
      body: { note: "Moved away" },
    });
    if (!end.body.ok) throw new Error(end.body.reason);
    await s.api(API_PATHS.decide(end.body.changeRequestId), {
      cookie: friend.cookie,
      method: "POST",
      body: { kind: "approve" } satisfies DecideRequest,
    });
    expect((await s.api<PactResponse>(API_PATHS.pact(pactId), { cookie })).body).toMatchObject({
      ok: true,
      pact: { stage: "ended" },
    });
  });

  test("the core's refusals are 200s; a body of another shape is a 400", async () => {
    const { s, owner, pact, pactId } = await ownerWithPact();
    const { cookie } = owner;

    expect(
      await s.api(API_PATHS.changePact(pactId), { cookie, method: "POST", body: { ...pact, reviewerIds: [] } }),
    ).toEqual({ status: 200, body: { ok: false, reason: "no-reviewers" } });
    expect(await s.api(API_PATHS.changePact(pactId), { cookie, method: "POST", body: pact })).toEqual({
      status: 200,
      body: { ok: false, reason: "nothing-changed" },
    });
    for (const path of [API_PATHS.changePact(pactId), API_PATHS.changePreview(pactId)]) {
      expect(await s.api(path, { cookie, method: "POST", body: { ...pact, penaltyCents: "5" } })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    for (const sent of [{ note: 5 }, ["note"], '"note"', null]) {
      const ended = await s.api(API_PATHS.endPact(pactId), { cookie, method: "POST", body: sent });
      expect({ sent, ...ended }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });
});

describe("reviewer questions", () => {
  /** Submits a photo of Monday's Gym as the owner; returns the evidence's id. */
  async function evidenceWaiting() {
    const setup = await ownerWithPact();
    const form = new FormData();
    form.append(EVIDENCE_PHOTO_FIELD, jpeg());
    const response = await setup.s.request(API_PATHS.evidence(setup.pactId), {
      method: "POST",
      cookie: setup.owner.cookie,
      body: form,
    });
    const submitted = (await response.json()) as SubmitEvidenceResponse;
    if (!submitted.ok) throw new Error(submitted.reason);
    return { ...setup, evidenceId: submitted.evidenceId };
  }

  test("the reviewer asks, the item waits on the owner's reply; the owner sees it on Today and its page, and replies", async () => {
    const { s, owner, friend, evidenceId } = await evidenceWaiting();
    const reviewer = { cookie: friend.cookie };

    const asked = await s.api<AskOwnerResponse>(API_PATHS.askOwner(evidenceId), {
      ...reviewer,
      method: "POST",
      body: { question: "Which gym is this?" } satisfies AskOwnerRequest,
    });

    expect(asked).toEqual({ status: 200, body: { ok: true } });
    expect((await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, reviewer)).body).toEqual([]);
    const waiting = await s.api<WaitingOnReplyResponse>(API_PATHS.waitingOnReply, reviewer);
    const question = {
      fromOwner: false,
      authorName: "friend",
      text: "Which gym is this?",
      sentAt: s.clock.now().toISOString(),
    };
    expect(waiting.body).toEqual([
      expect.objectContaining({ id: evidenceId, thread: { comments: [question], waitingOnReply: true } }),
    ]);
    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie: owner.cookie });
    expect(today.body.alerts).toEqual([
      expect.objectContaining({ kind: "reviewer-question", reviewerName: "friend", question: "Which gym is this?" }),
    ]);
    const page = await s.api<EvidenceResponse>(API_PATHS.evidenceItem(evidenceId), { cookie: owner.cookie });
    expect(page.body).toMatchObject({ ok: true, evidence: { id: evidenceId, thread: { waitingOnReply: true } } });
    expect((await s.api(API_PATHS.evidenceItem(evidenceId), reviewer)).body).toEqual({
      ok: false,
      reason: "evidence-not-found",
    });

    const replied = await s.api<ReplyResponse>(API_PATHS.reply(evidenceId), {
      cookie: owner.cookie,
      method: "POST",
      body: { reply: "The one on 5th" } satisfies ReplyRequest,
    });

    expect(replied).toEqual({ status: 200, body: { ok: true } });
    expect((await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, reviewer)).body).toEqual([
      expect.objectContaining({ id: evidenceId, thread: expect.objectContaining({ waitingOnReply: false }) }),
    ]);
    expect((await s.api(API_PATHS.waitingOnReply, reviewer)).body).toEqual([]);
  });

  test("a payment's page is its owner's; anyone else gets a 200 refusal", async () => {
    const { s, owner, friend, pact } = await ownerWithPact();
    s.clock.set(s.at("Sat 00:00"));
    await s.core.advanceTo(s.clock.now());
    const form = new FormData();
    form.append(PAYMENT_AMOUNT_FIELD, "500");
    form.append(EVIDENCE_PHOTO_FIELD, jpeg());
    const response = await s.request(API_PATHS.payments(pact.recipientId), {
      method: "POST",
      cookie: owner.cookie,
      body: form,
    });
    const recorded = (await response.json()) as RecordPaymentResponse;
    if (!recorded.ok) throw new Error(recorded.reason);

    const page = await s.api<PaymentResponse>(API_PATHS.paymentItem(recorded.paymentId), { cookie: owner.cookie });
    expect(page.body).toMatchObject({
      ok: true,
      payment: { amountCents: 500, recipientName: "Sam", state: { kind: "waiting" }, reviewerNames: ["friend"] },
    });
    expect((await s.api(API_PATHS.paymentItem(recorded.paymentId), { cookie: friend.cookie })).body).toEqual({
      ok: false,
      reason: "payment-not-found",
    });
  });

  test("the core's refusals are 200s; a body of another shape is a 400", async () => {
    const { s, owner, friend, evidenceId } = await evidenceWaiting();

    expect(
      await s.api(API_PATHS.askOwner(evidenceId), { cookie: friend.cookie, method: "POST", body: { question: " " } }),
    ).toEqual({ status: 200, body: { ok: false, reason: "blank-question" } });
    expect(
      await s.api(API_PATHS.reply(evidenceId), { cookie: owner.cookie, method: "POST", body: { reply: "Hm" } }),
    ).toEqual({ status: 200, body: { ok: false, reason: "no-question" } });
    for (const [path, cookie, body] of [
      [API_PATHS.askOwner(evidenceId), friend.cookie, { question: 5 }],
      [API_PATHS.askOwner(evidenceId), friend.cookie, {}],
      [API_PATHS.reply(evidenceId), owner.cookie, { reply: null }],
    ] as const) {
      expect(await s.api(path, { cookie, method: "POST", body })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
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

    const summary = {
      recipientId: pact.recipientId,
      name: "Sam",
      owedCents: 500,
      payableCents: 500,
      awaitingCents: 0,
      awaitingCount: 0,
      paidCents: 0,
      overdueCents: 0,
      billDue: null,
    };
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
              kind: "penalty",
              penaltyId: expect.any(String),
              pactId: created.body.pactId,
              pactName: "Gym",
              occurrenceDate: "2026-01-05",
              amountCents: 500,
              addedAt: "2026-01-06T05:00:00.000Z",
              paidCents: 0,
              held: false,
              bill: { kind: "next-bill", billedOn: "2026-01-14" },
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

describe("payments", () => {
  /** The owner with $15 owed to Sam: the friend reviews their Mon/Wed/Fri pact, and every day of it was Missed. */
  async function ownerWithFifteenOwed() {
    const setup = await ownerWithPact();
    setup.s.clock.set(setup.s.at("Sat 00:00"));
    await setup.s.core.advanceTo(setup.s.clock.now());
    return { ...setup, sam: setup.pact.recipientId };
  }

  /** Posts the payment form: the amount in cents, an optional note, and `photos` as `photo` fields. */
  async function record(
    s: Awaited<ReturnType<typeof server>>,
    cookie: string,
    recipientId: string,
    { amountCents, note, photos }: { amountCents?: string; note?: string; photos: (File | string)[] },
  ) {
    const form = new FormData();
    if (amountCents !== undefined) form.append(PAYMENT_AMOUNT_FIELD, amountCents);
    if (note !== undefined) form.append(PAYMENT_NOTE_FIELD, note);
    for (const photo of photos) form.append(EVIDENCE_PHOTO_FIELD, photo);
    const response = await s.request(API_PATHS.payments(recipientId), { method: "POST", cookie, body: form });
    return { status: response.status, body: (await response.json()) as unknown };
  }

  test("an owner records a payment with a screenshot; the ledger shows it awaiting, and the screenshot is served to the owner and the pact's reviewer only", async () => {
    const { s, owner, friend, sam } = await ownerWithFifteenOwed();
    // A friend of the owner's who reviews no pact with Sam.
    const other = await s.signIn("other@example.test", {
      inviteToken: (await s.api<CreateInviteResponse>(API_PATHS.invites, { cookie: owner.cookie, method: "POST" })).body
        .token,
    });

    const recorded = await record(s, owner.cookie, sam, {
      amountCents: "1000",
      note: "Venmo",
      photos: [jpeg(6, 3)],
    });

    expect(recorded).toEqual({
      status: 200,
      body: { ok: true, paymentId: expect.any(String) } satisfies RecordPaymentResponse,
    });
    const ledgers = await s.api<LedgersResponse>(API_PATHS.ledgers, { cookie: owner.cookie });
    expect(ledgers.body).toEqual([
      {
        recipientId: sam,
        name: "Sam",
        owedCents: 1500,
        payableCents: 500,
        awaitingCents: 1000,
        awaitingCount: 1,
        paidCents: 0,
        overdueCents: 0,
        billDue: null,
      },
    ] satisfies LedgersResponse);

    const [screenshot] = s.photoStore.photoIds;
    for (const cookie of [owner.cookie, friend.cookie]) {
      const response = await s.request(API_PATHS.photo(screenshot!), { cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(6).fill(3));
    }
    const response = await s.request(API_PATHS.photo(screenshot!), { cookie: other.cookie });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });

  test("the reviewer sees the payment in their queue and approves it; the owner can't decide it", async () => {
    const { s, owner, friend, sam } = await ownerWithFifteenOwed();
    const recorded = await record(s, owner.cookie, sam, { amountCents: "1000", photos: [jpeg()] });
    const { paymentId } = recorded.body as { paymentId: string };

    const queue = await s.api<ReviewQueueResponse>(API_PATHS.reviewQueue, { cookie: friend.cookie });
    expect(queue.body).toEqual([
      {
        kind: "payment",
        id: paymentId,
        ownerName: "owner",
        recipientName: "Sam",
        amountCents: 1000,
        note: null,
        photoId: s.photoStore.photoIds[0]!,
        recordedAt: s.at("Sat 00:00").toISOString(),
        owedCents: 1500,
        owedAfterApprovalCents: 500,
        thread: { comments: [], waitingOnReply: false },
      },
    ] satisfies ReviewQueueResponse);

    const approve = { kind: "approve" } satisfies DecideRequest;
    const decide = (cookie: string) => s.api(API_PATHS.decide(paymentId), { cookie, method: "POST", body: approve });
    expect(await decide(owner.cookie)).toEqual({
      status: 200,
      body: { ok: false, reason: "item-not-found" } satisfies DecideResponse,
    });
    expect(await decide(friend.cookie)).toEqual({ status: 200, body: { ok: true } satisfies DecideResponse });
    const ledgers = await s.api<LedgersResponse>(API_PATHS.ledgers, { cookie: owner.cookie });
    expect(ledgers.body).toEqual([
      {
        recipientId: sam,
        name: "Sam",
        owedCents: 500,
        payableCents: 500,
        awaitingCents: 0,
        awaitingCount: 0,
        paidCents: 1000,
        overdueCents: 0,
        billDue: null,
      },
    ] satisfies LedgersResponse);
  });

  test("the core's refusals are data: more than owed, a fractional amount, no screenshot", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    const refused = (reason: string) => ({ status: 200, body: { ok: false, reason } });
    expect(await record(s, owner.cookie, sam, { amountCents: "1501", photos: [jpeg()] })).toEqual(
      refused("payment-exceeds-owed"),
    );
    expect(await record(s, owner.cookie, sam, { amountCents: "250.5", photos: [jpeg()] })).toEqual(
      refused("invalid-amount"),
    );
    expect(await record(s, owner.cookie, sam, { amountCents: "500", photos: [] })).toEqual(refused("no-screenshot"));
  });

  test("a screenshot over the size cap, one that isn't a JPEG, or more than one, is refused before the core sees it", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    expect(await record(s, owner.cookie, sam, { amountCents: "500", photos: [jpeg(MAX_PHOTO_BYTES + 1)] })).toEqual({
      status: 400,
      body: { error: "photo-too-large" },
    });
    const malformed: (File | string)[][] = [
      ["not a file"],
      [new File([new Uint8Array([0x89, 0x50])], "photo.png", { type: "image/png" })],
      [jpeg(), jpeg()],
    ];
    for (const photos of malformed) {
      expect(await record(s, owner.cookie, sam, { amountCents: "500", photos })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    expect(s.photoStore.photoIds).toEqual([]);
    const ledgers = await s.api<LedgersResponse>(API_PATHS.ledgers, { cookie: owner.cookie });
    expect(ledgers.body).toEqual([expect.objectContaining({ awaitingCents: 0 })]);
    // Exactly at the cap is fine.
    expect(
      (await record(s, owner.cookie, sam, { amountCents: "500", photos: [jpeg(MAX_PHOTO_BYTES)] })).body,
    ).toMatchObject({ ok: true });
  });

  test("an amount that's missing or not a number is an invalid request", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    for (const amountCents of [undefined, "", "ten", "1e3", "5 dollars"]) {
      expect(
        await record(s, owner.cookie, sam, { ...(amountCents !== undefined && { amountCents }), photos: [jpeg()] }),
      ).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    expect(s.photoStore.photoIds).toEqual([]);
  });

  test("each upload logs one line with its size and timings", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();
    const uploadLines = () => s.logs.filter((line) => line.startsWith("payment-upload "));

    const recorded = await record(s, owner.cookie, sam, { amountCents: "1000", photos: [jpeg(5)] });
    const { paymentId } = recorded.body as { paymentId: string };
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^payment-upload outcome=ok payment=${paymentId} photos=1 bytes=5 largestBytes=5 receiveMs=\\d+ storeMs=\\d+$`,
        ),
      ),
    ]);

    s.logs.length = 0;
    await record(s, owner.cookie, sam, { amountCents: "1000", photos: [jpeg(4)] });
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        /^payment-upload outcome=payment-exceeds-owed photos=1 bytes=4 largestBytes=4 receiveMs=\d+ storeMs=\d+$/,
      ),
    ]);
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
      API_PATHS.waitingOnReply,
      API_PATHS.evidenceItem("some-evidence"),
      API_PATHS.paymentItem("some-payment"),
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
      API_PATHS.askOwner("some-item"),
      API_PATHS.reply("some-item"),
      API_PATHS.acceptMiss("some-pact", "2026-01-05"),
      API_PATHS.payments("some-recipient"),
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
    for (const sent of [{ timezone: 5 }, ["Europe/London"], '"Europe/London"', "not json"]) {
      const response = await s.api(API_PATHS.timezone, { cookie, method: "POST", body: sent });
      expect({ sent, ...response }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
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

  test("reports the deployed commit, or null for an image built without one", async () => {
    const health = async (s: Awaited<ReturnType<typeof server>>) =>
      (await (await s.request("/health")).json()) as HealthResponse;

    expect((await health(await server({ commit: "ebb9f3c" }))).commit).toBe("ebb9f3c");
    expect((await health(await server())).commit).toBeNull();
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
        VAPID_PUBLIC_KEY: "vapid-public",
        VAPID_PRIVATE_KEY: "vapid-private",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        OURA_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"),
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

describe("notifications", () => {
  const DEVICE = {
    endpoint: "https://web.push.apple.com/abc",
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: Buffer.alloc(16, 9).toString("base64url"),
  };

  test("needs a session", async () => {
    const s = await server();
    expect((await s.api(API_PATHS.notifications)).status).toBe(401);
    expect((await s.api(API_PATHS.pushSubscriptions, { method: "POST", body: DEVICE })).status).toBe(401);
  });

  test("the settings come with the key a browser subscribes with, and a change sticks", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const changed = await s.api<SetNotificationSettingResponse>(API_PATHS.notifications, {
      cookie,
      method: "POST",
      body: { setting: "decision", enabled: false },
    });

    expect(changed.body).toContainEqual({ setting: "decision", enabled: false });
    expect((await s.api<NotificationsResponse>(API_PATHS.notifications, { cookie })).body).toEqual({
      vapidPublicKey: VAPID_PUBLIC_KEY,
      settings: [
        { setting: "picked-as-reviewer", enabled: true },
        { setting: "review-item", enabled: true },
        { setting: "decision", enabled: false },
        { setting: "comment", enabled: true },
        { setting: "missed-occurrence", enabled: true },
        { setting: "new-bill", enabled: true },
        { setting: "overdue-bill", enabled: true },
        { setting: "connection-problem", enabled: true },
      ],
    });
  });

  test.each([
    ["a setting that doesn't exist", { setting: "nonsense", enabled: true }],
    ["operator alerts", { setting: "operator-alert", enabled: false }],
    ["enabled that isn't a boolean", { setting: "decision", enabled: "no" }],
  ])("a setting change with %s is a 400", async (_name, body) => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const response = await s.api(API_PATHS.notifications, { cookie, method: "POST", body });

    expect(response).toMatchObject({ status: 400, body: { error: "invalid-request" } });
  });

  test("a device is saved, then removed", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const saved = await s.api<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, {
      cookie,
      method: "POST",
      body: DEVICE,
    });
    expect(saved).toMatchObject({ status: 200, body: { ok: true } });

    const removed = await s.api(API_PATHS.pushSubscriptions, {
      cookie,
      method: "DELETE",
      body: { endpoint: DEVICE.endpoint },
    });
    expect(removed).toEqual({ status: 200, body: { ok: true } satisfies RemovePushSubscriptionResponse });
  });

  test("an endpoint that isn't a push service is the core's refusal, a 200", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const saved = await s.api<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, {
      cookie,
      method: "POST",
      body: { ...DEVICE, endpoint: "https://internal.example/hook" },
    });

    expect(saved).toMatchObject({ status: 200, body: { ok: false, reason: "invalid-subscription" } });
  });

  test("a removal without an endpoint is a 400", async () => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    for (const sent of [{}, { endpoint: 1 }, [DEVICE.endpoint], JSON.stringify(DEVICE.endpoint)]) {
      const removed = await s.api(API_PATHS.pushSubscriptions, { cookie, method: "DELETE", body: sent });
      expect({ sent, ...removed }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });

  test.each([
    ["no keys", { endpoint: DEVICE.endpoint }],
    ["an endpoint that isn't a string", { ...DEVICE, endpoint: 1 }],
  ])("a device with %s is a 400", async (_name, body) => {
    const s = await server();
    const { cookie } = await s.signIn(OPERATOR);

    const response = await s.api(API_PATHS.pushSubscriptions, { cookie, method: "POST", body });

    expect(response).toMatchObject({ status: 400, body: { error: "invalid-request" } });
  });
});

describe("connecting AnkiWeb", () => {
  const login = (s: Awaited<ReturnType<typeof server>>, cookie: string, password: string) =>
    s.api<ConnectAnkiResponse>(API_PATHS.ankiConnect, {
      cookie,
      method: "POST",
      body: { email: "me@example.test", password } satisfies ConnectAnkiRequest,
    });

  test("good credentials connect; bad ones and an AnkiWeb that doesn't answer don't", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);

    expect((await login(s, cookie, "wrong")).body).toEqual({ ok: false, reason: "wrong-login" });
    expect((await login(s, cookie, "down")).body).toEqual({ ok: false, reason: "unreachable" });
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);

    expect(await login(s, cookie, "right")).toMatchObject({ status: 200, body: { ok: true } });
    expect(s.ankiLogins.at(-1)).toEqual({
      account: s.core.accountIdForEmail(OPERATOR),
      username: "me@example.test",
      password: "right",
    });
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([
      { service: "anki", status: "connected", connectedAt: expect.any(String), activePacts: 0 },
    ]);
  });

  test("the email is trimmed; a login that throws is unreachable and logged, and connects nothing", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const connect = (password: string) =>
      s.api<ConnectAnkiResponse>(API_PATHS.ankiConnect, {
        cookie,
        method: "POST",
        body: { email: "  me@example.test \n", password } satisfies ConnectAnkiRequest,
      });

    expect(await connect("throws")).toEqual({ status: 200, body: { ok: false, reason: "unreachable" } });
    expect(s.logs).toContain("anki connect failed: socket hang up");
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);

    expect((await connect("right")).body).toEqual({ ok: true });
    expect(s.ankiLogins.map((login) => login.username)).toEqual(["me@example.test", "me@example.test"]);
  });

  test("a connect without an email and password is a 400, even with Anki not set up", async () => {
    const s = await server({ production: true, ankiSetUp: false });
    const { cookie } = await operatorWithInvite(s);
    for (const body of [{}, { email: "me@example.test" }, ["me@example.test", "right"]]) {
      expect(await s.api(API_PATHS.ankiConnect, { cookie, method: "POST", body })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("a disconnect the core fails keeps the host key", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    await login(s, cookie, "right");
    const as = s.core.as.bind(s.core);
    vi.spyOn(s.core, "as").mockImplementation((id) => ({
      ...as(id),
      disconnectAnki: () => Promise.reject(new Error("database is locked")),
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());

    const response = await s.request(API_PATHS.ankiDisconnect, { cookie, method: "POST" });

    expect(response.status).toBe(500);
    expect(s.ankiForgets).toEqual([]);
  });

  test("a connect without an email and password is a 400", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    for (const body of [{}, { email: "me@example.test" }, { email: 1, password: "right" }]) {
      expect(await s.api(API_PATHS.ankiConnect, { cookie, method: "POST", body })).toMatchObject({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("the deck list comes from AnkiWeb once connected", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const accountId = s.core.accountIdForEmail(OPERATOR)!;
    expect((await s.api<AnkiDecksResponse>(API_PATHS.ankiDecks, { cookie })).body).toEqual({
      ok: false,
      reason: "not-connected",
    });
    await login(s, cookie, "right");
    s.ankiSource.setDeck(accountId, { id: "1", name: "Spanish", review: 3 });

    expect((await s.api<AnkiDecksResponse>(API_PATHS.ankiDecks, { cookie })).body).toEqual({
      ok: true,
      rolloverHour: 4,
      decks: [{ id: "1", name: "Spanish", parentId: null, counts: { new: 0, learn: 0, review: 3 } }],
    });
  });

  test("check now asks AnkiWeb for a day waiting, and disconnecting forgets the host key", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const accountId = s.core.accountIdForEmail(OPERATOR)!;
    await login(s, owner.cookie, "right");
    s.ankiSource.setDeck(accountId, { id: "1", name: "Spanish", review: 3 });
    await s.api(API_PATHS.ankiDecks, { cookie: owner.cookie });
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: { ...pact, evidenceKind: "anki", name: "Spanish", description: "", ankiDeckId: "1" },
    });
    expect(created.body).toMatchObject({ ok: true });

    s.clock.set(s.at("Wed 20:00"));
    s.ankiSource.setAnkiDay(accountId, "2026-01-07", s.at("Wed 20:00"));
    expect(await s.api<CheckAnkiResponse>(API_PATHS.ankiCheck, { cookie: owner.cookie, method: "POST" })).toMatchObject(
      { status: 200, body: { ok: true } },
    );
    expect(s.ankiSource.countCalls).toEqual([{ account: accountId, deckIds: ["1"] }]);

    const after = await s.api<DisconnectAnkiResponse>(API_PATHS.ankiDisconnect, {
      cookie: owner.cookie,
      method: "POST",
    });
    expect(after.body.connections).toEqual([]);
    expect(s.ankiForgets).toEqual([accountId]);
  });

  test("a change after the edit window can name another deck", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    const accountId = s.core.accountIdForEmail(OPERATOR)!;
    await login(s, owner.cookie, "right");
    s.ankiSource.setDeck(accountId, { id: "1", name: "Spanish" });
    s.ankiSource.setDeck(accountId, { id: "2", name: "Italian" });
    await s.api(API_PATHS.ankiDecks, { cookie: owner.cookie });
    const anki = { ...pact, evidenceKind: "anki", name: "Spanish", description: "", ankiDeckId: "1" };
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: anki,
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    s.clock.set(s.at("Wed 20:00"));

    const { evidenceKind: _kind, ...change } = { ...anki, ankiDeckId: "2" };
    const preview = await s.api<ChangePreviewResponse>(API_PATHS.changePreview(created.body.pactId), {
      cookie: owner.cookie,
      method: "POST",
      body: change,
    });
    expect(preview.body).toMatchObject({
      ok: true,
      preview: {
        changes: [{ term: "deck", before: { id: "1", name: "Spanish" }, after: { id: "2", name: "Italian" } }],
        outcome: { kind: "needs-approval" },
      },
    });
  });

  test("with Anki not set up, connecting is refused and the profile says so", async () => {
    const s = await server({ production: true, ankiSetUp: false });
    const { cookie } = await operatorWithInvite(s);
    expect((await login(s, cookie, "right")).body).toEqual({ ok: false, reason: "unavailable" });
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body).toMatchObject({
      ankiAvailable: false,
      connections: [],
    });
  });
});

describe("connecting Oura", () => {
  /** Starts connecting as the browser would; returns the state Oura was sent and the cookies to bring back. */
  async function startConnecting(s: Awaited<ReturnType<typeof server>>, cookie: string) {
    const response = await s.request(API_PATHS.ouraConnect, { cookie });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(OURA_AUTHORIZE);
    return { state: location.searchParams.get("state")!, cookie: `${cookie}; ${cookieFrom(response)}` };
  }

  test("Oura's callback with this browser's state stores the tokens, makes the connection and returns to the form", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const started = await startConnecting(s, cookie);

    const back = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toBe("/pacts/new?oura=connected");
    expect(s.ouraConnects).toEqual([{ account: s.core.accountIdForEmail(OPERATOR), code: "good-code" }]);
    const me = await s.api<MeResponse>(API_PATHS.me, { cookie });
    expect(me.body.connections).toEqual([
      { service: "oura", status: "connected", connectedAt: expect.any(String), activePacts: 0 },
    ]);
  });

  test("a state that isn't this browser's connects nothing", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const started = await startConnecting(s, cookie);

    const forged = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=someone-else`, {
      cookie: started.cookie,
    });
    const noCookie = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, { cookie });

    for (const response of [forged, noCookie]) expect(response.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect(s.ouraConnects).toEqual([]);
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);
  });

  test("saying no on Oura's page returns to the form as cancelled; a code Oura refuses, as failed", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    let started = await startConnecting(s, cookie);
    const cancelled = await s.request(`${API_PATHS.ouraCallback}?error=access_denied&state=${started.state}`, {
      cookie: started.cookie,
    });
    started = await startConnecting(s, cookie);
    const refused = await s.request(`${API_PATHS.ouraCallback}?code=bad-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(cancelled.headers.get("Location")).toBe("/pacts/new?oura=cancelled");
    expect(refused.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);
  });

  test("the profile says whether Oura is set up, so the form can disable its tile", async () => {
    const set = await server();
    const unset = await server({ production: true, ouraSetUp: false });
    const meOf = async (s: Awaited<ReturnType<typeof server>>) => {
      const { cookie } = await operatorWithInvite(s);
      return (await s.api<MeResponse>(API_PATHS.me, { cookie })).body;
    };

    expect((await meOf(set)).ouraAvailable).toBe(true);
    expect((await meOf(unset)).ouraAvailable).toBe(false);
  });

  test("with Oura not set up, connecting returns to the form as unavailable and connects nothing", async () => {
    const s = await server({ production: true, ouraSetUp: false });
    const { cookie } = await operatorWithInvite(s);

    const started = await s.request(API_PATHS.ouraConnect, { cookie });
    const callback = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=any`, { cookie });

    for (const response of [started, callback]) {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/pacts/new?oura=unavailable");
    }
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);
  });

  test("connecting needs a session", async () => {
    const s = await server();
    expect((await s.request(API_PATHS.ouraConnect)).status).toBe(401);
  });

  test("reconnecting comes back to Today, connected or not", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const response = await s.request(OURA_RECONNECT_PATH, { cookie });
    const state = new URL(response.headers.get("Location")!).searchParams.get("state")!;
    const started = `${cookie}; ${cookieFrom(response)}`;

    const back = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${state}`, { cookie: started });

    expect(back.headers.get("Location")).toBe("/?oura=connected");
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([
      expect.objectContaining({ status: "connected" }),
    ]);
    const unset = await server({ production: true, ouraSetUp: false });
    const other = await operatorWithInvite(unset);
    expect((await unset.request(OURA_RECONNECT_PATH, { cookie: other.cookie })).headers.get("Location")).toBe(
      "/?oura=unavailable",
    );
  });

  /** The operator with Oura connected and a bedtime pact, in bed by midnight from Mon night. */
  async function ownerWithBedtimePact() {
    const { s, owner, pact } = await ownerWithFriend();
    const started = await startConnecting(s, owner.cookie);
    await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, { cookie: started.cookie });
    const created = await s.api<CreatePactResponse>(API_PATHS.pacts, {
      cookie: owner.cookie,
      method: "POST",
      body: { ...pact, evidenceKind: "oura", name: "In bed by midnight", description: "", inBedBy: "00:00" },
    });
    if (!created.body.ok) throw new Error(created.body.reason);
    return { s, cookie: owner.cookie, accountId: s.core.accountIdForEmail(OPERATOR)! };
  }

  test("a code whose exchange throws returns to the form as failed, is logged, and connects nothing", async () => {
    const s = await server();
    const { cookie } = await operatorWithInvite(s);
    const started = await startConnecting(s, cookie);

    const back = await s.request(`${API_PATHS.ouraCallback}?code=throwing-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(back.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect(s.logs).toContain("oura connect failed: token endpoint timed out");
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body.connections).toEqual([]);
  });

  test("a disconnect the core fails keeps Oura's tokens", async () => {
    const { s, cookie } = await ownerWithBedtimePact();
    const as = s.core.as.bind(s.core);
    vi.spyOn(s.core, "as").mockImplementation((id) => ({
      ...as(id),
      disconnectOura: () => Promise.reject(new Error("database is locked")),
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());

    const response = await s.request(API_PATHS.ouraDisconnect, { cookie, method: "POST" });

    expect(response.status).toBe(500);
    expect(s.ouraForgets).toEqual([]);
  });

  test("checking Oura now asks Oura for a night not judged yet, at most once in 15 seconds", async () => {
    const { s, cookie, accountId } = await ownerWithBedtimePact();
    s.clock.set(s.at("Tue 09:00"));

    const first = await s.api<CheckOuraResponse>(API_PATHS.ouraCheck, { cookie, method: "POST" });
    const again = await s.api<CheckOuraResponse>(API_PATHS.ouraCheck, { cookie, method: "POST" });

    for (const response of [first, again]) expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(s.ouraSource.calls.map((call) => call.account)).toEqual([accountId]);
  });

  test("checking Oura now with Oura not set up answers ok and asks nothing", async () => {
    const s = await server({ production: true, ouraSetUp: false });
    const { cookie } = await operatorWithInvite(s);
    expect(await s.api(API_PATHS.ouraCheck, { cookie, method: "POST" })).toEqual({ status: 200, body: { ok: true } });
    expect(s.ouraSource.calls).toEqual([]);
  });

  test("disconnecting removes the connection and Oura's tokens, and answers with the profile", async () => {
    const { s, cookie, accountId } = await ownerWithBedtimePact();
    const before = await s.api<MeResponse>(API_PATHS.me, { cookie });
    expect(before.body.connections).toEqual([expect.objectContaining({ activePacts: 1 })]);

    const response = await s.api<DisconnectOuraResponse>(API_PATHS.ouraDisconnect, { cookie, method: "POST" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ connections: [], ouraAvailable: true });
    expect(s.ouraForgets).toEqual([accountId]);
    const today = await s.api<TodayResponse>(API_PATHS.today, { cookie });
    expect(today.body.alerts).toEqual([{ kind: "connection", service: "oura", status: "not-connected" }]);
  });

  test("checking and disconnecting need a session", async () => {
    const s = await server();
    for (const path of [API_PATHS.ouraCheck, API_PATHS.ouraDisconnect]) {
      expect((await s.request(path, { method: "POST" })).status).toBe(401);
    }
  });
});
