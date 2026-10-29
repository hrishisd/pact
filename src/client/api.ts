// The client's side of the JSON API. Shapes come from src/shared.

import { createAuthClient } from "better-auth/react";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  type ApiErrorResponse,
  type MeResponse,
  type SetTimezoneRequest,
  type SetTimezoneResponse,
  type TodayResponse,
} from "../shared/api.ts";

export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH });

/** Starts Google sign-in; the browser leaves the app and comes back to `/`. */
export function signInWithGoogle(): Promise<unknown> {
  return authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: AUTH_ERROR_PATH });
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorResponse["error"] | undefined;
  constructor(status: number, code: ApiErrorResponse["error"] | undefined) {
    super(`API error ${status}${code ? ` (${code})` : ""}`);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new ApiError(response.status, (body as Partial<ApiErrorResponse> | null)?.error);
  return body as T;
}

export const api = {
  me: () => call<MeResponse>(API_PATHS.me),
  today: () => call<TodayResponse>(API_PATHS.today),
  setTimezone: (timezone: string) =>
    call<SetTimezoneResponse>(API_PATHS.timezone, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone } satisfies SetTimezoneRequest),
    }),
};
