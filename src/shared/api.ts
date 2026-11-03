// The JSON API between the client and the server: paths and the shapes of
// request and response bodies. Domain shapes come from ./types.ts.

import type {
  AcceptExcuseRejectionResult,
  AcceptInviteResult,
  AcceptMissResult,
  AddRecipientResult,
  AskOwnerResult,
  EvidenceResult,
  PaymentResult,
  ReplyResult,
  ChangePactResult,
  ChangePreviewResult,
  ChangeRequestResult,
  PactChange,
  RequestEndResult,
  WithdrawChangeRequestResult,
  CreatePactResult,
  DeletePactResult,
  EditPactResult,
  ExcuseOptionsResult,
  ExcusePreviewResult,
  ExcuseResult,
  FileExcuseResult,
  DecideResult,
  FirstOccurrenceResult,
  Friend,
  Invite,
  InviteLookup,
  LedgerResult,
  LedgerSummary,
  NewPact,
  NewRecipient,
  NotificationSetting,
  NotificationSettingState,
  PactResult,
  PactSummary,
  Profile,
  PushDevice,
  Recipient,
  RecordPaymentResult,
  ReviewDecision,
  ReviewItem,
  SavePushSubscriptionResult,
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

/**
 * How connecting Oura went, on the new pact form's URL after Oura's callback:
 * `/pacts/new?oura=connected`, `cancelled` (the owner said no on Oura's page)
 * or `failed`.
 */
export const OURA_RESULT_PARAM = "oura";
export type OuraResult = "connected" | "cancelled" | "failed";

/** The client route of an invite link; the SPA renders it. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}

/** The token of the invite link `pathname` is (the inverse of `invitePath`), or null. */
export function inviteTokenFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)$/.exec(pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/** The app's own pages, for its navigation and for where a notification opens. */
export const APP_PATHS = {
  today: "/",
  pacts: "/pacts",
  newPact: "/pacts/new",
  review: "/review",
  ledgers: "/ledgers",
  pact: (pactId: string) => `/pacts/${encodeURIComponent(pactId)}`,
  editPact: (pactId: string) => `/pacts/${encodeURIComponent(pactId)}/edit`,
  /** Request change: the pact's terms, each with Change. */
  changePact: (pactId: string) => `/pacts/${encodeURIComponent(pactId)}/change`,
  changeRequest: (changeRequestId: string) => `/changes/${encodeURIComponent(changeRequestId)}`,
  ledger: (recipientId: string) => `/ledgers/${encodeURIComponent(recipientId)}`,
  excuse: (excuseId: string) => `/excuses/${encodeURIComponent(excuseId)}`,
  /** Evidence's page, for its owner: where a reviewer's question about it opens. */
  evidence: (evidenceId: string) => `/evidence/${encodeURIComponent(evidenceId)}`,
  /** A payment's page, for its owner: where a reviewer's question about it opens. */
  payment: (paymentId: string) => `/payments/${encodeURIComponent(paymentId)}`,
} as const;

/**
 * The JSON API's routes. Tokens and ids are URL-safe as made (base64url,
 * UUIDs), so they go into paths as they are; the server registers its routes
 * by calling these with ":param" placeholders.
 */
export const API_PATHS = {
  me: "/api/me",
  /** A browser visit, not JSON: redirects to Oura's authorize page. */
  ouraConnect: "/api/oura/connect",
  /** Where Oura sends the browser back; it redirects to the new pact form with OURA_RESULT_PARAM. */
  ouraCallback: "/api/oura/callback",
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
  /** `date` is the occurrence's day, "YYYY-MM-DD". */
  acceptMiss: <T extends string, D extends string>(pactId: T, date: D) =>
    `/api/pacts/${pactId}/occurrences/${date}/accept-miss` as const,
  /**
   * GET: a photo's bytes and type, not JSON. Evidence photos are for the
   * pact's owner and reviewers; a payment's screenshot for the owner and the
   * reviewers of any of their pacts with its recipient. Anyone else gets the
   * 404 an unknown photo does.
   */
  photo: <T extends string>(photoId: T) => `/api/photos/${photoId}` as const,
  /** POST: what sending a change to the pact would do (the Request change verdict). */
  changePreview: <T extends string>(pactId: T) => `/api/pacts/${pactId}/change/preview` as const,
  /** POST: change the pact after its edit window. */
  changePact: <T extends string>(pactId: T) => `/api/pacts/${pactId}/change` as const,
  /** POST: ask to end the pact. */
  endPact: <T extends string>(pactId: T) => `/api/pacts/${pactId}/end` as const,
  /** GET: a change request's page, for its owner. */
  changeRequest: <T extends string>(changeRequestId: T) => `/api/changes/${changeRequestId}` as const,
  /** POST (no body): withdraw a change request still waiting. */
  withdrawChangeRequest: <T extends string>(changeRequestId: T) => `/api/changes/${changeRequestId}/withdraw` as const,
  /** POST: file an excuse for the pact. */
  excuses: <T extends string>(pactId: T) => `/api/pacts/${pactId}/excuses` as const,
  /** GET, with `?from=YYYY-MM-DD&to=YYYY-MM-DD`: the days an excuse with those dates would cover. */
  excusePreview: <T extends string>(pactId: T) => `/api/pacts/${pactId}/excuses/preview` as const,
  /** GET: what File excuse from the pact page offers. */
  excuseOptions: <T extends string>(pactId: T) => `/api/pacts/${pactId}/excuses/options` as const,
  /** GET: the excuse page. */
  excuse: <T extends string>(excuseId: T) => `/api/excuses/${excuseId}` as const,
  /** POST (no body): Take the L on a rejected excuse. */
  acceptExcuseRejection: <T extends string>(excuseId: T) => `/api/excuses/${excuseId}/accept-rejection` as const,
  reviewQueue: "/api/review",
  /** GET: items the account may decide that are waiting on their owner's reply. */
  waitingOnReply: "/api/review/waiting-on-reply",
  decide: <T extends string>(itemId: T) => `/api/review/${itemId}/decision` as const,
  /** POST: a reviewer asks the owner about an item instead of deciding it. */
  askOwner: <T extends string>(itemId: T) => `/api/review/${itemId}/question` as const,
  /** POST: the owner replies to a reviewer's question about one of their items. */
  reply: <T extends string>(itemId: T) => `/api/review/${itemId}/reply` as const,
  /** GET: evidence's page, for its owner. */
  evidenceItem: <T extends string>(evidenceId: T) => `/api/evidence/${evidenceId}` as const,
  /** GET: a payment's page, for its owner. */
  paymentItem: <T extends string>(paymentId: T) => `/api/payments/${paymentId}` as const,
  ledgers: "/api/ledgers",
  ledger: <T extends string>(recipientId: T) => `/api/ledgers/${recipientId}` as const,
  payments: <T extends string>(recipientId: T) => `/api/ledgers/${recipientId}/payments` as const,
  notifications: "/api/notifications",
  pushSubscriptions: "/api/push-subscriptions",
} as const;

/**
 * The largest photo the server accepts. A shrunk photo is about 100–180 KB and
 * a phone's original 3–5 MB, so this catches a shrink that silently failed.
 */
export const MAX_PHOTO_BYTES = 1024 * 1024;

/** The multipart field each photo of some evidence, or a payment's screenshot, is sent in. */
export const EVIDENCE_PHOTO_FIELD = "photo";

/** The payment form's field for the amount paid, in US cents, as decimal digits (e.g. "1000" for $10). */
export const PAYMENT_AMOUNT_FIELD = "amountCents";

/** The payment form's optional note field. */
export const PAYMENT_NOTE_FIELD = "note";

/** The excuse form's fields: its dates, "YYYY-MM-DD", and its reason. Photos go in EVIDENCE_PHOTO_FIELD. */
export const EXCUSE_FROM_FIELD = "from";
export const EXCUSE_TO_FIELD = "to";
export const EXCUSE_REASON_FIELD = "reason";

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

/** PUT /api/pacts/:id: an edit in the pact's edit window. */
export type EditPactRequest = NewPact;
export type EditPactResponse = EditPactResult;

/** DELETE /api/pacts/:id (no body): a delete in the pact's edit window. */
export type DeletePactResponse = DeletePactResult;

/** POST /api/pacts/first-occurrence: the form's Check step, before the pact exists or its edit is saved. */
export interface FirstOccurrenceRequest {
  schedule: Schedule;
  /** Oura Ring only: the in-bed-by time, "HH:MM". */
  inBedBy?: string;
  /** The pact being edited: the rule then counts from when it was created. */
  editing?: string;
}
export type FirstOccurrenceResponse = Json<FirstOccurrenceResult>;

/**
 * POST /api/pacts/:id/change/preview and POST /api/pacts/:id/change: every
 * term, changed or not, and an optional note. A body of another shape is a
 * 400 "invalid-request"; the core's refusals are 200s.
 */
export type ChangePactRequest = PactChange;
export type ChangePreviewResponse = ChangePreviewResult;
export type ChangePactResponse = ChangePactResult;

/** POST /api/pacts/:id/end, with an optional note. */
export interface EndPactRequest {
  note?: string;
}
export type EndPactResponse = RequestEndResult;

/** GET /api/changes/:id: someone else's change request, or none, is a 200 refusal. */
export type ChangeRequestResponse = Json<ChangeRequestResult>;

/** POST /api/changes/:id/withdraw (no body). */
export type WithdrawChangeRequestResponse = WithdrawChangeRequestResult;

/** GET /api/pacts: the Pacts tab. */
export type PactsResponse = Json<PactSummary>[];

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
 * POST /api/pacts/:id/occurrences/:date/accept-miss (no body): the owner
 * accepts a Missed occurrence (Take the L). A date not shaped "YYYY-MM-DD"
 * is a 400 "invalid-request"; the core's refusals are 200s.
 */
export type AcceptMissResponse = AcceptMissResult;

/**
 * POST /api/pacts/:id/excuses: multipart form data with EXCUSE_FROM_FIELD,
 * EXCUSE_TO_FIELD and EXCUSE_REASON_FIELD, and one `photo` file per photo
 * (0–3). A missing or non-text field, a photo over MAX_PHOTO_BYTES or of a
 * type outside PHOTO_CONTENT_TYPES is a 400, as for evidence; the core's
 * refusals ("too-many-photos" and "invalid-dates" included) are 200s.
 */
export type FileExcuseResponse = FileExcuseResult;

/** GET /api/pacts/:id/excuses/preview?from=&to= (both required, else a 400). The core's refusals are 200s. */
export type ExcusePreviewResponse = Json<ExcusePreviewResult>;

/** GET /api/pacts/:id/excuses/options */
export type ExcuseOptionsResponse = Json<ExcuseOptionsResult>;

/** GET /api/excuses/:id: the excuse page. Someone else's excuse, or none, is a 200 refusal. */
export type ExcuseResponse = Json<ExcuseResult>;

/** POST /api/excuses/:id/accept-rejection (no body). */
export type AcceptExcuseRejectionResponse = AcceptExcuseRejectionResult;

/** GET /api/review: the signed-in account's Review Queue, oldest first. */
export type ReviewQueueResponse = Json<ReviewItem[]>;

/**
 * POST /api/review/:id/decision. A body of another shape is a 400
 * "invalid-request"; the core's refusals ("blank-reason" included) are 200s.
 */
export type DecideRequest = ReviewDecision;
export type DecideResponse = DecideResult;

/** GET /api/review/waiting-on-reply: in the Review Queue's order. */
export type WaitingOnReplyResponse = Json<ReviewItem[]>;

/**
 * POST /api/review/:id/question. A body without a string `question` is a 400
 * "invalid-request"; the core's refusals ("blank-question" included) are 200s.
 */
export interface AskOwnerRequest {
  question: string;
}
export type AskOwnerResponse = AskOwnerResult;

/** POST /api/review/:id/reply, as the item's owner. Shapes and refusals as for a question. */
export interface ReplyRequest {
  reply: string;
}
export type ReplyResponse = ReplyResult;

/** GET /api/evidence/:id: the evidence's page. Someone else's evidence, or none, is a 200 refusal. */
export type EvidenceResponse = Json<EvidenceResult>;

/** GET /api/payments/:id: the payment's page. Someone else's payment, or none, is a 200 refusal. */
export type PaymentResponse = Json<PaymentResult>;

/** GET /api/ledgers: the Ledgers tab, one per recipient, sorted by name. */
export type LedgersResponse = Json<LedgerSummary>[];

/** GET /api/ledgers/:recipientId: a ledger's page. Another account's recipient, or none, is a 200 refusal. */
export type LedgerResponse = Json<LedgerResult>;

/**
 * POST /api/ledgers/:recipientId/payments: multipart form data with the
 * amount in PAYMENT_AMOUNT_FIELD, an optional PAYMENT_NOTE_FIELD, and the
 * screenshot as one `photo` file. A screenshot over MAX_PHOTO_BYTES is a 400
 * "photo-too-large"; an amount that isn't a number, a field of the wrong
 * kind, more than one `photo`, or a type outside PHOTO_CONTENT_TYPES is a
 * 400 "invalid-request". The core's refusals, "no-screenshot" and
 * "invalid-amount" (say, a fraction of a cent) included, are 200s.
 */
export type RecordPaymentResponse = RecordPaymentResult;

/** GET /api/notifications: the account's settings, and the key a browser subscribes with. */
export interface NotificationsResponse {
  settings: NotificationSettingState[];
  vapidPublicKey: string;
}

/** POST /api/notifications: turns one setting on or off. Answers with all of them. */
export interface SetNotificationSettingRequest {
  setting: NotificationSetting;
  enabled: boolean;
}
export type SetNotificationSettingResponse = NotificationSettingState[];

/**
 * POST /api/push-subscriptions: this device gets this account's notifications.
 * A body of another shape is a 400 "invalid-request"; the core refuses an
 * endpoint or keys it doesn't accept with a 200.
 */
export type SavePushSubscriptionRequest = PushDevice;
export type SavePushSubscriptionResponse = SavePushSubscriptionResult;

/** DELETE /api/push-subscriptions: this device stops getting them. Answers 200 whether or not it was saved. */
export interface RemovePushSubscriptionRequest {
  endpoint: string;
}

/** GET /api/me: the signed-in account's profile. */
export type MeResponse = Json<Profile>;

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
  /** The commit this image was built from, or null when built without one (local dev, a manual `fly deploy`). */
  commit: string | null;
}

/** Body of every non-2xx /api response. */
export interface ApiErrorResponse {
  error: "unauthenticated" | "invalid-request" | "not-found" | "photo-too-large";
}
