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
import { offsetClock } from "../core/adapters.ts";
import { scenario } from "../core/testing/scenario.ts";
import { EVIDENCE_KINDS, MAX_EVIDENCE_PHOTOS } from "../shared/types.ts";
import { termsOf } from "../shared/terms.ts";
import {
  API_PATHS,
  APP_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  DEV_ADVANCE_PATH,
  DEV_SIGN_IN_PATH,
  EVIDENCE_PHOTO_FIELD,
  INVITE_REQUIRED_PATH,
  INVITE_TOKEN_SIGN_IN_KEY,
  OURA_RECONNECT_PATH,
  TIMEZONE_SIGN_IN_KEY,
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
  type AddReviewersRequest,
  type AddReviewersResponse,
  type ChangePreviewResponse,
  type ChangeRequestResponse,
  type EndPactResponse,
  type RenamePactRequest,
  type RenamePactResponse,
  type SetRemindersRequest,
  type SetRemindersResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type AcceptExcuseRejectionResponse,
  type AcceptVacationRejectionResponse,
  type CheckOuraResponse,
  type DisconnectOuraResponse,
  type DecideRequest,
  type ExcuseOptionsResponse,
  type FileVacationRequest,
  type FileVacationResponse,
  type VacationOptionsResponse,
  type VacationPreviewRequest,
  type VacationPreviewResponse,
  type LastVacationResponse,
  type VacationsResponse,
  type ExcusePreviewResponse,
  type ExcuseResponse,
  type FileExcuseResponse,
  type DecideResponse,
  type FirstOccurrenceResponse,
  type FriendsResponse,
  type HealthResponse,
  type InviteLookupResponse,
  type Json,
  type LedgerResponse,
  type LedgersResponse,
  type PactResponse,
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
/** Where a refused sign-in is sent: Better Auth's error page, for want of an invite. */
const REFUSED_SIGN_IN = new RegExp(`^${AUTH_ERROR_PATH}\\?error=${INVITE_REQUIRED_CODE}`);

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
  devClock = false,
}: {
  canonicalOrigin?: string | null;
  commit?: string | null;
  diskUsedFraction?: () => number;
  production?: boolean;
  ouraSetUp?: boolean;
  ankiSetUp?: boolean;
  devClock?: boolean;
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
    // On the scenario's clock, so the core and the route agree on the time.
    devClock: devClock ? offsetClock(s.clock) : null,
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

  /** A JSON request to the API, as the account whose `cookie` is given (none by default). */
  async function api<T = unknown>(
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
  }

  /** The API as the account whose session `cookie` is: each request carries it. */
  const client = (cookie: string) => ({
    cookie,
    get: <T = unknown>(path: string) => api<T>(path, { cookie }),
    post: <T = unknown>(path: string, body?: unknown) => api<T>(path, { cookie, method: "POST", body }),
    put: <T = unknown>(path: string, body: unknown) => api<T>(path, { cookie, method: "PUT", body }),
    delete: <T = unknown>(path: string, body?: unknown) => api<T>(path, { cookie, method: "DELETE", body }),
    /** Posts a multipart form of `fields`, in order, as the browser's forms do. */
    async postForm<T = unknown>(path: string, fields: readonly (readonly [name: string, value: string | File])[]) {
      const form = new FormData();
      for (const [name, value] of fields) form.append(name, value);
      const response = await request(path, { method: "POST", cookie, body: form });
      return { status: response.status, body: (await response.json()) as T };
    },
  });

  return {
    at: s.at,
    date: s.date,
    clock: s.clock,
    advanceTo: s.advanceTo,
    setClockTo: s.setClockTo,
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
    /** The app's registered routes and middleware, as Hono lists them. */
    routes: app.routes,
    request,
    api,
    /**
     * Signs in through Google's redirect, as the browser would: starts sign-in,
     * then comes back to the callback with a code that Google's (faked) token
     * endpoint exchanges for `email`. Returns the callback's response, the
     * cookies it set, the account signed in as (null if refused) and the API
     * as that session. The browser's `timezone` (America/New_York unless
     * given) rides in the OAuth state, as the client sends it. With
     * `inviteToken`, signs in as the invite page does.
     */
    async signIn(
      email: string,
      { inviteToken, timezone = "America/New_York" }: { inviteToken?: string; timezone?: string } = {},
    ) {
      fakeGoogle(email);
      // As the invite page does: come back to the invite, carrying its token.
      const fromInvite =
        inviteToken === undefined
          ? { callbackURL: "/", additionalData: { [TIMEZONE_SIGN_IN_KEY]: timezone } }
          : {
              callbackURL: APP_PATHS.invite(inviteToken),
              additionalData: { [INVITE_TOKEN_SIGN_IN_KEY]: inviteToken, [TIMEZONE_SIGN_IN_KEY]: timezone },
            };
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
      return { response, accountId: s.core.accountIdForEmail(email), ...client(cookieFrom(response)) };
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

type Server = Awaited<ReturnType<typeof server>>;
/** A signed-in account's side of the API. */
type Account = Awaited<ReturnType<Server["signIn"]>>;

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
    expect(response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(cookie).not.toContain("session_token");
    expect(s.authRows()).toEqual({ user: 0, account: 0, session: 0 });

    // Trying again goes down the same path: there is no half-made user to sign in as.
    const again = await s.signIn("stranger@example.test");
    expect(again.response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
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

  test("the operator signs in with their browser's timezone and sees an empty Today", async () => {
    const s = await server();

    const operator = await s.signIn(OPERATOR, { timezone: "America/Los_Angeles" });
    expect(operator.response.status).toBe(302);
    expect(operator.response.headers.get("Location")).toBe("/");
    expect(s.authRows()).toEqual({ user: 1, account: 1, session: 1 });

    expect((await operator.get(API_PATHS.me)).body).toEqual({
      email: OPERATOR,
      name: "owner",
      timezone: "America/Los_Angeles",
      connections: [],
      ouraAvailable: true,
      ankiAvailable: true,
    } satisfies MeResponse);

    expect((await operator.get(API_PATHS.today)).body).toEqual({
      hasPacts: false,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [],
    } satisfies TodayResponse);
  });

  test("the timezone can be changed after sign-in", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    expect(await operator.post(API_PATHS.timezone, { timezone: "America/Los_Angeles" })).toEqual({
      status: 200,
      body: { ok: true, timezone: "America/Los_Angeles" } satisfies SetTimezoneResponse,
    });
    expect((await operator.get<MeResponse>(API_PATHS.me)).body.timezone).toBe("America/Los_Angeles");
  });

  test("an invited friend's new account gets the timezone their browser sent", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);

    const friend = await s.signIn("friend@example.test", { inviteToken: owner.token, timezone: "Asia/Tokyo" });

    expect((await friend.get<MeResponse>(API_PATHS.me)).body.timezone).toBe("Asia/Tokyo");
  });

  test("the operator signing in again gets the same account", async () => {
    const s = await server();
    const first = await s.signIn(OPERATOR);
    await first.post(API_PATHS.timezone, { timezone: "Europe/London" });

    const second = await s.signIn(OPERATOR);

    expect(second.response.headers.get("Location")).toBe("/");
    expect((await second.get<MeResponse>(API_PATHS.me)).body.timezone).toBe("Europe/London");
    expect(s.authRows()).toMatchObject({ user: 1, account: 1 });
  });

  test("an invalid timezone is refused as data, not as an error", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    const set = await operator.post(API_PATHS.timezone, { timezone: "Mars/Olympus_Mons" });

    expect(set).toEqual({ status: 200, body: { ok: false, reason: "invalid-timezone" } satisfies SetTimezoneResponse });
  });
});

/** The operator, signed in from a browser in New York, and an invite they made at "Mon 09:00". */
async function operatorWithInvite(s: Server) {
  const operator = await s.signIn(OPERATOR);
  if (!operator.accountId) throw new Error("the operator's sign-in was refused");
  const invite = await operator.post<CreateInviteResponse>(API_PATHS.invites);
  expect(invite.status).toBe(200);
  return { ...operator, accountId: operator.accountId, token: invite.body.token };
}

/** `value` as a response body carries it, after its trip through JSON. */
const serialized = <T>(value: T) => JSON.parse(JSON.stringify(value)) as Json<T>;

/**
 * The operator and a friend, both signed in, with a saved recipient, "Sam"; a pact to create,
 * and `createPact`, which creates it (or `body`) as the owner and returns its id. `core` is the
 * owner's view of the core, for comparing a response with the core's own answer.
 */
async function ownerWithFriend() {
  const s = await server();
  const owner = await operatorWithInvite(s);
  const friend = await s.signIn("friend@example.test", { inviteToken: owner.token });
  await friend.post(API_PATHS.acceptInvite(owner.token));
  const friends = await owner.get<FriendsResponse>(API_PATHS.friends);
  const friendId = friends.body[0]!.id;
  const added = await owner.post<AddRecipientResponse>(API_PATHS.recipients, { name: "Sam" });
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
  const createPact = async (body: unknown = pact) => {
    const created = await owner.post<CreatePactResponse>(API_PATHS.pacts, body);
    if (!created.body.ok) throw new Error(created.body.reason);
    return created.body.pactId;
  };
  return { s, owner, core: s.core.as(owner.accountId), friend, friendId, pact, createPact };
}

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

    const friend = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect(friend.response.status).toBe(302);
    expect(friend.response.headers.get("Location")).toBe(APP_PATHS.invite(owner.token));
    expect(s.authRows()).toEqual({ user: 2, account: 2, session: 2 });
    const accept = await friend.post<AcceptInviteResponse>(API_PATHS.acceptInvite(owner.token));
    expect(accept).toMatchObject({ status: 200, body: { ok: true, friend: { name: "owner" } } });

    expect((await friend.get<FriendsResponse>(API_PATHS.friends)).body).toEqual([
      { id: expect.any(String), name: "owner" },
    ]);
    expect((await owner.get<FriendsResponse>(API_PATHS.friends)).body).toEqual([
      { id: expect.any(String), name: "friend" },
    ]);
  });

  test("a forwarded link: once a new account claims it, a stranger sees it as used and can't sign in", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const claimant = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-used" });
    expect((await claimant.get(API_PATHS.invite(owner.token))).body).toMatchObject({
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
    await first.post(API_PATHS.acceptInvite(owner.token));

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-used" });
    const again = await first.post(API_PATHS.acceptInvite(owner.token));
    expect(again).toEqual({ status: 200, body: { ok: false, reason: "invite-used" } });

    const stranger = await s.signIn("stranger@example.test", { inviteToken: owner.token });
    expect(stranger.response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(s.authRows()).toEqual({ user: 2, account: 2, session: 2 });
  });

  test("an invite 7 days old shows as expired and can't be accepted", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const friend = await s.signIn("friend@example.test", { inviteToken: owner.token });

    s.setClockTo("2026-01-12T14:00:00Z");

    expect((await s.api(API_PATHS.invite(owner.token))).body).toEqual({ ok: false, reason: "invite-expired" });
    const accept = await friend.post(API_PATHS.acceptInvite(owner.token));
    expect(accept).toEqual({ status: 200, body: { ok: false, reason: "invite-expired" } });
    expect((await friend.get(API_PATHS.friends)).body).toEqual([]);
  });

  test("an expired invite lets no new account in", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    s.setClockTo("2026-01-12T14:00:00Z");

    const { response } = await s.signIn("friend@example.test", { inviteToken: owner.token });

    expect(response.headers.get("Location")).toMatch(REFUSED_SIGN_IN);
    expect(s.authRows()).toEqual({ user: 1, account: 1, session: 1 });
  });
});

describe("dev sign-in", () => {
  test("outside production, the operator signs in without Google and lands on Today, in New York by default", async () => {
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
        timezone: "America/New_York",
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

  test("a second person signs in with an invite token and a timezone, claims it, and lands on the invite to accept", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);

    const response = await s.request(
      `${DEV_SIGN_IN_PATH}?email=friend@example.test&name=Friend&invite=${owner.token}&timezone=Europe/London`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(APP_PATHS.invite(owner.token));
    const cookie = cookieFrom(response);
    expect((await s.api<MeResponse>(API_PATHS.me, { cookie })).body).toMatchObject({
      email: "friend@example.test",
      name: "Friend",
      timezone: "Europe/London",
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

describe("dev clock", () => {
  test("with the dev clock on, advance moves the server's time forward and ticks up to it", async () => {
    const s = await server({ devClock: true });
    const before = s.clock.now();

    const response = await s.api(DEV_ADVANCE_PATH, { method: "POST", body: { minutes: 11 } });

    const now = new Date(before.getTime() + 11 * 60_000).toISOString();
    expect(response).toEqual({ status: 200, body: { now } });
    expect(s.core.lastTick()?.toISOString()).toBe(now);
  });

  test("a shape other than a positive number of minutes is refused with 400", async () => {
    const s = await server({ devClock: true });

    for (const body of [{}, { minutes: -5 }, { minutes: 0 }, { minutes: "11" }]) {
      expect((await s.api(DEV_ADVANCE_PATH, { method: "POST", body })).status).toBe(400);
    }
  });

  test("without the dev clock, or from another machine, the route doesn't exist", async () => {
    const off = await server();
    expect((await off.api(DEV_ADVANCE_PATH, { method: "POST", body: { minutes: 11 } })).status).toBe(401);

    const on = await server({ devClock: true });
    const remote = await on.request(DEV_ADVANCE_PATH, {
      origin: "http://192.168.1.20:5173",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: 11 }),
    });
    expect(remote.status).toBe(401);
    expect(on.core.lastTick()).toBeNull();
  });
});

describe("pacts", () => {
  test("an owner edits and deletes a new pact, and only in its edit window", async () => {
    const { s, owner, pact, createPact } = await ownerWithFriend();
    const pactId = await createPact();
    const path = API_PATHS.pact(pactId);

    expect((await owner.put(path, { nonsense: true })).status).toBe(400);
    const edited = await owner.put(path, { ...pact, name: "Morning gym" });
    expect(edited).toMatchObject({ status: 200, body: { ok: true } });
    expect((await owner.get(path)).body).toMatchObject({ pact: { name: "Morning gym" } });
    expect(
      (await owner.post(API_PATHS.firstOccurrence, { schedule: pact.schedule, editing: pactId })).body,
    ).toMatchObject({ ok: true });

    expect((await owner.delete(path)).body).toEqual({ ok: true });
    expect((await owner.get(path)).body).toEqual({ ok: false, reason: "pact-not-found" });

    const againId = await createPact();
    s.setClockTo("Mon 09:10");
    const late = API_PATHS.pact(againId);
    const refused = { ok: false, reason: "edit-window-closed" };
    expect((await owner.put(late, pact)).body).toEqual(refused);
    expect((await owner.delete(late)).body).toEqual(refused);
  });

  test("an owner creates a Camera pact and sees it on Today, in Pacts and on its page, as the core has it", async () => {
    const { owner, core, pact, createPact } = await ownerWithFriend();
    expect((await owner.get<RecipientsResponse>(API_PATHS.recipients)).body).toEqual([
      { id: pact.recipientId, name: "Sam" },
    ] satisfies RecipientsResponse);

    const check = await owner.post(API_PATHS.firstOccurrence, { schedule: pact.schedule });
    expect(check).toEqual({ status: 200, body: serialized(core.firstOccurrence({ schedule: pact.schedule })) });

    const pactId = await createPact();

    const page = await owner.get<PactResponse>(API_PATHS.pact(pactId));
    if (!page.body.ok) throw new Error(page.body.reason);
    // Every term sent is the pact's.
    expect({ evidenceKind: page.body.pact.evidenceKind, ...termsOf(page.body.pact) }).toEqual({
      ...pact,
      reminders: [],
    });
    expect(page.body).toEqual(serialized(core.pact(pactId)));
    expect((await owner.get(API_PATHS.today)).body).toEqual(serialized(core.today()));
    expect((await owner.get(API_PATHS.pacts)).body).toEqual(serialized(core.pacts()));
  });

  test("Today's Yesterday says how each pact due yesterday did, as the core has it", async () => {
    const { s, owner, core, createPact } = await ownerWithFriend();
    const pactId = await createPact();
    await s.advanceTo("Tue 10:00");

    const today = await owner.get<TodayResponse>(API_PATHS.today);

    expect(today.body.yesterday).toMatchObject([{ pactId }]);
    expect(today.body).toEqual(serialized(core.today()));
  });

  test("a reviewer who isn't a friend is refused as data", async () => {
    const { owner, pact } = await ownerWithFriend();

    const created = await owner.post(API_PATHS.pacts, { ...pact, reviewerIds: ["someone-else"] });

    expect(created).toEqual({ status: 200, body: { ok: false, reason: "not-a-friend" } });
    expect((await owner.get(API_PATHS.pacts)).body).toEqual([]);
  });

  test("a malformed pact, recipient or schedule is an invalid request", async () => {
    const { owner, pact } = await ownerWithFriend();
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
      const created = await owner.post(API_PATHS.pacts, sent);
      expect({ sent, ...created }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
    const recipient = await owner.post(API_PATHS.recipients, { name: 5 });
    expect(recipient).toEqual({ status: 400, body: { error: "invalid-request" } });
    const check = await owner.post(API_PATHS.firstOccurrence, {});
    expect(check).toEqual({ status: 400, body: { error: "invalid-request" } });
    const timing = { schedule: pact.schedule, dueBy: 9 };
    expect(await owner.post(API_PATHS.firstOccurrence, timing)).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
    for (const evidenceKind of ["fitbit", 3, null]) {
      const kind = { schedule: pact.schedule, evidenceKind };
      expect(await owner.post(API_PATHS.firstOccurrence, kind)).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    // An editing id that isn't text, and JSON that isn't an object.
    for (const sent of [{ schedule: pact.schedule, editing: 5 }, [pact.schedule], '"schedule"', null]) {
      const check = await owner.post(API_PATHS.firstOccurrence, sent);
      expect({ sent, ...check }).toEqual({
        sent,
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("the Check step takes each evidence kind", async () => {
    const { owner, pact } = await ownerWithFriend();

    for (const evidenceKind of EVIDENCE_KINDS) {
      const body = { schedule: pact.schedule, evidenceKind };
      const check = await owner.post(API_PATHS.firstOccurrence, body);
      expect({ evidenceKind, ...check }).toMatchObject({ evidenceKind, status: 200, body: { ok: true } });
    }
  });

  test("a fractional penalty is the core's refusal, as data, like a fractional payment", async () => {
    const { s, owner, pact, createPact } = await ownerWithFriend();
    const fractional = { ...pact, penaltyCents: 5.5 };

    const created = await owner.post(API_PATHS.pacts, fractional);

    expect(created).toEqual({ status: 200, body: { ok: false, reason: "invalid-penalty" } });
    // Editing in the edit window, and a change after it, read the same terms.
    const pactId = await createPact();
    expect(await owner.put(API_PATHS.pact(pactId), fractional)).toEqual(created);
    s.setClockTo("Mon 09:11");
    for (const path of [API_PATHS.changePact(pactId), API_PATHS.changePreview(pactId)]) {
      const changed = await owner.post(path, fractional);
      expect({ path, ...changed }).toEqual({ path, ...created });
    }
  });

  // Each test below sends a term the core's answer depends on, so an answer equal to the core's
  // own shows the route passed that term on.

  test("a due-by time, start date and end date go through to the core, and its refusals come back as data", async () => {
    const { s, owner, core, pact, createPact } = await ownerWithFriend();
    const times = { dueBy: "21:00", startDate: "2026-01-12", endDate: "2026-01-31" };

    const timing = { schedule: pact.schedule, dueBy: times.dueBy, startDate: times.startDate };
    const check = await owner.post(API_PATHS.firstOccurrence, timing);
    expect(check).toEqual({ status: 200, body: serialized(core.firstOccurrence(timing)) });
    const refused = await owner.post(API_PATHS.pacts, { ...pact, ...times, endDate: "2026-01-09" });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "end-date-too-early" } });

    const pactId = await createPact({ ...pact, ...times });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({ ok: true, pact: times });

    s.setClockTo("Tue 10:00");
    const { endDate: _endDate, ...rest } = times;
    const change = { ...pact, ...rest, dueBy: "22:00" };
    const preview = await owner.post(API_PATHS.changePreview(pactId), change);
    expect(preview).toEqual({ status: 200, body: serialized(core.changePreview(pactId, change)) });
  });

  test("a Weekly count pact goes through to the core, and its refusals come back as data", async () => {
    const { s, owner, core, pact, createPact } = await ownerWithFriend();
    const weekly = {
      ...pact,
      name: "Piano",
      schedule: { kind: "weekly-count", target: 3 },
    } satisfies CreatePactRequest;

    const check = await owner.post(API_PATHS.firstOccurrence, { schedule: weekly.schedule });
    expect(check).toEqual({ status: 200, body: serialized(core.firstOccurrence({ schedule: weekly.schedule })) });
    const refused = await owner.post(API_PATHS.pacts, { ...weekly, schedule: { kind: "weekly-count", target: 8 } });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "invalid-schedule" } });
    const pactId = await createPact(weekly);
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { schedule: { kind: "weekly-count", target: 3 } },
    });

    s.setClockTo("Tue+1 10:00");
    const lowered = { ...weekly, schedule: { kind: "weekly-count", target: 2 } } satisfies ChangePactRequest;
    const preview = await owner.post(API_PATHS.changePreview(pactId), lowered);
    expect(preview).toEqual({ status: 200, body: serialized(core.changePreview(pactId, lowered)) });
  });

  test("a One-time pact goes through to the core, and its refusals come back as data", async () => {
    const { s, owner, core, pact, createPact } = await ownerWithFriend();
    const taxes = {
      ...pact,
      name: "Taxes",
      schedule: { kind: "one-time", deadline: "2026-01-08", submitAnytime: true },
      dueBy: "17:00",
      reminders: ["2026-01-07T09:00"],
    } satisfies CreatePactRequest;

    const timing = { schedule: taxes.schedule, dueBy: "17:00" };
    const check = await owner.post(API_PATHS.firstOccurrence, timing);
    expect(check).toEqual({ status: 200, body: serialized(core.firstOccurrence(timing)) });
    const tooSoon = await owner.post(API_PATHS.firstOccurrence, {
      schedule: { ...taxes.schedule, deadline: "2026-01-05" },
      dueBy: "09:30",
    });
    expect(tooSoon).toEqual({
      status: 200,
      body: { ok: false, reason: "deadline-too-soon" } satisfies FirstOccurrenceResponse,
    });
    const pactId = await createPact(taxes);
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { schedule: taxes.schedule, dueBy: "17:00", reminders: ["2026-01-07T09:00"] },
    });

    s.setClockTo("Tue 10:00");
    const later = { ...taxes, schedule: { ...taxes.schedule, deadline: "2026-01-09" } } satisfies ChangePactRequest;
    const preview = await owner.post(API_PATHS.changePreview(pactId), later);
    expect(preview).toEqual({ status: 200, body: serialized(core.changePreview(pactId, later)) });
  });

  test("reminders go through to the core when creating and changing a pact, and its refusals come back as data", async () => {
    const { s, owner, core, pact, createPact } = await ownerWithFriend();

    const refused = await owner.post(API_PATHS.pacts, { ...pact, reminders: ["6pm"] });
    expect(refused).toEqual({ status: 200, body: { ok: false, reason: "invalid-reminders" } });
    const pactId = await createPact({ ...pact, reminders: ["18:00", "07:00"] });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { reminders: ["07:00", "18:00"] },
    });

    s.setClockTo("Tue 10:00");
    const changed = { ...pact, reminders: ["19:30"], penaltyCents: 1000 };
    const preview = await owner.post(API_PATHS.changePreview(pactId), changed);
    expect(preview).toEqual({ status: 200, body: serialized(core.changePreview(pactId, changed)) });
    const sent = await owner.post(API_PATHS.changePact(pactId), changed);
    expect(sent.body).toMatchObject({ ok: true, outcome: { kind: "stricter", appliesNow: ["reminders"] } });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { reminders: ["19:30"] },
    });
    const malformed = { ...pact, reminders: [7] };
    expect(await owner.post(API_PATHS.changePact(pactId), malformed)).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
  });

  test("someone else's pact, or one that doesn't exist, is not found, as data", async () => {
    const { s, owner, friend, pact, createPact } = await ownerWithFriend();
    const pactId = await createPact();

    const other = await friend.get(API_PATHS.pact(pactId));

    const notFound = { status: 200, body: { ok: false, reason: "pact-not-found" } satisfies PactResponse };
    expect(other).toEqual(notFound);
    expect(await owner.get(API_PATHS.pact("no-such-pact"))).toEqual(notFound);
  });
});

/** A JPEG-typed file of `bytes` bytes, as the client sends a shrunk photo. */
const jpeg = (bytes = 3, fill = 1) => new File([new Uint8Array(bytes).fill(fill)], "photo.jpg", { type: "image/jpeg" });

/** The owner of a Mon/Wed/Fri Camera pact, created on Monday, that the friend reviews. */
async function ownerWithPact() {
  const setup = await ownerWithFriend();
  const pactId = await setup.createPact();
  // Past its edit window, when reviewers can see its evidence.
  setup.s.setClockTo("Mon 09:11");
  return { ...setup, pactId };
}

describe("evidence", () => {
  /** Posts `files` as the evidence form's `photo` fields. */
  const submit = (account: Account, pactId: string, files: (File | string)[]) =>
    account.postForm(
      API_PATHS.evidence(pactId),
      files.map((file) => [EVIDENCE_PHOTO_FIELD, file]),
    );

  test("an owner submits photos; Today shows it waiting, and its photos are served to the owner and reviewer only", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    const stranger = await s.signIn("stranger@example.test", {
      inviteToken: (await owner.post<CreateInviteResponse>(API_PATHS.invites)).body.token,
    });

    const submitted = await submit(owner, pactId, [jpeg(3, 1), jpeg(5, 2)]);

    expect(submitted).toEqual({
      status: 200,
      body: { ok: true, evidenceId: expect.any(String) } satisfies SubmitEvidenceResponse,
    });
    const today = await owner.get<TodayResponse>(API_PATHS.today);
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
    s.setClockTo("Tue 10:00");

    expect(await submit(owner, pactId, [jpeg()])).toEqual({
      status: 200,
      body: { ok: false, reason: "not-open" } satisfies SubmitEvidenceResponse,
    });
  });

  test("a photo over the size cap is refused before the core sees any of them", async () => {
    const { s, owner, pactId } = await ownerWithPact();

    const submitted = await submit(owner, pactId, [jpeg(), jpeg(MAX_PHOTO_BYTES + 1)]);

    expect(submitted).toEqual({ status: 400, body: { error: "photo-too-large" } });
    expect(s.photoStore.photoIds).toEqual([]);
    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.waiting).toEqual([]);
    // Exactly at the cap is fine.
    expect((await submit(owner, pactId, [jpeg(MAX_PHOTO_BYTES)])).body).toMatchObject({ ok: true });
  });

  test("each upload logs one line with its sizes and timings, whatever became of it", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    const uploadLines = () => s.logs.filter((line) => line.startsWith("evidence-upload "));

    const submitted = await submit(owner, pactId, [jpeg(3, 1), jpeg(5, 2)]);
    const { evidenceId } = submitted.body as { evidenceId: string };
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^evidence-upload outcome=ok evidence=${evidenceId} photos=2 bytes=8 largestBytes=5 receiveMs=\\d+ storeMs=\\d+$`,
        ),
      ),
    ]);

    s.logs.length = 0;
    s.setClockTo("Tue 10:00");
    await submit(owner, pactId, [jpeg(4)]);
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        /^evidence-upload outcome=not-open photos=1 bytes=4 largestBytes=4 receiveMs=\d+ storeMs=\d+$/,
      ),
    ]);

    s.logs.length = 0;
    await submit(owner, pactId, [jpeg(MAX_PHOTO_BYTES + 1)]);
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
        owner,
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
      expect(await submit(owner, pactId, files)).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    expect(s.photoStore.photoIds).toEqual([]);
  });

  describe("review", () => {
    test("the reviewer sees the evidence in their queue, fetches its photos, and approves it once", async () => {
      const { s, owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(owner, pactId, [jpeg(3, 1), jpeg(4, 2)]);
      const { evidenceId } = submitted.body as { evidenceId: string };

      const queue = await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue);

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
      const decided = await friend.post(API_PATHS.decide(evidenceId), approve);
      expect(decided).toEqual({ status: 200, body: { ok: true } satisfies DecideResponse });
      expect((await friend.get(API_PATHS.reviewQueue)).body).toEqual([]);
      const today = await owner.get<TodayResponse>(API_PATHS.today);
      expect(today.body).toMatchObject({ alerts: [], sections: [], waiting: [] });

      // A refusal is data.
      const again = await friend.post(API_PATHS.decide(evidenceId), approve);
      expect(again).toEqual({
        status: 200,
        body: { ok: false, reason: "already-decided" } satisfies DecideResponse,
      });
    });

    test("a rejection with its reason shows on the owner's Today as an alert, and the day takes no more evidence", async () => {
      const { s, owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(owner, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };

      const reject = { kind: "reject", reason: "Blurry" } satisfies DecideRequest;
      const decided = await friend.post(API_PATHS.decide(evidenceId), reject);

      expect(decided).toEqual({ status: 200, body: { ok: true } });
      const today = await owner.get<TodayResponse>(API_PATHS.today);
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
          week: false,
        },
      ] satisfies TodayResponse["alerts"]);
      expect(today.body.sections).toEqual([]);
      expect(await submit(owner, pactId, [jpeg()])).toEqual({
        status: 200,
        body: { ok: false, reason: "already-judged" } satisfies SubmitEvidenceResponse,
      });
    });

    test("after a rejection the owner takes the L: the alert goes and the ledger stays; refusals are data", async () => {
      const { owner, friend, pactId, pact } = await ownerWithPact();
      const submitted = await submit(owner, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };
      await friend.post(API_PATHS.decide(evidenceId), { kind: "reject", reason: "Blurry" } satisfies DecideRequest);
      const take = (account: Account, date = "2026-01-05") => account.post(API_PATHS.acceptMiss(pactId, date));

      expect(await take(friend)).toEqual({
        status: 200,
        body: { ok: false, reason: "pact-not-found" } satisfies AcceptMissResponse,
      });
      expect(await take(owner, "2026-01-06")).toEqual({
        status: 200,
        body: { ok: false, reason: "nothing-to-accept" } satisfies AcceptMissResponse,
      });
      expect(await take(owner)).toEqual({ status: 200, body: { ok: true } satisfies AcceptMissResponse });
      expect(await take(owner)).toEqual({
        status: 200,
        body: { ok: false, reason: "nothing-to-accept" } satisfies AcceptMissResponse,
      });

      const today = await owner.get<TodayResponse>(API_PATHS.today);
      expect(today.body).toMatchObject({ alerts: [], sections: [] });
      const ledger = await owner.get<LedgerResponse>(API_PATHS.ledger(pact.recipientId));
      expect(ledger.body).toMatchObject({
        ok: true,
        ledger: { summary: { owedCents: 500 }, history: [{ rejection: { reviewerName: "friend", reason: "Blurry" } }] },
      });
    });

    test("accepting a miss for a date that isn't a date is an invalid request", async () => {
      const { owner, pactId } = await ownerWithPact();

      for (const date of ["monday", "2026-1-5", "2026-01-05x", "20260105"]) {
        expect(await owner.post(API_PATHS.acceptMiss(pactId, date))).toEqual({
          status: 400,
          body: { error: "invalid-request" },
        });
      }
    });

    test("a decision of the wrong shape is an invalid request; a blank reason is refused as data", async () => {
      const { owner, friend, pactId } = await ownerWithPact();
      const submitted = await submit(owner, pactId, [jpeg()]);
      const { evidenceId } = submitted.body as { evidenceId: string };
      const decide = (body: unknown) => friend.post(API_PATHS.decide(evidenceId), body);

      for (const body of ["not json", {}, { kind: "maybe" }, { kind: "reject" }, { kind: "reject", reason: 3 }]) {
        expect(await decide(body)).toEqual({ status: 400, body: { error: "invalid-request" } });
      }
      expect(await decide({ kind: "reject", reason: " " })).toEqual({
        status: 200,
        body: { ok: false, reason: "blank-reason" },
      });
      expect((await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue)).body).toHaveLength(1);
    });
  });
});

describe("excuses", () => {
  /** Posts an excuse form for `pactId`: its dates and reason, and `files` as its `photo` fields. */
  const fileExcuse = (
    account: Account,
    pactId: string,
    fields: Partial<Record<"from" | "to" | "reason", string>>,
    files: File[] = [],
  ) =>
    account.postForm(API_PATHS.excuses(pactId), [
      ...Object.entries(fields),
      ...files.map((file) => [EVIDENCE_PHOTO_FIELD, file] as const),
    ]);

  test("the owner previews, files with a photo, sees it waiting and on its page; the reviewer approves it", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    await s.advanceTo("Tue 00:00");
    s.setClockTo("Tue 08:00");
    const monday = { from: s.date("Mon"), to: s.date("Mon") };

    const preview = await owner.get<ExcusePreviewResponse>(
      `${API_PATHS.excusePreview(pactId)}?${new URLSearchParams(monday).toString()}`,
    );
    expect(preview.body).toMatchObject({
      ok: true,
      preview: { covered: [{ date: s.date("Mon"), status: { kind: "missed", cover: null } }], heldCents: 500 },
    });
    const options = await owner.get<ExcuseOptionsResponse>(API_PATHS.excuseOptions(pactId));
    expect(options.body).toMatchObject({
      ok: true,
      options: { today: s.date("Tue"), recentDays: [{ date: s.date("Mon") }] },
    });

    const filed = await fileExcuse(owner, pactId, { ...monday, reason: "Sick" }, [jpeg(3, 7)]);
    expect(filed).toEqual({ status: 200, body: { ok: true, excuseId: expect.any(String) } });
    const { excuseId } = filed.body as { excuseId: string };
    expect(s.logs).toContainEqual(expect.stringMatching(/^excuse-upload outcome=ok excuse=\S+ photos=1 bytes=3 /));

    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.waiting).toEqual([
      {
        kind: "excuse",
        id: excuseId,
        pactId,
        name: "Gym",
        firstDate: s.date("Mon"),
        lastDate: s.date("Mon"),
        filedAt: s.at("Tue 08:00").toISOString(),
      },
    ] satisfies TodayResponse["waiting"]);
    const page = await owner.get<ExcuseResponse>(API_PATHS.excuse(excuseId));
    expect(page.body).toMatchObject({ ok: true, excuse: { reason: "Sick", reviewerNames: ["friend"] } });
    expect((await friend.get(API_PATHS.excuse(excuseId))).body).toEqual({
      ok: false,
      reason: "excuse-not-found",
    });
    const [photoId] = s.photoStore.photoIds;
    expect((await s.request(API_PATHS.photo(photoId!), { cookie: friend.cookie })).status).toBe(200);

    const queue = await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue);
    expect(queue.body).toEqual([expect.objectContaining({ kind: "excuse", id: excuseId, heldCents: 500 })]);
    const decided = await friend.post(API_PATHS.decide(excuseId), { kind: "approve" } satisfies DecideRequest);
    expect(decided).toEqual({ status: 200, body: { ok: true } });
    expect((await owner.get<LedgersResponse>(API_PATHS.ledgers)).body).toEqual([
      expect.objectContaining({ owedCents: 0 }),
    ]);
  });

  test("a rejected excuse is an alert; Take the L on it is a 200, and so is its refusal", async () => {
    const { s, owner, friend, pactId } = await ownerWithPact();
    await s.advanceTo("Tue 00:00");
    const filed = await fileExcuse(owner, pactId, { from: s.date("Mon"), to: s.date("Mon"), reason: "Sick" });
    const { excuseId } = filed.body as { excuseId: string };
    await friend.post(API_PATHS.decide(excuseId), { kind: "reject", reason: "No" } satisfies DecideRequest);

    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.alerts).toEqual([expect.objectContaining({ kind: "excuse-rejected", excuseId })]);
    const accept = () => owner.post<AcceptExcuseRejectionResponse>(API_PATHS.acceptExcuseRejection(excuseId));
    expect(await accept()).toEqual({ status: 200, body: { ok: true } });
    expect(await accept()).toEqual({ status: 200, body: { ok: false, reason: "nothing-to-accept" } });
  });

  test("the core's refusals are 200s; a form missing a field, or a preview without dates, is a 400", async () => {
    const { s, owner, pactId } = await ownerWithPact();

    expect(await fileExcuse(owner, pactId, { from: "2026-01-05", to: "2026-01-05", reason: " " })).toEqual({
      status: 200,
      body: { ok: false, reason: "blank-reason" } satisfies FileExcuseResponse,
    });
    const four = [jpeg(3, 1), jpeg(3, 2), jpeg(3, 3), jpeg(3, 4)];
    expect(await fileExcuse(owner, pactId, { from: "2026-01-05", to: "2026-01-05", reason: "Sick" }, four)).toEqual({
      status: 200,
      body: { ok: false, reason: "too-many-photos" },
    });
    expect(await fileExcuse(owner, pactId, { from: "2026-01-05", reason: "Sick" })).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
    expect(await owner.get(`${API_PATHS.excusePreview(pactId)}?from=2026-01-05`)).toEqual({
      status: 400,
      body: { error: "invalid-request" },
    });
  });
});

describe("vacations", () => {
  test("the owner reads the options, previews, files, sees it on Profile and withdraws it", async () => {
    const { s, owner, friendId, pactId } = await ownerWithPact();
    const request: VacationPreviewRequest = { from: s.date("Mon+1"), to: s.date("Sun+1"), pactIds: [pactId] };

    const options = await owner.get<VacationOptionsResponse>(API_PATHS.vacationOptions);
    expect(options.body).toMatchObject({
      today: s.date("Mon"),
      recurring: [{ id: pactId, reviewers: [{ id: friendId, name: "friend" }] }],
      oneTime: [],
    });
    const preview = await owner.post<VacationPreviewResponse>(API_PATHS.vacationPreview, request);
    expect(preview.body).toMatchObject({ ok: true, preview: { days: 7, summary: { kind: "all" } } });

    const filed = await owner.post(API_PATHS.vacations, {
      ...request,
      note: "Going to Portugal",
      reviewerIds: [friendId],
    } satisfies FileVacationRequest);
    expect(filed).toEqual({ status: 200, body: { ok: true, vacationId: expect.any(String) } });
    const { vacationId } = filed.body as { vacationId: string };
    expect((await owner.get<VacationsResponse>(API_PATHS.vacations)).body).toEqual([
      expect.objectContaining({ id: vacationId, note: "Going to Portugal", reviewerNames: ["friend"] }),
    ]);

    const withdraw = () => owner.post(API_PATHS.withdrawVacation(vacationId));
    expect(await withdraw()).toEqual({ status: 200, body: { ok: true } });
    expect(await withdraw()).toEqual({ status: 200, body: { ok: false, reason: "not-waiting" } });
    expect((await owner.get<VacationsResponse>(API_PATHS.vacations)).body).toEqual([]);
  });

  test("the picked reviewer sees it in the Review Queue, asks, the owner replies from Profile, and the reviewer approves", async () => {
    const { s, owner, friend, friendId, pactId } = await ownerWithPact();
    const filed = await owner.post<FileVacationResponse>(API_PATHS.vacations, {
      from: s.date("Mon+1"),
      to: s.date("Sun+1"),
      pactIds: [pactId],
      reviewerIds: [friendId],
    } satisfies FileVacationRequest);
    if (!filed.body.ok) throw new Error(filed.body.reason);
    const { vacationId } = filed.body;

    expect((await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue)).body).toEqual([
      expect.objectContaining({
        kind: "vacation",
        id: vacationId,
        from: s.date("Mon+1"),
        covers: [expect.objectContaining({ pactId, covered: expect.any(Array) })],
        filedAt: s.clock.now().toISOString(),
      }),
    ]);
    const asked = await friend.post<AskOwnerResponse>(API_PATHS.askOwner(vacationId), {
      question: "When do you fly?",
    } satisfies AskOwnerRequest);
    expect(asked).toEqual({ status: 200, body: { ok: true } });
    expect((await friend.get<WaitingOnReplyResponse>(API_PATHS.waitingOnReply)).body).toEqual([
      expect.objectContaining({ kind: "vacation", id: vacationId }),
    ]);
    expect((await owner.get<VacationsResponse>(API_PATHS.vacations)).body).toEqual([
      expect.objectContaining({
        id: vacationId,
        state: { kind: "waiting-on-reply", askedBy: "friend", question: "When do you fly?" },
      }),
    ]);

    const replied = await owner.post<ReplyResponse>(API_PATHS.reply(vacationId), {
      reply: "Sunday at 7am",
    } satisfies ReplyRequest);
    expect(replied).toEqual({ status: 200, body: { ok: true } });
    expect(await friend.post(API_PATHS.decide(vacationId), { kind: "approve" } satisfies DecideRequest)).toEqual({
      status: 200,
      body: { ok: true },
    });

    expect((await friend.get(API_PATHS.reviewQueue)).body).toEqual([]);
    expect((await owner.get<VacationsResponse>(API_PATHS.vacations)).body).toEqual([
      expect.objectContaining({ id: vacationId, state: { kind: "approved", reviewerName: "friend" } }),
    ]);
  });

  test("Profile reads the last vacation: none at first, then an approved one once it has ended", async () => {
    const { s, owner, friend, friendId, pactId } = await ownerWithPact();
    expect(await owner.get(API_PATHS.lastVacation)).toEqual({ status: 200, body: null });
    const filed = await owner.post<FileVacationResponse>(API_PATHS.vacations, {
      from: s.date("Mon+1"),
      to: s.date("Tue+1"),
      pactIds: [pactId],
      reviewerIds: [friendId],
    } satisfies FileVacationRequest);
    if (!filed.body.ok) throw new Error(filed.body.reason);
    await friend.post(API_PATHS.decide(filed.body.vacationId), { kind: "approve" } satisfies DecideRequest);

    s.setClockTo("Wed+1 12:00");

    expect(await owner.get<LastVacationResponse>(API_PATHS.lastVacation)).toEqual({
      status: 200,
      body: { from: s.date("Mon+1"), to: s.date("Tue+1") },
    });
  });

  test("a rejected vacation is an alert; Take the L on it is a 200, and so is its refusal", async () => {
    const { s, owner, friend, friendId, pactId } = await ownerWithPact();
    const filed = await owner.post<FileVacationResponse>(API_PATHS.vacations, {
      from: s.date("Mon+1"),
      to: s.date("Sun+1"),
      pactIds: [pactId],
      reviewerIds: [friendId],
    } satisfies FileVacationRequest);
    if (!filed.body.ok) throw new Error(filed.body.reason);
    const { vacationId } = filed.body;
    await friend.post(API_PATHS.decide(vacationId), { kind: "reject", reason: "No" } satisfies DecideRequest);

    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.alerts).toEqual([expect.objectContaining({ kind: "vacation-rejected", vacationId })]);
    const accept = () => owner.post<AcceptVacationRejectionResponse>(API_PATHS.acceptVacationRejection(vacationId));
    expect(await accept()).toEqual({ status: 200, body: { ok: true } });
    expect(await accept()).toEqual({ status: 200, body: { ok: false, reason: "nothing-to-accept" } });
    expect((await owner.get<TodayResponse>(API_PATHS.today)).body.alerts).toEqual([]);
  });

  test("the core's refusals are 200s; a body of another shape is a 400", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    const request = { from: s.date("Mon+1"), to: s.date("Sun+1"), pactIds: [pactId] };

    expect(await owner.post(API_PATHS.vacations, { ...request, reviewerIds: [] })).toEqual({
      status: 200,
      body: { ok: false, reason: "no-reviewers" },
    });
    expect(await owner.post(API_PATHS.vacationPreview, { ...request, from: s.date("Mon") })).toEqual({
      status: 200,
      body: { ok: false, reason: "not-after-today" },
    });
    for (const sent of [
      { ...request, pactIds: pactId },
      { from: request.from, to: request.to },
    ]) {
      const previewed = await owner.post(API_PATHS.vacationPreview, sent);
      expect({ sent, ...previewed }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
    for (const sent of [request, { ...request, reviewerIds: [], note: 5 }]) {
      const filed = await owner.post(API_PATHS.vacations, sent);
      expect({ sent, ...filed }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });
});

describe("change requests", () => {
  test("the owner previews and sends a change, sees it waiting, withdraws it, then asks to end the pact; the reviewer approves", async () => {
    const { owner, friend, pact, pactId } = await ownerWithPact();
    const lower: ChangePactRequest = { ...pact, penaltyCents: 200, note: "Tight month" };

    const preview = await owner.post<ChangePreviewResponse>(API_PATHS.changePreview(pactId), lower);
    expect(preview.body).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "penalty", before: 500, after: 200, effect: "needs-approval", reason: "lower-penalty" }],
        outcome: { kind: "needs-approval", reviewerNames: ["friend"], bundlesStricter: false, appliesNow: [] },
      },
    } satisfies ChangePreviewResponse);
    const sent = await owner.post<ChangePactResponse>(API_PATHS.changePact(pactId), lower);
    if (!sent.body.ok || sent.body.outcome.kind !== "needs-approval") throw new Error(JSON.stringify(sent.body));
    const id = sent.body.outcome.changeRequestId;
    const page = await owner.get<ChangeRequestResponse>(API_PATHS.changeRequest(id));
    expect(page.body).toMatchObject({ ok: true, changeRequest: { note: "Tight month", state: { kind: "waiting" } } });
    expect((await friend.get(API_PATHS.changeRequest(id))).body).toEqual({
      ok: false,
      reason: "change-request-not-found",
    });
    expect((await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue)).body).toEqual([
      expect.objectContaining({ kind: "change-request", id }),
    ]);
    const withdraw = () => owner.post(API_PATHS.withdrawChangeRequest(id));
    expect(await withdraw()).toEqual({ status: 200, body: { ok: true } });
    expect(await withdraw()).toEqual({ status: 200, body: { ok: false, reason: "not-waiting" } });

    const end = await owner.post<EndPactResponse>(API_PATHS.endPact(pactId), { note: "Moved away" });
    if (!end.body.ok) throw new Error(end.body.reason);
    await friend.post(API_PATHS.decide(end.body.changeRequestId), { kind: "approve" } satisfies DecideRequest);
    // The day open at approval is judged first: the pact Ends once it closes.
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { stage: "active", ending: { lastDay: expect.any(String) } },
    });
  });

  test("the core's refusals are 200s; a body of another shape is a 400", async () => {
    const { s, owner, pact, pactId } = await ownerWithPact();

    expect(await owner.post(API_PATHS.changePact(pactId), { ...pact, reviewerIds: [] })).toEqual({
      status: 200,
      body: { ok: false, reason: "no-reviewers" },
    });
    expect(await owner.post(API_PATHS.changePact(pactId), pact)).toEqual({
      status: 200,
      body: { ok: false, reason: "nothing-changed" },
    });
    for (const path of [API_PATHS.changePact(pactId), API_PATHS.changePreview(pactId)]) {
      expect(await owner.post(path, { ...pact, penaltyCents: "5" })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    for (const sent of [{ note: 5 }, ["note"], '"note"', null]) {
      const ended = await owner.post(API_PATHS.endPact(pactId), sent);
      expect({ sent, ...ended }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });

  test("a rename sends only the name; the core's refusals are 200s, a body of another shape a 400", async () => {
    const { owner, pactId } = await ownerWithPact();
    const path = API_PATHS.renamePact(pactId);

    expect(await owner.post(path, { name: 5 })).toEqual({ status: 400, body: { error: "invalid-request" } });
    expect(await owner.post(path, { name: " " } satisfies RenamePactRequest)).toEqual({
      status: 200,
      body: { ok: false, reason: "blank-name" } satisfies RenamePactResponse,
    });
    expect(await owner.post(path, { name: "Morning gym" } satisfies RenamePactRequest)).toEqual({
      status: 200,
      body: { ok: true } satisfies RenamePactResponse,
    });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { name: "Morning gym" },
    });
  });

  test("adding reviewers sends only those added; the core's refusals are 200s, a body of another shape a 400", async () => {
    const { s, owner, pactId } = await ownerWithPact();
    const path = API_PATHS.addReviewers(pactId);
    const invite = async () => (await owner.post<CreateInviteResponse>(API_PATHS.invites)).body.token;
    // Signed in with an invite they haven't accepted: not a friend yet.
    const stranger = await s.signIn("stranger@example.test", { inviteToken: await invite() });
    const token = await invite();
    const second = await s.signIn("second@example.test", { inviteToken: token });
    await second.post(API_PATHS.acceptInvite(token));

    expect(await owner.post(path, { reviewerIds: "x" })).toEqual({ status: 400, body: { error: "invalid-request" } });
    expect(await owner.post(path, { reviewerIds: [stranger.accountId!] } satisfies AddReviewersRequest)).toEqual({
      status: 200,
      body: { ok: false, reason: "not-a-friend" } satisfies AddReviewersResponse,
    });
    expect(await owner.post(path, { reviewerIds: [second.accountId!] } satisfies AddReviewersRequest)).toEqual({
      status: 200,
      body: { ok: true } satisfies AddReviewersResponse,
    });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { reviewers: [expect.objectContaining({ name: "friend" }), expect.objectContaining({ name: "second" })] },
    });
  });

  test("setting reminders sends only them; the core's refusals are 200s, a body of another shape a 400", async () => {
    const { owner, pactId } = await ownerWithPact();
    const path = API_PATHS.setReminders(pactId);

    expect(await owner.post(path, { reminders: [7] })).toEqual({ status: 400, body: { error: "invalid-request" } });
    expect(await owner.post(path, { reminders: ["6pm"] } satisfies SetRemindersRequest)).toEqual({
      status: 200,
      body: { ok: false, reason: "invalid-reminders" } satisfies SetRemindersResponse,
    });
    expect(await owner.post(path, { reminders: ["19:30", "07:00"] } satisfies SetRemindersRequest)).toEqual({
      status: 200,
      body: { ok: true } satisfies SetRemindersResponse,
    });
    expect((await owner.get<PactResponse>(API_PATHS.pact(pactId))).body).toMatchObject({
      ok: true,
      pact: { reminders: ["07:00", "19:30"] },
    });
  });
});

describe("reviewer questions", () => {
  /** Submits a photo of Monday's Gym as the owner; returns the evidence's id. */
  async function evidenceWaiting() {
    const setup = await ownerWithPact();
    const { body: submitted } = await setup.owner.postForm<SubmitEvidenceResponse>(API_PATHS.evidence(setup.pactId), [
      [EVIDENCE_PHOTO_FIELD, jpeg()],
    ]);
    if (!submitted.ok) throw new Error(submitted.reason);
    return { ...setup, evidenceId: submitted.evidenceId };
  }

  test("the reviewer asks, the item waits on the owner's reply; the owner sees it on Today and its page, and replies", async () => {
    const { s, owner, friend, evidenceId } = await evidenceWaiting();
    const asked = await friend.post<AskOwnerResponse>(API_PATHS.askOwner(evidenceId), {
      question: "Which gym is this?",
    } satisfies AskOwnerRequest);

    expect(asked).toEqual({ status: 200, body: { ok: true } });
    expect((await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue)).body).toEqual([]);
    const waiting = await friend.get<WaitingOnReplyResponse>(API_PATHS.waitingOnReply);
    const question = {
      fromOwner: false,
      authorName: "friend",
      text: "Which gym is this?",
      sentAt: s.clock.now().toISOString(),
    };
    expect(waiting.body).toEqual([
      expect.objectContaining({ id: evidenceId, thread: { comments: [question], waitingOnReply: true } }),
    ]);
    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.alerts).toEqual([
      expect.objectContaining({ kind: "reviewer-question", reviewerName: "friend", question: "Which gym is this?" }),
    ]);
    const page = await owner.get<EvidenceResponse>(API_PATHS.evidenceItem(evidenceId));
    expect(page.body).toMatchObject({ ok: true, evidence: { id: evidenceId, thread: { waitingOnReply: true } } });
    expect((await friend.get(API_PATHS.evidenceItem(evidenceId))).body).toEqual({
      ok: false,
      reason: "evidence-not-found",
    });

    const replied = await owner.post<ReplyResponse>(API_PATHS.reply(evidenceId), {
      reply: "The one on 5th",
    } satisfies ReplyRequest);

    expect(replied).toEqual({ status: 200, body: { ok: true } });
    expect((await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue)).body).toEqual([
      expect.objectContaining({ id: evidenceId, thread: expect.objectContaining({ waitingOnReply: false }) }),
    ]);
    expect((await friend.get(API_PATHS.waitingOnReply)).body).toEqual([]);
  });

  test("a payment's page is its owner's; anyone else gets a 200 refusal", async () => {
    const { s, owner, friend, pact } = await ownerWithPact();
    await s.advanceTo("Sat 00:00");
    const { body: recorded } = await owner.postForm<RecordPaymentResponse>(API_PATHS.payments(pact.recipientId), [
      [PAYMENT_AMOUNT_FIELD, "500"],
      [EVIDENCE_PHOTO_FIELD, jpeg()],
    ]);
    if (!recorded.ok) throw new Error(recorded.reason);

    const page = await owner.get<PaymentResponse>(API_PATHS.paymentItem(recorded.paymentId));
    expect(page.body).toMatchObject({
      ok: true,
      payment: { amountCents: 500, recipientName: "Sam", state: { kind: "waiting" }, reviewerNames: ["friend"] },
    });
    expect((await friend.get(API_PATHS.paymentItem(recorded.paymentId))).body).toEqual({
      ok: false,
      reason: "payment-not-found",
    });
  });

  test("the core's refusals are 200s; a body of another shape is a 400", async () => {
    const { s, owner, friend, evidenceId } = await evidenceWaiting();

    expect(await friend.post(API_PATHS.askOwner(evidenceId), { question: " " })).toEqual({
      status: 200,
      body: { ok: false, reason: "blank-question" },
    });
    expect(await owner.post(API_PATHS.reply(evidenceId), { reply: "Hm" })).toEqual({
      status: 200,
      body: { ok: false, reason: "no-question" },
    });
    for (const [path, account, body] of [
      [API_PATHS.askOwner(evidenceId), friend, { question: 5 }],
      [API_PATHS.askOwner(evidenceId), friend, {}],
      [API_PATHS.reply(evidenceId), owner, { reply: null }],
    ] as const) {
      expect(await account.post(path, body)).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });
});

describe("ledgers", () => {
  test("a Missed occurrence's penalty shows on the recipient's ledger, and its history", async () => {
    const { s, owner, pact, createPact } = await ownerWithFriend();
    const pactId = await createPact();
    await s.advanceTo("Tue 00:00");

    const ledgers = await owner.get<LedgersResponse>(API_PATHS.ledgers);

    const summary = {
      recipientId: pact.recipientId,
      name: "Sam",
      owedCents: 500,
      payableCents: 500,
      awaitingCents: 0,
      awaitingCount: 0,
      paidCents: 0,
      suggestedPaymentCents: 500,
      creditCents: 0,
      creditWaitsOn: [],
      overdueCents: 0,
      billDue: null,
    };
    expect(ledgers).toEqual({ status: 200, body: [summary] satisfies LedgersResponse });
    const ledger = await owner.get(API_PATHS.ledger(pact.recipientId));
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
              pactId,
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
    expect(await friend.get(API_PATHS.ledger(pact.recipientId))).toEqual(notFound);
    expect(await friend.get(API_PATHS.ledger("no-such-recipient"))).toEqual(notFound);
    expect((await friend.get(API_PATHS.ledgers)).body).toEqual([]);
  });
});

describe("payments", () => {
  /** The owner with $15 owed to Sam: the friend reviews their Mon/Wed/Fri pact, and every day of it was Missed. */
  async function ownerWithFifteenOwed() {
    const setup = await ownerWithPact();
    await setup.s.advanceTo("Sat 00:00");
    return { ...setup, sam: setup.pact.recipientId };
  }

  /** Posts the payment form: the amount in cents, an optional note, and `photos` as `photo` fields. */
  const record = (
    account: Account,
    recipientId: string,
    { amountCents, note, photos }: { amountCents?: string; note?: string; photos: (File | string)[] },
  ) =>
    account.postForm(API_PATHS.payments(recipientId), [
      ...(amountCents !== undefined ? [[PAYMENT_AMOUNT_FIELD, amountCents] as const] : []),
      ...(note !== undefined ? [[PAYMENT_NOTE_FIELD, note] as const] : []),
      ...photos.map((photo) => [EVIDENCE_PHOTO_FIELD, photo] as const),
    ]);

  test("an owner records a payment with a screenshot; the ledger shows it awaiting, and the screenshot is served to the owner and the pact's reviewer only", async () => {
    const { s, owner, friend, sam } = await ownerWithFifteenOwed();
    // A friend of the owner's who reviews no pact with Sam.
    const other = await s.signIn("other@example.test", {
      inviteToken: (await owner.post<CreateInviteResponse>(API_PATHS.invites)).body.token,
    });

    const recorded = await record(owner, sam, {
      amountCents: "1000",
      note: "Venmo",
      photos: [jpeg(6, 3)],
    });

    expect(recorded).toEqual({
      status: 200,
      body: { ok: true, paymentId: expect.any(String) } satisfies RecordPaymentResponse,
    });
    // The form's note reaches the core.
    const { paymentId } = recorded.body as { paymentId: string };
    expect((await owner.get<PaymentResponse>(API_PATHS.paymentItem(paymentId))).body).toMatchObject({
      ok: true,
      payment: { amountCents: 1000, note: "Venmo" },
    });
    const ledgers = await owner.get<LedgersResponse>(API_PATHS.ledgers);
    expect(ledgers.body).toEqual([
      {
        recipientId: sam,
        name: "Sam",
        owedCents: 1500,
        payableCents: 500,
        awaitingCents: 1000,
        awaitingCount: 1,
        paidCents: 0,
        suggestedPaymentCents: 500,
        creditCents: 0,
        creditWaitsOn: [],
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
    const recorded = await record(owner, sam, { amountCents: "1000", photos: [jpeg()] });
    const { paymentId } = recorded.body as { paymentId: string };

    const queue = await friend.get<ReviewQueueResponse>(API_PATHS.reviewQueue);
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
    const decide = (account: Account) => account.post(API_PATHS.decide(paymentId), approve);
    expect(await decide(owner)).toEqual({
      status: 200,
      body: { ok: false, reason: "item-not-found" } satisfies DecideResponse,
    });
    expect(await decide(friend)).toEqual({ status: 200, body: { ok: true } satisfies DecideResponse });
    const ledgers = await owner.get<LedgersResponse>(API_PATHS.ledgers);
    expect(ledgers.body).toEqual([
      {
        recipientId: sam,
        name: "Sam",
        owedCents: 500,
        payableCents: 500,
        awaitingCents: 0,
        awaitingCount: 0,
        paidCents: 1000,
        suggestedPaymentCents: 500,
        creditCents: 0,
        creditWaitsOn: [],
        overdueCents: 0,
        billDue: null,
      },
    ] satisfies LedgersResponse);
  });

  test("the core's refusals are data: more than owed, a fractional amount, no screenshot", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    const refused = (reason: string) => ({ status: 200, body: { ok: false, reason } });
    expect(await record(owner, sam, { amountCents: "1501", photos: [jpeg()] })).toEqual(
      refused("payment-exceeds-owed"),
    );
    expect(await record(owner, sam, { amountCents: "250.5", photos: [jpeg()] })).toEqual(refused("invalid-amount"));
    expect(await record(owner, sam, { amountCents: "500", photos: [] })).toEqual(refused("no-screenshot"));
  });

  test("a screenshot over the size cap, one that isn't a JPEG, or more than one, is refused before the core sees it", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    expect(await record(owner, sam, { amountCents: "500", photos: [jpeg(MAX_PHOTO_BYTES + 1)] })).toEqual({
      status: 400,
      body: { error: "photo-too-large" },
    });
    const malformed: (File | string)[][] = [
      ["not a file"],
      [new File([new Uint8Array([0x89, 0x50])], "photo.png", { type: "image/png" })],
      [jpeg(), jpeg()],
    ];
    for (const photos of malformed) {
      expect(await record(owner, sam, { amountCents: "500", photos })).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
    expect(s.photoStore.photoIds).toEqual([]);
    const ledgers = await owner.get<LedgersResponse>(API_PATHS.ledgers);
    expect(ledgers.body).toEqual([expect.objectContaining({ awaitingCents: 0 })]);
    // Exactly at the cap is fine.
    expect((await record(owner, sam, { amountCents: "500", photos: [jpeg(MAX_PHOTO_BYTES)] })).body).toMatchObject({
      ok: true,
    });
  });

  test("an amount that's missing or not a number is an invalid request", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();

    for (const amountCents of [undefined, "", "ten", "1e3", "5 dollars"]) {
      expect(await record(owner, sam, { ...(amountCents !== undefined && { amountCents }), photos: [jpeg()] })).toEqual(
        {
          status: 400,
          body: { error: "invalid-request" },
        },
      );
    }
    expect(s.photoStore.photoIds).toEqual([]);
  });

  test("each upload logs one line with its size and timings", async () => {
    const { s, owner, sam } = await ownerWithFifteenOwed();
    const uploadLines = () => s.logs.filter((line) => line.startsWith("payment-upload "));

    const recorded = await record(owner, sam, { amountCents: "1000", photos: [jpeg(5)] });
    const { paymentId } = recorded.body as { paymentId: string };
    expect(uploadLines()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^payment-upload outcome=ok payment=${paymentId} photos=1 bytes=5 largestBytes=5 receiveMs=\\d+ storeMs=\\d+$`,
        ),
      ),
    ]);

    s.logs.length = 0;
    await record(owner, sam, { amountCents: "1000", photos: [jpeg(4)] });
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
    // The API_PATHS entries that answer without a session, each on purpose.
    // (The auth handler under AUTH_BASE_PATH is public too, but isn't in API_PATHS.)
    const publicPaths: Partial<Record<keyof typeof API_PATHS, string>> = {
      invite: "the invite page shows to signed-out visitors, so its lookup can't need a session",
    };

    // A route's shape with its parameters' names dropped, so "/api/pacts/:pactId"
    // matches the ":p0" placeholder the test calls API_PATHS.pact with.
    const shape = (path: string) => path.replace(/:[^/]+/g, ":");
    const registered = (path: string) =>
      s.routes
        .filter((route) => route.method !== "ALL" && shape(route.path) === shape(path))
        .map((route) => route.method);

    for (const [name, entry] of Object.entries(API_PATHS)) {
      if (name in publicPaths) continue;
      const path = entry as string | ((...ids: string[]) => string);
      const [pattern, concrete] =
        typeof path === "string"
          ? [path, path]
          : [
              path(...Array.from({ length: path.length }, (_, i) => `:p${i}`)),
              path(...Array.from({ length: path.length }, (_, i) => `some-id-${i}`)),
            ];
      const methods = registered(pattern);
      expect(methods, `${name} has no registered route`).not.toEqual([]);
      for (const method of methods) {
        const response = await s.request(concrete, { method });
        const answer = { name, method, status: response.status, body: await response.json() };
        expect(answer).toEqual({ name, method, status: 401, body: { error: "unauthenticated" } });
      }
    }
  });

  test("a JSON body over 64 KB is refused with 413 before the core sees it; a photo upload over 64 KB still goes through", async () => {
    const { owner, pactId } = await ownerWithPact();

    const huge = await owner.post(API_PATHS.recipients, { name: "x".repeat(65 * 1024) });

    expect(huge).toEqual({ status: 413, body: { error: "body-too-large" } });
    expect((await owner.get<RecipientsResponse>(API_PATHS.recipients)).body).toEqual([
      expect.objectContaining({ name: "Sam" }),
    ]);
    const photo = await owner.postForm(API_PATHS.evidence(pactId), [[EVIDENCE_PHOTO_FIELD, jpeg(200 * 1024)]]);
    expect(photo).toEqual({ status: 200, body: expect.objectContaining({ ok: true }) });
  });

  test("a handler that throws answers 500 server-error as JSON and logs the request with the stack", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);
    vi.spyOn(s.core, "as").mockImplementation(() => {
      throw new Error("database is locked");
    });

    const today = await operator.get(API_PATHS.today);

    expect(today).toEqual({ status: 500, body: { error: "server-error" } });
    expect(s.logs).toEqual([
      expect.stringMatching(/^request failed: GET \/api\/today Error: database is locked\n\s+at /),
    ]);
  });

  test("a throw outside /api is a plain 500, logged the same way", async () => {
    const s = await server({
      diskUsedFraction: () => {
        throw new Error("statfs failed");
      },
    });

    const health = await s.request("/health");

    expect({ status: health.status, body: await health.text() }).toEqual({
      status: 500,
      body: "Internal Server Error",
    });
    expect(s.logs).toEqual([expect.stringMatching(/^request failed: GET \/health Error: statfs failed\n/)]);
  });

  test("a timezone request without a timezone is an invalid request", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    const set = await operator.post(API_PATHS.timezone, {});

    expect(set).toEqual({ status: 400, body: { error: "invalid-request" } });
    for (const sent of [{ timezone: 5 }, ["Europe/London"], '"Europe/London"', "not json"]) {
      const response = await operator.post(API_PATHS.timezone, sent);
      expect({ sent, ...response }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });
});

describe("health", () => {
  test("fails before the first tick, passes after one, and fails once ticks stop for 5 minutes", async () => {
    const s = await server();
    expect((await s.request("/health")).status).toBe(503);

    await s.advanceTo("Mon 09:00");
    const ok = await s.request("/health");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as HealthResponse).ok).toBe(true);

    s.setClockTo("Mon 09:06");
    expect((await s.request("/health")).status).toBe(503);
  });

  test("passes with the volume up to 80% full and fails past it, reporting the disk use", async () => {
    let diskUsed = 0.79;
    const s = await server({ diskUsedFraction: () => diskUsed });
    await s.advanceTo("Mon 09:00");
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
    await s.advanceTo("Mon 09:00");
    s.setClockTo("Mon 09:06");

    const response = await s.request("/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, diskUsedPercent: 0 });
  });

  test("reports the deployed commit, or null for an image built without one", async () => {
    const health = async (s: Server) => (await (await s.request("/health")).json()) as HealthResponse;

    expect((await health(await server({ commit: "ebb9f3c" }))).commit).toBe("ebb9f3c");
    expect((await health(await server())).commit).toBeNull();
  });

  test("liveness ignores the disk, so a full volume alerts without taking the app offline", async () => {
    const s = await server({ diskUsedFraction: () => 0.99 });
    await s.advanceTo("Mon 09:00");

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

    await s.advanceTo("Mon 09:00");
    s.setClockTo("Mon 09:06");

    expect((await s.request("/health")).status).toBe(503);
    expect(await live()).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("spa", () => {
  test("client routes fall back to index.html; unknown API routes don't", async () => {
    const s = await server();

    for (const path of ["/some/client/route", APP_PATHS.invite("some-token")]) {
      const page = await s.request(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("Cache-Control")).toBe("no-cache");
      expect(await page.text()).toContain("<div id=root>");
    }

    const operator = await s.signIn(OPERATOR);
    expect((await s.request("/api/nope", { cookie: operator.cookie })).status).toBe(404);
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
    const operator = await s.signIn(OPERATOR);

    const changed = await operator.post<SetNotificationSettingResponse>(API_PATHS.notifications, {
      setting: "decision",
      enabled: false,
    });

    expect(changed.body).toContainEqual({ setting: "decision", enabled: false });
    expect((await operator.get<NotificationsResponse>(API_PATHS.notifications)).body).toEqual({
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
    const operator = await s.signIn(OPERATOR);

    const response = await operator.post(API_PATHS.notifications, body);

    expect(response).toMatchObject({ status: 400, body: { error: "invalid-request" } });
  });

  test("a device is saved, then removed", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    const saved = await operator.post<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, DEVICE);
    expect(saved).toMatchObject({ status: 200, body: { ok: true } });

    const removed = await operator.delete(API_PATHS.pushSubscriptions, { endpoint: DEVICE.endpoint });
    expect(removed).toEqual({ status: 200, body: { ok: true } satisfies RemovePushSubscriptionResponse });
  });

  test("an endpoint that isn't a push service is the core's refusal, a 200", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    const saved = await operator.post<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, {
      ...DEVICE,
      endpoint: "https://internal.example/hook",
    });

    expect(saved).toMatchObject({ status: 200, body: { ok: false, reason: "invalid-subscription" } });
  });

  test("a removal without an endpoint is a 400", async () => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    for (const sent of [{}, { endpoint: 1 }, [DEVICE.endpoint], JSON.stringify(DEVICE.endpoint)]) {
      const removed = await operator.delete(API_PATHS.pushSubscriptions, sent);
      expect({ sent, ...removed }).toEqual({ sent, status: 400, body: { error: "invalid-request" } });
    }
  });

  test.each([
    ["no keys", { endpoint: DEVICE.endpoint }],
    ["an endpoint that isn't a string", { ...DEVICE, endpoint: 1 }],
  ])("a device with %s is a 400", async (_name, body) => {
    const s = await server();
    const operator = await s.signIn(OPERATOR);

    const response = await operator.post(API_PATHS.pushSubscriptions, body);

    expect(response).toMatchObject({ status: 400, body: { error: "invalid-request" } });
  });
});

describe("connecting AnkiWeb", () => {
  const login = (account: Account, password: string) =>
    account.post<ConnectAnkiResponse>(API_PATHS.ankiConnect, {
      email: "me@example.test",
      password,
    } satisfies ConnectAnkiRequest);

  test("good credentials connect; bad ones and an AnkiWeb that doesn't answer don't", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);

    expect((await login(owner, "wrong")).body).toEqual({ ok: false, reason: "wrong-login" });
    expect((await login(owner, "down")).body).toEqual({ ok: false, reason: "unreachable" });
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);

    expect(await login(owner, "right")).toMatchObject({ status: 200, body: { ok: true } });
    expect(s.ankiLogins.at(-1)).toEqual({
      account: owner.accountId,
      username: "me@example.test",
      password: "right",
    });
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([
      { service: "anki", status: "connected", connectedAt: expect.any(String), activePacts: 0 },
    ]);
  });

  test("the email is trimmed; a login that throws is unreachable and logged, and connects nothing", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const connect = (password: string) =>
      owner.post<ConnectAnkiResponse>(API_PATHS.ankiConnect, {
        email: "  me@example.test \n",
        password,
      } satisfies ConnectAnkiRequest);

    expect(await connect("throws")).toEqual({ status: 200, body: { ok: false, reason: "unreachable" } });
    expect(s.logs).toContain("anki connect failed: socket hang up");
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);

    expect((await connect("right")).body).toEqual({ ok: true });
    expect(s.ankiLogins.map((login) => login.username)).toEqual(["me@example.test", "me@example.test"]);
  });

  test("a connect without an email and password is a 400, even with Anki not set up", async () => {
    const s = await server({ production: true, ankiSetUp: false });
    const owner = await operatorWithInvite(s);
    for (const body of [{}, { email: "me@example.test" }, ["me@example.test", "right"]]) {
      expect(await owner.post(API_PATHS.ankiConnect, body)).toEqual({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("a disconnect the core fails keeps the host key", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    await login(owner, "right");
    const as = s.core.as.bind(s.core);
    vi.spyOn(s.core, "as").mockImplementation((id) => ({
      ...as(id),
      disconnectAnki: () => Promise.reject(new Error("database is locked")),
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());

    const response = await s.request(API_PATHS.ankiDisconnect, { cookie: owner.cookie, method: "POST" });

    expect(response.status).toBe(500);
    expect(s.ankiForgets).toEqual([]);
  });

  test("a connect without an email and password is a 400", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    for (const body of [{}, { email: "me@example.test" }, { email: 1, password: "right" }]) {
      expect(await owner.post(API_PATHS.ankiConnect, body)).toMatchObject({
        status: 400,
        body: { error: "invalid-request" },
      });
    }
  });

  test("the deck list comes from AnkiWeb once connected", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    expect((await owner.get<AnkiDecksResponse>(API_PATHS.ankiDecks)).body).toEqual({
      ok: false,
      reason: "not-connected",
    });
    await login(owner, "right");
    s.ankiSource.setDeck(owner.accountId, { id: "1", name: "Spanish", review: 3 });

    expect((await owner.get<AnkiDecksResponse>(API_PATHS.ankiDecks)).body).toEqual({
      ok: true,
      rolloverHour: 4,
      decks: [{ id: "1", name: "Spanish", parentId: null, counts: { new: 0, learn: 0, review: 3 } }],
    });
  });

  test("check now asks AnkiWeb for a day waiting, and disconnecting forgets the host key", async () => {
    const { s, owner, pact } = await ownerWithFriend();
    await login(owner, "right");
    s.ankiSource.setDeck(owner.accountId, { id: "1", name: "Spanish", review: 3 });
    await owner.get(API_PATHS.ankiDecks);
    const created = await owner.post<CreatePactResponse>(API_PATHS.pacts, {
      ...pact,
      evidenceKind: "anki",
      name: "Spanish",
      description: "",
      ankiDeckId: "1",
    });
    expect(created.body).toMatchObject({ ok: true });

    s.setClockTo("Wed 20:00");
    s.ankiSource.setAnkiDay(owner.accountId, s.date("Wed"), s.at("Wed 20:00"));
    expect(await owner.post<CheckAnkiResponse>(API_PATHS.ankiCheck)).toMatchObject({ status: 200, body: { ok: true } });
    expect(s.ankiSource.countCalls).toEqual([{ account: owner.accountId, deckIds: ["1"] }]);

    const after = await owner.post<DisconnectAnkiResponse>(API_PATHS.ankiDisconnect);
    expect(after.body.connections).toEqual([]);
    expect(s.ankiForgets).toEqual([owner.accountId]);
  });

  test("a change after the edit window can name another deck", async () => {
    const { s, owner, pact, createPact } = await ownerWithFriend();
    await login(owner, "right");
    s.ankiSource.setDeck(owner.accountId, { id: "1", name: "Spanish" });
    s.ankiSource.setDeck(owner.accountId, { id: "2", name: "Italian" });
    await owner.get(API_PATHS.ankiDecks);
    const anki = { ...pact, evidenceKind: "anki", name: "Spanish", description: "", ankiDeckId: "1" };
    const pactId = await createPact(anki);
    s.setClockTo("Wed 20:00");

    const { evidenceKind: _kind, ...change } = { ...anki, ankiDeckId: "2" };
    const preview = await owner.post<ChangePreviewResponse>(API_PATHS.changePreview(pactId), change);
    expect(preview.body).toMatchObject({
      ok: true,
      preview: {
        changes: [{ term: "deck", before: { id: "1", name: "Spanish" }, after: { id: "2", name: "Italian" } }],
        outcome: { kind: "needs-approval" },
      },
    });
  });

  test("a rename sent as the pact page sends it applies at once, and the pact keeps its deck", async () => {
    const { s, owner, pact, createPact } = await ownerWithFriend();
    await login(owner, "right");
    s.ankiSource.setDeck(owner.accountId, { id: "1", name: "Spanish" });
    await owner.get(API_PATHS.ankiDecks);
    const pactId = await createPact({
      ...pact,
      evidenceKind: "anki",
      name: "Spanish",
      description: "",
      ankiDeckId: "1",
    });
    const path = API_PATHS.pact(pactId);
    s.setClockTo("Wed 20:00");

    const sent = await owner.post(API_PATHS.renamePact(pactId), { name: "Spanish daily" } satisfies RenamePactRequest);

    expect(sent.body).toEqual({ ok: true });
    expect((await owner.get<PactResponse>(path)).body).toMatchObject({
      ok: true,
      pact: { name: "Spanish daily", anki: { deckId: "1" }, waiting: [] },
    });
  });

  test("with Anki not set up, connecting is refused and the profile says so", async () => {
    const s = await server({ production: true, ankiSetUp: false });
    const owner = await operatorWithInvite(s);
    expect((await login(owner, "right")).body).toEqual({ ok: false, reason: "unavailable" });
    expect((await owner.get<MeResponse>(API_PATHS.me)).body).toMatchObject({
      ankiAvailable: false,
      connections: [],
    });
  });
});

describe("connecting Oura", () => {
  /** Starts connecting as the browser would; returns the state Oura was sent and the cookies to bring back. */
  async function startConnecting(s: Server, cookie: string) {
    const response = await s.request(API_PATHS.ouraConnect, { cookie });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(OURA_AUTHORIZE);
    return { state: location.searchParams.get("state")!, cookie: `${cookie}; ${cookieFrom(response)}` };
  }

  test("Oura's callback with this browser's state stores the tokens, makes the connection and returns to the form", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const started = await startConnecting(s, owner.cookie);

    const back = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toBe("/pacts/new?oura=connected");
    expect(s.ouraConnects).toEqual([{ account: owner.accountId, code: "good-code" }]);
    const me = await owner.get<MeResponse>(API_PATHS.me);
    expect(me.body.connections).toEqual([
      { service: "oura", status: "connected", connectedAt: expect.any(String), activePacts: 0 },
    ]);
  });

  test("a state that isn't this browser's connects nothing", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const started = await startConnecting(s, owner.cookie);

    const forged = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=someone-else`, {
      cookie: started.cookie,
    });
    const noCookie = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, {
      cookie: owner.cookie,
    });

    for (const response of [forged, noCookie]) expect(response.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect(s.ouraConnects).toEqual([]);
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);
  });

  test("saying no on Oura's page returns to the form as cancelled; a code Oura refuses, as failed", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    let started = await startConnecting(s, owner.cookie);
    const cancelled = await s.request(`${API_PATHS.ouraCallback}?error=access_denied&state=${started.state}`, {
      cookie: started.cookie,
    });
    started = await startConnecting(s, owner.cookie);
    const refused = await s.request(`${API_PATHS.ouraCallback}?code=bad-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(cancelled.headers.get("Location")).toBe("/pacts/new?oura=cancelled");
    expect(refused.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);
  });

  test("the profile says whether Oura is set up, so the form can disable its tile", async () => {
    const set = await server();
    const unset = await server({ production: true, ouraSetUp: false });
    const meOf = async (s: Server) => {
      const owner = await operatorWithInvite(s);
      return (await owner.get<MeResponse>(API_PATHS.me)).body;
    };

    expect((await meOf(set)).ouraAvailable).toBe(true);
    expect((await meOf(unset)).ouraAvailable).toBe(false);
  });

  test("with Oura not set up, connecting returns to the form as unavailable and connects nothing", async () => {
    const s = await server({ production: true, ouraSetUp: false });
    const owner = await operatorWithInvite(s);

    const started = await s.request(API_PATHS.ouraConnect, { cookie: owner.cookie });
    const callback = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=any`, { cookie: owner.cookie });

    for (const response of [started, callback]) {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/pacts/new?oura=unavailable");
    }
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);
  });

  test("connecting needs a session", async () => {
    const s = await server();
    expect((await s.request(API_PATHS.ouraConnect)).status).toBe(401);
  });

  test("reconnecting comes back to Today, connected or not", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const response = await s.request(OURA_RECONNECT_PATH, { cookie: owner.cookie });
    const state = new URL(response.headers.get("Location")!).searchParams.get("state")!;
    const started = `${owner.cookie}; ${cookieFrom(response)}`;

    const back = await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${state}`, { cookie: started });

    expect(back.headers.get("Location")).toBe("/?oura=connected");
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([
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
    const { s, owner, pact, createPact } = await ownerWithFriend();
    const started = await startConnecting(s, owner.cookie);
    await s.request(`${API_PATHS.ouraCallback}?code=good-code&state=${started.state}`, { cookie: started.cookie });
    await createPact({
      ...pact,
      evidenceKind: "oura",
      name: "In bed by midnight",
      description: "",
      inBedBy: "00:00",
    });
    return { s, owner };
  }

  test("a code whose exchange throws returns to the form as failed, is logged, and connects nothing", async () => {
    const s = await server();
    const owner = await operatorWithInvite(s);
    const started = await startConnecting(s, owner.cookie);

    const back = await s.request(`${API_PATHS.ouraCallback}?code=throwing-code&state=${started.state}`, {
      cookie: started.cookie,
    });

    expect(back.headers.get("Location")).toBe("/pacts/new?oura=failed");
    expect(s.logs).toContain("oura connect failed: token endpoint timed out");
    expect((await owner.get<MeResponse>(API_PATHS.me)).body.connections).toEqual([]);
  });

  test("a disconnect the core fails keeps Oura's tokens", async () => {
    const { s, owner } = await ownerWithBedtimePact();
    const as = s.core.as.bind(s.core);
    vi.spyOn(s.core, "as").mockImplementation((id) => ({
      ...as(id),
      disconnectOura: () => Promise.reject(new Error("database is locked")),
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());

    const response = await s.request(API_PATHS.ouraDisconnect, { cookie: owner.cookie, method: "POST" });

    expect(response.status).toBe(500);
    expect(s.ouraForgets).toEqual([]);
  });

  test("checking Oura now asks Oura for a night not judged yet, at most once in 15 seconds", async () => {
    const { s, owner } = await ownerWithBedtimePact();
    s.setClockTo("Tue 09:00");

    const first = await owner.post<CheckOuraResponse>(API_PATHS.ouraCheck);
    const again = await owner.post<CheckOuraResponse>(API_PATHS.ouraCheck);

    for (const response of [first, again]) expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(s.ouraSource.calls.map((call) => call.account)).toEqual([owner.accountId]);
  });

  test("checking Oura now with Oura not set up answers ok and asks nothing", async () => {
    const s = await server({ production: true, ouraSetUp: false });
    const owner = await operatorWithInvite(s);
    expect(await owner.post(API_PATHS.ouraCheck)).toEqual({ status: 200, body: { ok: true } });
    expect(s.ouraSource.calls).toEqual([]);
  });

  test("disconnecting removes the connection and Oura's tokens, and answers with the profile", async () => {
    const { s, owner } = await ownerWithBedtimePact();
    const before = await owner.get<MeResponse>(API_PATHS.me);
    expect(before.body.connections).toEqual([expect.objectContaining({ activePacts: 1 })]);

    const response = await owner.post<DisconnectOuraResponse>(API_PATHS.ouraDisconnect);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ connections: [], ouraAvailable: true });
    expect(s.ouraForgets).toEqual([owner.accountId]);
    const today = await owner.get<TodayResponse>(API_PATHS.today);
    expect(today.body.alerts).toEqual([{ kind: "connection", service: "oura", status: "not-connected" }]);
  });

  test("checking and disconnecting need a session", async () => {
    const s = await server();
    for (const path of [API_PATHS.ouraCheck, API_PATHS.ouraDisconnect]) {
      expect((await s.request(path, { method: "POST" })).status).toBe(401);
    }
  });
});
