// Types shared by the server and the client: the shapes of the Pact core's
// query results and command outcomes, as they cross the JSON API.

export type AccountId = string;

/** "YYYY-MM-DD": a calendar day in some timezone, which the field's own doc names. */
export type LocalDate = string;

/** "HH:MM" on a 24-hour clock, "00:00" to "23:59". */
export type ClockTime = string;

/** A One-time pact's reminder: a day and a clock time, "YYYY-MM-DDTHH:MM". */
export type DatedReminder = string;

/** Why a command or query answered `{ ok: false }`: the `reason` of result type `R`. */
export type Refusal<R extends { ok: boolean }> = Extract<R, { ok: false; reason: unknown }>["reason"];

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

/** The most characters, once trimmed, a pact's or a recipient's name may have. */
export const MAX_NAME_CHARS = 80;

/**
 * The most characters, once trimmed, any other free text may have: a pact's
 * description, a note, a reason, a question or a reply.
 */
export const MAX_TEXT_CHARS = 2000;

/** Text over its cap (`MAX_NAME_CHARS` or `MAX_TEXT_CHARS`). */
export type TextTooLong = "text-too-long";

export type AddRecipientResult = { ok: true; recipient: Recipient } | { ok: false; reason: "blank-name" | TextTooLong };

/** The days of the week, Monday first, matching the Mon–Sun week. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** A day of the week: "mon" … "sun". */
export type Weekday = (typeof WEEKDAYS)[number];

/** When a pact's occurrences fall due. */
export type Schedule =
  /** Each listed weekday, in the owner's timezone, is its own occurrence. Listed Monday first, no repeats. */
  | { kind: "fixed-days"; days: Weekday[] }
  /**
   * Camera only: each Mon–Sun week is one occurrence, Satisfied once `target` days
   * of it have approved evidence (at most one counts per day): a whole number
   * from 1 to `MAX_WEEKLY_TARGET`.
   */
  | { kind: "weekly-count"; target: number }
  /**
   * Camera only: one occurrence, due at the deadline: `deadline`, a day in
   * the owner's timezone, at the pact's due-by time, or else the midnight
   * ending it. With `submitAnytime` off, evidence counts only on that day;
   * on, from the pact's creation until the deadline.
   */
  | { kind: "one-time"; deadline: LocalDate; submitAnytime: boolean };

/** A Weekly count target can't be more than one day of evidence a day. */
export const MAX_WEEKLY_TARGET = 7;

/** How a pact's evidence is gathered. Picked at creation and never changes. */
export const EVIDENCE_KINDS = ["camera", "oura", "anki"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** A service that supplies evidence: every evidence kind but Camera. */
export type ConnectionService = Exclude<EvidenceKind, "camera">;

export interface NewPact {
  evidenceKind: EvidenceKind;
  name: string;
  /** For Camera: what the photo will show. Oura Ring pacts have none. */
  description: string;
  /**
   * Oura Ring only: the in-bed-by time. An evening time (from 18:00) is due
   * that evening; an earlier one, the morning after.
   */
  inBedBy?: ClockTime;
  /**
   * Camera and Anki, optional: the due-by time, after 00:00. Evidence is due
   * by it each day instead of midnight, and the day is judged then. On an
   * Anki pact it runs from noon through the collection's rollover hour: a
   * time up to the rollover hour is the morning after, still the evening's
   * Anki day, and a later one, from noon, is that day once its Anki day has
   * opened.
   */
  dueBy?: ClockTime;
  /**
   * Anki only: the deck's id, from the owner's deck list (`AnkiDecksResult`).
   * Its subdecks count in it. On a change: left out to keep the deck it has;
   * changing it always needs approval.
   */
  ankiDeckId?: string;
  /**
   * Optional: the pact starts no earlier than this day. It can only push the
   * first occurrence later. Recurring pacts only: One-time has none. On a
   * change: it can change only before the first occurrence opens.
   */
  startDate?: LocalDate;
  /**
   * Optional: the pact's last day. Once it passes, the pact makes no more
   * occurrences and is Ended. Recurring pacts only: One-time has none.
   */
  endDate?: LocalDate;
  /**
   * Optional: when to remind the owner, in their timezone, each a clock time,
   * or on a One-time pact a dated reminder. See `PactTerms.reminders`. On a
   * change: they apply at once, even while a change request waits.
   */
  reminders?: (ClockTime | DatedReminder)[];
  schedule: Schedule;
  /** The Penalty per missed occurrence, in US cents: a positive whole number. */
  penaltyCents: number;
  /** One of the owner's saved recipients. */
  recipientId: string;
  /** One or more of the owner's friends. */
  reviewerIds: AccountId[];
}

export type CreatePactRefusal =
  /** An Oura Ring pact needs the owner's Oura connection first. */
  | "oura-not-connected"
  /** An Anki pact needs the owner's AnkiWeb connection first. */
  | "anki-not-connected"
  /** An Anki pact's deck is missing, or isn't in the owner's deck list as AnkiWeb last gave it. */
  | "unknown-deck"
  /** An Oura Ring pact's in-bed-by time is missing or isn't "HH:MM". */
  | "invalid-in-bed-by"
  /**
   * A due-by time on an Oura Ring pact, at midnight, or not "HH:MM"; on an
   * Anki pact, one after the collection's rollover hour and before noon.
   */
  | "invalid-due-by"
  /** A start date that isn't "YYYY-MM-DD", or one on a One-time pact. */
  | "invalid-start-date"
  /** An end date that isn't "YYYY-MM-DD", or one on a One-time pact. */
  | "invalid-end-date"
  /** An end date before the first occurrence (or, for a change, before today): the pact would have no days left. */
  | "end-date-too-early"
  /** A reminder that isn't "HH:MM" (on One-time, "YYYY-MM-DDTHH:MM"), or more than `MAX_REMINDERS`. */
  | "invalid-reminders"
  /** A reminder at or after the due time (a bedtime's in-bed-by time), which would never go off. */
  | "reminder-after-due-time"
  | "blank-name"
  | "blank-description"
  | TextTooLong
  | "no-days"
  /**
   * A Weekly count or One-time on an Oura Ring or Anki pact, a target that isn't a
   * whole number from 1 to `MAX_WEEKLY_TARGET`, or a deadline that isn't "YYYY-MM-DD".
   */
  | "invalid-schedule"
  /** A One-time deadline less than an hour after the pact's creation (for a change, after it takes effect). */
  | "deadline-too-soon"
  | "invalid-penalty"
  /** Not one of this owner's saved recipients. */
  | "unknown-recipient"
  | "no-reviewers"
  /** A reviewer isn't the owner's friend (the owner can't review their own pact). */
  | "not-a-friend";

/** The most reminders a pact can have. */
export const MAX_REMINDERS = 5;

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

/** What a pact's occurrences follow from, as the create form has it so far. */
export interface PactTiming {
  schedule: Schedule;
  /** Anki pacts open and fall due on the Anki day, which starts at the collection's rollover hour. Default Camera. */
  evidenceKind?: EvidenceKind;
  /** Oura Ring only: see `NewPact.inBedBy`. */
  inBedBy?: ClockTime;
  /** Camera and Anki: see `NewPact.dueBy`. */
  dueBy?: ClockTime;
  /** See `NewPact.startDate`. */
  startDate?: LocalDate;
}

/** A pact's first occurrence, as the create form's Check step names it. */
export interface FirstOccurrence {
  /** The occurrence's day in the owner's timezone: for Weekly count, its week's Monday. */
  date: LocalDate;
  /**
   * Its due time: midnight at the end of that day, or the due-by or in-bed-by
   * time, in the owner's timezone; for Weekly count, the end of its Sunday.
   */
  dueAt: Date;
}

export type FirstOccurrenceResult =
  | { ok: true; firstOccurrence: FirstOccurrence }
  | { ok: false; reason: "no-days" | "deadline-too-soon" | "pact-not-found" };

/** A card in the Pacts tab. */
export interface PactSummary {
  id: string;
  name: string;
  schedule: Schedule;
  penaltyCents: number;
  /** Ended pacts come after every Active one. */
  stage: PactStage;
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
}

/** Active from creation; Ended once its end date passes, an approved change request ends it, or a One-time occurrence is judged. */
export type PactStage = "active" | "ended";

/**
 * The pact page: a pact's terms as its owner sees them. Ended, it says
 * when: when an approved change request ended it, when its end date passed
 * (once its last occurrence closed), or for One-time when its occurrence was
 * judged.
 */
export type PactTerms = CurrentTerms & PactPageTerms & ({ stage: "active" } | { stage: "ended"; endedAt: Date });

interface PactPageTerms {
  id: string;
  /**
   * When the owner is reminded, each a clock time in their timezone, in the order
   * they go off. On a Camera pact: that time on each scheduled day, before
   * the day's due time, while it has no evidence. On an Oura Ring pact: each
   * scheduled night (from 18:00 that evening, else the morning after), before
   * the in-bed-by time, even if the owner is already in bed. Neither fires on
   * an occurrence an approved excuse covers. On a One-time pact each is
   * dated and goes off once, before the deadline, unless evidence was
   * already submitted.
   */
  reminders: (ClockTime | DatedReminder)[];
  firstOccurrence: FirstOccurrence;
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /**
   * A change in force whose first occurrence hasn't opened yet: the terms
   * above are the new ones. `todayKeepsCents` is today's penalty when today
   * is an occurrence on the old terms with another penalty.
   */
  newTerms: ChangeStart | null;
  /** The pact's evidence, excuses and change request waiting for a reviewer's decision, newest first. */
  waiting: PactWaitingItem[];
  /** What its heat map shows. */
  history: PactHistory;
  /** An Active Oura Ring or Anki pact whose owner's Oura or AnkiWeb can't be read: the same alert as on Today. Else null. */
  connectionProblem: ConnectionProblem | null;
}

/**
 * A pact's terms as they stand, as its page and a change request show them.
 * Reminders aren't terms and are the owner's own, so reviewers never see them.
 */
export type CurrentTerms = TermsByKind & {
  name: string;
  /** For Camera: what the photo will show. Empty for the others. */
  description: string;
  /** Or null: see `NewPact.startDate`. */
  startDate: LocalDate | null;
  /** Or null: see `NewPact.endDate`. */
  endDate: LocalDate | null;
  penaltyCents: number;
  recipient: Recipient;
  /** Sorted by name. */
  reviewers: { id: AccountId; name: string }[];
};

/** The terms that depend on how the pact's evidence is gathered. */
export type TermsByKind =
  | {
      evidenceKind: "camera";
      schedule: Schedule;
      /** The due-by time, or null for midnight. */
      dueBy: ClockTime | null;
    }
  | {
      evidenceKind: "oura";
      schedule: FixedDays;
      /** The in-bed-by time. */
      inBedBy: ClockTime;
    }
  | {
      evidenceKind: "anki";
      schedule: FixedDays;
      /** The due-by time, or null for midnight. */
      dueBy: ClockTime | null;
      /** The pact's deck and the Anki day it's judged on. */
      anki: AnkiTerms;
    };

/** Oura Ring and Anki pacts have Fixed days schedules only. */
type FixedDays = Extract<Schedule, { kind: "fixed-days" }>;

/** Cards in a deck as Anki's deck list counts them, the deck's daily limits applied and its subdecks included. */
export interface AnkiCounts {
  new: number;
  learn: number;
  /** Anki's Due column. */
  review: number;
}

/** One deck in the owner's Anki collection. */
export interface AnkiDeck {
  /** Anki's deck id, as text. */
  id: string;
  /** Its full name as Anki shows it, "Spanish::Verbs" for a subdeck. */
  name: string;
  /** The deck it's a subdeck of, or null at the top. */
  parentId: string | null;
  /** As of when the list was fetched. */
  counts: AnkiCounts;
}

/** The deck picker's list: every deck, parents before their subdecks, and when the Anki day starts. */
export type AnkiDecksResult =
  | { ok: true; decks: AnkiDeck[]; rolloverHour: number }
  /** Not connected, AnkiWeb refused the login, or AnkiWeb couldn't be reached. */
  | { ok: false; reason: "not-connected" | "disconnected" | "unreachable" };

/** An Anki pact's deck, and when its Anki day starts. */
export interface AnkiTerms {
  deckId: string;
  /** The deck's name as AnkiWeb last gave it ("Spanish::Verbs" for a subdeck), or null if Pact never had it. */
  deckName: string | null;
  /** Whether the last check found the deck gone from the collection: its days count as Missed until it's back. */
  deckMissing: boolean;
  /** The collection's "next day starts at" hour, 0–23, when the pact was made: each Anki day starts then. */
  rolloverHour: number;
}

/**
 * A pact's heat map: one square per occurrence period. Fixed days has one
 * per day; Weekly count, one per Mon–Sun week with the days that counted.
 */
export type PactHistory =
  | {
      kind: "fixed-days";
      /**
       * Every day from the first occurrence through the Sunday ending this week
       * (or the week the pact Ended, or the first occurrence's week while it's
       * coming up), oldest first.
       */
      days: HeatMapDay[];
    }
  | {
      kind: "weekly-count";
      /** Every week from the first occurrence through this week (or the week it Ended, or the first while it's coming up), oldest first. */
      weeks: HeatMapWeek[];
    }
  | {
      kind: "one-time";
      /** Its one occurrence, dated by the deadline's date. */
      day: HeatMapDay;
    };

/** One week on a Weekly count pact's heat map. */
export interface HeatMapWeek {
  /** Its Monday, in the owner's timezone. */
  date: LocalDate;
  /** How its occurrence went, or null for a week from the one the pact Ended that was never judged. */
  occurrence: OccurrenceRecord | null;
  /** How far it got: see `WeekProgress`. */
  progress: WeekProgress;
}

/**
 * How far a Weekly count week has got: `sessions` days with approved evidence
 * (at most one counts per day), `waiting` more with evidence waiting for a
 * reviewer, toward the `target` its terms set.
 */
export interface WeekProgress {
  sessions: number;
  waiting: number;
  target: number;
}

/** One day on a heat map. */
export interface HeatMapDay {
  /** In the owner's timezone. */
  date: LocalDate;
  /**
   * How its occurrence went, or null on a day the pact has none: one its
   * schedule skips, or one from the day it Ended that was never judged.
   */
  occurrence: OccurrenceRecord | null;
}

/** How one occurrence went, as a heat map's tapped square and a Yesterday row tell it. */
export interface OccurrenceRecord {
  status: RecordedStatus;
  /**
   * Once judged Satisfied or Missed, on Oura Ring and Anki pacts: the night's
   * sleep, or the check that decided the Anki day. Null for anything else.
   */
  detail: OccurrenceDetail | null;
}

/**
 * Where an occurrence stands, with the reviewer's decision that settled it:
 * approved evidence (Satisfied), rejected evidence (Missed), or an approved
 * excuse or vacation (Excused, or a day ahead it already covers). Each is null when no
 * one decision settled it, such as a day Missed with no evidence or a Weekly
 * count week.
 */
export type RecordedStatus =
  | (Extract<OccurrenceStatus, { kind: "satisfied" }> & {
      /** Who approved its evidence. */
      approvedBy: string | null;
    })
  | (Extract<OccurrenceStatus, { kind: "missed" }> & {
      /** The recipient its penalty went to. */
      recipientName: string | null;
      rejection: EvidenceRejection | null;
    })
  | (Extract<OccurrenceStatus, { kind: "excused" | "not-judged" }> & {
      /** Who approved the excuse that covers it, and the excuse's reason. */
      excuseApproval: { reviewerName: string; reason: string } | null;
      /** The dates of the approved vacation that covers it, when one does; left out otherwise. */
      vacation?: { from: LocalDate; to: LocalDate };
    });

/** What an Oura Ring or Anki pact's judged occurrence adds to its record. */
export type OccurrenceDetail =
  /**
   * When the owner got into bed, on Oura's clock, or null when Oura
   * reported no sleep by 18:00 the next day.
   */
  | { kind: "night"; inBedAt: ClockTime | null }
  /** The check that decided the Anki day, or null when no check reached AnkiWeb that day. */
  | { kind: "anki"; lastCheck: AnkiCheck | null };

/** A check of an Anki pact's deck: cards left (new, learning and due together) and when Pact checked. */
export interface AnkiCheck {
  cardsLeft: number;
  checkedAt: Date;
}

/** What the pact page's "Waiting on" list holds: never payments, which belong to a recipient. */
export type PactWaitingItem = Extract<TodayWaitingItem, { kind: "evidence" | "excuse" | "change-request" }>;

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
  /** Evidence for this occurrence (on Weekly count, for today) is already waiting for a reviewer. */
  | "evidence-waiting"
  /** Evidence for this occurrence (on Weekly count, for today) was already approved. */
  | "already-approved"
  /**
   * This occurrence is already judged: its evidence was rejected, which is
   * final. On Weekly count, today's evidence was rejected: the week can be
   * made up on another day.
   */
  | "already-judged";

export type SubmitEvidenceResult = { ok: true; evidenceId: string } | { ok: false; reason: SubmitEvidenceRefusal };

export type AcceptMissRefusal =
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** The occurrence isn't Missed (not judged yet, Satisfied, or not on the schedule), or the miss was already accepted. */
  | "nothing-to-accept";

export type AcceptMissResult = { ok: true } | { ok: false; reason: AcceptMissRefusal };

/**
 * An item in a reviewer's Review Queue: change requests first, then the
 * rest oldest first (by when evidence was submitted, an excuse filed or a
 * payment recorded). Items never expire.
 */
export type ReviewItem =
  /** A change request: the reviewer compares the old terms with the new, or decides on ending the pact. */
  | ({ kind: "change-request"; ownerName: string; thread: QuestionThread } & ChangeRequestView)
  /** Photo evidence: the reviewer checks the photos against what counts. */
  | ({
      kind: "evidence";
      ownerName: string;
      /** What rejecting costs the owner: the pact's penalty, added to the ledger for `recipientName`. */
      penaltyCents: number;
      recipientName: string;
      /** Weekly count only: its week so far. Rejecting costs nothing then: the day just doesn't count. */
      week?: WeekProgress;
      thread: QuestionThread;
    } & EvidenceView)
  /**
   * An excuse: the reviewer reads the reason and photos and decides all of
   * its days at once.
   */
  | ({
      kind: "excuse";
      ownerName: string;
      /** The penalties held while it waits: approving removes them, rejecting makes them owed. */
      heldCents: number;
      recipientName: string;
      thread: QuestionThread;
    } & ExcuseView)
  /**
   * A payment the owner recorded: the reviewer checks the screenshot. Any
   * reviewer of any of the owner's pacts with the recipient may decide it.
   */
  | ({
      kind: "payment";
      ownerName: string;
      /** What the owner owes the recipient now. Approving lowers it by `amountCents`. */
      owedCents: number;
      /** What the owner would owe the recipient once this payment is approved, never below zero. */
      owedAfterApprovalCents: number;
      thread: QuestionThread;
    } & PaymentView)
  /**
   * A vacation: the reviewer decides all of it at once, for every pact it
   * covers. Only the reviewers the owner picked see it.
   */
  | {
      kind: "vacation";
      id: string;
      ownerName: string;
      from: LocalDate;
      to: LocalDate;
      days: number;
      note: string | null;
      pacts: VacationPacts;
      /** Who it was sent to, by name. Any one of them decides it. */
      reviewerNames: string[];
      /** Each ticked pact with something covered, in the order the owner's pacts were made. */
      covers: VacationCover[];
      /** The penalties it holds, left out when none: approving removes them, rejecting makes them owed. */
      heldCents?: number;
      filedAt: Date;
      thread: QuestionThread;
    };

/** Evidence, as its reviewers and its owner see it. */
export interface EvidenceView {
  /** The evidence's id. */
  id: string;
  pactId: string;
  pactName: string;
  /** The occurrence's day in the owner's timezone: on Weekly count, the day it counts for. */
  occurrenceDate: LocalDate;
  /** What counts, as the occurrence's terms say. */
  description: string;
  /** In the order taken; each is served at the photo path. */
  photoIds: string[];
  /** When the server received its last photo. */
  submittedAt: Date;
}

/** An excuse, as its reviewers and its owner see it. */
export interface ExcuseView {
  /** The excuse's id. */
  id: string;
  pactId: string;
  pactName: string;
  reason: string;
  /** In the order added; each is served at the photo path. */
  photoIds: string[];
  filedAt: Date;
  /** The days it covers, oldest first, as they stand now. */
  days: ExcuseDay[];
}

/** A payment, as its reviewers and its owner see it. */
export interface PaymentView {
  /** The payment's id. */
  id: string;
  recipientName: string;
  amountCents: number;
  /** The owner's note, or null when there's none. */
  note: string | null;
  /** The screenshot, served at the photo path. */
  photoId: string;
  recordedAt: Date;
}

/** What an item's page adds for its owner: where it stands, who may decide it, and its questions. */
export interface ReviewedItem {
  state: ReviewState;
  /** Who may decide it, sorted by name. */
  reviewerNames: string[];
  thread: QuestionThread;
}

/**
 * A review item's questions and replies, oldest first. A reviewer's question
 * leaves the item waiting on the owner's reply; the owner's reply sends it
 * back to every reviewer's Review Queue.
 */
export interface QuestionThread {
  comments: ThreadComment[];
  /**
   * The latest comment is a reviewer's question and the item is still waiting
   * for a decision: it's out of every reviewer's queue until the owner replies.
   */
  waitingOnReply: boolean;
}

/** A reviewer's question or the owner's reply. Text only. */
export interface ThreadComment {
  /** The owner's reply, rather than a reviewer's question. */
  fromOwner: boolean;
  authorName: string;
  text: string;
  sentAt: Date;
}

export type AskOwnerResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        /** Not an item this account may decide, or none. */
        "item-not-found" | "already-decided" | "blank-question" | TextTooLong;
    };

export type ReplyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        /** Not one of this owner's items, or none. */
        | "item-not-found"
        /** Decided already, or a change request withdrawn: there's nothing left to answer. */
        | "not-waiting"
        /** Its latest comment isn't a reviewer's question. */
        | "no-question"
        | "blank-reply"
        | TextTooLong;
    };

/** Where a review item of the owner's stands. */
export type ReviewState =
  | { kind: "waiting" }
  | { kind: "approved"; reviewerName: string; decidedAt: Date }
  | { kind: "rejected"; reviewerName: string; decidedAt: Date; reason: string };

/** Evidence's page, for its owner. Its reviewers are the pact's. */
export type EvidenceDetail = EvidenceView & ReviewedItem;

export type EvidenceResult = { ok: true; evidence: EvidenceDetail } | { ok: false; reason: "evidence-not-found" };

/** A payment's page, for its owner. Its reviewers are those of the owner's pacts with the recipient. */
export type PaymentDetail = PaymentView & ReviewedItem & { recipientId: string };

export type PaymentResult = { ok: true; payment: PaymentDetail } | { ok: false; reason: "payment-not-found" };

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
  | "blank-reason"
  | TextTooLong
  /** Approving a change to a One-time pact whose new deadline is less than an hour away: it can only be rejected. */
  | "deadline-too-soon";

export type DecideResult = { ok: true } | { ok: false; reason: DecideRefusal };

export type SetTimezoneResult =
  /** `timezone` is the zone's canonical IANA name, as stored. */
  { ok: true; timezone: string } | { ok: false; reason: "invalid-timezone" };

/**
 * The kinds of notification an account can turn off, on all its devices. Every
 * kind starts on. Later tickets add theirs (story 88).
 */
export const NOTIFICATION_SETTINGS = [
  "picked-as-reviewer",
  "review-item",
  "decision",
  "comment",
  "missed-occurrence",
  "new-bill",
  "overdue-bill",
  "connection-problem",
] as const;
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
  /** IANA zone, e.g. "America/New_York": the browser's at sign-up, until changed in Profile. */
  timezone: string;
  /** The connections the account has made, if any. */
  connections: Connection[];
}

/** A link to an outside service that supplies evidence: Oura or AnkiWeb. */
export interface Connection {
  service: ConnectionService;
  /** Needs reconnecting once the service refuses its tokens; until then, connected. */
  status: "connected" | "needs-reconnecting";
  connectedAt: Date;
  /** How many of the owner's Active pacts use it: disconnecting leaves their days to count as Missed. */
  activePacts: number;
}

/**
 * Why the owner's Oura (or AnkiWeb) can't be read while an Active pact needs
 * it: the service refused Pact's tokens or login (Needs reconnecting), or the
 * owner disconnected it.
 */
export type ConnectionProblem = "needs-reconnecting" | "not-connected";

/** What a broken connection costs and what to do, as its push and its alerts say after "… needs reconnecting." */
export const RECONNECT_TEXT: Record<ConnectionService, string> = {
  oura: "A night with no data by 6pm counts as Missed. Reconnect before then.",
  anki: "A day whose deck isn't finished by its due time counts as Missed. Reconnect before then.",
};

/**
 * The Today query, in display order: alerts, then cards in their sections,
 * then Waiting for approval, then Yesterday. When alerts and sections are all
 * empty, the UI shows the "Nothing to do right now" card.
 *
 * Sections come in display order and an empty one is left out. Yesterday
 * lists the pacts due yesterday, by name.
 */
export interface Today {
  /** False until the account has made a pact: a new account's Today says what to do first. */
  hasPacts: boolean;
  alerts: TodayAlert[];
  sections: TodaySection[];
  waiting: TodayWaitingItem[];
  yesterday: TodayYesterdayEntry[];
  /**
   * The owner's approved vacations on today's date, from their first to
   * their last day, each a banner after the alerts. The occurrences they
   * cover are in no section and not in Yesterday. Left out when there's none.
   */
  vacations?: TodayVacation[];
}

/** An approved vacation on now, as Today's banner shows it. */
export interface TodayVacation {
  id: string;
  from: LocalDate;
  /** Its last day: "On vacation until" it. */
  to: LocalDate;
  note: string | null;
  pacts: VacationPacts;
  /** Each pact with something covered, in the order the owner's pacts were made. */
  covers: VacationCover[];
}

/** Something that needs the owner, shown first. */
export type TodayAlert =
  /**
   * The owner has an Active pact judged from `service` but Pact can't read
   * it. On Oura, a night with no data by 18:00 the next day counts as Missed;
   * on AnkiWeb, a day whose deck isn't finished by its due time. First of all
   * alerts, Oura before AnkiWeb; it goes once the owner reconnects.
   */
  | { kind: "connection"; service: ConnectionService; status: ConnectionProblem }
  /**
   * A reviewer asked about one of the owner's items still waiting for a
   * decision, and the owner hasn't replied yet. One per item, with its latest
   * question. It goes once the owner replies, or the item is decided (or a
   * change request withdrawn).
   */
  | {
      kind: "reviewer-question";
      item: TodayWaitingItem;
      reviewerName: string;
      question: string;
      askedAt: Date;
    }
  /**
   * A reviewer rejected the evidence for an occurrence, which judged it
   * Missed and added `penaltyCents` to the ledger for `recipientName`. Newest
   * rejection first. It stays until the owner accepts the miss (Take the L,
   * `acceptMiss`), which changes nothing else, or files an excuse for the day.
   *
   * On Weekly count (`week`) the day just doesn't count: nothing is Missed
   * or owed yet, and the owner can make it up another day before the week is
   * due. The alert goes once the week is judged too.
   */
  | {
      kind: "evidence-rejected";
      pactId: string;
      name: string;
      reviewerName: string;
      reason: string;
      /** The occurrence's day in the owner's timezone: on Weekly count, the day it was for. */
      occurrenceDate: LocalDate;
      penaltyCents: number;
      recipientName: string;
      /**
       * Until when an excuse for the day is accepted: 48 hours after the
       * rejection. Null on Weekly count: the week isn't judged yet, so no 48
       * hours are running.
       */
      excusableUntil: Date | null;
      /** Whether it's a Weekly count day. */
      week: boolean;
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
      /** The first and last days it covered; the same day for one. */
      firstDate: LocalDate;
      lastDate: LocalDate;
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
    }
  /**
   * A picked reviewer rejected a vacation: its held penalties are owed
   * again, and its days not judged yet are judged as usual. Newest
   * rejection first. It stays until the owner takes the L
   * (`acceptVacationRejection`), or files a new vacation or an excuse
   * covering any of its days.
   */
  | {
      kind: "vacation-rejected";
      vacationId: string;
      reviewerName: string;
      reason: string;
      /** Its first and last day. */
      firstDate: LocalDate;
      lastDate: LocalDate;
      /** The penalties it held, owed again now. */
      owedAgainCents: number;
    }
  /**
   * Bills to one recipient are past their due time and not all paid, and
   * payments awaiting approval don't cover the rest. One per recipient. It
   * goes once paid, or once a payment awaiting approval covers it.
   */
  | {
      kind: "bill-overdue";
      recipientId: string;
      recipientName: string;
      /** The unpaid part of the overdue bills that payments awaiting approval don't cover. */
      overdueCents: number;
      /** The oldest overdue bill: the Wednesday it was made, and when it was due. */
      billedOn: LocalDate;
      dueAt: Date;
      /**
       * Who has been told: the reviewers of the owner's pacts with this
       * recipient, once the core has told them in this Overdue spell. Empty until then;
       * a reviewer with overdue notifications off is never told, so never listed.
       */
      reviewerNames: string[];
    };
export type TodaySection =
  /** Bedtime nights past their in-bed-by time that Oura hasn't reported yet, soonest cutoff first. */
  | { kind: "no-oura-data"; cards: TodayNoOuraDataCard[] }
  /** Pacts whose occurrence is open today, and bills to pay, soonest due first. */
  | { kind: "to-do"; cards: (TodayToDoCard | TodayAnkiCard | TodayBillCard)[] }
  /**
   * Occurrences judged Missed in the last 48 hours, latest first, except
   * those Missed through a rejection (alerts) and accepted misses.
   */
  | { kind: "missed"; cards: TodayMissedCard[] }
  /** Bedtime pacts whose night runs now, soonest deadline first. Nothing to do: Oura reports it. */
  | { kind: "automatic"; cards: TodayAutomaticCard[] }
  /** Pacts whose first occurrence hasn't opened yet, soonest first. */
  | { kind: "coming-up"; cards: TodayComingUpCard[] };

/** What every Today card shows of its pact. */
interface TodayPactCard {
  pactId: string;
  name: string;
  penaltyCents: number;
}

/**
 * A Camera pact whose occurrence is open today and still takes evidence
 * today. A Weekly count week (`week` set) shows while today has none and the
 * week's target isn't met or waiting for approval.
 */
export interface TodayToDoCard extends TodayPactCard {
  kind: "evidence";
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The open occurrence's day in the owner's timezone: for Weekly count, its week's Monday. */
  occurrenceDate: LocalDate;
  /**
   * Its due-by time today, or midnight ending today, in the owner's timezone;
   * for Weekly count, the end of its Sunday, so it sorts below things due today.
   */
  dueAt: Date;
  /** Its due-by time, or null when it's due at midnight. On Weekly count it limits each day's evidence. */
  dueBy: ClockTime | null;
  /** Weekly count only: the week so far. */
  week?: WeekProgress;
}

/**
 * An Anki pact's day open now, not judged yet and before its due time, with
 * no excuse filed for it. It leaves Today once Pact sees the deck finished.
 */
export interface TodayAnkiCard extends TodayPactCard {
  kind: "anki";
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The Anki day: the day it started on, in the owner's timezone. */
  occurrenceDate: LocalDate;
  dueAt: Date;
  /** Its due-by time, or null when it's due at midnight. */
  dueBy: ClockTime | null;
  /** The deck's name as AnkiWeb last gave it, or null if Pact never had it. */
  deckName: string | null;
  /** Whether the last check found the deck gone from the collection. */
  deckMissing: boolean;
  /** The latest check of the deck for this Anki day, or null before the first. */
  lastCheck: AnkiCheck | null;
}

/**
 * Bills to one recipient not due yet, with an unpaid part that payments
 * awaiting approval don't cover. One per recipient.
 */
export interface TodayBillCard {
  kind: "bill";
  recipientId: string;
  recipientName: string;
  /** What's left to pay on those bills, less payments awaiting approval. */
  amountCents: number;
  /** The soonest due of them, and the Wednesday it was made. */
  dueAt: Date;
  billedOn: LocalDate;
}

/** Who rejected some evidence, and why. */
export interface EvidenceRejection {
  reviewerName: string;
  reason: string;
}

/** An occurrence judged Missed at its due time; `penaltyCents` is the penalty it added. */
export interface TodayMissedCard extends TodayPactCard {
  /** The occurrence's day in the owner's timezone. */
  occurrenceDate: LocalDate;
  /** When it was judged Missed. */
  missedAt: Date;
  /** Until when an excuse for it is accepted: 48 hours after it was judged Missed. */
  excusableUntil: Date;
  /** What else its line says, or null for a plain Missed day. */
  detail: MissedDetail | null;
}

export type MissedDetail =
  | OccurrenceDetail
  /**
   * Today's occurrence of a Camera pact, Missed at its due-by time with no
   * evidence: it shows as Closed.
   */
  | { kind: "closed"; dueBy: ClockTime }
  /** Weekly count only: how far the week got. `penaltyCents` is one penalty per day short. */
  | { kind: "week"; progress: WeekProgress };

/**
 * A bedtime night past its in-bed-by time that Oura hasn't reported yet and
 * no excuse covers. Syncing the ring before `closesAt` still counts.
 */
export interface TodayNoOuraDataCard extends TodayPactCard {
  /** The night's day in the owner's timezone. */
  occurrenceDate: LocalDate;
  /** 18:00 the next day: with no sleep data by then, it's Missed. */
  closesAt: Date;
  /** Tonight's night of the same pact, which rides on this card instead of an Automatic one; null when there's none. */
  tonight: { occurrenceDate: LocalDate; dueAt: Date; inBedBy: ClockTime } | null;
}

/** A bedtime pact's night that runs now. */
export interface TodayAutomaticCard extends TodayPactCard {
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The night's day in the owner's timezone. */
  occurrenceDate: LocalDate;
  /** Tonight's in-bed-by deadline. */
  dueAt: Date;
  inBedBy: ClockTime;
}

export interface TodayComingUpCard extends TodayPactCard {
  /** When its edit window closes; null once it has. */
  editWindowClosesAt: Date | null;
  /** The first occurrence's day in the owner's timezone. */
  opensOn: LocalDate;
  /** The pact's start date, when the owner set one: it starts rather than opens. */
  startDate: LocalDate | null;
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
      /** The occurrence's day in the owner's timezone. */
      occurrenceDate: LocalDate;
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
      /** The first and last days it covers; the same day for one. */
      firstDate: LocalDate;
      lastDate: LocalDate;
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
    }
  /** The pact's change request, until a reviewer decides it or the owner withdraws it. */
  | {
      kind: "change-request";
      /** The change request's id. */
      id: string;
      pactId: string;
      name: string;
      /** It asks to end the pact, rather than change its terms. */
      endsPact: boolean;
      requestedAt: Date;
    };
/** One pact due yesterday, and how it did. Weekly count pacts are never in it. */
export interface TodayYesterdayEntry {
  pactId: string;
  name: string;
  /** A bedtime night not judged yet is waiting on Oura, not a reviewer. */
  evidenceKind: EvidenceKind;
  /** Yesterday, in the owner's timezone. */
  occurrenceDate: LocalDate;
  occurrence: OccurrenceRecord;
}

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
  /**
   * What Record a payment starts at: the open bills (`overdueCents` and
   * `billDue`), at most `payableCents`; with no open bill, `payableCents`.
   */
  suggestedPaymentCents: number;
  /**
   * The unpaid part of bills past their due time that payments awaiting
   * approval don't cover. Above zero, the owner is Overdue to this recipient.
   */
  overdueCents: number;
  /**
   * Bills not due yet with an unpaid part payments awaiting approval don't
   * cover: that part, and the soonest due time. Null when there's none.
   */
  billDue: { amountCents: number; dueAt: Date } | null;
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
  | "payment-exceeds-owed"
  | TextTooLong;

export type RecordPaymentResult = { ok: true; paymentId: string } | { ok: false; reason: RecordPaymentRefusal };

/** An entry in a ledger's history: a penalty or a payment. */
export type LedgerEntry = LedgerPenalty | LedgerPayment;

/** A penalty on a ledger: what a Missed occurrence added. */
export interface LedgerPenalty {
  kind: "penalty";
  penaltyId: string;
  pactId: string;
  pactName: string;
  /** The Missed occurrence's day in the owner's timezone. */
  occurrenceDate: LocalDate;
  amountCents: number;
  /** When it was added: when the occurrence was judged Missed. */
  addedAt: Date;
  /** Weekly count only: how far its week got. `amountCents` is one penalty per day short of the target. */
  week?: WeekProgress;
  /**
   * How much of it approved payments have paid: none, part or all of
   * `amountCents`. Approved payments to the recipient pay off its penalties
   * oldest first, in the reverse of the history's order.
   */
  paidCents: number;
  /** When the occurrence was Missed because its latest evidence was rejected: who rejected it and why. */
  rejection?: EvidenceRejection;
  /**
   * Held while an excuse or vacation covering the occurrence waits for
   * approval: it doesn't count toward owed, and payments don't pay it.
   */
  held: boolean;
  /**
   * The bill it's on, or the Wednesday bill it goes on once it can't be
   * excused. While it's held, the bill it would go on if the excuse (or
   * vacation) holding it were rejected now: a later one the longer it waits.
   */
  bill:
    | { kind: "on-bill"; billedOn: LocalDate; dueAt: Date }
    | { kind: "next-bill"; billedOn: LocalDate }
    | { kind: "if-excuse-rejected"; billedOn: LocalDate }
    | { kind: "if-vacation-rejected"; billedOn: LocalDate };
}

/** A payment to the recipient the owner recorded, and where its review stands. */
export interface LedgerPayment {
  kind: "payment";
  paymentId: string;
  amountCents: number;
  /** The owner's note, or null when there's none. */
  note: string | null;
  recordedAt: Date;
  /**
   * Where its review stands. Only an approved payment pays off penalties. A
   * rejected one says who rejected it and why: that's how the owner learns of it.
   */
  state: ReviewState;
}

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

/** How long after creation the owner can edit or delete a pact freely, in minutes. */
export const EDIT_WINDOW_MINUTES = 10;

/**
 * How long after it's judged Missed (a rejection judges it then) an
 * occurrence can be excused, in hours.
 */
export const EXCUSE_WINDOW_HOURS = 48;

/** The hour a bedtime night closes (and the next night starts): 18:00 the day after it. */
export const NIGHT_CLOSES_AT = 18;

/** The dates an owner picks for an excuse for one pact. */
export interface ExcuseDates {
  /** In the owner's timezone, both included. */
  from: LocalDate;
  to: LocalDate;
}

export interface NewExcuse extends ExcuseDates {
  /** Why: trimmed, and it can't be blank. */
  reason: string;
}

/** The excuse or vacation that counts for an occurrence, waiting for approval or approved. */
export interface OccurrenceCover {
  kind: "excuse" | "vacation";
  state: "waiting" | "approved";
}

/**
 * Where one of a pact's occurrences stands: its outcome, the cover that
 * counts for it, and where it is in time.
 */
export type OccurrenceStatus = OccurrenceStanding &
  (
    | { kind: "satisfied" }
    | { kind: "excused" }
    | {
        kind: "missed";
        /** Its penalty, held while `cover` waits for approval. */
        penaltyCents: number;
        /** Until when an excuse for it is accepted: 48 hours after it was judged Missed. */
        excusableUntil: Date;
      }
    | {
        kind: "not-judged";
        opensAt: Date;
        dueAt: Date;
        /** Its evidence is waiting for a reviewer. */
        evidenceWaiting: boolean;
      }
  );

/** What every `OccurrenceStatus` carries, whatever its outcome. */
export interface OccurrenceStanding {
  /** The excuse or vacation that counts for it; null when none does (a rejected or withdrawn one doesn't). */
  cover: OccurrenceCover | null;
  /** Before it opens, open, or past its due time. */
  phase: "ahead" | "open" | "past-due";
}

/** One of a pact's days on an excuse, and where it stands. */
export interface ExcuseDay {
  /** In the owner's timezone: for Weekly count, its week's Monday. */
  date: LocalDate;
  /** Weekly count only: its week's Sunday. A day in the week excuses the whole week. */
  through?: LocalDate;
  status: OccurrenceStatus;
}

/**
 * Why a day in an excuse's dates can't be excused now: Satisfied, already Excused
 * (or approved ahead), already on an excuse or a vacation waiting for
 * approval, or Missed more than 48 hours ago.
 */
export type ExcuseSkipReason = "satisfied" | "excused" | "on-waiting-excuse" | "on-waiting-vacation" | "window-closed";

/** The days an excuse with some dates would cover, and those it would skip. */
export interface ExcusePreview {
  /** Oldest first, as they stand before filing. */
  covered: ExcuseDay[];
  /** Oldest first. */
  skipped: { date: LocalDate; reason: ExcuseSkipReason }[];
  /** The penalties filing would hold: those of the covered Missed days. */
  heldCents: number;
}

export type ExcuseDatesRefusal =
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** Excuses open once the edit window closes. */
  | "edit-window-open"
  /** Not a "YYYY-MM-DD" date, or `to` before `from`. */
  | "invalid-dates"
  /** More than MAX_EXCUSE_SPAN_DAYS days. */
  | "too-many-days";

export type ExcusePreviewResult = { ok: true; preview: ExcusePreview } | { ok: false; reason: ExcuseDatesRefusal };

/** What the File excuse sheet opened from a pact page offers. */
export interface ExcuseOptions {
  /** The owner's today: the Days ahead range starts here. */
  today: LocalDate;
  /** Days dated today or earlier that an excuse would cover now, newest first. */
  recentDays: ExcuseDay[];
}

export type ExcuseOptionsResult =
  { ok: true; options: ExcuseOptions } | { ok: false; reason: "pact-not-found" | "edit-window-open" };

export type FileExcuseRefusal =
  | ExcuseDatesRefusal
  | "blank-reason"
  | TextTooLong
  /** More than MAX_EXCUSE_PHOTOS photos. */
  | "too-many-photos"
  /** None of the pact's days in the dates can be excused now. */
  | "nothing-to-excuse";

export type FileExcuseResult = { ok: true; excuseId: string } | { ok: false; reason: FileExcuseRefusal };

/** The excuse page, for its owner. Its reviewers are the pact's: who it was sent to. */
export type ExcuseDetail = ExcuseView & ReviewedItem;

export type ExcuseResult = { ok: true; excuse: ExcuseDetail } | { ok: false; reason: "excuse-not-found" };

export type AcceptExcuseRejectionResult =
  { ok: true } | { ok: false; reason: "excuse-not-found" | "nothing-to-accept" };

/** One of the owner's pacts the Pacts step of Plan a vacation offers. */
export interface VacationPactOption {
  id: string;
  name: string;
  evidenceKind: EvidenceKind;
  schedule: Schedule;
  penaltyCents: number;
  /** Its reviewers, by name: the Reviewers step offers those of the ticked pacts. */
  reviewers: Friend[];
  /** A One-time pact with Submit anytime has been open since it was made, so it can't be ticked. */
  alreadyOpen: boolean;
}

/** What Plan a vacation offers: the owner's Active pacts whose edit window has closed. */
export interface VacationOptions {
  /** The owner's today: the first day has to be after it. */
  today: LocalDate;
  recurring: VacationPactOption[];
  oneTime: VacationPactOption[];
  /** Some Active pact is still in its edit window, so it isn't offered yet. */
  inEditWindow: boolean;
}

/** The days and pacts an owner picks for a vacation. */
export interface VacationRequest {
  /** The first and last day, in the owner's timezone, both included. */
  from: LocalDate;
  to: LocalDate;
  /** The pacts ticked. */
  pactIds: string[];
}

export interface NewVacation extends VacationRequest {
  /** What the owner is doing, for the reviewers. Optional; trimmed, and a blank note is none. */
  note?: string;
  /** The reviewers it goes to: each reviews at least one ticked pact. */
  reviewerIds: AccountId[];
}

/** An occurrence a vacation covers or skips: a Weekly count week by its Monday, with its Sunday. */
export interface VacationOccurrence {
  date: LocalDate;
  /** Weekly count only: its week's Sunday. */
  through?: LocalDate;
}

/**
 * Why a vacation skips an occurrence in its dates: it has already opened,
 * it's already Excused (or an approved excuse covers it ahead), it's on an
 * excuse waiting for approval, or it's on another vacation.
 */
export type VacationSkipReason = "already-open" | "excused" | "on-waiting-excuse" | "on-vacation";

/** What a vacation's dates mean for one offered pact. */
export interface VacationPactPreview {
  pactId: string;
  /** Whether it's ticked. An unticked pact's `covered` are the occurrences it keeps. */
  ticked: boolean;
  /** Oldest first. */
  covered: VacationOccurrence[];
  /** Oldest first. */
  skipped: (VacationOccurrence & { reason: VacationSkipReason })[];
  /** Weekly count weeks the dates touch whose Thursday is outside them: not covered, with their full target. */
  notCovered: VacationOccurrence[];
}

/**
 * Which pacts a vacation has, as its summary says it: every offered pact
 * that can be ticked, every recurring one and no One-time one, or some.
 */
export type VacationPacts = { kind: "all" } | { kind: "all-recurring" } | { kind: "some"; names: string[] };

/** What a vacation with some dates and pacts would cover if filed now. */
export interface VacationPreview {
  /** Days from the first to the last, both included. */
  days: number;
  /** One per offered pact, in the order the options list them, recurring first. */
  pacts: VacationPactPreview[];
  summary: VacationPacts;
  /** No ticked pact has an occurrence left to cover: filing is refused. */
  coversNothing: boolean;
}

export type VacationDatesRefusal =
  /** Not a "YYYY-MM-DD" date, or the last day before the first. */
  | "invalid-dates"
  /** The first day is today or earlier. */
  | "not-after-today"
  /** More than MAX_EXCUSE_SPAN_DAYS days. */
  | "too-many-days";

export type VacationPreviewResult =
  | { ok: true; preview: VacationPreview }
  /** pact-not-offered: a ticked pact isn't one the options let the owner tick. */
  | { ok: false; reason: VacationDatesRefusal | "pact-not-offered" };

export type FileVacationRefusal =
  | Extract<VacationPreviewResult, { ok: false }>["reason"]
  | "no-pacts"
  | "no-reviewers"
  /** A picked reviewer reviews none of the ticked pacts. */
  | "reviewer-not-offered"
  /** No ticked pact has an occurrence left to cover. */
  | "nothing-to-cover"
  | TextTooLong;

export type FileVacationResult = { ok: true; vacationId: string } | { ok: false; reason: FileVacationRefusal };

export type AcceptVacationRejectionResult =
  | { ok: true }
  /** nothing-to-accept: it isn't rejected, or the owner already took the L on it. */
  | { ok: false; reason: "vacation-not-found" | "nothing-to-accept" };

export type WithdrawVacationResult = { ok: true } | { ok: false; reason: "vacation-not-found" | "not-waiting" };

/** One of the owner's vacations as its Profile card shows it. */
export interface VacationCard {
  id: string;
  from: LocalDate;
  to: LocalDate;
  days: number;
  note: string | null;
  pacts: VacationPacts;
  /** Who it was sent to, by name. */
  reviewerNames: string[];
  state: VacationState;
  /** The penalties it holds while it waits, left out when none: withdrawing makes them owed. */
  heldCents?: number;
}

/**
 * Where a vacation on Profile stands: waiting for approval, waiting on the
 * owner's reply to a reviewer's question, approved ahead of its first day,
 * or approved and on now, from its first to its last day.
 */
export type VacationState =
  | { kind: "waiting" }
  | { kind: "waiting-on-reply"; askedBy: string; question: string }
  | { kind: "approved"; reviewerName: string }
  | { kind: "on-now" };

/** The dates of the owner's last approved vacation that has ended, as Profile's "Last one" shows them. */
export interface LastVacation {
  from: LocalDate;
  to: LocalDate;
}

/** One pact a vacation covers, as its review item shows it: what the pact gives up, as the days stand now. */
export interface VacationCover {
  pactId: string;
  name: string;
  evidenceKind: EvidenceKind;
  schedule: Schedule;
  /** Oldest first. */
  covered: VacationOccurrence[];
  /** The covered occurrences already Missed, oldest first, each with its penalty held while it waits; left out when none. */
  held?: (VacationOccurrence & { penaltyCents: number })[];
}

export interface Health {
  /** False when there has been no scheduler tick in the last 5 minutes. */
  ok: boolean;
  lastTick: Date | null;
}

/**
 * The terms an owner sends to change a pact after its edit window: all of
 * them, changed or not, as the Request change form holds them. An optional
 * term left out is none, except the deck. The evidence kind never changes.
 */
export type PactChange = Omit<NewPact, "evidenceKind"> & {
  /** Why, for the reviewers, when part of it needs approval. Optional; trimmed, and a blank note is none. */
  note?: string;
};

/**
 * What changing one term does: it relaxes the pact, so it waits for a
 * reviewer's approval (and `reason` says why); it only makes it stricter, so
 * it applies without approval to occurrences not open yet; or it doesn't
 * change what counts (the name, the reminders, an added reviewer), so it
 * applies at once.
 */
export type TermEffect = { effect: "needs-approval"; reason: ApprovalReason } | { effect: "stricter" | "at-once" };

/** Why a changed term relaxes the pact, so it needs approval. */
export type ApprovalReason =
  /** The description: it defines what a photo must show. */
  | "defines-photo"
  /** Any other deck: Pact can't tell whether it's easier. */
  | "deck-changed"
  /** A later in-bed-by or due-by time. */
  | "later-time"
  /** A due-by time removed, so due at midnight. */
  | "due-at-midnight"
  /** A Fixed days schedule losing a day. */
  | "fewer-days"
  /** A lower Weekly count target. */
  | "lower-target"
  /** One-time: Submit anytime turned on. */
  | "submit-anytime-on"
  /** One-time with Submit anytime on: a later deadline. */
  | "later-deadline"
  /** One-time without Submit anytime on both sides: any other date. */
  | "date-moved"
  /** A start date where there was none. */
  | "start-added"
  | "later-start"
  /** An end date where there was none. */
  | "end-added"
  | "earlier-end"
  | "lower-penalty"
  /** Any other recipient: only a reviewer can judge which hurts more. */
  | "recipient-changed"
  /** Removing a reviewer. */
  | "reviewers-removed";

/** One term a change changes, before and after, and what changing it does. */
export type TermChange = TermValues & TermEffect;

type TermValues =
  | { term: "name"; before: string; after: string }
  | { term: "description"; before: string; after: string }
  /** An Anki pact's deck: its id, and its name as AnkiWeb last gave it (null if Pact never had it). */
  | { term: "deck"; before: { id: string; name: string | null }; after: { id: string; name: string | null } }
  | { term: "in-bed-by"; before: ClockTime; after: ClockTime }
  /** Null for midnight. */
  | { term: "due-by"; before: ClockTime | null; after: ClockTime | null }
  /** Null for none. */
  | { term: "start-date"; before: LocalDate | null; after: LocalDate | null }
  /** Null for none. */
  | { term: "end-date"; before: LocalDate | null; after: LocalDate | null }
  | { term: "schedule"; before: Schedule; after: Schedule }
  /** In US cents. */
  | { term: "penalty"; before: number; after: number }
  | { term: "recipient"; before: Recipient; after: Recipient }
  /** In the order they go off. Changing them always applies at once. */
  | { term: "reminders"; before: (ClockTime | DatedReminder)[]; after: (ClockTime | DatedReminder)[] }
  /** Each list sorted by name. Removing anyone needs approval; adding applies at once. */
  | { term: "reviewers"; before: Friend[]; after: Friend[]; added: Friend[]; removed: Friend[] };

/**
 * What applies at once inside a change that is stricter or needs approval:
 * the name, the reminders, and the reviewers added (one, or more than one).
 */
export type AppliesNow = "name" | "reminders" | "new-reviewer" | "new-reviewers";

/** What sending a change does, taken as a whole. */
export type ChangeOutcome =
  /** Nothing differs from the terms as they stand. */
  | { kind: "nothing" }
  /** Only the name, the reminders or added reviewers: done now. */
  | { kind: "at-once" }
  /**
   * Only stricter (and maybe at-once) changes: they apply without approval
   * from the start given. `appliesNow`: the at-once ones, in that order.
   */
  | ({ kind: "stricter"; appliesNow: AppliesNow[] } & ChangeStart)
  /**
   * Something relaxes the pact, so it's a change request, reviewed as a whole
   * (`bundlesStricter`: with stricter changes in it, which wait too). The name,
   * the reminders and added reviewers still apply at once (`appliesNow`). `reviewerNames`: who may decide
   * it, the added reviewers included, sorted by name.
   */
  | { kind: "needs-approval"; reviewerNames: string[]; bundlesStricter: boolean; appliesNow: AppliesNow[] };

/** The Request change form's verdict: each term that differs, in the form's order, and what sending would do. */
export interface ChangePreview {
  changes: TermChange[];
  outcome: ChangeOutcome;
}

export type ChangePactRefusal =
  | CreatePactRefusal
  /** Not this owner's pact, or no pact. */
  | "pact-not-found"
  /** In the edit window the pact is edited instead. */
  | "edit-window-open"
  | "pact-ended"
  /** A change request waits: until it's decided or withdrawn, only the name, the reminders and added reviewers change. */
  | "change-request-waiting"
  /** The start date can't change once the first occurrence has opened. */
  | "pact-started"
  /** Fixed days and Weekly count can't be swapped after the edit window: a new pact is needed. */
  | "schedule-kind-fixed"
  | "nothing-changed";

export type ChangePreviewResult = { ok: true; preview: ChangePreview } | { ok: false; reason: ChangePactRefusal };

/** What a sent change did: a change request carries its id. */
export type ChangePactOutcome =
  | Exclude<ChangeOutcome, { kind: "nothing" | "needs-approval" }>
  | (Extract<ChangeOutcome, { kind: "needs-approval" }> & { changeRequestId: string });

export type ChangePactResult = { ok: true; outcome: ChangePactOutcome } | { ok: false; reason: ChangePactRefusal };

export type RequestEndResult =
  | { ok: true; changeRequestId: string }
  | {
      ok: false;
      reason: "pact-not-found" | "edit-window-open" | "pact-ended" | "change-request-waiting" | TextTooLong;
    };

/** A change request, as its reviewers and its owner see it. */
export type ChangeRequestView = ChangeRequestBase & ({ endsPact: true } | TermsChangeRequest);

interface ChangeRequestBase {
  /** The change request's id. */
  id: string;
  pactId: string;
  pactName: string;
  /** The owner's "Why?", or null. */
  note: string | null;
  requestedAt: Date;
  /** The pact's terms as they stand: what it leaves alone stays as here. */
  current: CurrentTerms;
}

/** A change request that changes terms, rather than ending the pact. */
interface TermsChangeRequest {
  endsPact: false;
  /** The terms it changes, old and new, each `needs-approval` or `stricter`. */
  changes: TermChange[];
  /** While it waits: when the new terms would start if it were approved now. Null once decided. */
  start: ChangeStart | null;
}

/**
 * When new terms start: `appliesFrom` is the first occurrence's day not
 * open yet. `todayKeepsCents` is today's penalty, when today is an
 * occurrence on the old terms and the penalty changes.
 */
export interface ChangeStart {
  appliesFrom: LocalDate;
  todayKeepsCents: number | null;
}

/** Where a change request stands. */
export type ChangeRequestState = ReviewState | { kind: "withdrawn"; withdrawnAt: Date };

/** The change request's page, for its owner. */
export type ChangeRequestDetail = ChangeRequestView & {
  state: ChangeRequestState;
  /** The pact's reviewers, sorted by name: who may decide it. */
  reviewerNames: string[];
  thread: QuestionThread;
};

export type ChangeRequestResult =
  { ok: true; changeRequest: ChangeRequestDetail } | { ok: false; reason: "change-request-not-found" };

export type WithdrawChangeRequestResult =
  | { ok: true }
  /** Not this owner's, or decided or withdrawn already. */
  | { ok: false; reason: "change-request-not-found" | "not-waiting" };
