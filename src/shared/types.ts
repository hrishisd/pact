// Types shared by the server and the client: the shapes of the Pact core's
// query results and command outcomes, as they cross the JSON API.

export type AccountId = string;

export type SignInResult =
  | { ok: true; accountId: AccountId }
  | { ok: false; reason: "invite-required" };

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
  | { ok: true; inviterName: string; expiresAt: Date }
  | { ok: false; reason: InviteUnusableReason };

export interface Friend {
  id: AccountId;
  name: string;
}

export type AcceptInviteResult =
  /** `friend` is the inviter. */
  | { ok: true; friend: Friend }
  | { ok: false; reason: InviteUnusableReason | "own-invite" | "already-friends" };

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
  | { ok: true; firstOccurrence: FirstOccurrence }
  | { ok: false; reason: "no-days" | "no-timezone" };

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

export type SetTimezoneResult =
  /** `timezone` is the zone's canonical IANA name, as stored. */
  | { ok: true; timezone: string }
  | { ok: false; reason: "invalid-timezone" };

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
 * Sections come in display order and an empty one is left out. The other
 * element types are `never` until the tickets that fill each part.
 */
export interface Today {
  /** False until the account has made a pact: a new account's Today says what to do first. */
  hasPacts: boolean;
  alerts: TodayAlert[];
  sections: TodaySection[];
  waiting: TodayWaitingItem[];
  yesterday: TodayYesterdayEntry[];
}

export type TodayAlert = never;
export type TodaySection =
  /** Pacts whose occurrence is open today, soonest due first. */
  | { kind: "to-do"; cards: TodayToDoCard[] }
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

export interface TodayComingUpCard extends TodayPactCard {
  /** The first occurrence's day, "YYYY-MM-DD" in the owner's timezone. */
  opensOn: string;
}
export type TodayWaitingItem = never;
export type TodayYesterdayEntry = never;

export interface Health {
  /** False when there has been no scheduler tick in the last 5 minutes. */
  ok: boolean;
  lastTick: Date | null;
}
