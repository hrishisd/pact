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

/** A pact's first occurrence, as the create form's Check step names it. */
export interface FirstOccurrence {
  /** The occurrence's day in the owner's timezone, "YYYY-MM-DD". */
  date: string;
  /** Midnight at the end of that day, in the owner's timezone. */
  dueAt: Date;
}

export type FirstOccurrenceResult =
  { ok: true; firstOccurrence: FirstOccurrence } | { ok: false; reason: "no-days" | "no-timezone" };

/** A card in the Pacts tab. */
export interface PactSummary {
  id: string;
  name: string;
  schedule: Schedule;
  penaltyCents: number;
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
}

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
 * An item in a reviewer's Review Queue, oldest first. Items never expire.
 * Change requests, excuses and payments join as other kinds.
 */
export type ReviewItem =
  /** Photo evidence: the reviewer checks the photos against what counts. */
  {
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
  };

/** A reviewer's decision on a Review Queue item. */
export type ReviewDecision =
  | { kind: "approve" }
  /** `reason` tells the owner why; it can't be blank. */
  | { kind: "reject"; reason: string };

export type DecideRefusal =
  /** Not in this account's Review Queue: no such item, or not a reviewer of its pact. */
  | "item-not-found"
  /** A reviewer of the pact has already decided it; the first decision is final. */
  | "already-decided"
  | "blank-reason";

export type DecideResult = { ok: true } | { ok: false; reason: DecideRefusal };

export type SetTimezoneResult =
  /** `timezone` is the zone's canonical IANA name, as stored. */
  { ok: true; timezone: string } | { ok: false; reason: "invalid-timezone" };

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
   * `acceptMiss`), which changes nothing else.
   */
  {
    kind: "evidence-rejected";
    pactId: string;
    name: string;
    reviewerName: string;
    reason: string;
    /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
    occurrenceDate: string;
    penaltyCents: number;
    recipientName: string;
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
}

export interface TodayComingUpCard extends TodayPactCard {
  /** The first occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  opensOn: string;
}

/** Something of the owner's waiting for a reviewer's decision, newest first. */
export type TodayWaitingItem =
  /** Evidence still waiting, even once its occurrence is past due. */
  {
    kind: "evidence";
    /** The evidence's id. */
    id: string;
    pactId: string;
    name: string;
    /** The occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
    occurrenceDate: string;
    /** When the server received its last photo. */
    submittedAt: Date;
  };
export type TodayYesterdayEntry = never;

/** What the owner owes one recipient, across every pact naming it. */
export interface LedgerSummary {
  recipientId: string;
  name: string;
  /** The penalties added for Missed occurrences, less approved payments (none until payments arrive). */
  owedCents: number;
  /** Approved payments, lifetime. */
  paidCents: number;
}

/** A penalty on a ledger: what a Missed occurrence added. */
export interface LedgerPenalty {
  penaltyId: string;
  pactId: string;
  pactName: string;
  /** The Missed occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  occurrenceDate: string;
  amountCents: number;
  /** When it was added: when the occurrence was judged Missed. */
  addedAt: Date;
  /** When the occurrence was Missed because its latest evidence was rejected: who rejected it and why. */
  rejection?: EvidenceRejection;
}

/** One recipient's ledger: its summary and its penalties, newest first. */
export interface Ledger {
  summary: LedgerSummary;
  history: LedgerPenalty[];
}

export type LedgerResult = { ok: true; ledger: Ledger } | { ok: false; reason: "recipient-not-found" };

export interface Health {
  /** False when there has been no scheduler tick in the last 5 minutes. */
  ok: boolean;
  lastTick: Date | null;
}
