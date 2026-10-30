// The client's side of the JSON API. Shapes come from src/shared.

import { createAuthClient } from "better-auth/react";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  EVIDENCE_PHOTO_FIELD,
  INVITE_TOKEN_SIGN_IN_KEY,
  invitePath,
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
  type InviteLookupResponse,
  type LedgerResponse,
  type LedgersResponse,
  type MeResponse,
  type PactResponse,
  type PactsResponse,
  type RecipientsResponse,
  type ReviewQueueResponse,
  type SetTimezoneRequest,
  type SetTimezoneResponse,
  type SubmitEvidenceResponse,
  type TodayResponse,
} from "../shared/api.ts";

export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH });

/** Starts Google sign-in; the browser leaves the app and comes back to `/`. */
export function signInWithGoogle(): Promise<unknown> {
  return authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: AUTH_ERROR_PATH });
}

/**
 * Starts Google sign-in from an invite page. The token rides through Google's
 * redirect so a new account can be created; the browser comes back to the
 * invite page either way (with ?error=<code> when sign-in fails) to accept.
 */
export function signInWithInvite(token: string): Promise<unknown> {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: invitePath(token),
    errorCallbackURL: invitePath(token),
    additionalData: { [INVITE_TOKEN_SIGN_IN_KEY]: token },
  });
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

/** The request never got a response: the network, not the server, failed. */
class NetworkError extends Error {}

/**
 * Says what failed, for an error state: `network` (which asks the user to check
 * their connection) only when no response came back; anything else, a 500
 * included, is on our side.
 */
export function failureText(error: unknown, network: string): string {
  return error instanceof NetworkError ? network : "Something went wrong on our side. Try again in a minute.";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init }).catch((cause: unknown) => {
    throw new NetworkError(`${path}: no response`, { cause });
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new ApiError(response.status, (body as Partial<ApiErrorResponse> | null)?.error);
  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

/** A multipart POST; the browser sets the Content-Type with its boundary. */
function postForm<T>(path: string, form: FormData): Promise<T> {
  return call<T>(path, { method: "POST", body: form });
}

export const api = {
  me: () => call<MeResponse>(API_PATHS.me),
  today: () => call<TodayResponse>(API_PATHS.today),
  setTimezone: (timezone: string) =>
    post<SetTimezoneResponse>(API_PATHS.timezone, { timezone } satisfies SetTimezoneRequest),
  /** Works signed out. */
  invite: (token: string) => call<InviteLookupResponse>(API_PATHS.invite(encodeURIComponent(token))),
  createInvite: () => post<CreateInviteResponse>(API_PATHS.invites),
  acceptInvite: (token: string) => post<AcceptInviteResponse>(API_PATHS.acceptInvite(encodeURIComponent(token))),
  friends: () => call<FriendsResponse>(API_PATHS.friends),
  recipients: () => call<RecipientsResponse>(API_PATHS.recipients),
  addRecipient: (recipient: AddRecipientRequest) => post<AddRecipientResponse>(API_PATHS.recipients, recipient),
  pacts: () => call<PactsResponse>(API_PATHS.pacts),
  createPact: (pact: CreatePactRequest) => post<CreatePactResponse>(API_PATHS.pacts, pact),
  firstOccurrence: (request: FirstOccurrenceRequest) =>
    post<FirstOccurrenceResponse>(API_PATHS.firstOccurrence, request),
  pact: (pactId: string) => call<PactResponse>(API_PATHS.pact(encodeURIComponent(pactId))),
  /** `photos` are already shrunk (photos.ts), in the order taken. */
  submitEvidence: (pactId: string, photos: Blob[]) => {
    const form = new FormData();
    photos.forEach((photo, i) => form.append(EVIDENCE_PHOTO_FIELD, photo, `photo-${i + 1}.jpg`));
    return postForm<SubmitEvidenceResponse>(API_PATHS.evidence(encodeURIComponent(pactId)), form);
  },
  acceptMiss: (pactId: string, occurrenceDate: string) =>
    post<AcceptMissResponse>(API_PATHS.acceptMiss(encodeURIComponent(pactId), encodeURIComponent(occurrenceDate))),
  reviewQueue: () => call<ReviewQueueResponse>(API_PATHS.reviewQueue),
  decide: (itemId: string, decision: DecideRequest) =>
    post<DecideResponse>(API_PATHS.decide(encodeURIComponent(itemId)), decision),
  ledgers: () => call<LedgersResponse>(API_PATHS.ledgers),
  ledger: (recipientId: string) => call<LedgerResponse>(API_PATHS.ledger(encodeURIComponent(recipientId))),
};
