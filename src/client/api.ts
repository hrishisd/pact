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
  TIMEZONE_SIGN_IN_KEY,
  APP_PATHS,
  PAYMENT_AMOUNT_FIELD,
  PAYMENT_NOTE_FIELD,
  type AcceptExcuseRejectionResponse,
  type AcceptVacationRejectionResponse,
  type AnkiDecksResponse,
  type CheckAnkiResponse,
  type CheckOuraResponse,
  type ConnectAnkiRequest,
  type ConnectAnkiResponse,
  type DisconnectAnkiResponse,
  type DisconnectOuraResponse,
  type AcceptInviteResponse,
  type AcceptMissResponse,
  type AddRecipientRequest,
  type AddRecipientResponse,
  type AskOwnerRequest,
  type AskOwnerResponse,
  type EvidenceResponse,
  type PaymentResponse,
  type ReplyRequest,
  type ReplyResponse,
  type WaitingOnReplyResponse,
  type ApiErrorResponse,
  type ChangePactRequest,
  type ChangePactResponse,
  type ChangePreviewResponse,
  type ChangeRequestResponse,
  type EndPactRequest,
  type EndPactResponse,
  type WithdrawChangeRequestResponse,
  type CreateInviteResponse,
  type CreatePactRequest,
  type CreatePactResponse,
  type DeletePactResponse,
  type EditPactRequest,
  type EditPactResponse,
  type ExcuseOptionsResponse,
  type ExcusePreviewQuery,
  type ExcusePreviewResponse,
  type ExcuseResponse,
  type FileExcuseRequest,
  type FileExcuseResponse,
  type FileVacationRequest,
  type FileVacationResponse,
  type VacationOptionsResponse,
  type VacationPreviewRequest,
  type VacationPreviewResponse,
  type LastVacationResponse,
  type VacationsResponse,
  type WithdrawVacationResponse,
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

export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH });

/** The browser's IANA timezone: a new account is created with it. */
function detectedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Starts Google sign-in; the browser leaves the app and comes back to `/`. */
export function signInWithGoogle(): Promise<unknown> {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: AUTH_ERROR_PATH,
    additionalData: { [TIMEZONE_SIGN_IN_KEY]: detectedTimezone() },
  });
}

/**
 * Starts Google sign-in from an invite page. The token rides through Google's
 * redirect so a new account can be created; the browser comes back to the
 * invite page either way (with ?error=<code> when sign-in fails) to accept.
 */
export function signInWithInvite(token: string): Promise<unknown> {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: APP_PATHS.invite(token),
    errorCallbackURL: APP_PATHS.invite(token),
    additionalData: { [INVITE_TOKEN_SIGN_IN_KEY]: token, [TIMEZONE_SIGN_IN_KEY]: detectedTimezone() },
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

/**
 * What a `text-too-long` refusal says. The text fields' `maxLength` keeps
 * text within the core's caps, so only an older page or a paste around it
 * gets here.
 */
export const TEXT_TOO_LONG_TEXT = "That's too long. Shorten it and try again.";

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
  checkOura: () => post<CheckOuraResponse>(API_PATHS.ouraCheck),
  disconnectOura: () => post<DisconnectOuraResponse>(API_PATHS.ouraDisconnect),
  connectAnki: (login: ConnectAnkiRequest) => post<ConnectAnkiResponse>(API_PATHS.ankiConnect, login),
  ankiDecks: () => call<AnkiDecksResponse>(API_PATHS.ankiDecks),
  checkAnki: () => post<CheckAnkiResponse>(API_PATHS.ankiCheck),
  disconnectAnki: () => post<DisconnectAnkiResponse>(API_PATHS.ankiDisconnect),
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
  changePreview: (pactId: string, change: ChangePactRequest) =>
    post<ChangePreviewResponse>(API_PATHS.changePreview(encodeURIComponent(pactId)), change),
  changePact: (pactId: string, change: ChangePactRequest) =>
    post<ChangePactResponse>(API_PATHS.changePact(encodeURIComponent(pactId)), change),
  endPact: (pactId: string, request: EndPactRequest) =>
    post<EndPactResponse>(API_PATHS.endPact(encodeURIComponent(pactId)), request),
  changeRequest: (changeRequestId: string) =>
    call<ChangeRequestResponse>(API_PATHS.changeRequest(encodeURIComponent(changeRequestId))),
  withdrawChangeRequest: (changeRequestId: string) =>
    post<WithdrawChangeRequestResponse>(API_PATHS.withdrawChangeRequest(encodeURIComponent(changeRequestId))),
  /** `photos` are already shrunk (photos.ts), in the order taken. */
  submitEvidence: (pactId: string, photos: Blob[]) => {
    const form = new FormData();
    photos.forEach((photo, i) => form.append(EVIDENCE_PHOTO_FIELD, photo, `photo-${i + 1}.jpg`));
    return postForm<SubmitEvidenceResponse>(API_PATHS.evidence(encodeURIComponent(pactId)), form);
  },
  excusePreview: (pactId: string, { from, to }: ExcusePreviewQuery) =>
    call<ExcusePreviewResponse>(
      `${API_PATHS.excusePreview(encodeURIComponent(pactId))}?${new URLSearchParams({ from, to }).toString()}`,
    ),
  excuseOptions: (pactId: string) => call<ExcuseOptionsResponse>(API_PATHS.excuseOptions(encodeURIComponent(pactId))),
  /** `photos` are already shrunk (photos.ts), in the order added. */
  fileExcuse: (pactId: string, excuse: FileExcuseRequest, photos: Blob[]) => {
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
  vacationOptions: () => call<VacationOptionsResponse>(API_PATHS.vacationOptions),
  vacationPreview: (request: VacationPreviewRequest) =>
    post<VacationPreviewResponse>(API_PATHS.vacationPreview, request),
  fileVacation: (vacation: FileVacationRequest) => post<FileVacationResponse>(API_PATHS.vacations, vacation),
  vacations: () => call<VacationsResponse>(API_PATHS.vacations),
  lastVacation: () => call<LastVacationResponse>(API_PATHS.lastVacation),
  withdrawVacation: (vacationId: string) =>
    post<WithdrawVacationResponse>(API_PATHS.withdrawVacation(encodeURIComponent(vacationId))),
  acceptVacationRejection: (vacationId: string) =>
    post<AcceptVacationRejectionResponse>(API_PATHS.acceptVacationRejection(encodeURIComponent(vacationId))),
  acceptMiss: (pactId: string, occurrenceDate: string) =>
    post<AcceptMissResponse>(API_PATHS.acceptMiss(encodeURIComponent(pactId), encodeURIComponent(occurrenceDate))),
  reviewQueue: () => call<ReviewQueueResponse>(API_PATHS.reviewQueue),
  decide: (itemId: string, decision: DecideRequest) =>
    post<DecideResponse>(API_PATHS.decide(encodeURIComponent(itemId)), decision),
  waitingOnReply: () => call<WaitingOnReplyResponse>(API_PATHS.waitingOnReply),
  askOwner: (itemId: string, question: string) =>
    post<AskOwnerResponse>(API_PATHS.askOwner(encodeURIComponent(itemId)), { question } satisfies AskOwnerRequest),
  reply: (itemId: string, reply: string) =>
    post<ReplyResponse>(API_PATHS.reply(encodeURIComponent(itemId)), { reply } satisfies ReplyRequest),
  evidence: (evidenceId: string) => call<EvidenceResponse>(API_PATHS.evidenceItem(encodeURIComponent(evidenceId))),
  payment: (paymentId: string) => call<PaymentResponse>(API_PATHS.paymentItem(encodeURIComponent(paymentId))),
  ledgers: () => call<LedgersResponse>(API_PATHS.ledgers),
  ledger: (recipientId: string) => call<LedgerResponse>(API_PATHS.ledger(encodeURIComponent(recipientId))),
  /** `screenshot` is already shrunk (photos.ts). */
  recordPayment: (recipientId: string, payment: RecordPaymentRequest, screenshot: Blob) => {
    const form = new FormData();
    form.append(PAYMENT_AMOUNT_FIELD, String(payment.amountCents));
    if (payment.note !== undefined) form.append(PAYMENT_NOTE_FIELD, payment.note);
    form.append(EVIDENCE_PHOTO_FIELD, screenshot, "screenshot.jpg");
    return postForm<RecordPaymentResponse>(API_PATHS.payments(encodeURIComponent(recipientId)), form);
  },
  notifications: () => call<NotificationsResponse>(API_PATHS.notifications),
  setNotificationSetting: (request: SetNotificationSettingRequest) =>
    post<SetNotificationSettingResponse>(API_PATHS.notifications, request),
  savePushSubscription: (device: SavePushSubscriptionRequest) =>
    post<SavePushSubscriptionResponse>(API_PATHS.pushSubscriptions, device),
  removePushSubscription: (endpoint: string) =>
    call<RemovePushSubscriptionResponse>(API_PATHS.pushSubscriptions, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint } satisfies RemovePushSubscriptionRequest),
    }),
};
