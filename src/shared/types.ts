// Types shared by the server and the client: the shapes of the Pact core's
// query results and command outcomes, as they cross the JSON API.

export type AccountId = string;

export type SignInResult =
  | { ok: true; accountId: AccountId }
  | { ok: false; reason: "invite-required" };

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
 * The element types are `never` until the tickets that fill each part.
 */
export interface Today {
  alerts: TodayAlert[];
  sections: TodaySection[];
  waiting: TodayWaitingItem[];
  yesterday: TodayYesterdayEntry[];
}

export type TodayAlert = never;
export type TodaySection = never;
export type TodayWaitingItem = never;
export type TodayYesterdayEntry = never;

export interface Health {
  /** False when there has been no scheduler tick in the last 5 minutes. */
  ok: boolean;
  lastTick: Date | null;
}
