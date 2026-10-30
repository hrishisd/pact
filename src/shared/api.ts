// The JSON API between the client and the server: paths and the shapes of
// request and response bodies. Domain shapes come from ./types.ts.

import type {
  AcceptInviteResult,
  AcceptRejectionResult,
  AddRecipientResult,
  CreatePactResult,
  DecideResult,
  FirstOccurrenceResult,
  Friend,
  Invite,
  InviteLookup,
  LedgerResult,
  LedgerSummary,
  NewPact,
  NewRecipient,
  PactResult,
  PactSummary,
  Profile,
  Recipient,
  ReviewDecision,
  ReviewItem,
  Schedule,
  SetTimezoneResult,
  SubmitEvidenceResult,
  Today,
} from "./types.ts";

/**
 * A value as it arrives after a trip through JSON: every Date is its ISO 8601
 * string. Response types that carry dates are wrapped in this.
 */
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

/** Better Auth's routes live under this path. */
export const AUTH_BASE_PATH = "/api/auth";

/** Where Better Auth sends the browser, with ?error=<code>, when sign-in fails. */
export const AUTH_ERROR_PATH = "/auth-error";

/**
 * Development only: signs in without Google (see docs/agents/local-dev.md).
 * `?as=operator`, or `?email=…&name=…&invite=<token>` for anyone else.
 */
export const DEV_SIGN_IN_PATH = "/api/dev/sign-in";

/** The plain page for a Google account that has no invite. */
export const INVITE_REQUIRED_PATH = "/invite-required";

/**
 * Sign-in from an invite link carries the link's token through Google's
 * redirect in the OAuth state: the client passes
 * `additionalData: { [INVITE_TOKEN_SIGN_IN_KEY]: token }` to
 * `signIn.social`, and the server hands it to the core when Google's
 * callback would create a new account.
 */
export const INVITE_TOKEN_SIGN_IN_KEY = "inviteToken";

/** The client route of an invite link; the SPA renders it. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}

/** The token of the invite link `pathname` is (the inverse of `invitePath`), or null. */
export function inviteTokenFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)$/.exec(pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/**
 * The JSON API's routes. Tokens and ids are URL-safe as made (base64url,
 * UUIDs), so they go into paths as they are; the server registers its routes
 * by calling these with ":param" placeholders.
 */
export const API_PATHS = {
  me: "/api/me",
  timezone: "/api/me/timezone",
  today: "/api/today",
  invites: "/api/invites",
  /** Needs no session: the invite page shows to signed-out visitors. */
  invite: <T extends string>(token: T) => `/api/invites/${token}` as const,
  acceptInvite: <T extends string>(token: T) => `/api/invites/${token}/accept` as const,
  friends: "/api/friends",
  recipients: "/api/recipients",
  pacts: "/api/pacts",
  firstOccurrence: "/api/pacts/first-occurrence",
  pact: <T extends string>(pactId: T) => `/api/pacts/${pactId}` as const,
  evidence: <T extends string>(pactId: T) => `/api/pacts/${pactId}/evidence` as const,
  acceptRejection: <T extends string>(pactId: T) => `/api/pacts/${pactId}/accept-rejection` as const,
  /**
   * GET: a photo's bytes and type, not JSON, for the pact's owner and
   * reviewers only. Anyone else gets the 404 an unknown photo does.
   */
  photo: <T extends string>(photoId: T) => `/api/photos/${photoId}` as const,
  reviewQueue: "/api/review",
  decide: <T extends string>(itemId: T) => `/api/review/${itemId}/decision` as const,
  ledgers: "/api/ledgers",
  ledger: <T extends string>(recipientId: T) => `/api/ledgers/${recipientId}` as const,
} as const;

/**
 * The largest photo the server accepts. A shrunk photo is about 100–180 KB and
 * a phone's original 3–5 MB, so this catches a shrink that silently failed.
 */
export const MAX_PHOTO_BYTES = 1024 * 1024;

/** The multipart field each photo of some evidence is sent in. */
export const EVIDENCE_PHOTO_FIELD = "photo";

/** The photo types the server accepts and serves back: JPEG, which the client always sends after shrinking. */
export const PHOTO_CONTENT_TYPES: readonly string[] = ["image/jpeg"];

/** POST /api/invites: a new single-use invite, expiring 7 days from now. */
export type CreateInviteResponse = Json<Invite>;

/** GET /api/invites/:token, with or without a session. */
export type InviteLookupResponse = Json<InviteLookup>;

/** POST /api/invites/:token/accept (no body). */
export type AcceptInviteResponse = AcceptInviteResult;

/** GET /api/friends */
export type FriendsResponse = Friend[];

/** GET /api/recipients: the owner's saved recipients. */
export type RecipientsResponse = Recipient[];

/** POST /api/recipients */
export type AddRecipientRequest = NewRecipient;
export type AddRecipientResponse = AddRecipientResult;

/** POST /api/pacts */
export type CreatePactRequest = NewPact;
export type CreatePactResponse = CreatePactResult;

/** POST /api/pacts/first-occurrence: the create form's Check step, before the pact exists. */
export interface FirstOccurrenceRequest {
  schedule: Schedule;
}
export type FirstOccurrenceResponse = Json<FirstOccurrenceResult>;

/** GET /api/pacts: the Pacts tab. */
export type PactsResponse = PactSummary[];

/** GET /api/pacts/:id: the pact page. Someone else's pact, or none, is a 200 refusal. */
export type PactResponse = Json<PactResult>;

/**
 * POST /api/pacts/:id/evidence: multipart form data with one `photo` file
 * per photo, in the order taken. A photo over MAX_PHOTO_BYTES is a 400
 * "photo-too-large"; a `photo` field that isn't a file, or a type outside
 * PHOTO_CONTENT_TYPES, is a 400 "invalid-request". The core's refusals,
 * "no-photos" and "too-many-photos" included, are 200s.
 */
export type SubmitEvidenceResponse = SubmitEvidenceResult;

/**
 * POST /api/pacts/:id/accept-rejection (no body): the owner takes the miss
 * after a rejection. The core's refusals are 200s.
 */
export type AcceptRejectionResponse = AcceptRejectionResult;

/** GET /api/review: the signed-in account's Review Queue, oldest first. */
export type ReviewQueueResponse = Json<ReviewItem[]>;

/**
 * POST /api/review/:id/decision. A body of another shape is a 400
 * "invalid-request"; the core's refusals ("blank-reason" included) are 200s.
 */
export type DecideRequest = ReviewDecision;
export type DecideResponse = DecideResult;

/** GET /api/ledgers: the Ledgers tab, one per recipient, sorted by name. */
export type LedgersResponse = LedgerSummary[];

/** GET /api/ledgers/:recipientId: a ledger's page. Another account's recipient, or none, is a 200 refusal. */
export type LedgerResponse = Json<LedgerResult>;

/** GET /api/me: the signed-in account's profile. */
export type MeResponse = Profile;

/**
 * POST /api/me/timezone. Answers 200 with the core's result whether the zone
 * was accepted or refused.
 */
export interface SetTimezoneRequest {
  /** IANA zone, e.g. "America/New_York". */
  timezone: string;
}
export type SetTimezoneResponse = SetTimezoneResult;

/** GET /api/today */
export type TodayResponse = Json<Today>;

/** GET /healthz: liveness only (process up, database readable). */
export interface LivenessResponse {
  ok: true;
}

/**
 * GET /health: fails (503) when the scheduler has not ticked for 5 minutes or
 * the database's volume is more than 80% full.
 */
export interface HealthResponse {
  ok: boolean;
  /** ISO 8601, or null before the first scheduler tick. */
  lastTick: string | null;
  /** How much of the database's volume is in use, as a percentage to one decimal place, e.g. 12.5. */
  diskUsedPercent: number;
}

/** Body of every non-2xx /api response. */
export interface ApiErrorResponse {
  error: "unauthenticated" | "invalid-request" | "not-found" | "photo-too-large";
}
