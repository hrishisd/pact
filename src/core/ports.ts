// The six ports outside the Pact core. Each has a production adapter
// (adapters.ts, oura.ts, anki.ts, photo-stores.ts, web-push.ts, gmail.ts) and a
// fake for tests (testing/fakes.ts).

import type { AccountId, AnkiCounts, AnkiDeck, PushDevice, ReviewItem } from "../shared/types.ts";

export type { AnkiCounts, AnkiDeck, PushDevice };

/** The current time. The core never reads system time any other way. */
export interface Clock {
  now(): Date;
}

/** One sleep period in the Oura API v2 `sleep` shape (fields the core may use). */
export interface OuraSleepPeriod {
  id: string;
  /** The day Oura assigns the period to, "YYYY-MM-DD". */
  day: string;
  /** ISO 8601 with the UTC offset Oura reports, e.g. "2026-01-05T23:41:00-05:00". */
  bedtime_start: string;
  bedtime_end: string;
  type: "long_sleep" | "late_nap" | "rest" | "sleep" | "deleted";
  /** Seconds. */
  time_in_bed: number;
  /** Seconds. */
  total_sleep_duration: number | null;
}

export interface OuraDateRange {
  /** "YYYY-MM-DD", inclusive, as Oura's `start_date`. */
  startDate: string;
  /** "YYYY-MM-DD", as Oura's `end_date`. */
  endDate: string;
}

export type OuraSleepResult =
  | { ok: true; periods: OuraSleepPeriod[] }
  /** Token revoked or expired, or membership lapsed. */
  | { ok: false; reason: "disconnected" };

export interface OuraSource {
  sleepPeriods(account: AccountId, range: OuraDateRange): Promise<OuraSleepResult>;
}

export type AnkiDeckListResult =
  | { ok: true; decks: AnkiDeck[]; rolloverHour: number }
  /** AnkiWeb refused the stored login, or there is none. */
  | { ok: false; reason: "disconnected" };

export type AnkiCountsResult =
  | {
      ok: true;
      /** The Anki day the counts are for: the calendar day it started on, "YYYY-MM-DD", on the collection's clock. */
      ankiDate: string;
      /** The moment they were evaluated at: the owner's last answer that Anki day, or the check time with none. */
      asOf: Date;
      /** By deck id: its counts, or null for a deck no longer in the collection. */
      decks: Record<string, AnkiCounts | null>;
      /** By deck id: its current full name, "Spanish::Verbs" for a subdeck, for each deck still in the collection. */
      names: Record<string, string>;
    }
  | { ok: false; reason: "disconnected" };

/**
 * What an Oura or Anki adapter throws for a failure it has already raised as
 * an operator alert: an AnkiWeb protocol error, or Oura refusing Pact's own
 * app. The core treats it as any failed call, except that a check now
 * doesn't tell the owner the service couldn't be reached: it's Pact's to fix.
 */
export class OperatorAlerted extends Error {}

/**
 * The owner's Anki collection, as AnkiWeb has it. One call is one check of
 * the collection, however many decks it asks about. Throwing (a timeout, a
 * 5xx, a protocol error) is a failed check.
 */
export interface AnkiSource {
  decks(account: AccountId): Promise<AnkiDeckListResult>;
  deckCounts(account: AccountId, deckIds: readonly string[]): Promise<AnkiCountsResult>;
}

export type NotificationKind =
  | "operator-alert"
  /** To each reviewer of a new pact, when its edit window closes; to a reviewer added later, at once. */
  | "picked-as-reviewer"
  /** To each reviewer of a pact: a new item in their Review Queue. */
  | "review-item"
  /** To the owner: a reviewer approved or rejected their evidence. */
  | "evidence-decided"
  /** To the owner: a reviewer approved or rejected their excuse. */
  | "excuse-decided"
  /** To the owner: a reviewer approved or rejected their payment. */
  | "payment-decided"
  /** To the owner: a reviewer approved or rejected their change request. */
  | "change-request-decided"
  /** To the owner: one of the reviewers they picked approved or rejected their vacation. */
  | "vacation-decided"
  /** To the owner: a reviewer asked about one of their review items. */
  | "reviewer-question"
  /** To each reviewer of an item: its owner replied to a question, so it's back in their queue. */
  | "owner-replied"
  /** To a reviewer, at 09:00 each day while an item in their Review Queue has waited more than 24 hours. */
  | "stale-review-items"
  /** To the owner, at 09:00 each day while a reviewer's question to them has gone unanswered more than 24 hours. */
  | "unanswered-question"
  /** To the owner: an occurrence reached its due time and was judged Missed. */
  | "missed-occurrence"
  /** To the owner: a Wednesday bill to one recipient. */
  | "new-bill"
  /** To the owner: one of a pact's reminders, at its time. Set per pact, so no setting turns it off. */
  | "reminder"
  /** To the owner, daily while Overdue; to the reviewers of pacts with that recipient, at first and weekly. */
  | "overdue-bill"
  /** To the owner: Oura refused its tokens, or at 15:00 a bedtime night still has no sleep data. */
  | "connection-problem"
  /** To each reviewer of an owner's affected pacts: the owner's timezone change made due times later. */
  | "timezone-changed"
  /** To each earlier reviewer of a pact: the owner added another reviewer to it. */
  | "reviewer-added"
  /** To each reviewer of a pact a vacation covers, but the approver: the vacation was approved. */
  | "vacation-approved";

/** What a notification says, and the app path it opens: all a push carries. */
interface NotificationText {
  title: string;
  body: string;
  url: string;
}

/** What a reviewer decided, on a "...-decided" notification; a rejection has its reason. */
type DecisionDetails = { decision: "approved" } | { decision: "rejected"; reason: string };

/** What an operator alert's push is about (`pushOperatorAlert`, outbox.ts). */
export type OperatorAlertDetails =
  | { alert: "reminders-dropped"; dropped: number }
  | { alert: "database-restored"; lastTick: string | null }
  /** `to`: the address of an email that failed for 24 hours and was given up. */
  | { alert: "email-given-up"; to: string };

/**
 * By kind, what a notification is about, stored beside its text. Never
 * pushed: they tell notifications apart in the outbox and in tests.
 */
interface NotificationDetails {
  "operator-alert": OperatorAlertDetails;
  "picked-as-reviewer": { pactId: string };
  "review-item":
    | { itemKind: "evidence" | "excuse" | "change-request"; itemId: string; pactId: string }
    | { itemKind: "payment"; itemId: string; recipientId: string }
    | { itemKind: "vacation"; itemId: string };
  "evidence-decided": { itemKind: "evidence"; itemId: string; pactId: string } & DecisionDetails;
  "excuse-decided": { itemKind: "excuse"; itemId: string; pactId: string } & DecisionDetails;
  "payment-decided": { itemKind: "payment"; itemId: string; recipientId: string } & DecisionDetails;
  "change-request-decided": { itemKind: "change-request"; itemId: string; pactId: string } & DecisionDetails;
  "vacation-decided": { itemKind: "vacation"; itemId: string } & DecisionDetails;
  "reviewer-question": { itemKind: ReviewItem["kind"]; itemId: string };
  "owner-replied": { itemKind: ReviewItem["kind"]; itemId: string };
  /** `count`: the items in the Review Queue; the oldest is the one the push names. */
  "stale-review-items": { count: number; oldestItemKind: ReviewItem["kind"]; oldestItemId: string };
  /** The item with the oldest unanswered question, the one the push names. */
  "unanswered-question": { itemKind: ReviewItem["kind"]; itemId: string };
  /** `occurrenceDate`: "YYYY-MM-DD", the day judged. */
  "missed-occurrence": { pactId: string; occurrenceDate: string };
  "new-bill": { recipientId: string };
  /** `occurrenceDate`: "YYYY-MM-DD", the day the reminder is about. */
  reminder: { pactId: string; occurrenceDate: string };
  "overdue-bill": { recipientId: string };
  /** `occurrenceDate`: "YYYY-MM-DD", the night with no sleep data; none when the service needs reconnecting. */
  "connection-problem": { occurrenceDate?: string };
  /** `from` and `to`: the owner's timezones before and after, IANA names. */
  "timezone-changed": { ownerId: AccountId; from: string; to: string };
  /** `added`: the reviewers added, by name. */
  "reviewer-added": { pactId: string; added: AccountId[] };
  /** `pactIds`: the covered pacts named to this recipient, the ones they review. */
  "vacation-approved": { vacationId: string; pactIds: string[] };
}

/** A notification of kind `K`. */
export interface NotificationOf<K extends NotificationKind> {
  recipient: AccountId;
  kind: K;
  payload: NotificationText & NotificationDetails[K];
}

export type Notification = { [K in NotificationKind]: NotificationOf<K> }[NotificationKind];

/**
 * A notification as it's sent, with `badge`: the recipient's Review Queue
 * size when it goes, for the number on the app's icon. Worked out at each
 * send, never stored, so a retry carries the count then.
 */
export type Push = Notification & { badge: number };

export interface DeliveryReport {
  /** Endpoints of devices the push service says are gone; the core removes them. */
  expired: string[];
  /** Devices it may reach later; the core retries just these. */
  failed: { endpoint: string; error: string }[];
}

/**
 * Delivers one notification to the given devices of its recipient (there may
 * be none). Throwing means no device was reached; the core retries them all.
 */
export interface Notifier {
  deliver(push: Push, devices: readonly PushDevice[]): Promise<DeliveryReport>;
}

/** One email: plain text, with an HTML version when there is one. */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends email. `send` rejects when the mail server doesn't accept the message. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

export interface StoredPhoto {
  photoId: string;
  /** When the server received the image. */
  receivedAt: Date;
}

export interface Photo {
  bytes: Uint8Array;
  contentType: string;
}

export interface PhotoStore {
  store(photo: Photo): Promise<StoredPhoto>;
  fetch(photoId: string): Promise<Photo | null>;
}
