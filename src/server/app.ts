// The HTTP surface: /health and /healthz, a redirect to the canonical host,
// Better Auth under /api/auth, the JSON API under /api, two plain sign-in error
// pages, and the built SPA with a fallback to index.html for client-side routes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import type { AccountId, NewPayment, PactCore, Photo, Schedule, Weekday } from "../core/index.ts";
import { MAX_EVIDENCE_PHOTOS, NOTIFICATION_SETTINGS, WEEKDAYS } from "../shared/types.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  DEV_SIGN_IN_PATH,
  EVIDENCE_PHOTO_FIELD,
  INVITE_REQUIRED_PATH,
  invitePath,
  MAX_PHOTO_BYTES,
  PAYMENT_AMOUNT_FIELD,
  PAYMENT_NOTE_FIELD,
  PHOTO_CONTENT_TYPES,
  type AcceptInviteResponse,
  type AcceptMissResponse,
  type AddRecipientRequest,
  type AddRecipientResponse,
  type ApiErrorResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type DecideRequest,
  type DecideResponse,
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
  type RecordPaymentResponse,
  type RemovePushSubscriptionRequest,
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
import { INVITE_REQUIRED_CODE, type Auth } from "./auth.ts";
import { inviteRequiredPage, signInFailedPage } from "./pages.ts";

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
  /** Where the app writes log lines. Default: console.log. */
  log?: (line: string) => void;
}

/** A parsed multipart form: each field's value, or values when it repeats. */
type UploadForm = Record<string, string | File | (string | File)[]>;

/** Room for the multipart boundaries and headers around the photos. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

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
  log = (line) => console.log(line),
}: AppOptions) {
  const app = new Hono<Env>();

  /**
   * One line per photo upload (evidence, or a payment's screenshot), to see
   * sizes and speeds in the server log. Nothing from the request's URL goes
   * in, so a request can't forge a line.
   */
  const logUpload = (upload: "evidence" | "payment", fields: Record<string, string | number>) =>
    log(
      `${upload}-upload ${Object.entries(fields)
        .map(([name, value]) => `${name}=${value}`)
        .join(" ")}`,
    );

  /**
   * A multipart upload of photos in EVIDENCE_PHOTO_FIELD: evidence, or a
   * payment's screenshot. Transport checks only: a form that won't parse, a
   * field there that isn't a photo, or a form `valid` refuses is a 400
   * invalid-request; a photo over the size cap is a 400 photo-too-large.
   * Otherwise `send` calls the core with the photos and its result is the
   * response. Each upload that parsed logs one line (`logUpload`) with its
   * sizes and timings and what `outcome` says became of it, except a form
   * refused for its shape.
   */
  const receivePhotos = async <Body extends { ok: boolean }, Fields>(
    c: Context<Env>,
    upload: "evidence" | "payment",
    {
      parse,
      send,
      outcome,
    }: {
      /**
       * Shape checks beyond the photos, given the parsed form and how many
       * photos it has: the other fields `send` needs, or null if malformed.
       */
      parse: (form: UploadForm, photoCount: number) => Fields | null;
      send: (fields: Fields, photos: Photo[]) => Promise<Body>;
      /** For the log line: what became of the upload, and the new item's id when it was accepted. */
      outcome: (body: Body) => Record<string, string>;
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
    logUpload(upload, { ...outcome(body), ...sizes, receiveMs, storeMs });
    return c.json(body);
  };

  // Liveness, for Fly's check: the process serves and the database answers.
  // It ignores the scheduler and the disk, so a stuck scheduler or a filling
  // volume alerts via /health instead of taking the only machine out of rotation.
  app.get("/healthz", (c) => {
    core.lastTick();
    const body: LivenessResponse = { ok: true };
    return c.json(body);
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
      } catch {
        return c.redirect(INVITE_REQUIRED_PATH);
      }
      // As Google's sign-in does: back to the invite, to accept it, or home.
      return c.redirect(inviteToken === undefined ? "/" : invitePath(inviteToken));
    });
  }

  // The invite page shows to signed-out visitors, so its lookup needs no
  // session; with one, it's the account's view (a claimed invite is open to
  // the account that claimed it).
  app.get(API_PATHS.invite(":token"), async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const accountId = session && core.accountIdForEmail(session.user.email);
    const token = c.req.param("token");
    const body: InviteLookupResponse = json(accountId ? core.as(accountId).invite(token) : core.invite(token));
    return c.json(body);
  });

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

  app.get(API_PATHS.me, (c) => {
    const body: MeResponse = core.as(c.get("accountId")).profile();
    return c.json(body);
  });

  // A refused zone is a result, not an error: 200 either way.
  app.post(API_PATHS.timezone, async (c) => {
    const request = (await c.req.json().catch(() => null)) as Partial<SetTimezoneRequest> | null;
    if (typeof request?.timezone !== "string") return apiError(c, 400, "invalid-request");
    const result: SetTimezoneResponse = await core.as(c.get("accountId")).setTimezone(request.timezone);
    return c.json(result);
  });

  app.get(API_PATHS.today, (c) => {
    const body: TodayResponse = json(core.as(c.get("accountId")).today());
    return c.json(body);
  });

  app.post(API_PATHS.invites, async (c) => {
    const body: CreateInviteResponse = json(await core.as(c.get("accountId")).createInvite());
    return c.json(body);
  });

  app.post(API_PATHS.acceptInvite(":token"), async (c) => {
    const body: AcceptInviteResponse = await core.as(c.get("accountId")).acceptInvite(c.req.param("token"));
    return c.json(body);
  });

  app.get(API_PATHS.friends, (c) => {
    const body: FriendsResponse = core.as(c.get("accountId")).friends();
    return c.json(body);
  });

  app.get(API_PATHS.recipients, (c) => {
    const body: RecipientsResponse = core.as(c.get("accountId")).recipients();
    return c.json(body);
  });

  app.post(API_PATHS.recipients, async (c) => {
    const recipient = parseNewRecipient(await c.req.json().catch(() => null));
    if (!recipient) return apiError(c, 400, "invalid-request");
    const body: AddRecipientResponse = await core.as(c.get("accountId")).addRecipient(recipient);
    return c.json(body);
  });

  app.get(API_PATHS.pacts, (c) => {
    const body: PactsResponse = core.as(c.get("accountId")).pacts();
    return c.json(body);
  });

  app.post(API_PATHS.pacts, async (c) => {
    const pact = parseNewPact(await c.req.json().catch(() => null));
    if (!pact) return apiError(c, 400, "invalid-request");
    const body: CreatePactResponse = await core.as(c.get("accountId")).createPact(pact);
    return c.json(body);
  });

  app.post(API_PATHS.firstOccurrence, async (c) => {
    const request = (await c.req.json().catch(() => null)) as Partial<
      Record<keyof FirstOccurrenceRequest, unknown>
    > | null;
    const schedule = parseSchedule(request?.schedule);
    if (!schedule) return apiError(c, 400, "invalid-request");
    const body: FirstOccurrenceResponse = json(core.as(c.get("accountId")).firstOccurrence(schedule));
    return c.json(body);
  });

  app.get(API_PATHS.pact(":id"), (c) => {
    const body: PactResponse = json(core.as(c.get("accountId")).pact(c.req.param("id")));
    return c.json(body);
  });

  // Transport checks only: every photo is checked against the size cap before
  // the core is called, which decides how many photos evidence may have. The
  // body limit stops a huge upload being read at all: past it, some photo
  // must be over the cap, or there are too many.
  app.post(
    API_PATHS.evidence(":id"),
    bodyLimit({
      maxSize: MAX_EVIDENCE_PHOTOS * MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => apiError(c, 400, "photo-too-large"),
    }),
    (c) =>
      receivePhotos(c, "evidence", {
        parse: () => ({}),
        send: (_fields, photos): Promise<SubmitEvidenceResponse> =>
          core.as(c.get("accountId")).submitEvidence(c.req.param("id"), photos),
        outcome: (body): Record<string, string> =>
          body.ok ? { outcome: "ok", evidence: body.evidenceId } : { outcome: body.reason },
      }),
  );

  // Transport and shape checks only, as for evidence: the amount must be a
  // number, and there may be at most one screenshot, under the size cap. The
  // core decides the rest, a missing screenshot included.
  app.post(
    API_PATHS.payments(":id"),
    bodyLimit({
      maxSize: MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => apiError(c, 400, "photo-too-large"),
    }),
    (c) =>
      receivePhotos(c, "payment", {
        parse: (form, photoCount): Omit<NewPayment, "recipientId"> | null => {
          const amount = form[PAYMENT_AMOUNT_FIELD];
          const note = form[PAYMENT_NOTE_FIELD];
          if (typeof amount !== "string" || !/^-?\d+(\.\d+)?$/.test(amount)) return null;
          if (note !== undefined && typeof note !== "string") return null;
          if (photoCount > 1) return null;
          return { amountCents: Number(amount), ...(note !== undefined && { note }) };
        },
        send: (fields, [screenshot]): Promise<RecordPaymentResponse> =>
          core.as(c.get("accountId")).recordPayment({ recipientId: c.req.param("id"), ...fields }, screenshot ?? null),
        outcome: (body): Record<string, string> =>
          body.ok ? { outcome: "ok", payment: body.paymentId } : { outcome: body.reason },
      }),
  );

  app.post(API_PATHS.acceptMiss(":id", ":date"), async (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiError(c, 400, "invalid-request");
    const body: AcceptMissResponse = await core.as(c.get("accountId")).acceptMiss(c.req.param("id"), date);
    return c.json(body);
  });

  // Bytes, not JSON, so a photo the account may not see is a 404, as if it
  // didn't exist. Private: only this browser may cache it.
  app.get(API_PATHS.photo(":id"), async (c) => {
    const result = await core.as(c.get("accountId")).photo(c.req.param("id"));
    if (!result.ok) return apiError(c, 404, "not-found");
    return c.body(result.photo.bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": result.photo.contentType,
      "Cache-Control": "private",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get(API_PATHS.reviewQueue, (c) => {
    const body: ReviewQueueResponse = json(core.as(c.get("accountId")).reviewQueue());
    return c.json(body);
  });

  app.post(API_PATHS.decide(":id"), async (c) => {
    const decision = parseDecision(await c.req.json().catch(() => null));
    if (!decision) return apiError(c, 400, "invalid-request");
    const body: DecideResponse = await core.as(c.get("accountId")).decide(c.req.param("id"), decision);
    return c.json(body);
  });

  app.get(API_PATHS.ledgers, (c) => {
    const body: LedgersResponse = core.as(c.get("accountId")).ledgers();
    return c.json(body);
  });

  app.get(API_PATHS.ledger(":id"), (c) => {
    const body: LedgerResponse = json(core.as(c.get("accountId")).ledger(c.req.param("id")));
    return c.json(body);
  });

  app.get(API_PATHS.notifications, (c) => {
    const body: NotificationsResponse = {
      settings: core.as(c.get("accountId")).notificationSettings(),
      vapidPublicKey,
    };
    return c.json(body);
  });

  app.post(API_PATHS.notifications, async (c) => {
    const request = parseSetNotificationSetting(await c.req.json().catch(() => null));
    if (!request) return apiError(c, 400, "invalid-request");
    const body: SetNotificationSettingResponse = await core
      .as(c.get("accountId"))
      .setNotificationSetting(request.setting, request.enabled);
    return c.json(body);
  });

  app.post(API_PATHS.pushSubscriptions, async (c) => {
    const device = parsePushDevice(await c.req.json().catch(() => null));
    if (!device) return apiError(c, 400, "invalid-request");
    const body: SavePushSubscriptionResponse = await core.as(c.get("accountId")).savePushSubscription(device);
    return c.json(body);
  });

  app.delete(API_PATHS.pushSubscriptions, async (c) => {
    const request = (await c.req.json().catch(() => null)) as Partial<RemovePushSubscriptionRequest> | null;
    if (typeof request?.endpoint !== "string") return apiError(c, 400, "invalid-request");
    await core.as(c.get("accountId")).removePushSubscription(request.endpoint);
    return c.json({ ok: true });
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

function apiError(c: Context, status: 400 | 401 | 404, error: ApiErrorResponse["error"]) {
  const body: ApiErrorResponse = { error };
  return c.json(body, status);
}

/**
 * A core result as the client will receive it: c.json turns each Date into
 * its ISO string, and this states that in the type.
 */
function json<T>(value: T): Json<T> {
  return value as Json<T>;
}

// Request bodies are checked for shape only; the core judges their content.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseSchedule(value: unknown): Schedule | null {
  if (!isRecord(value) || value.kind !== "fixed-days") return null;
  const { days } = value;
  if (!isStringArray(days) || !days.every(isWeekday)) return null;
  return { kind: "fixed-days", days };
}

function parseNewRecipient(value: unknown): AddRecipientRequest | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return { name: value.name };
}

function parseNewPact(value: unknown): CreatePactRequest | null {
  if (!isRecord(value)) return null;
  const { evidenceKind, name, description, penaltyCents, recipientId, reviewerIds } = value;
  const schedule = parseSchedule(value.schedule);
  if (
    (evidenceKind !== "camera" && evidenceKind !== "oura") ||
    typeof name !== "string" ||
    typeof description !== "string" ||
    !schedule ||
    typeof penaltyCents !== "number" ||
    !Number.isSafeInteger(penaltyCents) ||
    typeof recipientId !== "string" ||
    !isStringArray(reviewerIds)
  ) {
    return null;
  }
  return { evidenceKind, name, description, schedule, penaltyCents, recipientId, reviewerIds };
}

function parseDecision(value: unknown): DecideRequest | null {
  if (!isRecord(value)) return null;
  if (value.kind === "approve") return { kind: "approve" };
  if (value.kind === "reject" && typeof value.reason === "string") return { kind: "reject", reason: value.reason };
  return null;
}

function parseSetNotificationSetting(value: unknown): SetNotificationSettingRequest | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  const setting = NOTIFICATION_SETTINGS.find((known) => known === value.setting);
  return setting ? { setting, enabled: value.enabled } : null;
}

function parsePushDevice(value: unknown): SavePushSubscriptionRequest | null {
  if (!isRecord(value)) return null;
  const { endpoint, p256dh, auth } = value;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null;
  return { endpoint, p256dh, auth };
}

function readIndexHtml(staticDir: string): string | null {
  try {
    return readFileSync(join(staticDir, "index.html"), "utf8");
  } catch {
    return null;
  }
}
