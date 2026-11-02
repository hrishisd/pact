// Types shared by the server and the client: the shapes of the Pact core's
// query results and command outcomes, as they cross the JSON API.

export type AccountId = string;

export type SignInResult = { ok: true; accountId: AccountId } | { ok: false; reason: "invite-required" };

export interface Invite {
  /** Unguessable; the invite link carries it. */
  token: string;
  /** 7 days after creation. */
  expiresAt: Date;
}

/** Why an invite can't be used: the invite page's clear message. */
export type InviteUnusableReason = "invite-not-found" | "invite-used" | "invite-expired";

/** The invite page's view of a token, read without an account. */
export type InviteLookup =
  { ok: true; inviterName: string; expiresAt: Date } | { ok: false; reason: InviteUnusableReason };

export interface Friend {
  id: AccountId;
  name: string;
}

export type AcceptInviteResult =
  /** `friend` is the inviter. */
  { ok: true; friend: Friend } | { ok: false; reason: InviteUnusableReason | "own-invite" | "already-friends" };

/** Who a pact's penalties are meant to go to: just a name, saved per owner. */
export interface Recipient {
  id: string;
  name: string;
}

export interface NewRecipient {
  name: string;
}

export type AddRecipientResult = { ok: true; recipient: Recipient } | { ok: false; reason: "blank-name" };

/** The days of the week, Monday first, matching the Mon–Sun week. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** A day of the week: "mon" … "sun". */
export type Weekday = (typeof WEEKDAYS)[number];

/** When a pact's occurrences fall due. Only Fixed days so far. */
export type Schedule =
  /** Each listed weekday, in the owner's timezone, is its own occurrence. Listed Monday first, no repeats. */
  { kind: "fixed-days"; days: Weekday[] };

/** How a pact's evidence is gathered. Picked at creation and never changes. */
export type EvidenceKind = "camera" | "oura";

export interface NewPact {
  evidenceKind: EvidenceKind;
  name: string;
  /** For Camera: what the photo will show. */
  description: string;
  schedule: Schedule;
  /** The Penalty per missed occurrence, in US cents: a positive whole number. */
  penaltyCents: number;
  /** One of the owner's saved recipients. */
  recipientId: string;
  /** One or more of the owner's friends. */
  reviewerIds: AccountId[];
}

export type CreatePactRefusal =
  /** Oura Ring pacts aren't available yet. */
  | "evidence-kind-unavailable"
  | "blank-name"
  | "blank-description"
  | "no-days"
  | "invalid-penalty"
  /** Not one of this owner's saved recipients. */
  | "unknown-recipient"
  | "no-reviewers"
  /** A reviewer isn't the owner's friend (the owner can't review their own pact). */
  | "not-a-friend"
  /** Days are counted in the owner's timezone, so one must be confirmed first. */
  | "no-timezone";

export type CreatePactResult = { ok: true; pactId: string } | { ok: false; reason: CreatePactRefusal };

export type EditPactRefusal =
  | CreatePactRefusal
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** Past the first 10 minutes. */
  | "edit-window-closed"
  /** A pact's evidence kind never changes, not even in its edit window. */
  | "evidence-kind-fixed";

export type EditPactResult = { ok: true } | { ok: false; reason: EditPactRefusal };

export type DeletePactResult = { ok: true } | { ok: false; reason: "pact-not-found" | "edit-window-closed" };

/** A pact's first occurrence, as the create form's Check step names it. */
export interface FirstOccurrence {
  /** The occurrence's day in the owner's timezone, "YYYY-MM-DD". */
  date: string;
  /** Midnight at the end of that day, in the owner's timezone. */
  dueAt: Date;
}

export type FirstOccurrenceResult =
  { ok: true; firstOccurrence: FirstOccurrence } | { ok: false; reason: "no-days" | "no-timezone" | "pact-not-found" };

/** A card in the Pacts tab. */
export interface PactSummary {
  id: string;
  name: string;
  schedule: Schedule;
  penaltyCents: number;
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
}

/** The pact page: the pact's terms. */
export interface PactTerms {
  id: string;
  name: string;
  description: string;
  evidenceKind: EvidenceKind;
  schedule: Schedule;
  penaltyCents: number;
  recipient: Recipient;
  /** Sorted by name. */
  reviewers: { id: AccountId; name: string }[];
  /** Ended comes with end dates and change requests. */
  stage: "active";
  firstOccurrence: FirstOccurrence;
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The pact's evidence and excuses waiting for a reviewer's decision, newest first. */
  waiting: PactWaitingItem[];
}

/** What the pact page's "Waiting on" list holds: never payments, which belong to a recipient. */
export type PactWaitingItem = Extract<TodayWaitingItem, { kind: "evidence" | "excuse" }>;

export type PactResult = { ok: true; pact: PactTerms } | { ok: false; reason: "pact-not-found" };

/** The most photos one piece of evidence may have. */
export const MAX_EVIDENCE_PHOTOS = 10;

export type SubmitEvidenceRefusal =
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  | "no-photos"
  /** More than MAX_EVIDENCE_PHOTOS photos. */
  | "too-many-photos"
  /** No occurrence is open when the server receives the photos: a day the schedule skips, before the first occurrence, or past the due time. */
  | "not-open"
  /** Evidence for this occurrence is already waiting for a reviewer. */
  | "evidence-waiting"
  /** Evidence for this occurrence was already approved. */
  | "already-approved"
  /** This occurrence is already judged: its evidence was rejected, which is final. */
  | "already-judged";

export type SubmitEvidenceResult = { ok: true; evidenceId: string } | { ok: false; reason: SubmitEvidenceRefusal };

export type AcceptMissRefusal =
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** The occurrence isn't Missed (not judged yet, Kept, or not on the schedule), or the miss was already accepted. */
  | "nothing-to-accept";

export type AcceptMissResult = { ok: true } | { ok: false; reason: AcceptMissRefusal };

/**
 * An item in a reviewer's Review Queue, oldest first (by when evidence was
 * submitted or a payment recorded). Items never expire. Change requests and
 * excuses join as other kinds.
 */
export type ReviewItem =
  /** Photo evidence: the reviewer checks the photos against what counts. */
  | {
      kind: "evidence";
      /** The evidence's id. */
      id: string;
      pactId: string;
      pactName: string;
      ownerName: string;
      /** The pact's description of what counts. */
      description: string;
      /** In the order taken; each is served at the photo path. */
      photoIds: string[];
      /** When the server received its last photo. */
      submittedAt: Date;
      /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
      occurrenceDate: string;
      /** What rejecting costs the owner: the pact's penalty, added to the ledger for `recipientName`. */
      penaltyCents: number;
      recipientName: string;
    }
  /**
   * An excuse: the reviewer reads the reason and photos and decides all of
   * its days at once.
   */
  | {
      kind: "excuse";
      /** The excuse's id. */
      id: string;
      pactId: string;
      pactName: string;
      ownerName: string;
      reason: string;
      /** In the order added; each is served at the photo path. */
      photoIds: string[];
      filedAt: Date;
      /** The days it covers, oldest first, as they stand now. */
      days: ExcuseDay[];
      /** The penalties held while it waits: approving removes them, rejecting makes them owed. */
      heldCents: number;
      recipientName: string;
    }
  /**
   * A payment the owner recorded: the reviewer checks the screenshot. Any
   * reviewer of any of the owner's pacts with the recipient may decide it.
   */
  | {
      kind: "payment";
      /** The payment's id. */
      id: string;
      ownerName: string;
      recipientName: string;
      amountCents: number;
      /** The owner's note, or null when there's none. */
      note: string | null;
      /** The screenshot, served at the photo path. */
      photoId: string;
      recordedAt: Date;
      /** What the owner owes the recipient now. Approving lowers it by `amountCents`. */
      owedCents: number;
      /** What the owner would owe the recipient once this payment is approved, never below zero. */
      owedAfterApprovalCents: number;
    };

/** A reviewer's decision on a Review Queue item. */
export type ReviewDecision =
  | { kind: "approve" }
  /** `reason` tells the owner why; it can't be blank. */
  | { kind: "reject"; reason: string };

export type DecideRefusal =
  /** Not in this account's Review Queue: no such item, or not one this account may decide. */
  | "item-not-found"
  /** A reviewer of the pact has already decided it; the first decision is final. */
  | "already-decided"
  | "blank-reason";

export type DecideResult = { ok: true } | { ok: false; reason: DecideRefusal };

export type SetTimezoneResult =
  /** `timezone` is the zone's canonical IANA name, as stored. */
  { ok: true; timezone: string } | { ok: false; reason: "invalid-timezone" };

/**
 * The kinds of notification an account can turn off, on all its devices. Every
 * kind starts on. Later tickets add theirs (story 88).
 */
export const NOTIFICATION_SETTINGS = ["picked-as-reviewer", "review-item", "decision", "missed-occurrence"] as const;
export type NotificationSetting = (typeof NOTIFICATION_SETTINGS)[number];

export interface NotificationSettingState {
  setting: NotificationSetting;
  enabled: boolean;
}

/** One device's push subscription, as the browser reports it. Keys are base64url. */
export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SavePushSubscriptionResult = { ok: true } | { ok: false; reason: "invalid-subscription" };

export interface Profile {
  email: string;
  name: string;
  /** IANA zone, e.g. "America/New_York". Null until the user confirms one. */
  timezone: string | null;
}

/**
 * The Today query, in display order: alerts, then cards in their sections,
 * then Waiting for approval, then Yesterday. When alerts and sections are all
 * empty, the UI shows the "Nothing to do right now" card.
 *
 * Sections come in display order and an empty one is left out. Yesterday is
 * `never` until the ticket that fills it.
 */
export interface Today {
  /** False until the account has made a pact: a new account's Today says what to do first. */
  hasPacts: boolean;
  alerts: TodayAlert[];
  sections: TodaySection[];
  waiting: TodayWaitingItem[];
  yesterday: TodayYesterdayEntry[];
}

/** Something that needs the owner, shown first. */
export type TodayAlert =
  /**
   * A reviewer rejected the evidence for an occurrence, which judged it
   * Missed and added `penaltyCents` to the ledger for `recipientName`. Newest
   * rejection first. It stays until the owner accepts the miss (Take the L,
   * `acceptMiss`), which changes nothing else, or files an excuse for the day.
   */
  | {
      kind: "evidence-rejected";
      pactId: string;
      name: string;
      reviewerName: string;
      reason: string;
      /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
      occurrenceDate: string;
      penaltyCents: number;
      recipientName: string;
      /** Until when an excuse for the day is accepted: 48 hours after the rejection. */
      excusableUntil: Date;
    }
  /**
   * A reviewer rejected an excuse: its held penalties are owed again, and its
   * days not judged yet are judged as usual. Newest rejection first. It stays
   * until the owner takes the L (`acceptExcuseRejection`) or files a new
   * excuse for any of its days.
   */
  | {
      kind: "excuse-rejected";
      excuseId: string;
      pactId: string;
      name: string;
      reviewerName: string;
      reason: string;
      /** The first and last days it covered, "YYYY-MM-DD"; the same day for one. */
      firstDate: string;
      lastDate: string;
      /** The penalties it held, owed again now. */
      owedAgainCents: number;
      /** Whether any of its days isn't judged yet. */
      hasDaysNotJudged: boolean;
      /**
       * Whether a new excuse would cover any of its days, and when the first
       * of those windows closes: null when the days left are not judged yet,
       * whose window hasn't started.
       */
      refile: { closesAt: Date | null } | null;
    };
export type TodaySection =
  /** Pacts whose occurrence is open today, soonest due first. */
  | { kind: "to-do"; cards: TodayToDoCard[] }
  /**
   * Occurrences judged Missed in the last 48 hours, latest first, except
   * those Missed through a rejection (alerts) and accepted misses.
   */
  | { kind: "missed"; cards: TodayMissedCard[] }
  /** Pacts whose first occurrence hasn't opened yet, soonest first. */
  | { kind: "coming-up"; cards: TodayComingUpCard[] };

/** What every Today card shows of its pact. */
interface TodayPactCard {
  pactId: string;
  name: string;
  penaltyCents: number;
}

/** A Fixed-days pact whose occurrence is open today. */
export interface TodayToDoCard extends TodayPactCard {
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The open occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  occurrenceDate: string;
  /** Midnight ending today, in the owner's timezone. */
  dueAt: Date;
}

/** Who rejected some evidence, and why. */
export interface EvidenceRejection {
  reviewerName: string;
  reason: string;
}

/** An occurrence judged Missed at its due time; `penaltyCents` is the penalty it added. */
export interface TodayMissedCard extends TodayPactCard {
  /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  occurrenceDate: string;
  /** When it was judged Missed. */
  missedAt: Date;
  /** Until when an excuse for it is accepted: 48 hours after it was judged Missed. */
  excusableUntil: Date;
}

export interface TodayComingUpCard extends TodayPactCard {
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The first occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  opensOn: string;
}

/** Something of the owner's waiting for a reviewer's decision, newest first. */
export type TodayWaitingItem =
  /** Evidence still waiting, even once its occurrence is past due. */
  | {
      kind: "evidence";
      /** The evidence's id. */
      id: string;
      pactId: string;
      name: string;
      /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
      occurrenceDate: string;
      /** When the server received its last photo. */
      submittedAt: Date;
    }
  /** An excuse no reviewer has decided yet. */
  | {
      kind: "excuse";
      /** The excuse's id. */
      id: string;
      pactId: string;
      name: string;
      /** The first and last days it covers, "YYYY-MM-DD"; the same day for one. */
      firstDate: string;
      lastDate: string;
      filedAt: Date;
    }
  /** A payment no reviewer has decided yet. */
  | {
      kind: "payment";
      /** The payment's id. */
      id: string;
      recipientId: string;
      recipientName: string;
      amountCents: number;
      recordedAt: Date;
    };
export type TodayYesterdayEntry = never;

/** What the owner owes one recipient, across every pact naming it. */
export interface LedgerSummary {
  recipientId: string;
  name: string;
  /** The penalties added for Missed occurrences, less those held by an excuse waiting for approval, less approved payments. */
  owedCents: number;
  /**
   * The most a new payment may be: `owedCents` less `awaitingCents`, never
   * below zero. Nothing more can be recorded while it's zero.
   */
  payableCents: number;
  /** Payments no reviewer has decided yet. They don't reduce `owedCents` until approved. */
  awaitingCents: number;
  /** How many payments make up `awaitingCents`. */
  awaitingCount: number;
  /** Approved payments, lifetime. */
  paidCents: number;
}

/** A payment the owner made to a recipient outside the app, to record with its screenshot. */
export interface NewPayment {
  /** One of the owner's recipients. */
  recipientId: string;
  /** In US cents: a positive whole number. */
  amountCents: number;
  /** Optional; trimmed, and a blank note is none. */
  note?: string;
}

export type RecordPaymentRefusal =
  /** Not one of this owner's recipients, or none. */
  | "recipient-not-found"
  /** Not a positive whole number of cents. */
  | "invalid-amount"
  /** A payment needs one screenshot of it. */
  | "no-screenshot"
  /** More than what's owed less payments awaiting approval: the ledger would go below zero. */
  | "payment-exceeds-owed";

export type RecordPaymentResult = { ok: true; paymentId: string } | { ok: false; reason: RecordPaymentRefusal };

/** An entry in a ledger's history: a penalty or a payment. */
export type LedgerEntry = LedgerPenalty | LedgerPayment;

/** A penalty on a ledger: what a Missed occurrence added. */
export interface LedgerPenalty {
  kind: "penalty";
  penaltyId: string;
  pactId: string;
  pactName: string;
  /** The Missed occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  occurrenceDate: string;
  amountCents: number;
  /** When it was added: when the occurrence was judged Missed. */
  addedAt: Date;
  /**
   * How much of it approved payments have paid: none, part or all of
   * `amountCents`. Approved payments to the recipient pay off its penalties
   * oldest first, in the reverse of the history's order.
   */
  paidCents: number;
  /** When the occurrence was Missed because its latest evidence was rejected: who rejected it and why. */
  rejection?: EvidenceRejection;
  /** Held while an excuse for the occurrence waits for approval: it doesn't count toward owed, and payments don't pay it. */
  held: boolean;
}

/** A payment to the recipient the owner recorded, and where its review stands. */
export interface LedgerPayment {
  kind: "payment";
  paymentId: string;
  amountCents: number;
  /** The owner's note, or null when there's none. */
  note: string | null;
  recordedAt: Date;
  state: LedgerPaymentState;
}

/**
 * Where a payment's review stands. Only an approved payment pays off
 * penalties. A rejected one says who rejected it and why: that's how the
 * owner learns of it.
 */
export type LedgerPaymentState =
  | { kind: "awaiting-approval" }
  | { kind: "approved"; reviewerName: string; decidedAt: Date }
  | { kind: "rejected"; reviewerName: string; decidedAt: Date; reason: string };

/** One recipient's ledger: its summary and its history, newest first. */
export interface Ledger {
  summary: LedgerSummary;
  history: LedgerEntry[];
}

export type LedgerResult = { ok: true; ledger: Ledger } | { ok: false; reason: "recipient-not-found" };

/** The most photos one excuse may have. */
export const MAX_EXCUSE_PHOTOS = 3;

/** The longest date range one excuse may span, in days. */
export const MAX_EXCUSE_SPAN_DAYS = 62;

/** The dates an owner picks for an excuse for one pact. */
export interface ExcuseDates {
  /** "YYYY-MM-DD" in the owner's timezone, both included. */
  from: string;
  to: string;
}

export interface NewExcuse extends ExcuseDates {
  /** Why: trimmed, and it can't be blank. */
  reason: string;
}

/**
 * Where one of a pact's occurrences stands. `excuse` says whether an excuse
 * waiting for approval, or an approved one, covers a day not judged yet.
 */
export type OccurrenceStatus =
  | { kind: "kept" }
  | { kind: "excused" }
  | {
      kind: "missed";
      /** Its penalty. */
      penaltyCents: number;
      /** Held while an excuse for it waits for approval. */
      held: boolean;
      /** Until when an excuse for it is accepted: 48 hours after it was judged Missed. */
      excusableUntil: Date;
    }
  | {
      kind: "not-judged";
      opensAt: Date;
      dueAt: Date;
      /** Its evidence is waiting for a reviewer. */
      evidenceWaiting: boolean;
      excuse: "waiting" | "approved" | null;
    };

/** One of a pact's days on an excuse, and where it stands. */
export interface ExcuseDay {
  /** "YYYY-MM-DD" in the owner's timezone. */
  date: string;
  status: OccurrenceStatus;
}

/**
 * Why a day in an excuse's dates can't be excused now: Kept, already Excused
 * (or approved ahead), already on an excuse waiting for approval, or Missed
 * more than 48 hours ago.
 */
export type ExcuseSkipReason = "kept" | "excused" | "on-waiting-excuse" | "window-closed";

/** The days an excuse with some dates would cover, and those it would skip. */
export interface ExcusePreview {
  /** Oldest first, as they stand before filing. */
  covered: ExcuseDay[];
  /** Oldest first. */
  skipped: { date: string; reason: ExcuseSkipReason }[];
  /** The penalties filing would hold: those of the covered Missed days. */
  heldCents: number;
}

export type ExcuseDatesRefusal =
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** Excuses open once the edit window closes. */
  | "edit-window-open"
  /** Not "YYYY-MM-DD", or `to` before `from`. */
  | "invalid-dates"
  /** More than MAX_EXCUSE_SPAN_DAYS days. */
  | "too-many-days";

export type ExcusePreviewResult = { ok: true; preview: ExcusePreview } | { ok: false; reason: ExcuseDatesRefusal };

/** What the File excuse sheet opened from a pact page offers. */
export interface ExcuseOptions {
  /** The owner's today, "YYYY-MM-DD": the Days ahead range starts here. */
  today: string;
  /** Days dated today or earlier that an excuse would cover now, newest first. */
  recentDays: ExcuseDay[];
}

export type ExcuseOptionsResult =
  { ok: true; options: ExcuseOptions } | { ok: false; reason: "pact-not-found" | "edit-window-open" };

export type FileExcuseRefusal =
  | ExcuseDatesRefusal
  | "blank-reason"
  /** More than MAX_EXCUSE_PHOTOS photos. */
  | "too-many-photos"
  /** None of the pact's days in the dates can be excused now. */
  | "nothing-to-excuse";

export type FileExcuseResult = { ok: true; excuseId: string } | { ok: false; reason: FileExcuseRefusal };

/** Where an excuse's review stands. */
export type ExcuseState =
  | { kind: "waiting" }
  | { kind: "approved"; reviewerName: string; decidedAt: Date }
  | { kind: "rejected"; reviewerName: string; decidedAt: Date; reason: string };

/** The excuse page. */
export interface ExcuseDetail {
  id: string;
  pactId: string;
  pactName: string;
  reason: string;
  photoIds: string[];
  filedAt: Date;
  /** Oldest first, as they stand now. */
  days: ExcuseDay[];
  state: ExcuseState;
  /** The pact's reviewers, sorted by name: who it was sent to. */
  reviewerNames: string[];
}

export type ExcuseResult = { ok: true; excuse: ExcuseDetail } | { ok: false; reason: "excuse-not-found" };

export type AcceptExcuseRejectionResult =
  { ok: true } | { ok: false; reason: "excuse-not-found" | "nothing-to-accept" };

export interface Health {
  /** False when there has been no scheduler tick in the last 5 minutes. */
  ok: boolean;
  lastTick: Date | null;
}
