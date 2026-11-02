// The client's side of the JSON API. Shapes come from src/shared.

import { createAuthClient } from "better-auth/react";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  EVIDENCE_PHOTO_FIELD,
  EXCUSE_FROM_FIELD,
  EXCUSE_REASON_FIELD,
  EXCUSE_TO_FIELD,
  INVITE_TOKEN_SIGN_IN_KEY,
  invitePath,
  PAYMENT_AMOUNT_FIELD,
  PAYMENT_NOTE_FIELD,
  type AcceptExcuseRejectionResponse,
  type AcceptInviteResponse,
  type AcceptMissResponse,
  type AddRecipientRequest,
  type AddRecipientResponse,
  type ApiErrorResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type DeletePactResponse,
  type EditPactRequest,
  type EditPactResponse,
  type ExcuseOptionsResponse,
  type ExcusePreviewResponse,
  type ExcuseResponse,
  type FileExcuseResponse,
  type DecideRequest,
  type DecideResponse,
  type FirstOccurrenceRequest,
  type FirstOccurrenceResponse,
  type FriendsResponse,
  type InviteLookupResponse,
  type LedgerResponse,
  type LedgersResponse,
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

/** `failureText` for an upload, except that a photo the server found too large gets `tooLarge`. */
export function uploadFailureText(error: unknown, tooLarge: string, network: string): string {
  return error instanceof ApiError && error.code === "photo-too-large" ? tooLarge : failureText(error, network);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init }).catch((cause: unknown) => {
    throw new NetworkError(`${path}: no response`, { cause });
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new ApiError(response.status, (body as Partial<ApiErrorResponse> | null)?.error);
  return body as T;
}

function post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return call<T>(path, {
    method,
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
  editPact: (pactId: string, pact: EditPactRequest) =>
    post<EditPactResponse>(API_PATHS.pact(encodeURIComponent(pactId)), pact, "PUT"),
  deletePact: (pactId: string) =>
    call<DeletePactResponse>(API_PATHS.pact(encodeURIComponent(pactId)), { method: "DELETE" }),
  firstOccurrence: (request: FirstOccurrenceRequest) =>
    post<FirstOccurrenceResponse>(API_PATHS.firstOccurrence, request),
  pact: (pactId: string) => call<PactResponse>(API_PATHS.pact(encodeURIComponent(pactId))),
  /** `photos` are already shrunk (photos.ts), in the order taken. */
  submitEvidence: (pactId: string, photos: Blob[]) => {
    const form = new FormData();
    photos.forEach((photo, i) => form.append(EVIDENCE_PHOTO_FIELD, photo, `photo-${i + 1}.jpg`));
    return postForm<SubmitEvidenceResponse>(API_PATHS.evidence(encodeURIComponent(pactId)), form);
  },
  excusePreview: (pactId: string, dates: { from: string; to: string }) =>
    call<ExcusePreviewResponse>(
      `${API_PATHS.excusePreview(encodeURIComponent(pactId))}?${new URLSearchParams(dates).toString()}`,
    ),
  excuseOptions: (pactId: string) => call<ExcuseOptionsResponse>(API_PATHS.excuseOptions(encodeURIComponent(pactId))),
  /** `photos` are already shrunk (photos.ts), in the order added. */
  fileExcuse: (pactId: string, excuse: { from: string; to: string; reason: string }, photos: Blob[]) => {
    const form = new FormData();
    form.append(EXCUSE_FROM_FIELD, excuse.from);
    form.append(EXCUSE_TO_FIELD, excuse.to);
    form.append(EXCUSE_REASON_FIELD, excuse.reason);
    photos.forEach((photo, i) => form.append(EVIDENCE_PHOTO_FIELD, photo, `photo-${i + 1}.jpg`));
    return postForm<FileExcuseResponse>(API_PATHS.excuses(encodeURIComponent(pactId)), form);
  },
  excuse: (excuseId: string) => call<ExcuseResponse>(API_PATHS.excuse(encodeURIComponent(excuseId))),
  acceptExcuseRejection: (excuseId: string) =>
    post<AcceptExcuseRejectionResponse>(API_PATHS.acceptExcuseRejection(encodeURIComponent(excuseId))),
  acceptMiss: (pactId: string, occurrenceDate: string) =>
    post<AcceptMissResponse>(API_PATHS.acceptMiss(encodeURIComponent(pactId), encodeURIComponent(occurrenceDate))),
  reviewQueue: () => call<ReviewQueueResponse>(API_PATHS.reviewQueue),
  decide: (itemId: string, decision: DecideRequest) =>
    post<DecideResponse>(API_PATHS.decide(encodeURIComponent(itemId)), decision),
  ledgers: () => call<LedgersResponse>(API_PATHS.ledgers),
  ledger: (recipientId: string) => call<LedgerResponse>(API_PATHS.ledger(encodeURIComponent(recipientId))),
  /** `screenshot` is already shrunk (photos.ts). */
  recordPayment: (recipientId: string, payment: { amountCents: number; note: string }, screenshot: Blob) => {
    const form = new FormData();
    form.append(PAYMENT_AMOUNT_FIELD, String(payment.amountCents));
    form.append(PAYMENT_NOTE_FIELD, payment.note);
    form.append(EVIDENCE_PHOTO_FIELD, screenshot, "screenshot.jpg");
    return postForm<RecordPaymentResponse>(API_PATHS.payments(encodeURIComponent(recipientId)), form);
  },
  notifications: () => call<NotificationsResponse>(API_PATHS.notifications),
  setNotificationSetting: (request: SetNotificationSettingRequest) =>
    post<SetNotificationSettingResponse>(API_PATHS.notifications, request),
  savePushSubscription: (device: SavePushSubscriptionRequest) =>
    post<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, device),
  removePushSubscription: (endpoint: string) =>
    call<unknown>(API_PATHS.pushSubscriptions, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint } satisfies RemovePushSubscriptionRequest),
    }),
};
