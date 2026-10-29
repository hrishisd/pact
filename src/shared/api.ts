// The JSON API between the client and the server: paths and the shapes of
// request and response bodies. Domain shapes come from ./types.ts.

import type { Profile, SetTimezoneResult, Today } from "./types.ts";

/** Better Auth's routes live under this path. */
export const AUTH_BASE_PATH = "/api/auth";

/** Where Better Auth sends the browser, with ?error=<code>, when sign-in fails. */
export const AUTH_ERROR_PATH = "/auth-error";

/** The plain page for a Google account that has no invite. */
export const INVITE_REQUIRED_PATH = "/invite-required";

/** The JSON API's routes. */
export const API_PATHS = {
  me: "/api/me",
  timezone: "/api/me/timezone",
  today: "/api/today",
} as const;

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
export type TodayResponse = Today;

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
