// The HTTP surface: /health and /healthz, a redirect to the canonical host,
// Better Auth under /api/auth, the JSON API under /api, two plain sign-in error
// pages, and the built SPA with a fallback to index.html for client-side routes.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { matchedRoutes } from "hono/route";
import type { AccountId, AnkiConnector, DevClock, OuraConnector, PactCore, Photo, Schedule } from "../core/index.ts";
import {
  EVIDENCE_KINDS,
  MAX_EVIDENCE_PHOTOS,
  MAX_EXCUSE_PHOTOS,
  NOTIFICATION_SETTINGS,
  WEEKDAYS,
  type NewPact,
} from "../shared/types.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  DEV_ADVANCE_PATH,
  DEV_SIGN_IN_PATH,
  type DevAdvanceRequest,
  EVIDENCE_PHOTO_FIELD,
  EXCUSE_FROM_FIELD,
  EXCUSE_REASON_FIELD,
  EXCUSE_TO_FIELD,
  INVITE_REQUIRED_PATH,
  APP_PATHS,
  MAX_PHOTO_BYTES,
  OURA_RESULT_PARAM,
  type OuraResult,
  PAYMENT_AMOUNT_FIELD,
  PAYMENT_NOTE_FIELD,
  PHOTO_CONTENT_TYPES,
  type AcceptExcuseRejectionResponse,
  type AcceptVacationRejectionResponse,
  type AnkiDecksResponse,
  type CheckAnkiResponse,
  type CheckOuraResponse,
  type ConnectAnkiRequest,
  type ConnectAnkiResponse,
  type DisconnectAnkiResponse,
  type AskOwnerRequest,
  type DisconnectOuraResponse,
  type AcceptInviteResponse,
  type AcceptMissResponse,
  type AddRecipientRequest,
  type AddRecipientResponse,
  type ChangePactRequest,
  type ChangePactResponse,
  type ChangePreviewResponse,
  type ChangeRequestResponse,
  type EndPactRequest,
  type EndPactResponse,
  type WithdrawChangeRequestResponse,
  type ApiErrorResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type DeletePactResponse,
  type EditPactResponse,
  type ExcuseOptionsResponse,
  type FileVacationRequest,
  type FileVacationResponse,
  type LastVacationResponse,
  type VacationOptionsResponse,
  type VacationPreviewRequest,
  type VacationPreviewResponse,
  type VacationsResponse,
  type WithdrawVacationResponse,
  type ExcusePreviewQuery,
  type ExcusePreviewResponse,
  type ExcuseResponse,
  type FileExcuseRequest,
  type FileExcuseResponse,
  type DecideRequest,
  type DecideResponse,
  type AskOwnerResponse,
  type EvidenceResponse,
  type PaymentResponse,
  type ReplyRequest,
  type ReplyResponse,
  type WaitingOnReplyResponse,
  type FirstOccurrenceRequest,
  type FirstOccurrenceResponse,
  type FriendsResponse,
  type HealthResponse,
  type InviteLookupResponse,
  type Json,
  type LedgerResponse,
  type LedgersResponse,
  type LivenessResponse,
  type MeResponse,
  type NotificationsResponse,
  type PactResponse,
  type PactsResponse,
  type RecipientsResponse,
  type RecordPaymentRequest,
  type RecordPaymentResponse,
  type RemovePushSubscriptionRequest,
  type RemovePushSubscriptionResponse,
  type ReviewQueueResponse,
  type SavePushSubscriptionRequest,
  type SavePushSubscriptionResponse,
  type SetNotificationSettingRequest,
  type SetNotificationSettingResponse,
  type SetTimezoneRequest,
  type SetTimezoneResponse,
  type SubmitEvidenceResponse,
  type TodayResponse,
} from "../shared/api.ts";
import { INVITE_REQUIRED_CODE, isInviteRequired, type Auth } from "./auth.ts";
import { connections } from "./connections.ts";
import { inviteRequiredPage, signInFailedPage } from "./pages.ts";
import { arrayOf, boolean, number, object, oneOf, optional, string, union, type Fields, type Parser } from "./parse.ts";

export interface AppOptions {
  core: PactCore;
  auth: Auth;
  /** The Vite build output. When it has no index.html, only the API is served. */
  staticDir: string;
  /** Requests on any other host redirect here; null serves every host. See Config. */
  canonicalOrigin: string | null;
  /** The deployed commit, for /health. See Config. */
  commit: string | null;
  /** How full the database's volume is, from 0 to 1. Production asks the filesystem; tests pass a fake. */
  diskUsedFraction: () => number;
  /** In production the dev sign-in route doesn't exist. */
  production: boolean;
  /** The dev sign-in's `?as=operator`. */
  operatorEmail: string;
  /** The key browsers subscribe to push with. See Config. */
  vapidPublicKey: string;
  /**
   * Oura's OAuth steps: the real adapter, or in development without Oura
   * credentials a stand-in. Null in production without them: Oura isn't set
   * up, so connecting returns to the form as `unavailable`.
   */
  oura: OuraConnector | null;
  /**
   * AnkiWeb's login: the real adapter, or in development without an Anki
   * token key a stand-in. Null in production without one: Anki isn't set up,
   * so connecting is refused as `unavailable`.
   */
  anki: AnkiConnector | null;
  /** Where the app writes log lines. Default: console.log. */
  log?: (line: string) => void;
  /**
   * DEVELOPMENT ONLY (PACT_DEV_CLOCK=1): the clock the core runs on, which
   * POST /api/dev/advance moves forward. Null or absent: no such route.
   */
  devClock?: DevClock | null;
}

/** A parsed multipart form: each field's value, or values when it repeats. */
type UploadForm = Record<string, string | File | (string | File)[]>;

/** What a photo upload is for, as its log line names it. */
type Upload = "evidence" | "excuse" | "payment";

/** The OAuth state for connecting Oura, between the connect route and Oura's callback. */
const OURA_STATE_COOKIE = "pact_oura_state";

/** Where Oura's callback sends the browser: the new pact form, or Today after a reconnect. */
type OuraReturn = "new-pact" | "today";

function ouraReturnPath(then: OuraReturn, result: OuraResult): string {
  return `${then === "today" ? APP_PATHS.today : APP_PATHS.newPact}?${OURA_RESULT_PARAM}=${result}`;
}

/** Room for the multipart boundaries and headers around the photos. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * The most an /api request body may be, photo uploads apart: well above any
 * request whose text is within MAX_NAME_CHARS and MAX_TEXT_CHARS.
 */
const MAX_JSON_BODY_BYTES = 64 * 1024;

/** The routes that take photos: each has its own, larger body limit (`photoBodyLimit`). */
const PHOTO_UPLOAD_ROUTES = new Set<string>([
  API_PATHS.evidence(":id"),
  API_PATHS.payments(":id"),
  API_PATHS.excuses(":id"),
]);

/** /health fails once the volume is fuller than this (ADR 0003). */
const MAX_DISK_USED_FRACTION = 0.8;

/** Loopback, as URL hostnames (IPv6 in brackets) and as socket addresses. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Bindings are absent in tests (app.request), present under @hono/node-server.
type Env = { Bindings: Partial<HttpBindings>; Variables: { accountId: AccountId } };

export function createApp({
  core,
  auth,
  staticDir,
  canonicalOrigin,
  commit,
  diskUsedFraction,
  production,
  operatorEmail,
  vapidPublicKey,
  oura,
  anki,
  log = (line) => console.log(line),
  devClock = null,
}: AppOptions) {
  const app = new Hono<Env>();

  /** The signed-in account, as the core knows it. */
  const account = (c: Context<Env>) => core.as(c.get("accountId"));
  const connection = connections({ core, oura, anki, log });

  /** The account's profile, as GET /api/me and the disconnect routes answer with it. */
  const me = (accountId: AccountId): MeResponse => ({
    ...json(core.as(accountId).profile()),
    ouraAvailable: oura !== null,
    ankiAvailable: anki !== null,
  });

  /**
   * One line per photo upload (evidence, an excuse's photos, or a payment's
   * screenshot), to see sizes and speeds in the server log. Nothing from the
   * request's URL goes in, so a request can't forge a line.
   */
  const logUpload = (upload: Upload, fields: Record<string, string | number>) =>
    log(
      `${upload}-upload ${Object.entries(fields)
        .map(([name, value]) => `${name}=${value}`)
        .join(" ")}`,
    );

  /**
   * A multipart upload of photos in EVIDENCE_PHOTO_FIELD: evidence, an
   * excuse's photos, or a payment's screenshot. Transport checks only: a form
   * that won't parse, a field there that isn't a photo, or a form `parse`
   * refuses is a 400 invalid-request; a photo over the size cap is a 400
   * photo-too-large. Otherwise `send` calls the core with the photos and its
   * result is the response. Each upload that parsed logs one line (`logUpload`) with its
   * sizes and timings and what became of it (the new item's id, under the
   * upload's name, when it was accepted), except a form refused for its shape.
   */
  const receivePhotos = async <Id extends string, Fields>(
    c: Context<Env>,
    upload: Upload,
    {
      parse,
      send,
      id,
    }: {
      /**
       * Shape checks beyond the photos, given the parsed form and how many
       * photos it has: the other fields `send` needs, or null if malformed.
       */
      parse: (form: UploadForm, photoCount: number) => Fields | null;
      send: (
        fields: Fields,
        photos: Photo[],
      ) => Promise<({ ok: true } & Record<Id, string>) | { ok: false; reason: string }>;
      /** For the log line: the field of an accepted upload's result that holds the new item's id. */
      id: Id;
    },
  ) => {
    if (!c.req.header("Content-Type")?.startsWith("multipart/form-data")) return apiError(c, 400, "invalid-request");
    // From the request's headers arriving to its last byte: most of the time
    // the phone spends uploading, though not its connection setup.
    const receiving = performance.now();
    const form = await c.req.parseBody({ all: true }).catch(() => null);
    const receiveMs = Math.round(performance.now() - receiving);
    if (!form) {
      logUpload(upload, { outcome: "unreadable", receiveMs });
      return apiError(c, 400, "invalid-request");
    }
    const fields = [form[EVIDENCE_PHOTO_FIELD] ?? []].flat();
    const files = fields.filter(
      (field): field is File => field instanceof File && PHOTO_CONTENT_TYPES.includes(field.type),
    );
    const parsed = files.length === fields.length ? parse(form, files.length) : null;
    if (parsed === null) return apiError(c, 400, "invalid-request");
    const sizes = {
      photos: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      largestBytes: Math.max(0, ...files.map((file) => file.size)),
    };
    if (files.some((file) => file.size > MAX_PHOTO_BYTES)) {
      logUpload(upload, { outcome: "photo-too-large", ...sizes, receiveMs });
      return apiError(c, 400, "photo-too-large");
    }
    const photos: Photo[] = await Promise.all(
      files.map(async (file) => ({ bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type })),
    );
    const storing = performance.now();
    const body = await send(parsed, photos);
    const storeMs = Math.round(performance.now() - storing);
    const outcome = body.ok ? { outcome: "ok", [upload]: body[id] } : { outcome: body.reason };
    logUpload(upload, { ...outcome, ...sizes, receiveMs, storeMs });
    return c.json(body);
  };

  // Liveness, for Fly's check: the process serves and the database answers.
  // It ignores the scheduler and the disk, so a stuck scheduler or a filling
  // volume alerts via /health instead of taking the only machine out of rotation.
  app.get("/healthz", (c) => {
    core.lastTick();
    return c.json<LivenessResponse>({ ok: true });
  });
  // For the uptime monitor: the scheduler is ticking and the volume has room.
  app.get("/health", (c) => {
    const health = core.health();
    const diskUsed = diskUsedFraction();
    const body: HealthResponse = {
      ok: health.ok && diskUsed <= MAX_DISK_USED_FRACTION,
      lastTick: health.lastTick?.toISOString() ?? null,
      diskUsedPercent: Math.round(diskUsed * 1000) / 10,
      commit,
    };
    return c.json(body, body.ok ? 200 : 503);
  });

  // The health routes above answer on any host: Fly's check and the uptime
  // monitor may not use the canonical one. Behind Fly's proxy the request URL's
  // host is the browser's Host header.
  if (canonicalOrigin !== null) {
    const canonical = new URL(canonicalOrigin);
    app.use("*", async (c, next) => {
      const url = new URL(c.req.url);
      if (url.hostname === canonical.hostname) return next();
      // 308, unlike 301, keeps a POST a POST.
      const status = c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308;
      return c.redirect(`${canonical.origin}${url.pathname}${url.search}`, status);
    });
  }

  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  // DEVELOPMENT ONLY: sign in without Google, for agents driving a browser or
  // curl (docs/agents/local-dev.md). Never mounted in production, and refused
  // unless the browser is on this machine (so a phone on the Wi-Fi can't use
  // it). The core decides, as for Google: the operator, or a usable invite
  // token, which this claims.
  if (!production) {
    app.get(DEV_SIGN_IN_PATH, async (c, next) => {
      if (!fromThisMachine(c)) return next();
      const as = c.req.query("as");
      const email = as === "operator" ? operatorEmail : c.req.query("email");
      if (!email) return apiError(c, 400, "invalid-request");
      const name = c.req.query("name") ?? email.split("@")[0]!;
      const inviteToken = c.req.query("invite");
      try {
        const { headers } = await auth.api.devSignIn({
          body: { email, name, ...(inviteToken !== undefined && { inviteToken }) },
          returnHeaders: true,
        });
        for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      } catch (error) {
        if (isInviteRequired(error)) return c.redirect(INVITE_REQUIRED_PATH);
        throw error;
      }
      // As Google's sign-in does: back to the invite, to accept it, or home.
      return c.redirect(inviteToken === undefined ? "/" : APP_PATHS.invite(inviteToken));
    });
  }

  // DEVELOPMENT ONLY, with PACT_DEV_CLOCK=1: moves the server's clock forward
  // and runs the scheduler's tick up to the new time, for the browser smoke
  // test (e2e/). From this machine only, as the dev sign-in.
  if (!production && devClock) {
    app.post(DEV_ADVANCE_PATH, async (c, next) => {
      if (!fromThisMachine(c)) return next();
      const request = await readJson(c, parseDevAdvance);
      if (!request || !(request.minutes > 0)) return apiError(c, 400, "invalid-request");
      devClock.advance(request.minutes);
      const now = devClock.now();
      await core.advanceTo(now);
      return c.json({ now: now.toISOString() });
    });
  }

  // The invite page shows to signed-out visitors, so its lookup needs no
  // session; with one, it's the account's view (a claimed invite is open to
  // the account that claimed it).
  app.get(API_PATHS.invite(":token"), async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const accountId = session && core.accountIdForEmail(session.user.email);
    const token = c.req.param("token");
    return c.json<InviteLookupResponse>(json(accountId ? core.as(accountId).invite(token) : core.invite(token)));
  });

  // Every other /api body is read only up to MAX_JSON_BODY_BYTES; past it,
  // a 413 before the session is even looked up. The photo upload routes have
  // their own, larger limits.
  const jsonBodyLimit = bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: (c) => apiError(c, 413, "body-too-large"),
  });
  app.use("/api/*", (c, next) =>
    matchedRoutes(c).some((route) => route.method === "POST" && PHOTO_UPLOAD_ROUTES.has(route.path))
      ? next()
      : jsonBodyLimit(c, next),
  );

  // Every other /api route is made as the signed-in account. Better Auth
  // creates a user only after the core has made the account (see auth.ts), so
  // a session's email always finds one; this is a read, never a sign-in.
  app.use("/api/*", async (c, next) => {
    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    // A session that was renewed comes back with a fresh cookie: pass it on.
    for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
    const accountId = session && core.accountIdForEmail(session.user.email);
    if (!accountId) return apiError(c, 401, "unauthenticated");
    c.set("accountId", accountId);
    await next();
  });

  // Connecting Oura: to Oura's authorize page with a random state, kept in a
  // short-lived cookie this browser brings back to the callback, where it
  // must match. Lax, so Oura's redirect back (a top-level GET) carries it.
  // `?then=today` (OURA_RECONNECT_PATH) comes back to Today instead of the new
  // pact form; it rides in the cookie after the state, so Oura never sees it.
  app.get(API_PATHS.ouraConnect, (c) => {
    const then: OuraReturn = c.req.query("then") === "today" ? "today" : "new-pact";
    if (!oura) return c.redirect(ouraReturnPath(then, "unavailable"));
    const state = randomBytes(16).toString("base64url");
    setCookie(c, OURA_STATE_COOKIE, `${state}.${then}`, {
      httpOnly: true,
      secure: production,
      sameSite: "Lax",
      path: API_PATHS.ouraCallback,
      maxAge: 10 * 60,
    });
    return c.redirect(oura.authorizeUrl(state));
  });
  app.get(API_PATHS.ouraCallback, async (c) => {
    const [expected, cookieThen] = getCookie(c, OURA_STATE_COOKIE)?.split(".") ?? [];
    const then: OuraReturn = cookieThen === "today" ? "today" : "new-pact";
    const back = (result: OuraResult) => c.redirect(ouraReturnPath(then, result));
    if (!oura) return back("unavailable");
    deleteCookie(c, OURA_STATE_COOKIE, { path: API_PATHS.ouraCallback });
    const { state, code, error } = c.req.query();
    if (expected === undefined || state !== expected) return back("failed");
    // Oura's page sends the browser back with an error when the owner says no.
    if (error !== undefined || code === undefined) return back(error === "access_denied" ? "cancelled" : "failed");
    return back(await connection.connectOura(c.get("accountId"), code));
  });

  app.post(API_PATHS.ouraCheck, async (c) => {
    await account(c).checkOura();
    return c.json<CheckOuraResponse>({ ok: true });
  });

  app.post(API_PATHS.ouraDisconnect, async (c) => {
    await connection.disconnect(c.get("accountId"), "oura");
    return c.json<DisconnectOuraResponse>(me(c.get("accountId")));
  });

  app.post(API_PATHS.ankiConnect, async (c) => {
    const request = await readJson(c, parseConnectAnki);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<ConnectAnkiResponse>(await connection.connectAnki(c.get("accountId"), request));
  });

  app.get(API_PATHS.ankiDecks, async (c) => c.json<AnkiDecksResponse>(await account(c).ankiDecks()));

  app.post(API_PATHS.ankiCheck, async (c) => {
    await account(c).checkAnki();
    return c.json<CheckAnkiResponse>({ ok: true });
  });

  app.post(API_PATHS.ankiDisconnect, async (c) => {
    await connection.disconnect(c.get("accountId"), "anki");
    return c.json<DisconnectAnkiResponse>(me(c.get("accountId")));
  });

  app.get(API_PATHS.me, (c) => c.json<MeResponse>(me(c.get("accountId"))));

  // A refused zone is a result, not an error: 200 either way.
  app.post(API_PATHS.timezone, async (c) => {
    const request = await readJson(c, parseSetTimezone);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<SetTimezoneResponse>(await account(c).setTimezone(request.timezone));
  });

  app.get(API_PATHS.today, (c) => c.json<TodayResponse>(json(account(c).today())));

  app.post(API_PATHS.invites, async (c) => c.json<CreateInviteResponse>(json(await account(c).createInvite())));

  app.post(API_PATHS.acceptInvite(":token"), async (c) =>
    c.json<AcceptInviteResponse>(await account(c).acceptInvite(c.req.param("token"))),
  );

  app.get(API_PATHS.friends, (c) => c.json<FriendsResponse>(account(c).friends()));

  app.get(API_PATHS.recipients, (c) => c.json<RecipientsResponse>(account(c).recipients()));

  app.post(API_PATHS.recipients, async (c) => {
    const recipient = await readJson(c, parseNewRecipient);
    if (!recipient) return apiError(c, 400, "invalid-request");
    return c.json<AddRecipientResponse>(await account(c).addRecipient(recipient));
  });

  app.get(API_PATHS.pacts, (c) => c.json<PactsResponse>(json(account(c).pacts())));

  app.post(API_PATHS.pacts, async (c) => {
    const pact = await readJson(c, parseNewPact);
    if (!pact) return apiError(c, 400, "invalid-request");
    return c.json<CreatePactResponse>(await account(c).createPact(pact));
  });

  app.post(API_PATHS.firstOccurrence, async (c) => {
    const request = await readJson(c, parseFirstOccurrence);
    if (!request) return apiError(c, 400, "invalid-request");
    const { editing, ...timing } = request;
    return c.json<FirstOccurrenceResponse>(json(account(c).firstOccurrence(timing, editing)));
  });

  app.get(API_PATHS.pact(":id"), (c) => c.json<PactResponse>(json(account(c).pact(c.req.param("id")))));

  app.put(API_PATHS.pact(":id"), async (c) => {
    const pact = await readJson(c, parseNewPact);
    if (!pact) return apiError(c, 400, "invalid-request");
    return c.json<EditPactResponse>(await account(c).editPact(c.req.param("id"), pact));
  });

  app.post(API_PATHS.changePreview(":id"), async (c) => {
    const change = await readJson(c, parsePactChange);
    if (!change) return apiError(c, 400, "invalid-request");
    return c.json<ChangePreviewResponse>(account(c).changePreview(c.req.param("id"), change));
  });

  app.post(API_PATHS.changePact(":id"), async (c) => {
    const change = await readJson(c, parsePactChange);
    if (!change) return apiError(c, 400, "invalid-request");
    return c.json<ChangePactResponse>(await account(c).changePact(c.req.param("id"), change));
  });

  app.post(API_PATHS.endPact(":id"), async (c) => {
    const request = await readJson(c, parseEndPact);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<EndPactResponse>(await account(c).requestEnd(c.req.param("id"), request.note));
  });

  app.get(API_PATHS.changeRequest(":id"), (c) =>
    c.json<ChangeRequestResponse>(json(account(c).changeRequest(c.req.param("id")))),
  );

  app.post(API_PATHS.withdrawChangeRequest(":id"), async (c) =>
    c.json<WithdrawChangeRequestResponse>(await account(c).withdrawChangeRequest(c.req.param("id"))),
  );

  app.delete(API_PATHS.pact(":id"), async (c) =>
    c.json<DeletePactResponse>(await account(c).deletePact(c.req.param("id"))),
  );

  // Transport checks only: every photo is checked against the size cap before
  // the core is called, which decides how many photos evidence may have. The
  // body limit stops a huge upload being read at all: past it, some photo
  // must be over the cap, or there are too many.
  app.post(API_PATHS.evidence(":id"), photoBodyLimit(MAX_EVIDENCE_PHOTOS), (c) =>
    receivePhotos(c, "evidence", {
      parse: () => ({}),
      send: (_fields, photos): Promise<SubmitEvidenceResponse> => account(c).submitEvidence(c.req.param("id"), photos),
      id: "evidenceId",
    }),
  );

  // Transport and shape checks only, as for evidence: the amount must be a
  // number, and there may be at most one screenshot, under the size cap. The
  // core decides the rest, a missing screenshot included.
  app.post(API_PATHS.payments(":id"), photoBodyLimit(1), (c) =>
    receivePhotos(c, "payment", {
      parse: (form, photoCount): RecordPaymentRequest | null => {
        const amount = form[PAYMENT_AMOUNT_FIELD];
        const note = form[PAYMENT_NOTE_FIELD];
        if (typeof amount !== "string" || !/^-?\d+(\.\d+)?$/.test(amount)) return null;
        if (note !== undefined && typeof note !== "string") return null;
        if (photoCount > 1) return null;
        return { amountCents: Number(amount), ...(note !== undefined && { note }) };
      },
      send: (fields, [screenshot]): Promise<RecordPaymentResponse> =>
        account(c).recordPayment({ recipientId: c.req.param("id"), ...fields }, screenshot ?? null),
      id: "paymentId",
    }),
  );

  // Transport and shape checks only, as for evidence: the dates and reason
  // must be text. The core decides the rest, how many photos included; the
  // body limit lets one more photo than allowed through, so that's its refusal.
  app.post(API_PATHS.excuses(":id"), photoBodyLimit(MAX_EXCUSE_PHOTOS + 1), (c) =>
    receivePhotos(c, "excuse", {
      parse: (form): FileExcuseRequest | null => {
        const [from, to, reason] = [form[EXCUSE_FROM_FIELD], form[EXCUSE_TO_FIELD], form[EXCUSE_REASON_FIELD]];
        if (typeof from !== "string" || typeof to !== "string" || typeof reason !== "string") return null;
        return { from, to, reason };
      },
      send: (excuse, photos): Promise<FileExcuseResponse> => account(c).fileExcuse(c.req.param("id"), excuse, photos),
      id: "excuseId",
    }),
  );

  app.get(API_PATHS.excusePreview(":id"), (c) => {
    const [from, to] = [c.req.query("from"), c.req.query("to")];
    if (from === undefined || to === undefined) return apiError(c, 400, "invalid-request");
    const query: ExcusePreviewQuery = { from, to };
    return c.json<ExcusePreviewResponse>(json(account(c).excusePreview(c.req.param("id"), query)));
  });

  app.get(API_PATHS.excuseOptions(":id"), (c) =>
    c.json<ExcuseOptionsResponse>(json(account(c).excuseOptions(c.req.param("id")))),
  );

  app.get(API_PATHS.excuse(":id"), (c) => c.json<ExcuseResponse>(json(account(c).excuse(c.req.param("id")))));

  app.post(API_PATHS.acceptExcuseRejection(":id"), async (c) =>
    c.json<AcceptExcuseRejectionResponse>(await account(c).acceptExcuseRejection(c.req.param("id"))),
  );

  app.get(API_PATHS.vacationOptions, (c) => c.json<VacationOptionsResponse>(account(c).vacationOptions()));

  app.post(API_PATHS.vacationPreview, async (c) => {
    const request = await readJson(c, parseVacationRequest);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<VacationPreviewResponse>(account(c).vacationPreview(request));
  });

  app.get(API_PATHS.vacations, (c) => c.json<VacationsResponse>(account(c).vacations()));
  app.get(API_PATHS.lastVacation, (c) => c.json<LastVacationResponse>(account(c).lastVacation()));

  app.post(API_PATHS.vacations, async (c) => {
    const vacation = await readJson(c, parseNewVacation);
    if (!vacation) return apiError(c, 400, "invalid-request");
    return c.json<FileVacationResponse>(await account(c).fileVacation(vacation));
  });

  app.post(API_PATHS.withdrawVacation(":id"), async (c) =>
    c.json<WithdrawVacationResponse>(await account(c).withdrawVacation(c.req.param("id"))),
  );
  app.post(API_PATHS.acceptVacationRejection(":id"), async (c) =>
    c.json<AcceptVacationRejectionResponse>(await account(c).acceptVacationRejection(c.req.param("id"))),
  );

  app.post(API_PATHS.acceptMiss(":id", ":date"), async (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiError(c, 400, "invalid-request");
    return c.json<AcceptMissResponse>(await account(c).acceptMiss(c.req.param("id"), date));
  });

  // Bytes, not JSON, so a photo the account may not see is a 404, as if it
  // didn't exist. Private: only this browser may cache it.
  app.get(API_PATHS.photo(":id"), async (c) => {
    const result = await account(c).photo(c.req.param("id"));
    if (!result.ok) return apiError(c, 404, "not-found");
    return c.body(result.photo.bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": result.photo.contentType,
      "Cache-Control": "private",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get(API_PATHS.reviewQueue, (c) => c.json<ReviewQueueResponse>(json(account(c).reviewQueue())));

  app.post(API_PATHS.decide(":id"), async (c) => {
    const decision = await readJson(c, parseDecision);
    if (!decision) return apiError(c, 400, "invalid-request");
    return c.json<DecideResponse>(await account(c).decide(c.req.param("id"), decision));
  });

  app.get(API_PATHS.waitingOnReply, (c) => c.json<WaitingOnReplyResponse>(json(account(c).waitingOnReply())));

  app.post(API_PATHS.askOwner(":id"), async (c) => {
    const request = await readJson(c, parseAskOwner);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<AskOwnerResponse>(await account(c).askOwner(c.req.param("id"), request.question));
  });

  app.post(API_PATHS.reply(":id"), async (c) => {
    const request = await readJson(c, parseReply);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<ReplyResponse>(await account(c).reply(c.req.param("id"), request.reply));
  });

  app.get(API_PATHS.evidenceItem(":id"), (c) => c.json<EvidenceResponse>(json(account(c).evidence(c.req.param("id")))));

  app.get(API_PATHS.paymentItem(":id"), (c) => c.json<PaymentResponse>(json(account(c).payment(c.req.param("id")))));

  app.get(API_PATHS.ledgers, (c) => c.json<LedgersResponse>(json(account(c).ledgers())));

  app.get(API_PATHS.ledger(":id"), (c) => c.json<LedgerResponse>(json(account(c).ledger(c.req.param("id")))));

  app.get(API_PATHS.notifications, (c) =>
    c.json<NotificationsResponse>({
      settings: account(c).notificationSettings(),
      vapidPublicKey,
    }),
  );

  app.post(API_PATHS.notifications, async (c) => {
    const request = await readJson(c, parseSetNotificationSetting);
    if (!request) return apiError(c, 400, "invalid-request");
    return c.json<SetNotificationSettingResponse>(
      await account(c).setNotificationSetting(request.setting, request.enabled),
    );
  });

  app.post(API_PATHS.pushSubscriptions, async (c) => {
    const device = await readJson(c, parsePushDevice);
    if (!device) return apiError(c, 400, "invalid-request");
    return c.json<SavePushSubscriptionResponse>(await account(c).savePushSubscription(device));
  });

  app.delete(API_PATHS.pushSubscriptions, async (c) => {
    const request = await readJson(c, parseRemovePushSubscription);
    if (!request) return apiError(c, 400, "invalid-request");
    await account(c).removePushSubscription(request.endpoint);
    return c.json<RemovePushSubscriptionResponse>({ ok: true });
  });

  app.all("/api/*", (c) => apiError(c, 404, "not-found"));

  // Better Auth redirects here, with ?error=<code>, when a sign-in fails.
  app.get(AUTH_ERROR_PATH, (c) =>
    c.req.query("error") === INVITE_REQUIRED_CODE ? c.redirect(INVITE_REQUIRED_PATH) : c.html(signInFailedPage(), 400),
  );
  app.get(INVITE_REQUIRED_PATH, (c) => c.html(inviteRequiredPage(), 403));

  // The SPA. Hashed build assets are immutable; everything else (index.html,
  // the manifest, icons, the client-route fallback) revalidates.
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.ok) return;
    c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("*", serveStatic({ root: staticDir }));
  // An asset this build doesn't have gets a 404, not the SPA fallback.
  app.get("/assets/*", (c) => c.notFound());
  const indexHtml = readIndexHtml(staticDir);
  app.get("*", (c) =>
    indexHtml === null
      ? c.text("The client isn't built. Run `npm run build`, or use `npm run dev`.", 404)
      : c.html(indexHtml),
  );

  return app;
}

/**
 * For the dev sign-in: whether the request came from a browser on this
 * machine. Every host and address it names must be loopback: the Host, the
 * socket's peer, and what Vite's proxy forwards (it rewrites Host to the
 * server's, and appends the browser's real address to X-Forwarded-For).
 */
function fromThisMachine(c: Context<Env>): boolean {
  const hosts = [c.req.header("Host"), c.req.header("X-Forwarded-Host")].filter((host) => host !== undefined);
  const addresses = [
    ...(c.req.header("X-Forwarded-For")?.split(",") ?? []),
    ...(c.env?.incoming?.socket.remoteAddress === undefined ? [] : [c.env.incoming.socket.remoteAddress]),
  ];
  return (
    LOOPBACK_HOSTS.has(new URL(c.req.url).hostname) &&
    hosts.every((host) => LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname)) &&
    addresses.every((address) => LOOPBACK_ADDRESSES.has(address.trim()))
  );
}

function apiError(c: Context, status: 400 | 401 | 404 | 413, error: ApiErrorResponse["error"]) {
  const body: ApiErrorResponse = { error };
  return c.json(body, status);
}

/**
 * The body limit for an upload of up to `photos` photos: past it, some photo
 * must be over the size cap (or there are too many), so it isn't read at all.
 */
function photoBodyLimit(photos: number) {
  return bodyLimit({
    maxSize: photos * MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES,
    onError: (c) => apiError(c, 400, "photo-too-large"),
  });
}

/** The request's JSON body as `parse` reads it: null when it isn't JSON or `parse` refuses it. */
async function readJson<T>(c: Context, parse: Parser<T>): Promise<T | null> {
  return parse(await c.req.json().catch(() => null));
}

/**
 * A core result as the client will receive it: c.json turns each Date into
 * its ISO string, and this states that in the type.
 */
function json<T>(value: T): Json<T> {
  return value as Json<T>;
}

// Request bodies are checked for shape only; the core judges their content.

const schedule = union<Schedule>({
  "fixed-days": object({ days: arrayOf(oneOf(WEEKDAYS)) }),
  "weekly-count": object({ target: number }),
  "one-time": object({ deadline: string, submitAnytime: boolean }),
});

const parseDevAdvance = object<DevAdvanceRequest>({ minutes: number });
const parseSetTimezone = object<SetTimezoneRequest>({ timezone: string });
const parseConnectAnki = object<ConnectAnkiRequest>({ email: string, password: string });
const parseNewRecipient = object<AddRecipientRequest>({ name: string });

const parseFirstOccurrence = object<FirstOccurrenceRequest>({
  schedule,
  evidenceKind: optional(oneOf(EVIDENCE_KINDS)),
  inBedBy: optional(string),
  dueBy: optional(string),
  startDate: optional(string),
  editing: optional(string),
});

/** The terms a new pact and a change share. */
const PACT_TERMS: Fields<Omit<NewPact, "evidenceKind">> = {
  name: string,
  description: string,
  schedule,
  penaltyCents: number,
  recipientId: string,
  reviewerIds: arrayOf(string),
  inBedBy: optional(string),
  dueBy: optional(string),
  startDate: optional(string),
  endDate: optional(string),
  ankiDeckId: optional(string),
  reminders: optional(arrayOf(string)),
};

const parseNewPact = object<CreatePactRequest>({ evidenceKind: oneOf(EVIDENCE_KINDS), ...PACT_TERMS });
const parsePactChange = object<ChangePactRequest>({ ...PACT_TERMS, note: optional(string) });
const parseEndPact = object<EndPactRequest>({ note: optional(string) });
const VACATION_REQUEST = { from: string, to: string, pactIds: arrayOf(string) };
const parseVacationRequest = object<VacationPreviewRequest>(VACATION_REQUEST);
const parseNewVacation = object<FileVacationRequest>({
  ...VACATION_REQUEST,
  note: optional(string),
  reviewerIds: arrayOf(string),
});

const parseDecision = union<DecideRequest>({
  approve: object({}),
  reject: object({ reason: string }),
});

const parseAskOwner = object<AskOwnerRequest>({ question: string });
const parseReply = object<ReplyRequest>({ reply: string });
const parseSetNotificationSetting = object<SetNotificationSettingRequest>({
  setting: oneOf(NOTIFICATION_SETTINGS),
  enabled: boolean,
});
const parsePushDevice = object<SavePushSubscriptionRequest>({ endpoint: string, p256dh: string, auth: string });
const parseRemovePushSubscription = object<RemovePushSubscriptionRequest>({ endpoint: string });

function readIndexHtml(staticDir: string): string | null {
  try {
    return readFileSync(join(staticDir, "index.html"), "utf8");
  } catch {
    return null;
  }
}
