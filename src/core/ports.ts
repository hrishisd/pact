// The four ports outside the Pact core. Each has a production adapter
// (adapters.ts, photo-stores.ts, web-push.ts) and a fake for tests (testing/fakes.ts).

import type { AccountId, PushDevice } from "../shared/types.ts";

export type { PushDevice };

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
  /** To the owner: a reviewer asked about one of their review items. */
  | "reviewer-question"
  /** To each reviewer of an item: its owner replied to a question, so it's back in their queue. */
  | "owner-replied"
  /** To the owner: an occurrence reached its due time and was judged Missed. */
  | "missed-occurrence"
  /** To the owner: a Wednesday bill to one recipient. */
  | "new-bill"
  /** To the owner, daily while Overdue; to the reviewers of pacts with that recipient, at first and weekly. */
  | "overdue-bill";
export type NotificationChannel = "push";

export interface NotificationPayload {
  /** What the notification says, and the app path it opens. */
  title: string;
  body: string;
  url: string;
  [detail: string]: unknown;
}

export interface Notification {
  recipient: AccountId;
  kind: NotificationKind;
  channel: NotificationChannel;
  payload: NotificationPayload;
}

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
  deliver(notification: Notification, devices: readonly PushDevice[]): Promise<DeliveryReport>;
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
