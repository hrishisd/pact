// The JSON API between the client and the server: paths and the shapes of
// request and response bodies. Domain shapes come from ./types.ts.

import type {
  AcceptInviteResult,
  AddRecipientResult,
  CreatePactResult,
  FirstOccurrenceResult,
  Friend,
  Invite,
  InviteLookup,
  NewPact,
  NewRecipient,
  PactResult,
  PactSummary,
  Profile,
  Recipient,
  Schedule,
  SetTimezoneResult,
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
} as const;

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
  error: "unauthenticated" | "invalid-request" | "not-found";
}
