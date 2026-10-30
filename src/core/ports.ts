// The four ports outside the Pact core. Each has a production adapter
// (adapters.ts, photo-stores.ts) and a fake for tests (testing/fakes.ts).

import type { AccountId } from "../shared/types.ts";

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
  /** To each reviewer of a pact: a new item in their Review Queue. */
  | "review-item"
  /** To the owner: a reviewer approved or rejected their evidence. */
  | "evidence-decided";
export type NotificationChannel = "push";

export interface Notification {
  recipient: AccountId;
  kind: NotificationKind;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
}

/** Delivers one notification. Throwing means "not delivered"; the core retries later. */
export interface Notifier {
  deliver(notification: Notification): Promise<void>;
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
