// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { addDays, parseClockTime, parseDatedReminder } from "../shared/calendar.ts";
import {
  earlierDate,
  laterDate,
  localDateOf,
  mondayOf,
  startOfDay,
  wallTime,
  weekdayOf,
  zoneOffsetAt,
} from "./calendar.ts";
import { openDatabase, type Db } from "./db.ts";
import { appliesNow, effectOf, termDiffs, type ChangeableTerms, type TermDiff } from "./changes.ts";
import {
  ankiDueByFits,
  ankiDueByOrder,
  dayStartHour,
  dueSoonEnough,
  firstWeekFrom,
  hasSchedule,
  lastDayOf,
  minutesFrom,
  newOccurrenceTerms,
  NIGHT_STARTS_HOUR,
  oneTimeReminderAt,
  nightStartsAt,
  noOuraDataPushAt,
  occurrences,
  occurrencesOverTime,
  reminderAt,
  utcOffsetMs,
  type DayClock,
  type EarlierTerms,
  type NewTerms,
  type Occurrence,
  type Occurrences,
  type OccurrenceTerms,
  type OneTimeTerms,
  type OuraOffset,
  type RecurringTerms,
} from "./occurrences.ts";
import type {
  AnkiCountsResult,
  AnkiSource,
  Clock,
  Notification,
  NotificationKind,
  NotificationOf,
  Notifier,
  OuraSleepPeriod,
  OuraSource,
  Photo,
  PhotoStore,
} from "./ports.ts";
import { APP_PATHS } from "../shared/api.ts";
import { clockText, formatDate, money, scheduleText } from "../shared/format.ts";
import {
  MAX_EVIDENCE_PHOTOS,
  MAX_EXCUSE_PHOTOS,
  MAX_EXCUSE_SPAN_DAYS,
  MAX_REMINDERS,
  MAX_WEEKLY_TARGET,
  NOTIFICATION_SETTINGS,
  RECONNECT_TEXT,
  WEEKDAYS,
  type AcceptExcuseRejectionResult,
  type AcceptInviteResult,
  type AcceptMissResult,
  type AccountId,
  type AnkiDeck,
  type AnkiDecksResult,
  type AnkiCheck,
  type AnkiTerms,
  type AskOwnerResult,
  type AddRecipientResult,
  type ChangeOutcome,
  type ClockTime,
  type ChangePactRefusal,
  type ChangePactResult,
  type ChangePreview,
  type ChangePreviewResult,
  type ChangeRequestResult,
  type ChangeRequestState,
  type ChangeRequestView,
  type ChangeStart,
  type CurrentTerms,
  type PactChange,
  type RequestEndResult,
  type TermChange,
  type WithdrawChangeRequestResult,
  type CreatePactRefusal,
  type CreatePactResult,
  type DecideResult,
  type DeletePactResult,
  type EditPactResult,
  type EvidenceRejection,
  type EvidenceResult,
  type EvidenceView,
  type ExcuseDates,
  type ExcuseDatesRefusal,
  type ExcuseDay,
  type ExcuseDetail,
  type ExcuseOptionsResult,
  type ExcusePreview,
  type ExcusePreviewResult,
  type ExcuseResult,
  type ExcuseSkipReason,
  type ExcuseView,
  type FileExcuseRefusal,
  type FileExcuseResult,
  type FirstOccurrenceResult,
  type HeatMapDay,
  type HeatMapWeek,
  type PactHistory,
  type Friend,
  type Health,
  type Invite,
  type InviteLookup,
  type LedgerEntry,
  type LedgerPayment,
  type LedgerPenalty,
  type LedgerResult,
  type LedgerSummary,
  type LocalDate,
  type NewExcuse,
  type NewPact,
  type NewRecipient,
  type NotificationSetting,
  type NotificationSettingState,
  type MissedDetail,
  type OccurrenceDetail,
  type OccurrenceRecord,
  type OccurrenceStatus,
  type Connection,
  type ConnectionProblem,
  type ConnectionService,
  type EvidenceKind,
  type PactTiming,
  type PaymentResult,
  type PaymentView,
  type QuestionThread,
  type ReplyResult,
  type ReviewState,
  type PactWaitingItem,
  type PactSummary,
  type PactResult,
  type PactTerms,
  type TermsByKind,
  type Recipient,
  type RecordedStatus,
  type NewPayment,
  type Profile,
  type PushDevice,
  type RecordPaymentRefusal,
  type RecordPaymentResult,
  type ReviewDecision,
  type ReviewItem,
  type SavePushSubscriptionResult,
  type Schedule,
  type SetTimezoneResult,
  type SignInResult,
  type SubmitEvidenceRefusal,
  type SubmitEvidenceResult,
  type Today,
  type TodayAlert,
  type TodayAnkiCard,
  type TodayAutomaticCard,
  type TodayBillCard,
  type TodayComingUpCard,
  type TodayMissedCard,
  type TodayNoOuraDataCard,
  type TodaySection,
  type TodayToDoCard,
  type TodayWaitingItem,
  type TodayYesterdayEntry,
  type WeekProgress,
} from "../shared/types.ts";

export interface PactCoreOptions {
  /** SQLite file. Production: on the /data volume. */
  dbPath: string;
  clock: Clock;
  notifier: Notifier;
  ouraSource: OuraSource;
  ankiSource: AnkiSource;
  photoStore: PhotoStore;
  /** The operator's email; their first sign-in may create an account without an invite. */
  operatorEmail: string;
  /** Where the core writes log lines (including OPERATOR_ALERT). Default: console.log. */
  log?: (line: string) => void;
  /**
   * Makes the id of each new row: unique, URL-safe. Default: randomUUID. Ties on
   * a timestamp fall back to id order, so tests pass ids that rise in creation order.
   */
  newId?: () => string;
}

export interface PactCore {
  /**
   * Idempotent. An existing account always signs in. A new identity gets an
   * account on the operator's first sign-in, or with a usable invite token,
   * which the new account then claims: no one else can sign in with it or
   * accept it. Signing in doesn't use the invite up (accepting it does).
   */
  signIn(identity: { email: string; name: string }, options?: { inviteToken?: string }): Promise<SignInResult>;
  /** The invite page's view of `token` for a signed-out visitor: a claimed invite shows as used. */
  invite(token: string): InviteLookup;
  /** The account signed in with `email` (whatever its case), or null if there is none. Never writes. */
  accountIdForEmail(email: string): AccountId | null;
  /** Commands and queries made as one account. */
  as(accountId: AccountId): AccountView;
  /**
   * Runs everything due by `t`, records the tick, then delivers the outbox.
   * Judges every occurrence due by `t` that isn't judged yet, catching up on
   * any it missed while stopped: approved evidence makes it Satisfied; evidence
   * still waiting leaves it for the decision; none makes it Missed and adds
   * the pact's penalty to the owner's ledger for its recipient. (Rejected
   * evidence already judged it.) Each is judged as of its due time. Running
   * it again for the same `t` changes nothing.
   */
  advanceTo(t: Date): Promise<void>;
  lastTick(): Date | null;
  /** Not ok when there's no tick in the last 5 minutes by the clock. */
  health(): Health;
  /** How many migrations this database has applied. */
  schemaVersion(): number;
  /** After a restore from backup: tells the operator how old the restored data is. */
  raiseRestoreAlert(): Promise<void>;
  /** Waits for the outbox deliveries started so far. Commands don't; the scheduler's tick and tests do. */
  deliveriesSettled(): Promise<void>;
  /** Waits for any delivery in progress, then closes the database. */
  close(): Promise<void>;
}

export interface AccountView {
  setTimezone(timezone: string): Promise<SetTimezoneResult>;
  /** A single-use invite link that expires 7 days from now. */
  createInvite(): Promise<Invite>;
  /** The invite page's view of `token` for this account: open to it if it claimed the invite. */
  invite(token: string): InviteLookup;
  /** Makes this account and the inviter friends and uses the invite up. A refusal changes nothing. */
  acceptInvite(token: string): Promise<AcceptInviteResult>;
  /** Sorted by name. */
  friends(): Friend[];
  /** Saves a recipient (a name, trimmed) to this owner's list. Names may repeat. */
  addRecipient(recipient: NewRecipient): Promise<AddRecipientResult>;
  /** This owner's saved recipients, sorted by name. */
  recipients(): Recipient[];
  /** Makes a pact, Active at once. A refusal writes nothing. */
  createPact(pact: NewPact): Promise<CreatePactResult>;
  /**
   * Changes a pact in its edit window. Same rules as `createPact`, as of when
   * the pact was created, and the evidence kind can't change. It doesn't
   * restart the window. Evidence waiting for a day the new schedule doesn't
   * have goes with that day. A refusal changes nothing.
   */
  editPact(pactId: string, pact: NewPact): Promise<EditPactResult>;
  /** Removes a pact in its edit window, with its evidence, and tells nobody. A refusal changes nothing. */
  deletePact(pactId: string): Promise<DeletePactResult>;
  /**
   * The first occurrence a pact with `timing` would have if created now, or
   * if it's the pact `editing`, when that was created: what the form's Check
   * step names. Same rule as `createPact`.
   */
  firstOccurrence(timing: PactTiming, editing?: string): FirstOccurrenceResult;
  /**
   * This owner's pacts, for the Pacts tab: Active ones in their edit window
   * first, then the other Active ones by name, then Ended ones by name.
   */
  pacts(): PactSummary[];
  /** The pact page's terms. Someone else's pact, or none, is not found. */
  pact(pactId: string): PactResult;
  /**
   * What sending `change` to an Active pact past its edit window would do,
   * term by term and as a whole: the Request change form's verdict. The same
   * rules as `changePact`, which it never calls.
   */
  changePreview(pactId: string, change: PactChange): ChangePreviewResult;
  /**
   * The owner changes an Active pact past its edit window. The name and added
   * reviewers apply at once (each new reviewer is told). If anything else
   * relaxes the pact, the rest waits as one change request for a reviewer,
   * stricter parts included, and the reviewers get a review item. Otherwise
   * the stricter parts apply now, to every occurrence not open yet (from
   * tomorrow, in the owner's timezone). While a change request waits, only
   * the name and added reviewers may change. The same checks as
   * `createPact`, so a pact never has zero reviewers. A refusal changes nothing.
   */
  changePact(pactId: string, change: PactChange): Promise<ChangePactResult>;
  /**
   * The owner asks to end an Active pact past its edit window: a change
   * request. Approved, the pact is Ended at once and makes no more
   * occurrences; its judged occurrences and penalties stay. A refusal changes nothing.
   */
  requestEnd(pactId: string, note?: string): Promise<RequestEndResult>;
  /** A change request's page, for its owner. Someone else's, or none, is not found. */
  changeRequest(changeRequestId: string): ChangeRequestResult;
  /** The owner withdraws a change request still waiting: it leaves every queue and the terms stay. */
  withdrawChangeRequest(changeRequestId: string): Promise<WithdrawChangeRequestResult>;
  profile(): Profile;
  /**
   * Records that the account connected Oura: the Oura adapter has just stored
   * its tokens. Connecting again marks the connection connected as of now.
   */
  connectOura(): Promise<void>;
  /**
   * Checks Oura now for the account's bedtime nights not judged yet, as a
   * tick would, and judges what it reports. Ignored less than 15 seconds after
   * the account's last check, with no night waiting, or without a working
   * connection. A failing call changes nothing; a "disconnected" one marks
   * the connection Needs reconnecting.
   */
  checkOura(): Promise<void>;
  /**
   * Removes the account's Oura connection. Its Active bedtime pacts keep
   * running: their nights count as Missed until the owner connects again.
   */
  disconnectOura(): Promise<void>;
  /**
   * Records that the account connected AnkiWeb: the Anki adapter has just
   * stored its host key. Connecting again marks the connection connected as of now.
   */
  connectAnki(): Promise<void>;
  /**
   * The account's deck list from AnkiWeb, with the collection's rollover
   * hour, for the deck picker. A command: it keeps the list, which a new Anki
   * pact's deck is checked against and Today names decks from.
   */
  ankiDecks(): Promise<AnkiDecksResult>;
  /**
   * Checks AnkiWeb now for the account's Anki days open and not judged yet,
   * as a tick would, and judges what it finds. Ignored less than 15 seconds
   * after the account's last check, or with no day waiting. A failing call
   * changes nothing.
   */
  checkAnki(): Promise<void>;
  /** Removes the account's AnkiWeb connection. Its Active Anki pacts keep running, and their days count as Missed. */
  disconnectAnki(): Promise<void>;
  today(): Today;
  /**
   * The owner submits photo evidence for the occurrence of `pactId` open now.
   * Accepted only while that occurrence is open when the server has received
   * every photo, so there's no backfilling. The pact's reviewers get a review
   * item. A refusal writes nothing (photos already stored stay unused).
   */
  submitEvidence(pactId: string, photos: Photo[]): Promise<SubmitEvidenceResult>;
  /**
   * The owner accepts a Missed occurrence of `pactId` (Take the L), dated
   * `occurrenceDate` ("YYYY-MM-DD" in the owner's timezone). It only takes
   * the occurrence off Today: its rejected-evidence alert, or its Missed card.
   * The ledger doesn't change. A refusal changes nothing.
   */
  acceptMiss(pactId: string, occurrenceDate: string): Promise<AcceptMissResult>;
  /**
   * The days an excuse for `pactId` with `dates` would cover if filed now,
   * and those it would skip and why: what the File excuse sheet lists. The
   * same rules as `fileExcuse`, which it never calls.
   */
  excusePreview(pactId: string, dates: ExcuseDates): ExcusePreviewResult;
  /** What File excuse from the pact page offers: the owner's today, and the recent days an excuse would cover. */
  excuseOptions(pactId: string): ExcuseOptionsResult;
  /**
   * The owner asks the pact's reviewers to treat the pact's scheduled days in
   * `excuse`'s dates as Excused. It covers the days that can be excused now,
   * fixed at filing: any day not judged yet, and a Missed day within 48 hours
   * of being judged Missed (a rejection judges it then). It skips the rest:
   * Satisfied, already Excused or approved ahead, on another excuse waiting for
   * approval, or Missed more than 48 hours ago. While it waits, the
   * penalties of its Missed days are held. Refused when no day is left, the
   * reason is blank, the dates are reversed or span more than 62 days, in the
   * pact's edit window, or with more than 3 photos. The reviewers get a review
   * item. A refusal writes nothing (photos already stored stay unused).
   */
  fileExcuse(pactId: string, excuse: NewExcuse, photos: Photo[]): Promise<FileExcuseResult>;
  /** The excuse page, for the owner. Someone else's excuse, or none, is not found. */
  excuse(excuseId: string): ExcuseResult;
  /**
   * The owner takes the L on a rejected excuse: its alert leaves Today, and
   * so do its Missed days. The ledger doesn't change, and a new excuse for
   * its days is still accepted inside their 48 hours.
   */
  acceptExcuseRejection(excuseId: string): Promise<AcceptExcuseRejectionResult>;
  /**
   * A photo of some evidence or an excuse, for the pact's owner or one of its reviewers;
   * anyone else is told it isn't found. A query: async only because the photo
   * store is, and it never writes.
   */
  photo(photoId: string): Promise<PhotoResult>;
  /**
   * Items waiting for this account's decision as a reviewer: change
   * requests, evidence and excuses for pacts it reviews, and payments to a
   * recipient of any pact it reviews. Change requests first, then the rest
   * oldest first, by when the evidence was submitted, the excuse filed or the
   * payment recorded. Items waiting on the owner's reply are left out.
   */
  reviewQueue(): ReviewItem[];
  /**
   * A reviewer decides an item in their queue, or one waiting on the owner's
   * reply: evidence by a reviewer of its pact, a payment by a reviewer of any
   * of the owner's pacts with its recipient. The first decision is final: the item leaves every reviewer's
   * queue and the owner is told. A refusal changes nothing. An approved
   * payment lowers owed and raises lifetime paid; a rejected one changes
   * neither. For evidence, a rejection is final: it judges the occurrence Missed
   * there and then, with its penalty, whether it's still open or past its
   * due time, and it takes no more evidence. An approval after the due time
   * judges it Satisfied there and then; before it, judging at the due time does.
   * For an excuse, the decision covers all its days. Approved, its Missed days
   * become Excused there and then and their penalties are removed; its days
   * not judged yet are judged Excused at their due time (or at once, if that
   * has passed). Rejected, its held penalties are owed again, its days not
   * judged yet are judged as usual, and the owner gets a rejected-excuse alert.
   * For a change request, approval applies its terms from the first
   * occurrence not open yet, or ends the pact at once; rejection leaves the
   * terms as they are.
   */
  decide(itemId: string, decision: ReviewDecision): Promise<DecideResult>;
  /**
   * A reviewer asks the owner about an item they may decide, instead of
   * deciding it. The item is then waiting on the owner's reply: it leaves
   * every reviewer's queue (see `waitingOnReply`), and the owner gets a
   * Today alert and a notification. Any reviewer can still decide it, and
   * may ask again. The question is trimmed and can't be blank.
   */
  askOwner(itemId: string, question: string): Promise<AskOwnerResult>;
  /**
   * The owner replies, in text, to a reviewer's question about one of their
   * items still waiting for a decision. It goes back into every reviewer's
   * queue, in its place, and each of them is told. Trimmed; can't be blank.
   */
  reply(itemId: string, reply: string): Promise<ReplyResult>;
  /**
   * Items this account may decide that are waiting on the owner's reply, in
   * the Review Queue's order. Out of the queue, but a reviewer can still
   * open one and decide it.
   */
  waitingOnReply(): ReviewItem[];
  /** One of this owner's evidence, for its page: where it stands and its questions. */
  evidence(evidenceId: string): EvidenceResult;
  /** One of this owner's payments, for its page: where it stands and its questions. */
  payment(paymentId: string): PaymentResult;
  /**
   * The owner records a payment they made to one of their recipients outside
   * the app, with one screenshot of it. It waits for a reviewer of any of the
   * owner's pacts with that recipient, and each of them gets a review item.
   * Refused if it's more than owed less payments already awaiting approval,
   * so the ledger never goes below zero. A refusal writes nothing (a
   * screenshot already stored stays unused).
   */
  recordPayment(payment: NewPayment, screenshot: Photo | null): Promise<RecordPaymentResult>;
  /** One ledger per recipient this owner's pacts name, sorted by name. */
  ledgers(): LedgerSummary[];
  /**
   * One of this owner's ledgers with its penalties, newest first. Another
   * owner's recipient, or none, is not found.
   */
  ledger(recipientId: string): LedgerResult;
  /** This account's notification settings, in display order. */
  notificationSettings(): NotificationSettingState[];
  /** Off, that kind records nothing for this account until it's turned back on. */
  setNotificationSetting(setting: NotificationSetting, enabled: boolean): Promise<NotificationSettingState[]>;
  /**
   * Notifications for this account go to this device too, from now on. Only
   * the known push services are accepted, since the server sends to whatever
   * is saved here. A device another account saved moves to this one.
   */
  savePushSubscription(device: PushDevice): Promise<SavePushSubscriptionResult>;
  /** Stops sending to this device, if it's this account's. */
  removePushSubscription(endpoint: string): Promise<void>;
}

export type PhotoResult = { ok: true; photo: Photo } | { ok: false; reason: "photo-not-found" };

export function createPactCore(options: PactCoreOptions): PactCore {
  const db = openDatabase(options.dbPath);
  return new Core(db, options);
}

/**
 * Which setting turns a kind of notification off. Operator alerts can't be,
 * and reminders are set on each pact instead.
 */
const SETTING_OF_KIND: Record<NotificationKind, NotificationSetting | null> = {
  "operator-alert": null,
  "picked-as-reviewer": "picked-as-reviewer",
  "review-item": "review-item",
  "evidence-decided": "decision",
  "payment-decided": "decision",
  "missed-occurrence": "missed-occurrence",
  "excuse-decided": "decision",
  "change-request-decided": "decision",
  "reviewer-question": "comment",
  "owner-replied": "comment",
  "new-bill": "new-bill",
  "overdue-bill": "overdue-bill",
  "connection-problem": "connection-problem",
  reminder: null,
};
/** The core ignores a check of Oura now this soon after the account's last one. */
const OURA_CHECK_INTERVAL_MS = 15_000;
/** The core ignores a check of AnkiWeb now this soon after the account's last one. */
const ANKI_CHECK_INTERVAL_MS = 15_000;
/** While an account has an Anki day open and not judged, the scheduler checks AnkiWeb this often. */
const ANKI_POLL_INTERVAL_MS = 10 * 60 * 1000;
/**
 * How long a check of AnkiWeb still running can hold judging the account's
 * Anki days due after it started: the adapter gives up after 2 minutes
 * (anki.ts), plus a margin.
 */
const ANKI_CHECK_HOLDS_JUDGING_MS = 3 * 60 * 1000;
/** The service a pact of each evidence kind is judged from; Camera has none. */
const SERVICE_OF_KIND: Record<EvidenceKind, ConnectionService | null> = {
  camera: null,
  oura: "oura",
  anki: "anki",
};
/** The push when a connection needs reconnecting, by service. */
const RECONNECT_PUSH: Record<ConnectionService, { title: string; body: string }> = {
  oura: { title: "Oura needs reconnecting", body: RECONNECT_TEXT.oura },
  anki: { title: "AnkiWeb needs reconnecting", body: RECONNECT_TEXT.anki },
};
/** The push services browsers use, as domains; a saved endpoint must be on one of them. */
const PUSH_SERVICE_DOMAINS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long after it's judged Missed (a rejection judges it then) an
 * occurrence can be excused. A Missed card stays on Today that long.
 */
const EXCUSE_WINDOW_MS = 48 * 60 * 60 * 1000;
/** How long after its Wednesday a bill is due. */
const BILL_TERM_DAYS = 7;
/** Bills are made on Wednesdays at this time, in the owner's timezone, and fall due at it. */
const BILL_TIME = { hour: 18, minute: 0 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How often an Overdue owner is reminded, and how often their reviewers are told. */
const OVERDUE_REMINDER_MS = DAY_MS;
const OVERDUE_REVIEWER_NOTICE_MS = 7 * DAY_MS;
/** A reminder the scheduler reaches later than this after its time, as after downtime, is dropped, not sent. */
const REMINDER_LATE_MS = 15 * 60 * 1000;
/** How long after creation the owner can edit or delete a pact freely. */
const EDIT_WINDOW_MS = 10 * 60 * 1000;
/**
 * SQL: who reviews payments from `owner` to `recipient` (SQL expressions):
 * the reviewers of any of the owner's pacts with that recipient, now or in
 * earlier terms, or with a penalty to it, with repeats. A pact whose
 * recipient changed still answers for what it sent the old one.
 */
function paymentReviewersSql(owner: string, recipient: string): string {
  return `SELECT pact_reviewer.reviewer_account_id FROM pact_reviewer
    JOIN pact ON pact.id = pact_reviewer.pact_id
    WHERE pact.owner_account_id = ${owner}
      AND (pact.recipient_id = ${recipient}
           OR EXISTS (SELECT 1 FROM pact_earlier_terms AS earlier
                      WHERE earlier.pact_id = pact.id AND earlier.recipient_id = ${recipient})
           OR EXISTS (SELECT 1 FROM penalty AS sent
                      WHERE sent.pact_id = pact.id AND sent.recipient_id = ${recipient}))`;
}
/** SQL: the account bound to the one `?` may decide the `payment` row: they review it. */
const MAY_DECIDE_PAYMENT = `? IN (${paymentReviewersSql("payment.owner_account_id", "payment.recipient_id")})`;
/** SQL: what judging reads of a `pact` row and its owner's `account` row (PactToJudge). */
const PACT_TO_JUDGE_COLUMNS = `pact.id, pact.schedule, pact.first_occurrence, pact.evidence_kind, pact.in_bed_by,
  pact.judged_through, pact.ended_at, account.timezone, pact.owner_account_id`;
/** SQL: the `pact` row's schedule is Weekly count. */
const WEEKLY_COUNT_PACT = `json_extract(pact.schedule, '$.kind') = 'weekly-count'`;
/**
 * SQL: the Missed `occurrence` row (of the `pact` row) was judged through a
 * rejection. Any rejected evidence will do: on Fixed days and One-time a
 * rejection judges the occurrence at once. A Weekly count week's rejected
 * evidence just doesn't count, so a short week is never Missed through it.
 */
const MISSED_THROUGH_REJECTION = `(NOT ${WEEKLY_COUNT_PACT} AND EXISTS (SELECT 1 FROM evidence
  WHERE evidence.pact_id = occurrence.pact_id AND evidence.occurrence_date = occurrence.date
    AND evidence.decision = 'rejected'))`;
/**
 * SQL: an excuse matching `condition` (on `excuse`) covers the occurrence of
 * pact `pact` on `date` (SQL expressions).
 */
function excuseCoversSql(pact: string, date: string, condition: string): string {
  return `EXISTS (SELECT 1 FROM excuse_day JOIN excuse ON excuse.id = excuse_day.excuse_id
    WHERE excuse_day.pact_id = ${pact} AND excuse_day.date = ${date} AND ${condition})`;
}
/** SQL: the `penalty` row is held: an excuse waiting for approval covers its occurrence. */
const PENALTY_HELD = excuseCoversSql("penalty.pact_id", "penalty.occurrence_date", "excuse.decision IS NULL");

class Core implements PactCore {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #notifier: Notifier;
  readonly #photoStore: PhotoStore;
  readonly #ouraSource: OuraSource;
  readonly #ankiSource: AnkiSource;
  readonly #operatorEmailKey: string;
  readonly #log: (line: string) => void;
  readonly #newId: () => string;
  /** Outbox deliveries run one at a time, in this chain. */
  #delivery: Promise<void> = Promise.resolve();
  /**
   * When each account last checked Oura now. In memory: a restart forgets
   * it, which costs at most one more call. Set before the call, so two
   * checks at once make one.
   */
  readonly #ouraChecks = new Map<AccountId, number>();
  /** When each account last checked AnkiWeb now. In memory, as `#ouraChecks`. */
  readonly #ankiChecks = new Map<AccountId, number>();
  /**
   * When each account's AnkiWeb was last checked, by a tick or check now. In
   * memory: a restart costs at most one more call. A check that fails is
   * forgotten, so the next tick tries again.
   */
  readonly #ankiPolls = new Map<AccountId, number>();
  /**
   * When each check of AnkiWeb still running started, by account, from a tick
   * or check now. In memory: a check doesn't outlive the process.
   */
  readonly #ankiChecksRunning = new Map<AccountId, Set<{ startedAt: number }>>();

  constructor(db: Db, options: PactCoreOptions) {
    this.#db = db;
    this.#clock = options.clock;
    this.#notifier = options.notifier;
    this.#photoStore = options.photoStore;
    this.#ouraSource = options.ouraSource;
    this.#ankiSource = options.ankiSource;
    this.#operatorEmailKey = emailKey(options.operatorEmail);
    this.#log = options.log ?? ((line) => console.log(line));
    this.#newId = options.newId ?? randomUUID;
  }

  /**
   * Runs `change` as one transaction: all of it commits or none of it does.
   * Then runs `afterCommit` and starts delivering the outbox, without waiting:
   * a slow push service never holds up the person who tapped. A delivery failure
   * doesn't fail the command; the notification waits for the next attempt.
   */
  async #command<T>(change: () => T, afterCommit?: (result: T) => void): Promise<T> {
    const result = this.#db.transaction(change).immediate();
    afterCommit?.(result);
    void this.#deliverOutbox();
    return result;
  }

  /** Queues a notification in the current command's transaction. */
  #enqueue<K extends NotificationKind>(notification: NotificationOf<K>): void {
    if (!this.#db.inTransaction) throw new Error("notifications are enqueued only inside a command");
    const setting = SETTING_OF_KIND[notification.kind];
    if (setting !== null && this.#settingIsOff(notification.recipient, setting)) return;
    // Push is the only channel; the column stays from the first migration.
    this.#db
      .prepare(
        `INSERT INTO outbox (recipient_account_id, kind, channel, payload, created_at)
         VALUES (?, ?, 'push', ?, ?)`,
      )
      .run(
        notification.recipient,
        notification.kind,
        JSON.stringify(notification.payload),
        this.#clock.now().toISOString(),
      );
  }

  /** Queues the same notification to each of `recipients`. */
  #tellAll<K extends NotificationKind>(
    recipients: readonly AccountId[],
    kind: K,
    payload: NotificationOf<K>["payload"],
  ): void {
    for (const recipient of recipients) this.#enqueue({ recipient, kind, payload });
  }

  #settingIsOff(accountId: AccountId, setting: NotificationSetting): boolean {
    return (
      this.#db
        .prepare(`SELECT 1 FROM notification_setting_off WHERE account_id = ? AND setting = ?`)
        .get(accountId, setting) !== undefined
    );
  }

  #notificationSettings(accountId: AccountId): NotificationSettingState[] {
    return NOTIFICATION_SETTINGS.map((setting) => ({ setting, enabled: !this.#settingIsOff(accountId, setting) }));
  }

  #deliverOutbox(): Promise<void> {
    this.#delivery = this.#delivery
      .then(() => this.#deliverPending())
      .catch((error: unknown) => this.#log(`outbox delivery stopped, will retry: ${String(error)}`));
    return this.#delivery;
  }

  async #deliverPending(): Promise<void> {
    const rows = this.#db
      .prepare(
        `SELECT id, recipient_account_id, kind, payload, sent_to
         FROM outbox WHERE delivered_at IS NULL ORDER BY id`,
      )
      .all() as OutboxRow[];
    for (const row of rows) {
      // Stored by `#enqueue`, so the kind and its payload match.
      const notification = {
        recipient: row.recipient_account_id,
        kind: row.kind,
        payload: JSON.parse(row.payload) as unknown,
      } as Notification;
      try {
        const devices = this.#db
          .prepare(`SELECT endpoint, p256dh, auth FROM push_subscription WHERE account_id = ? ORDER BY endpoint`)
          .all(row.recipient_account_id) as PushDevice[];
        const sentTo = JSON.parse(row.sent_to) as string[];
        const toSend = devices.filter((device) => !sentTo.includes(device.endpoint));
        const { expired, failed } = await this.#notifier.deliver(notification, toSend);
        for (const endpoint of expired) {
          this.#db.prepare(`DELETE FROM push_subscription WHERE endpoint = ?`).run(endpoint);
        }
        if (failed.length > 0) {
          const unreached = new Set([...expired, ...failed.map((f) => f.endpoint)]);
          const reached = toSend.map((device) => device.endpoint).filter((endpoint) => !unreached.has(endpoint));
          this.#db
            .prepare(`UPDATE outbox SET sent_to = ? WHERE id = ?`)
            .run(JSON.stringify([...sentTo, ...reached]), row.id);
          throw new Error(failed.map((f) => f.error).join("; "));
        }
        this.#db
          .prepare(`UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?`)
          .run(this.#clock.now().toISOString(), row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#db.prepare(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(message, row.id);
        this.#log(
          `notification ${row.id} (${row.kind} to ${row.recipient_account_id}) not delivered, will retry: ${message}`,
        );
      }
    }
  }

  signIn(identity: { email: string; name: string }, options: { inviteToken?: string } = {}): Promise<SignInResult> {
    return this.#command((): SignInResult => {
      const existing = this.accountIdForEmail(identity.email);
      if (existing !== null) return { ok: true, accountId: existing };

      const key = emailKey(identity.email);
      const isOperator =
        key === this.#operatorEmailKey && !this.#db.prepare(`SELECT 1 FROM account WHERE is_operator = 1`).get();
      const invite = options.inviteToken === undefined ? undefined : this.#inviteRow(options.inviteToken);
      const invited = invite !== undefined && this.#inviteLookup(invite, null).ok;
      if (!isOperator && !invited) return { ok: false, reason: "invite-required" };

      const id = this.#newId();
      this.#db
        .prepare(
          `INSERT INTO account (id, email, email_key, name, is_operator, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, identity.email, key, identity.name, isOperator ? 1 : 0, this.#clock.now().toISOString());
      if (invited) {
        this.#db.prepare(`UPDATE invite SET claimed_by_account_id = ? WHERE token = ?`).run(id, invite.token);
      }
      return { ok: true, accountId: id };
    });
  }

  invite(token: string): InviteLookup {
    return this.#inviteLookup(this.#inviteRow(token), null);
  }

  /**
   * Whether `viewerId` (null: a signed-out visitor) may use the invite `row`.
   * One claimed by another account is as good as used.
   */
  #inviteLookup(row: InviteRow | undefined, viewerId: AccountId | null): InviteLookup {
    if (!row) return { ok: false, reason: "invite-not-found" };
    if (row.used_at !== null) return { ok: false, reason: "invite-used" };
    const expiresAt = new Date(row.expires_at);
    if (this.#clock.now().getTime() >= expiresAt.getTime()) return { ok: false, reason: "invite-expired" };
    const claimedBy = row.claimed_by_account_id;
    if (claimedBy !== null && claimedBy !== viewerId) return { ok: false, reason: "invite-used" };
    return { ok: true, inviterName: row.inviter_name, expiresAt };
  }

  #inviteRow(token: string): InviteRow | undefined {
    return this.#db
      .prepare(
        `SELECT invite.token, invite.inviter_account_id, account.name AS inviter_name, invite.expires_at,
                invite.used_at, invite.claimed_by_account_id
         FROM invite JOIN account ON account.id = invite.inviter_account_id
         WHERE invite.token = ?`,
      )
      .get(token) as InviteRow | undefined;
  }

  #areFriends(a: AccountId, b: AccountId): boolean {
    const [first, second] = friendshipPair(a, b);
    return (
      this.#db.prepare(`SELECT 1 FROM friendship WHERE account_a_id = ? AND account_b_id = ?`).get(first, second) !==
      undefined
    );
  }

  accountIdForEmail(email: string): AccountId | null {
    const row = this.#db.prepare(`SELECT id FROM account WHERE email_key = ?`).get(emailKey(email)) as
      { id: string } | undefined;
    return row?.id ?? null;
  }

  as(accountId: AccountId): AccountView {
    const account = () => {
      const row = this.#db.prepare(`SELECT email, name, timezone FROM account WHERE id = ?`).get(accountId) as
        { email: string; name: string; timezone: string | null } | undefined;
      if (!row) throw new UnknownAccountError(accountId);
      return row;
    };
    return {
      setTimezone: (timezone) =>
        this.#command((): SetTimezoneResult => {
          account();
          const zone = canonicalTimezone(timezone);
          if (zone === null) return { ok: false, reason: "invalid-timezone" };
          this.#db.prepare(`UPDATE account SET timezone = ? WHERE id = ?`).run(zone, accountId);
          return { ok: true, timezone: zone };
        }),
      createInvite: () =>
        this.#command((): Invite => {
          account();
          const token = randomBytes(24).toString("base64url");
          const now = this.#clock.now();
          const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
          this.#db
            .prepare(`INSERT INTO invite (token, inviter_account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
            .run(token, accountId, now.toISOString(), expiresAt.toISOString());
          return { token, expiresAt };
        }),
      invite: (token) => {
        account();
        return this.#inviteLookup(this.#inviteRow(token), accountId);
      },
      acceptInvite: (token) =>
        this.#command((): AcceptInviteResult => {
          account();
          const row = this.#inviteRow(token);
          if (!row) return { ok: false, reason: "invite-not-found" };
          const lookup = this.#inviteLookup(row, accountId);
          if (!lookup.ok) return lookup;
          const inviterId = row.inviter_account_id;
          if (inviterId === accountId) return { ok: false, reason: "own-invite" };
          if (this.#areFriends(accountId, inviterId)) return { ok: false, reason: "already-friends" };

          const now = this.#clock.now().toISOString();
          this.#db
            .prepare(`UPDATE invite SET used_at = ?, used_by_account_id = ? WHERE token = ?`)
            .run(now, accountId, token);
          this.#db
            .prepare(`INSERT INTO friendship (account_a_id, account_b_id, created_at) VALUES (?, ?, ?)`)
            .run(...friendshipPair(accountId, inviterId), now);
          return { ok: true, friend: { id: inviterId, name: lookup.inviterName } };
        }),
      friends: () => {
        account();
        const friends = this.#db
          .prepare(
            `SELECT account.id, account.name FROM friendship
             JOIN account ON account.id =
               CASE WHEN friendship.account_a_id = ? THEN friendship.account_b_id ELSE friendship.account_a_id END
             WHERE friendship.account_a_id = ? OR friendship.account_b_id = ?`,
          )
          .all(accountId, accountId, accountId) as Friend[];
        return friends.sort(byName);
      },
      addRecipient: (recipient) =>
        this.#command((): AddRecipientResult => {
          account();
          const name = recipient.name.trim();
          if (name === "") return { ok: false, reason: "blank-name" };
          const id = this.#newId();
          this.#db
            .prepare(`INSERT INTO recipient (id, owner_account_id, name, created_at) VALUES (?, ?, ?, ?)`)
            .run(id, accountId, name, this.#clock.now().toISOString());
          return { ok: true, recipient: { id, name } };
        }),
      recipients: () => {
        account();
        return this.#selectRecipients(`owner_account_id = ?`, accountId);
      },
      createPact: (pact) =>
        this.#command((): CreatePactResult => {
          const { timezone } = account();
          const now = this.#clock.now();
          const checked = this.#checkedPact(accountId, timezone, pact, now);
          if (!checked.ok) return checked;

          const id = this.#newId();
          const times = timesOf(checked.terms);
          this.#db
            .prepare(
              `INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, in_bed_by,
                                 due_by, start_date, end_date, penalty_cents, recipient_id, stage,
                                 first_occurrence, created_at, reminders, reminded_through, anki_deck_id,
                                 anki_rollover_hour)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              accountId,
              checked.name,
              checked.description,
              pact.evidenceKind,
              JSON.stringify(checked.terms.schedule),
              times.inBedBy,
              times.dueBy,
              checked.startDate,
              checked.terms.endDate,
              pact.penaltyCents,
              pact.recipientId,
              checked.terms.firstOccurrence,
              now.toISOString(),
              JSON.stringify(checked.reminders),
              now.toISOString(),
              checked.ankiDeckId,
              times.ankiRollover,
            );
          this.#setReviewers(id, checked.reviewerIds);
          return { ok: true, pactId: id };
        }),
      editPact: (pactId, pact) =>
        this.#command((): EditPactResult => {
          const { timezone } = account();
          const row = this.#ownPact(accountId, pactId);
          if (!row) return { ok: false, reason: "pact-not-found" };
          if (editWindowClosesAt(row, this.#clock.now()) === null) return { ok: false, reason: "edit-window-closed" };
          if (pact.evidenceKind !== row.evidence_kind) return { ok: false, reason: "evidence-kind-fixed" };
          const checked = this.#checkedPact(accountId, timezone, pact, new Date(row.created_at), row);
          if (!checked.ok) return checked;

          const times = timesOf(checked.terms);
          this.#db
            .prepare(
              `UPDATE pact SET name = ?, description = ?, schedule = ?, in_bed_by = ?, due_by = ?, start_date = ?,
                               end_date = ?, penalty_cents = ?, recipient_id = ?, first_occurrence = ?, reminders = ?,
                               anki_deck_id = ?
               WHERE id = ?`,
            )
            .run(
              checked.name,
              checked.description,
              JSON.stringify(checked.terms.schedule),
              times.inBedBy,
              times.dueBy,
              checked.startDate,
              checked.terms.endDate,
              pact.penaltyCents,
              pact.recipientId,
              checked.terms.firstOccurrence,
              JSON.stringify(checked.reminders),
              checked.ankiDeckId,
              pactId,
            );
          this.#db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ?`).run(pactId);
          this.#setReviewers(pactId, checked.reviewerIds);
          // A One-time pact's evidence is for its one occurrence, wherever its deadline goes.
          if (scheduleOf(row.schedule).kind === "one-time" && checked.terms.schedule.kind === "one-time") {
            this.#moveOneTimeOccurrence(pactId, row.first_occurrence, checked.terms.firstOccurrence);
            return { ok: true };
          }
          const { includes } = occurrences(checked.terms, checked.timezone);
          this.#removeEvidence(pactId, (date) => !includes(date));
          return { ok: true };
        }),
      deletePact: (pactId) =>
        this.#command((): DeletePactResult => {
          account();
          const row = this.#ownPact(accountId, pactId);
          if (!row) return { ok: false, reason: "pact-not-found" };
          if (editWindowClosesAt(row, this.#clock.now()) === null) return { ok: false, reason: "edit-window-closed" };
          // In its window a pact has nothing judged, so no penalties: evidence is all it can have.
          this.#removeEvidence(pactId, () => true);
          this.#db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ?`).run(pactId);
          this.#db.prepare(`DELETE FROM pact WHERE id = ?`).run(pactId);
          return { ok: true };
        }),
      firstOccurrence: ({ schedule, evidenceKind, inBedBy, dueBy, startDate }, editing) => {
        const { timezone } = account();
        const pact = editing === undefined ? undefined : this.#ownPact(accountId, editing);
        if (editing !== undefined && !pact) return { ok: false, reason: "pact-not-found" };
        if (timezone === null) return { ok: false, reason: "no-timezone" };
        // An Anki pact keeps the rollover hour it was made with; a new one takes the deck list's.
        const ankiRollover = pact
          ? pact.anki_rollover_hour
          : evidenceKind === "anki"
            ? (this.#ankiDeckList(accountId)?.rolloverHour ?? null)
            : null;
        // The form may not have a valid time or date yet: those count as not set. So does a
        // due-by time the Anki day can't be due by, which creating the pact refuses.
        const validDueBy =
          dueBy !== undefined && isDueBy(dueBy) && (ankiRollover === null || ankiDueByFits(dueBy, ankiRollover));
        const times = {
          inBedBy: inBedBy !== undefined && isClockTime(inBedBy) ? inBedBy : null,
          dueBy: validDueBy ? dueBy : null,
          ankiRollover,
        };
        const timing = newOccurrenceTerms(
          newTermsOf(schedule, formDayClock(times), times.dueBy),
          pact ? new Date(pact.created_at) : this.#clock.now(),
          timezone,
          startDate !== undefined && isLocalDate(startDate) ? startDate : null,
        );
        if (!timing.ok) return timing;
        return { ok: true, firstOccurrence: { date: timing.first.date, dueAt: timing.first.dueAt } };
      },
      pacts: () => {
        account();
        const pacts = this.#activePacts(accountId).map(
          ({ id, name, terms, penaltyCents, editWindowClosesAt }): PactSummary => ({
            id,
            name,
            schedule: terms.schedule,
            penaltyCents,
            stage: "active",
            editWindowClosesAt,
          }),
        );
        const ended = (
          this.#db
            .prepare(
              `SELECT id, name, schedule, penalty_cents FROM pact
               WHERE owner_account_id = ? AND stage = 'ended'
               ORDER BY name, created_at, id`,
            )
            .all(accountId) as Pick<PactRow, "id" | "name" | "schedule" | "penalty_cents">[]
        ).map((row): PactSummary => ({
          id: row.id,
          name: row.name,
          schedule: scheduleOf(row.schedule),
          penaltyCents: row.penalty_cents,
          stage: "ended",
          editWindowClosesAt: null,
        }));
        return [
          ...pacts.filter((pact) => pact.editWindowClosesAt),
          ...pacts.filter((pact) => !pact.editWindowClosesAt),
          ...ended,
        ];
      },
      pact: (pactId) => {
        const { timezone } = account();
        const row = this.#ownPact(accountId, pactId);
        if (!row || timezone === null) return { ok: false, reason: "pact-not-found" };
        const now = this.#clock.now();
        const { first } = this.#occurrencesOf(pactId, timezone);
        const service = SERVICE_OF_KIND[row.evidence_kind];
        const pact: PactTerms = {
          id: row.id,
          ...this.#currentTerms(row),
          ...stageOf(row),
          firstOccurrence: { date: first.date, dueAt: first.dueAt },
          editWindowClosesAt: editWindowClosesAt(row, now),
          newTerms: this.#newTerms(row, timezone, now),
          waiting: mergeByTime(
            waitingSince,
            "newest-first",
            this.#waitingChangeRequests(accountId, pactId),
            this.#waitingEvidence(accountId, pactId),
            this.#waitingExcuses(accountId, pactId),
          ) as PactWaitingItem[],
          history: this.#pactHistory(row, timezone, first, now),
          connectionProblem:
            row.stage === "active" && service !== null ? this.#connectionProblem(accountId, service) : null,
        };
        return { ok: true, pact };
      },
      changePreview: (pactId, change) => {
        const { timezone } = account();
        const checked = this.#checkedChange(accountId, timezone, pactId, change, this.#clock.now());
        if (!checked.ok) return checked;
        const { before, after, diffs, outcome } = checked;
        const preview: ChangePreview = { changes: this.#termChanges(accountId, before, after, diffs), outcome };
        return { ok: true, preview } satisfies ChangePreviewResult;
      },
      changePact: (pactId, change) =>
        this.#command((): ChangePactResult => {
          const { timezone, name: ownerName } = account();
          const now = this.#clock.now();
          const checked = this.#checkedChange(accountId, timezone, pactId, change, now);
          if (!checked.ok) return checked;
          const { pact, before, after, outcome } = checked;
          if (outcome.kind === "nothing") return { ok: false, reason: "nothing-changed" };
          // The name, the reminders and added reviewers apply at once, even inside a change that waits.
          if (after.name !== before.name)
            this.#db.prepare(`UPDATE pact SET name = ? WHERE id = ?`).run(after.name, pactId);
          this.#db.prepare(`UPDATE pact SET reminders = ? WHERE id = ?`).run(JSON.stringify(after.reminders), pactId);
          const added = after.reviewerIds.filter((id) => !before.reviewerIds.includes(id));
          this.#setReviewers(pactId, added);
          this.#tellPickedAsReviewer(added, `${ownerName} added you as a reviewer`, {
            id: pactId,
            name: after.name,
            schedule: before.schedule,
            penaltyCents: before.penaltyCents,
          });
          if (outcome.kind === "needs-approval") {
            const sent = {
              ...before,
              name: after.name,
              reviewerIds: [...before.reviewerIds, ...added].sort(),
              reminders: after.reminders,
            };
            const id = this.#sendChangeRequest({ ...pact, name: after.name }, ownerName, sent, after, change.note);
            return { ok: true, outcome: { ...outcome, changeRequestId: id } };
          }
          if (outcome.kind === "stricter") this.#applyTerms(pact, after, now, checked.timezone);
          return { ok: true, outcome };
        }),
      requestEnd: (pactId, note) =>
        this.#command((): RequestEndResult => {
          const { name: ownerName } = account();
          const pact = this.#ownPact(accountId, pactId);
          if (!pact) return { ok: false, reason: "pact-not-found" };
          if (pact.stage === "ended") return { ok: false, reason: "pact-ended" };
          if (editWindowClosesAt(pact, this.#clock.now()) !== null) return { ok: false, reason: "edit-window-open" };
          if (this.#waitingChangeRequestId(pactId) !== null) return { ok: false, reason: "change-request-waiting" };
          const id = this.#sendChangeRequest(pact, ownerName, this.#changeableTerms(pact), null, note);
          return { ok: true, changeRequestId: id };
        }),
      changeRequest: (changeRequestId) => {
        account();
        const row = this.#changeRequestRow(changeRequestId);
        if (!row || row.owner_account_id !== accountId) return { ok: false, reason: "change-request-not-found" };
        // A decision outranks a withdrawal.
        const state: ChangeRequestState =
          row.withdrawn_at !== null && row.decision === null
            ? { kind: "withdrawn", withdrawnAt: new Date(row.withdrawn_at) }
            : reviewStateOf(row);
        const changeRequest = {
          ...this.#changeRequestView(row),
          state,
          reviewerNames: this.#friendsSortedByName(this.#reviewersOf(row.pact_id)).map((friend) => friend.name),
          thread: this.#thread(row.id, state.kind === "waiting"),
        };
        return { ok: true, changeRequest } satisfies ChangeRequestResult;
      },
      withdrawChangeRequest: (changeRequestId) =>
        this.#command((): WithdrawChangeRequestResult => {
          account();
          const row = this.#changeRequestRow(changeRequestId);
          if (!row || row.owner_account_id !== accountId) return { ok: false, reason: "change-request-not-found" };
          if (row.decision !== null || row.withdrawn_at !== null) return { ok: false, reason: "not-waiting" };
          this.#db
            .prepare(`UPDATE change_request SET withdrawn_at = ? WHERE id = ?`)
            .run(this.#clock.now().toISOString(), changeRequestId);
          return { ok: true };
        }),
      profile: () => {
        const { email, name, timezone } = account();
        const connections = (
          this.#db
            .prepare(`SELECT service, status, connected_at FROM connection WHERE account_id = ? ORDER BY service`)
            .all(accountId) as { service: ConnectionService; status: Connection["status"]; connected_at: string }[]
        ).map((row): Connection => ({
          service: row.service,
          status: row.status,
          connectedAt: new Date(row.connected_at),
          activePacts: this.#activePactsUsing(accountId, row.service),
        }));
        return { email, name, timezone, connections };
      },
      checkOura: async () => {
        account();
        const now = this.#clock.now();
        if (checkedWithin(this.#ouraChecks, accountId, now, OURA_CHECK_INTERVAL_MS)) return;
        this.#ouraChecks.set(accountId, now.getTime());
        const fetched = await this.#fetchSleep(now, accountId);
        await this.#command(() => {
          for (const account of fetched.disconnected) this.#markDisconnected("oura", account, fetched.askedAt);
          this.#noteOuraClock(fetched.sleep);
          this.#judgeNights(now, fetched.sleep, accountId);
        });
      },
      disconnectOura: () =>
        this.#command(() => {
          account();
          this.#disconnect(accountId, "oura");
        }),
      connectAnki: () =>
        this.#command(() => {
          account();
          // A new login: the next tick checks at once, whenever the last check was.
          this.#ankiPolls.delete(accountId);
          this.#connect(accountId, "anki");
        }),
      ankiDecks: async () => {
        account();
        if (!this.#hasConnection(accountId, "anki")) return { ok: false, reason: "not-connected" };
        const askedAt = this.#clock.now();
        let result;
        try {
          result = await this.#ankiSource.decks(accountId);
        } catch (error) {
          this.#log(`AnkiWeb deck list for account ${accountId} failed: ${errorText(error)}`);
          return { ok: false, reason: "unreachable" };
        }
        if (!result.ok) {
          await this.#command(() => this.#markDisconnected("anki", accountId, askedAt));
          return result;
        }
        const { decks, rolloverHour } = result;
        await this.#command(() => {
          this.#db
            .prepare(
              `INSERT INTO anki_deck_list (account_id, decks, rollover_hour, fetched_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (account_id) DO UPDATE SET decks = excluded.decks, rollover_hour = excluded.rollover_hour,
                 fetched_at = excluded.fetched_at`,
            )
            .run(accountId, JSON.stringify(decks), rolloverHour, this.#clock.now().toISOString());
        });
        return { ok: true, decks, rolloverHour };
      },
      checkAnki: async () => {
        account();
        const now = this.#clock.now();
        if (checkedWithin(this.#ankiChecks, accountId, now, ANKI_CHECK_INTERVAL_MS)) return;
        if (this.#ankiDaysWaiting(now, accountId).length === 0) return;
        this.#ankiChecks.set(accountId, now.getTime());
        const fetched = await this.#fetchAnki(now, accountId);
        await this.#command(() => this.#recordAnkiChecks(fetched));
      },
      disconnectAnki: () =>
        this.#command(() => {
          account();
          this.#disconnect(accountId, "anki");
        }),
      connectOura: () =>
        this.#command(() => {
          account();
          this.#connect(accountId, "oura");
        }),
      today: () => {
        const { timezone } = account();
        // Every pact's owner has a timezone: creating one needs it.
        const { alerts, sections } =
          timezone === null ? { alerts: [], sections: [] } : this.#todayCards(accountId, timezone);
        const hasPacts = this.#db.prepare(`SELECT 1 FROM pact WHERE owner_account_id = ?`).get(accountId) !== undefined;
        const yesterday = timezone === null ? [] : this.#yesterday(accountId, timezone);
        return { hasPacts, alerts, sections, waiting: this.#waiting(accountId), yesterday };
      },
      notificationSettings: () => {
        account();
        return this.#notificationSettings(accountId);
      },
      setNotificationSetting: (setting, enabled) =>
        this.#command(() => {
          account();
          if (enabled) {
            this.#db
              .prepare(`DELETE FROM notification_setting_off WHERE account_id = ? AND setting = ?`)
              .run(accountId, setting);
          } else {
            this.#db
              .prepare(
                `INSERT INTO notification_setting_off (account_id, setting) VALUES (?, ?) ON CONFLICT DO NOTHING`,
              )
              .run(accountId, setting);
          }
          return this.#notificationSettings(accountId);
        }),
      savePushSubscription: (device) =>
        this.#command((): SavePushSubscriptionResult => {
          account();
          if (!isPushDevice(device)) return { ok: false, reason: "invalid-subscription" };
          this.#db
            .prepare(
              `INSERT INTO push_subscription (endpoint, account_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (endpoint) DO UPDATE
               SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth`,
            )
            .run(device.endpoint, accountId, device.p256dh, device.auth, this.#clock.now().toISOString());
          return { ok: true };
        }),
      removePushSubscription: (endpoint) =>
        this.#command(() => {
          account();
          this.#db
            .prepare(`DELETE FROM push_subscription WHERE endpoint = ? AND account_id = ?`)
            .run(endpoint, accountId);
        }),
      submitEvidence: async (pactId, photos) => {
        const { timezone, name: ownerName } = account();
        // Refuse cheaply before storing anything, then check again at the time
        // the server received the photos, in the transaction that writes.
        const early = this.#evidenceAcceptance(accountId, timezone, pactId, photos.length, this.#clock.now());
        if (!early.ok) return early;
        const stored = await Promise.all(photos.map((photo) => this.#photoStore.store(photo)));
        const submittedAt = new Date(Math.max(...stored.map((p) => p.receivedAt.getTime())));
        return this.#command((): SubmitEvidenceResult => {
          const acceptance = this.#evidenceAcceptance(accountId, timezone, pactId, photos.length, submittedAt);
          if (!acceptance.ok) return acceptance;
          const { occurrence, day } = acceptance;
          this.#db
            .prepare(`INSERT INTO occurrence (pact_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
            .run(pactId, occurrence.date);
          const evidenceId = this.#newId();
          this.#db
            .prepare(`INSERT INTO evidence (id, pact_id, occurrence_date, day, submitted_at) VALUES (?, ?, ?, ?, ?)`)
            .run(evidenceId, pactId, occurrence.date, day, submittedAt.toISOString());
          stored.forEach(({ photoId, receivedAt }, position) => {
            this.#db
              .prepare(`INSERT INTO evidence_photo (evidence_id, position, photo_id, received_at) VALUES (?, ?, ?, ?)`)
              .run(evidenceId, position, photoId, receivedAt.toISOString());
          });
          // Evidence from inside the edit window waits for #closeEditWindows to
          // tell its reviewers; if they were told already, it missed that and goes now.
          const pact = this.#ownPact(accountId, pactId);
          if (pact && (pact.reviewers_notified_at !== null || editWindowClosesAt(pact, submittedAt) === null)) {
            this.#enqueueEvidenceReviewItems(pactId, evidenceId, day, ownerName);
          }
          return { ok: true, evidenceId };
        });
      },
      acceptMiss: (pactId, occurrenceDate) =>
        this.#command((): AcceptMissResult => {
          account();
          const isOwn = this.#db
            .prepare(`SELECT 1 FROM pact WHERE id = ? AND owner_account_id = ?`)
            .get(pactId, accountId);
          if (!isOwn) return { ok: false, reason: "pact-not-found" };
          const now = this.#clock.now().toISOString();
          const accepted = this.#db
            .prepare(
              `UPDATE occurrence SET miss_accepted_at = ?
               WHERE pact_id = ? AND date = ? AND outcome = 'missed' AND miss_accepted_at IS NULL`,
            )
            .run(now, pactId, occurrenceDate);
          if (accepted.changes === 1) return { ok: true };
          // On Weekly count, a rejected day isn't a miss, but its alert goes the same way.
          const rejected = this.#db
            .prepare(
              `UPDATE evidence SET rejection_accepted_at = ?
               WHERE pact_id = ? AND day = ? AND decision = 'rejected' AND rejection_accepted_at IS NULL
                 AND (SELECT json_extract(schedule, '$.kind') FROM pact WHERE id = ?) = 'weekly-count'`,
            )
            .run(now, pactId, occurrenceDate, pactId);
          return rejected.changes > 0 ? { ok: true } : { ok: false, reason: "nothing-to-accept" };
        }),
      excusePreview: (pactId, dates) => {
        const { timezone } = account();
        return this.#excusePreview(accountId, timezone, pactId, dates, this.#clock.now());
      },
      excuseOptions: (pactId) => {
        const { timezone } = account();
        const now = this.#clock.now();
        const pact = this.#ownPact(accountId, pactId);
        if (!pact || timezone === null) return { ok: false, reason: "pact-not-found" };
        if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
        const today = localDateOf(now, timezone);
        // Days before today an excuse could cover: Missed in the last 48 hours, or still waiting on evidence.
        const since = new Date(now.getTime() - EXCUSE_WINDOW_MS).toISOString();
        const earliest = (
          this.#db
            .prepare(
              `SELECT MIN(date) AS date FROM occurrence
               WHERE pact_id = ? AND date < ? AND (outcome IS NULL OR (outcome = 'missed' AND judged_at > ?))`,
            )
            .get(pactId, today, since) as { date: LocalDate | null }
        ).date;
        const { overlapping } = this.#occurrencesOf(pactId, timezone);
        const recentDays = overlapping(earliest ?? today, today)
          .filter((occurrence) => !this.#dueAfterEnd(pactId, occurrence))
          .map((occurrence) => this.#excuseDay(pactId, occurrence))
          .filter(({ status }) => this.#skipReason(status, now) === null)
          .toReversed();
        return { ok: true, options: { today, recentDays } };
      },
      fileExcuse: async (pactId, excuse, photos) => {
        const { timezone, name: ownerName } = account();
        const reason = excuse.reason.trim();
        // Refuse cheaply before storing anything, then check again at the time
        // the server received the photos, in the transaction that writes.
        const acceptance = (
          at: Date,
        ): { ok: true; preview: ExcusePreview } | { ok: false; reason: FileExcuseRefusal } => {
          const checked = this.#excusePreview(accountId, timezone, pactId, excuse, at);
          if (!checked.ok) return checked;
          if (reason === "") return { ok: false, reason: "blank-reason" };
          if (photos.length > MAX_EXCUSE_PHOTOS) return { ok: false, reason: "too-many-photos" };
          if (checked.preview.covered.length === 0) return { ok: false, reason: "nothing-to-excuse" };
          return checked;
        };
        const early = acceptance(this.#clock.now());
        if (!early.ok) return early;
        const stored = await Promise.all(photos.map((photo) => this.#photoStore.store(photo)));
        // With no photos, the server received the excuse when it writes it.
        const lastReceived = stored.length === 0 ? null : Math.max(...stored.map((p) => p.receivedAt.getTime()));
        return this.#command((): FileExcuseResult => {
          const filedAt = lastReceived === null ? this.#clock.now() : new Date(lastReceived);
          const checked = acceptance(filedAt);
          if (!checked.ok) return checked;
          const excuseId = this.#newId();
          this.#db
            .prepare(`INSERT INTO excuse (id, pact_id, reason, filed_at) VALUES (?, ?, ?, ?)`)
            .run(excuseId, pactId, reason, filedAt.toISOString());
          for (const { date } of checked.preview.covered) {
            this.#db
              .prepare(`INSERT INTO excuse_day (excuse_id, pact_id, date) VALUES (?, ?, ?)`)
              .run(excuseId, pactId, date);
          }
          stored.forEach(({ photoId, receivedAt }, position) => {
            this.#db
              .prepare(`INSERT INTO excuse_photo (excuse_id, position, photo_id, received_at) VALUES (?, ?, ?, ?)`)
              .run(excuseId, position, photoId, receivedAt.toISOString());
          });
          const pactName = this.#pactName(pactId);
          const dates = this.#excuseDatesText(excuseId);
          this.#tellAll(this.#reviewersOf(pactId), "review-item", {
            itemKind: "excuse",
            itemId: excuseId,
            pactId,
            title: `${ownerName} filed an excuse`,
            body: `${pactName} · ${dates}`,
            url: APP_PATHS.review,
          });
          return { ok: true, excuseId };
        });
      },
      excuse: (excuseId) => {
        account();
        const pact = this.#excusePact(excuseId);
        if (!pact || pact.owner_account_id !== accountId) return { ok: false, reason: "excuse-not-found" };
        const row = this.#db
          .prepare(
            `SELECT excuse.reason, excuse.filed_at, ${reviewStateColumns("excuse")}
             FROM excuse LEFT JOIN account AS reviewer ON reviewer.id = excuse.decided_by_account_id
             WHERE excuse.id = ?`,
          )
          .get(excuseId) as ReviewStateRow & { reason: string; filed_at: string };
        const reviewerNames = this.#friendsSortedByName(this.#reviewersOf(pact.id)).map((friend) => friend.name);
        const excuse: ExcuseDetail = {
          ...this.#excuseView({
            ...row,
            id: excuseId,
            pact_id: pact.id,
            pact_name: pact.name,
            timezone: pact.timezone,
          }),
          state: reviewStateOf(row),
          reviewerNames,
          thread: this.#thread(excuseId, row.decision === null),
        };
        return { ok: true, excuse };
      },
      acceptExcuseRejection: (excuseId) =>
        this.#command((): AcceptExcuseRejectionResult => {
          account();
          const pact = this.#excusePact(excuseId);
          if (!pact || pact.owner_account_id !== accountId) return { ok: false, reason: "excuse-not-found" };
          const now = this.#clock.now().toISOString();
          const accepted = this.#db
            .prepare(
              `UPDATE excuse SET rejection_accepted_at = ?
               WHERE id = ? AND decision = 'rejected' AND rejection_accepted_at IS NULL`,
            )
            .run(now, excuseId);
          if (accepted.changes !== 1) return { ok: false, reason: "nothing-to-accept" };
          this.#db
            .prepare(
              `UPDATE occurrence SET miss_accepted_at = ?
               WHERE outcome = 'missed' AND miss_accepted_at IS NULL
                 AND (pact_id, date) IN (SELECT pact_id, date FROM excuse_day WHERE excuse_id = ?)`,
            )
            .run(now, excuseId);
          return { ok: true };
        }),
      recordPayment: async (payment, screenshot) => {
        const { name: ownerName } = account();
        // Refuse cheaply before storing anything, then check again in the
        // transaction that writes, as another payment may have come first.
        const early = this.#paymentAcceptance(accountId, payment);
        if (!early.ok) return early;
        if (screenshot === null) return { ok: false, reason: "no-screenshot" };
        const { photoId } = await this.#photoStore.store(screenshot);
        return this.#command((): RecordPaymentResult => {
          const acceptance = this.#paymentAcceptance(accountId, payment);
          if (!acceptance.ok) return acceptance;
          const note = payment.note?.trim() ?? "";
          const paymentId = this.#newId();
          this.#db
            .prepare(
              `INSERT INTO payment (id, owner_account_id, recipient_id, amount_cents, note, photo_id, recorded_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              paymentId,
              accountId,
              payment.recipientId,
              payment.amountCents,
              note === "" ? null : note,
              photoId,
              this.#clock.now().toISOString(),
            );
          this.#tellAll(this.#paymentReviewers(accountId, payment.recipientId), "review-item", {
            itemKind: "payment",
            itemId: paymentId,
            recipientId: payment.recipientId,
            title: `${ownerName} recorded a payment`,
            body: `${money(payment.amountCents)} to ${this.#recipientName(payment.recipientId)}`,
            url: APP_PATHS.review,
          });
          return { ok: true, paymentId };
        });
      },
      photo: async (photoId) => {
        account();
        const viewable =
          this.#mayViewPactItemPhoto("evidence", photoId, accountId) ||
          this.#mayViewPactItemPhoto("excuse", photoId, accountId) ||
          this.#mayViewPaymentPhoto(photoId, accountId);
        const photo = viewable ? await this.#photoStore.fetch(photoId) : null;
        return photo ? { ok: true, photo } : { ok: false, reason: "photo-not-found" };
      },
      reviewQueue: () => {
        account();
        return this.#reviewItems(accountId).filter((item) => !item.thread.waitingOnReply);
      },
      waitingOnReply: () => {
        account();
        return this.#reviewItems(accountId).filter((item) => item.thread.waitingOnReply);
      },
      evidence: (evidenceId) => {
        account();
        const row = this.#db
          .prepare(
            `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, evidence.occurrence_date, evidence.day,
                    evidence.submitted_at, ${reviewStateColumns("evidence")}
             FROM evidence
             JOIN pact ON pact.id = evidence.pact_id
             LEFT JOIN account AS reviewer ON reviewer.id = evidence.decided_by_account_id
             WHERE evidence.id = ? AND pact.owner_account_id = ?`,
          )
          .get(evidenceId, accountId) as (ReviewStateRow & EvidenceViewRow) | undefined;
        if (!row) return { ok: false, reason: "evidence-not-found" };
        return {
          ok: true,
          evidence: {
            ...this.#evidenceView(row),
            state: reviewStateOf(row),
            reviewerNames: this.#friendsSortedByName(this.#reviewersOf(row.pact_id)).map((friend) => friend.name),
            thread: this.#thread(row.id, row.decision === null),
          },
        };
      },
      payment: (paymentId) => {
        account();
        const row = this.#db
          .prepare(
            `SELECT payment.id, payment.recipient_id, recipient.name AS recipient_name, payment.amount_cents,
                    payment.note, payment.photo_id, payment.recorded_at, ${reviewStateColumns("payment")}
             FROM payment
             JOIN recipient ON recipient.id = payment.recipient_id
             LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
             WHERE payment.id = ? AND payment.owner_account_id = ?`,
          )
          .get(paymentId, accountId) as (ReviewStateRow & PaymentViewRow & { recipient_id: string }) | undefined;
        if (!row) return { ok: false, reason: "payment-not-found" };
        return {
          ok: true,
          payment: {
            ...paymentView(row),
            recipientId: row.recipient_id,
            state: reviewStateOf(row),
            reviewerNames: this.#friendsSortedByName(this.#paymentReviewers(accountId, row.recipient_id)).map(
              (friend) => friend.name,
            ),
            thread: this.#thread(row.id, row.decision === null),
          },
        };
      },
      askOwner: (itemId, question) =>
        this.#command((): AskOwnerResult => {
          const { name } = account();
          const item = this.#itemToDecide(accountId, itemId);
          if (!item) return { ok: false, reason: "item-not-found" };
          if (item.row.decision !== null) return { ok: false, reason: "already-decided" };
          const text = question.trim();
          if (text === "") return { ok: false, reason: "blank-question" };
          this.#addComment(itemId, accountId, false, text);
          this.#enqueue({
            recipient: item.row.owner_account_id,
            kind: "reviewer-question",
            payload: {
              itemKind: item.kind,
              itemId,
              title: `${name} asked about your ${this.#itemWhat(item.kind, itemId)}`,
              body: `“${text}”`,
              url: itemPath(item.kind, itemId),
            },
          });
          return { ok: true };
        }),
      reply: (itemId, reply) =>
        this.#command((): ReplyResult => {
          const { name } = account();
          const item = this.#ownItem(accountId, itemId);
          if (!item) return { ok: false, reason: "item-not-found" };
          if (!item.waiting) return { ok: false, reason: "not-waiting" };
          if (!this.#thread(itemId, true).waitingOnReply) return { ok: false, reason: "no-question" };
          const text = reply.trim();
          if (text === "") return { ok: false, reason: "blank-reply" };
          this.#addComment(itemId, accountId, true, text);
          this.#tellAll(item.reviewerIds, "owner-replied", {
            itemKind: item.kind,
            itemId,
            title: `${name} replied about their ${this.#itemWhat(item.kind, itemId)}`,
            body: `“${text}” It's back in your queue.`,
            url: APP_PATHS.review,
          });
          return { ok: true };
        }),
      decide: (itemId, decision) =>
        this.#command((): DecideResult => {
          account();
          const item = this.#itemToDecide(accountId, itemId);
          if (!item) return { ok: false, reason: "item-not-found" };
          if (item.row.decision !== null) return { ok: false, reason: "already-decided" };
          const reason = decision.kind === "reject" ? decision.reason.trim() : null;
          if (reason === "") return { ok: false, reason: "blank-reason" };
          const decided: Decided =
            reason === null ? { outcome: "approved", reason: null } : { outcome: "rejected", reason };
          switch (item.kind) {
            case "evidence":
              this.#decideEvidence(item.row, decided, accountId);
              break;
            case "excuse":
              this.#decideExcuse(item.row, decided, accountId);
              break;
            case "payment":
              this.#decidePayment(item.row, decided, accountId);
              break;
            case "change-request":
              if (decided.outcome === "approved") {
                // Judging catches up on the pact first, as the scheduler would have: a change never
                // rescues an occurrence already due. Judging may End it, which withdraws the request.
                const [pact] = this.#pactsToJudge(item.row.pact_id);
                this.#judgePactDueBy(pact!, this.#clock.now());
                if (this.#waitingChangeRequestId(item.row.pact_id) !== item.row.id) {
                  return { ok: false, reason: "item-not-found" };
                }
              }
              if (decided.outcome === "approved" && !this.#approvableNow(item.row)) {
                return { ok: false, reason: "deadline-too-soon" };
              }
              this.#decideChangeRequest(item.row, decided, accountId);
              break;
          }
          return { ok: true };
        }),
      ledgers: () => {
        account();
        return this.#ledgerSummaries(accountId);
      },
      ledger: (recipientId) => {
        const { timezone } = account();
        const [summary] = this.#ledgerSummaries(accountId, recipientId);
        if (!summary) return { ok: false, reason: "recipient-not-found" };
        const penalties = this.#ledgerPenalties(accountId, recipientId, timezone);
        // A payment recorded the instant a penalty was added came after it, so it's listed first.
        const history = mergeByTime<LedgerEntry>(
          (entry) => (entry.kind === "penalty" ? entry.addedAt : entry.recordedAt),
          "newest-first",
          this.#ledgerPayments(accountId, recipientId),
          penalties,
        );
        return { ok: true, ledger: { summary, history } };
      },
    };
  }

  /**
   * The review item `itemId`, if `reviewerId` may decide it (decided or not):
   * evidence or an excuse for a pact they review (evidence once the pact's
   * edit window has closed), a payment to a recipient of any of the owner's
   * pacts they review, or a change request not withdrawn, for an Active pact.
   */
  #itemToDecide(reviewerId: AccountId, itemId: string): ItemToDecide | undefined {
    const evidence = this.#db
      .prepare(
        `SELECT evidence.id, evidence.pact_id, evidence.occurrence_date, evidence.day, evidence.decision,
                  pact.owner_account_id, owner.timezone
           FROM evidence
           JOIN pact ON pact.id = evidence.pact_id
           JOIN account AS owner ON owner.id = pact.owner_account_id
           JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
           WHERE evidence.id = ? AND pact.created_at <= ?`,
      )
      .get(reviewerId, itemId, this.#editWindowCutoff()) as EvidenceToDecide | undefined;
    if (evidence) return { kind: "evidence", row: evidence };
    const excuse = this.#db
      .prepare(
        `SELECT excuse.id, excuse.pact_id, excuse.decision, pact.owner_account_id
         FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE excuse.id = ?`,
      )
      .get(reviewerId, itemId) as ExcuseToDecide | undefined;
    if (excuse) return { kind: "excuse", row: excuse };
    const payment = this.#paymentToDecide(reviewerId, itemId);
    if (payment) return { kind: "payment", row: payment };
    const mayDecideRequest =
      this.#db
        .prepare(
          `SELECT 1 FROM change_request
           JOIN pact ON pact.id = change_request.pact_id
           JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                             AND pact_reviewer.reviewer_account_id = ?
           WHERE change_request.id = ? AND change_request.withdrawn_at IS NULL AND pact.stage = 'active'`,
        )
        .get(reviewerId, itemId) !== undefined;
    const changeRequest = mayDecideRequest ? this.#changeRequestRow(itemId) : undefined;
    return changeRequest && { kind: "change-request", row: changeRequest };
  }

  /**
   * One of `ownerId`'s review items: its kind, whether it's still waiting for
   * a decision (not decided, nor a change request withdrawn), and who may
   * decide it.
   */
  #ownItem(
    ownerId: AccountId,
    itemId: string,
  ): { kind: ReviewItem["kind"]; waiting: boolean; reviewerIds: AccountId[] } | undefined {
    const ofPact = (table: "evidence" | "excuse") =>
      this.#db
        .prepare(
          `SELECT ${table}.pact_id, ${table}.decision FROM ${table}
           JOIN pact ON pact.id = ${table}.pact_id
           WHERE ${table}.id = ? AND pact.owner_account_id = ?`,
        )
        .get(itemId, ownerId) as { pact_id: string; decision: ReviewOutcome | null } | undefined;
    for (const kind of ["evidence", "excuse"] as const) {
      const row = ofPact(kind);
      if (row) return { kind, waiting: row.decision === null, reviewerIds: this.#reviewersOf(row.pact_id) };
    }
    const payment = this.#db
      .prepare(`SELECT recipient_id, decision FROM payment WHERE id = ? AND owner_account_id = ?`)
      .get(itemId, ownerId) as { recipient_id: string; decision: ReviewOutcome | null } | undefined;
    if (payment) {
      return {
        kind: "payment",
        waiting: payment.decision === null,
        reviewerIds: this.#paymentReviewers(ownerId, payment.recipient_id),
      };
    }
    const request = this.#changeRequestRow(itemId);
    if (request && request.owner_account_id === ownerId) {
      return {
        kind: "change-request",
        waiting: request.decision === null && request.withdrawn_at === null,
        reviewerIds: this.#reviewersOf(request.pact_id),
      };
    }
    return undefined;
  }

  /** How a notification names a review item after "your" or "their": "evidence for Gym", "$10 payment to Sam". */
  #itemWhat(kind: ReviewItem["kind"], itemId: string): string {
    switch (kind) {
      case "evidence":
      case "excuse": {
        const { name } = this.#db
          .prepare(`SELECT pact.name FROM ${kind} JOIN pact ON pact.id = ${kind}.pact_id WHERE ${kind}.id = ?`)
          .get(itemId) as { name: string };
        return `${kind} for ${name}`;
      }
      case "payment": {
        const { amount_cents, recipient_id } = this.#db
          .prepare(`SELECT amount_cents, recipient_id FROM payment WHERE id = ?`)
          .get(itemId) as { amount_cents: number; recipient_id: string };
        return `${money(amount_cents)} payment to ${this.#recipientName(recipient_id)}`;
      }
      case "change-request": {
        const row = this.#changeRequestRow(itemId)!;
        const name = this.#pactName(row.pact_id);
        return row.request.kind === "end" ? `request to end ${name}` : `change to ${name}`;
      }
    }
  }

  /** Adds a question (a reviewer's) or a reply (the owner's) to an item's thread. */
  #addComment(itemId: string, authorId: AccountId, fromOwner: boolean, text: string): void {
    this.#db
      .prepare(`INSERT INTO comment (item_id, author_account_id, from_owner, text, sent_at) VALUES (?, ?, ?, ?, ?)`)
      .run(itemId, authorId, fromOwner ? 1 : 0, text, this.#clock.now().toISOString());
  }

  /**
   * An item's questions and replies, oldest first. `waiting` says the item is
   * still waiting for a decision; only then can it be waiting on a reply.
   */
  #thread(itemId: string, waiting: boolean): QuestionThread {
    const comments = (
      this.#db
        .prepare(
          `SELECT comment.from_owner, account.name, comment.text, comment.sent_at
           FROM comment JOIN account ON account.id = comment.author_account_id
           WHERE comment.item_id = ? ORDER BY comment.id`,
        )
        .all(itemId) as { from_owner: 0 | 1; name: string; text: string; sent_at: string }[]
    ).map((row) => ({
      fromOwner: row.from_owner === 1,
      authorName: row.name,
      text: row.text,
      sentAt: new Date(row.sent_at),
    }));
    return { comments, waitingOnReply: waiting && comments.at(-1)?.fromOwner === false };
  }

  /**
   * Alerts for the owner's items still waiting for a decision whose latest
   * comment is a reviewer's question, with when it was asked.
   */
  #questionAlerts(ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
    return this.#waiting(ownerId).flatMap((item) => {
      const { comments, waitingOnReply } = this.#thread(item.id, true);
      const question = comments.at(-1);
      if (!waitingOnReply || !question) return [];
      return [
        {
          at: question.sentAt,
          alert: {
            kind: "reviewer-question",
            item,
            reviewerName: question.authorName,
            question: question.text,
            askedAt: question.sentAt,
          },
        },
      ];
    });
  }

  /** Evidence as its reviewers and its owner see it, with what counts from `terms`: the occurrence's day's. */
  #evidenceView(row: EvidenceViewRow, terms = this.#termsOn(row.pact_id, row.occurrence_date)): EvidenceView {
    return {
      id: row.id,
      pactId: row.pact_id,
      pactName: row.pact_name,
      occurrenceDate: row.day,
      description: terms.description,
      photoIds: this.#evidencePhotoIds(row.id),
      submittedAt: new Date(row.submitted_at),
    };
  }

  /** An excuse as its reviewers and its owner see it, its days as they stand now. */
  #excuseView(row: ExcuseViewRow): ExcuseView {
    return {
      id: row.id,
      pactId: row.pact_id,
      pactName: row.pact_name,
      reason: row.reason,
      photoIds: this.#excusePhotoIds(row.id),
      filedAt: new Date(row.filed_at),
      days: this.#excuseDays(row.id, row.pact_id, row.timezone),
    };
  }

  /**
   * Every item `reviewerId` may decide, waiting on the owner's reply or not:
   * change requests first, then the rest oldest first.
   */
  #reviewItems(reviewerId: AccountId): ReviewItem[] {
    // Change requests first: one waiting holds up any other change to its pact.
    return [
      ...this.#changeRequestsToReview(reviewerId),
      ...mergeByTime(
        reviewItemSince,
        "oldest-first",
        this.#evidenceToReview(reviewerId),
        this.#excusesToReview(reviewerId),
        this.#paymentsToReview(reviewerId),
      ),
    ];
  }

  /** Evidence waiting for approval that `reviewerId` may decide: for pacts they review, past the edit window. */
  #evidenceToReview(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#db
      .prepare(
        `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, owner.name AS owner_name,
                evidence.submitted_at, evidence.occurrence_date, evidence.day, ${WEEKLY_COUNT_PACT} AS weekly
         FROM evidence
         JOIN pact ON pact.id = evidence.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE evidence.decision IS NULL AND pact.created_at <= ?
         ORDER BY evidence.submitted_at, evidence.id`,
      )
      .all(reviewerId, this.#editWindowCutoff()) as (EvidenceViewRow & { owner_name: string; weekly: 0 | 1 })[];
    return rows.map((row): ReviewItem => {
      // What counts, and what rejecting costs: the terms of the occurrence's day.
      const terms = this.#termsOn(row.pact_id, row.occurrence_date);
      return {
        kind: "evidence",
        ...this.#evidenceView(row, terms),
        ownerName: row.owner_name,
        penaltyCents: terms.penalty_cents,
        recipientName: this.#recipientName(terms.recipient_id),
        ...(row.weekly === 1 && { week: this.#weekProgress(row.pact_id, row.occurrence_date) }),
        thread: this.#thread(row.id, true),
      };
    });
  }

  /** The owner's penalties for `recipientId`, newest first, each with what's paid and the bill it's on or will make. */
  #ledgerPenalties(ownerId: AccountId, recipientId: string, timezone: string | null): LedgerPenalty[] {
    const penaltyRows = this.#db
      .prepare(
        `SELECT penalty.id, penalty.pact_id, pact.name AS pact_name, penalty.occurrence_date,
                penalty.amount_cents, penalty.added_at, penalty.bill_id, ${PENALTY_HELD} AS held,
                ${WEEKLY_COUNT_PACT} AS weekly
         FROM penalty JOIN pact ON pact.id = penalty.pact_id
         WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ?
         ORDER BY penalty.added_at DESC, penalty.occurrence_date DESC, pact.name, penalty.id`,
      )
      .all(ownerId, recipientId) as {
      id: string;
      pact_id: string;
      pact_name: string;
      occurrence_date: string;
      amount_cents: number;
      added_at: string;
      bill_id: string | null;
      held: 0 | 1;
      weekly: 0 | 1;
    }[];
    const allocation = this.#allocate(ownerId, recipientId);
    const bills = this.#billsOf(ownerId, recipientId);
    return penaltyRows.map((row): LedgerPenalty => {
      const held = row.held === 1;
      // Missed with evidence means all of it was rejected, on Fixed days; a short week is its own miss.
      const rejection = row.weekly === 1 ? null : this.#rejection(row.pact_id, row.occurrence_date);
      const bill = bills.find((b) => b.id === row.bill_id);
      return {
        kind: "penalty",
        penaltyId: row.id,
        pactId: row.pact_id,
        pactName: row.pact_name,
        occurrenceDate: row.occurrence_date,
        amountCents: row.amount_cents,
        ...(row.weekly === 1 && { week: this.#weekProgress(row.pact_id, row.occurrence_date) }),
        addedAt: new Date(row.added_at),
        paidCents: allocation.get(row.id)?.paidCents ?? 0,
        ...(rejection && { rejection }),
        held,
        bill: bill
          ? { kind: "on-bill", billedOn: bill.billedOn, dueAt: bill.dueAt }
          : {
              // A rejected excuse releases it to the next bill it can make, as if it had never been held.
              kind: held ? "if-excuse-rejected" : "next-bill",
              billedOn: nextBillDay(new Date(row.added_at), this.#clock.now(), ownerZone(timezone, ownerId)),
            },
      };
    });
  }

  /**
   * The owner's ledgers, sorted by name: one per recipient a pact names or a
   * penalty went to. Just the one for `recipientId`, if given.
   */
  #ledgerSummaries(ownerId: AccountId, recipientId?: string): LedgerSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT recipient.id, recipient.name,
                (SELECT COALESCE(SUM(amount_cents), 0) FROM penalty
                 WHERE penalty.owner_account_id = recipient.owner_account_id
                   AND penalty.recipient_id = recipient.id AND NOT ${PENALTY_HELD}) AS penalty_cents,
                COALESCE(SUM(payment.amount_cents) FILTER (WHERE payment.decision = 'approved'), 0) AS paid_cents,
                COALESCE(SUM(payment.amount_cents) FILTER (WHERE payment.decision IS NULL), 0) AS awaiting_cents,
                COUNT(payment.id) FILTER (WHERE payment.decision IS NULL) AS awaiting_count
         FROM recipient
         LEFT JOIN payment
           ON payment.owner_account_id = recipient.owner_account_id AND payment.recipient_id = recipient.id
         WHERE recipient.owner_account_id = ?
           AND (? IS NULL OR recipient.id = ?)
           AND (EXISTS (SELECT 1 FROM pact WHERE pact.recipient_id = recipient.id)
                OR EXISTS (SELECT 1 FROM penalty WHERE penalty.recipient_id = recipient.id))
         GROUP BY recipient.id`,
      )
      .all(ownerId, recipientId ?? null, recipientId ?? null) as {
      id: string;
      name: string;
      penalty_cents: number;
      paid_cents: number;
      awaiting_cents: number;
      awaiting_count: number;
    }[];
    const now = this.#clock.now();
    return rows.sort(byName).map((row) => {
      // An excuse approved after its penalty was paid leaves more paid than
      // owed. The surplus pays the next penalties (#allocate), and owed is $0
      // meanwhile, never below.
      const owedCents = Math.max(0, row.penalty_cents - row.paid_cents);
      const payableCents = Math.max(0, owedCents - row.awaiting_cents);
      const bills = this.#billsOf(ownerId, row.id);
      const billDue = billDueOf(bills, now);
      const overdueCents = overdueOf(bills, now)?.cents ?? 0;
      const billsCents = overdueCents + (billDue?.amountCents ?? 0);
      return {
        recipientId: row.id,
        name: row.name,
        owedCents,
        payableCents,
        awaitingCents: row.awaiting_cents,
        awaitingCount: row.awaiting_count,
        paidCents: row.paid_cents,
        suggestedPaymentCents: billsCents > 0 ? Math.min(billsCents, payableCents) : payableCents,
        overdueCents,
        billDue: billDue && { amountCents: billDue.amountCents, dueAt: billDue.dueAt },
      };
    });
  }

  /**
   * How payments to `recipientId` apply to the owner's penalties, oldest
   * first: approved payments pay them (`paidCents`), then payments awaiting
   * approval cover what's left (`coveredCents`). Billed penalties come first,
   * oldest bill first, then those not on a bill yet, so a payment that paid a
   * bill stays on it when an older held penalty is released later. Held
   * penalties aren't owed, so payments skip them.
   */
  #allocate(ownerId: AccountId, recipientId: string): Map<string, { paidCents: number; coveredCents: number }> {
    const totals = this.#db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE decision = 'approved'), 0) AS approved,
                COALESCE(SUM(amount_cents) FILTER (WHERE decision IS NULL), 0) AS awaiting
         FROM payment WHERE owner_account_id = ? AND recipient_id = ?`,
      )
      .get(ownerId, recipientId) as { approved: number; awaiting: number };
    const rows = this.#db
      .prepare(
        `SELECT penalty.id, penalty.amount_cents FROM penalty JOIN pact ON pact.id = penalty.pact_id
         LEFT JOIN bill ON bill.id = penalty.bill_id
         WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ? AND NOT ${PENALTY_HELD}
         ORDER BY bill.id IS NULL, bill.created_at, bill.id,
                  penalty.added_at, penalty.occurrence_date, pact.name DESC, penalty.id DESC`,
      )
      .all(ownerId, recipientId) as { id: string; amount_cents: number }[];
    let approved = totals.approved;
    let awaiting = totals.awaiting;
    const allocation = new Map<string, { paidCents: number; coveredCents: number }>();
    for (const row of rows) {
      const paidCents = Math.min(row.amount_cents, approved);
      approved -= paidCents;
      const coveredCents = Math.min(row.amount_cents - paidCents, awaiting);
      awaiting -= coveredCents;
      allocation.set(row.id, { paidCents, coveredCents });
    }
    return allocation;
  }

  /** The owner's bills to `recipientId`, oldest first, with what's unpaid and what payments awaiting approval don't cover. */
  #billsOf(ownerId: AccountId, recipientId: string): BillState[] {
    const allocation = this.#allocate(ownerId, recipientId);
    const bills = this.#db
      .prepare(
        `SELECT id, billed_on, due_at FROM bill WHERE owner_account_id = ? AND recipient_id = ?
         ORDER BY created_at, id`,
      )
      .all(ownerId, recipientId) as { id: string; billed_on: LocalDate; due_at: string }[];
    return bills.map((bill) => {
      const penalties = this.#db.prepare(`SELECT id, amount_cents FROM penalty WHERE bill_id = ?`).all(bill.id) as {
        id: string;
        amount_cents: number;
      }[];
      let unpaidCents = 0;
      let uncoveredCents = 0;
      for (const penalty of penalties) {
        const { paidCents, coveredCents } = allocation.get(penalty.id) ?? { paidCents: 0, coveredCents: 0 };
        unpaidCents += penalty.amount_cents - paidCents;
        uncoveredCents += penalty.amount_cents - paidCents - coveredCents;
      }
      return { id: bill.id, billedOn: bill.billed_on, dueAt: new Date(bill.due_at), unpaidCents, uncoveredCents };
    });
  }

  /**
   * Makes the Wednesday bills due by `t` for every account with a timezone,
   * from where billing got to (catching up after downtime): at each
   * Wednesday 18:00, one bill per recipient for the owed penalties not on a
   * bill whose 48-hour excuse window had closed by then. No penalties, no
   * bill. The owner is told of each bill with something left to pay.
   */
  #makeBills(t: Date): void {
    const accounts = this.#db
      .prepare(
        `SELECT id, timezone, created_at, billed_through FROM account WHERE timezone IS NOT NULL
                ORDER BY created_at, id`,
      )
      .all() as { id: AccountId; timezone: string; created_at: string; billed_through: string | null }[];
    for (const account of accounts) {
      const from = new Date(account.billed_through ?? account.created_at);
      if (from.getTime() >= t.getTime()) continue;
      for (const wednesday of billDays(from, t, account.timezone)) {
        this.#billOwner(account.id, wednesday, account.timezone);
      }
      this.#db.prepare(`UPDATE account SET billed_through = ? WHERE id = ?`).run(t.toISOString(), account.id);
    }
  }

  #billOwner(ownerId: AccountId, wednesday: LocalDate, timezone: string): void {
    const createdAt = billInstant(wednesday, timezone);
    const dueAt = billInstant(addDays(wednesday, BILL_TERM_DAYS), timezone);
    const excusableAfter = new Date(createdAt.getTime() - EXCUSE_WINDOW_MS).toISOString();
    const recipients = this.#db
      .prepare(
        `SELECT DISTINCT penalty.recipient_id FROM penalty
         WHERE penalty.owner_account_id = ? AND penalty.bill_id IS NULL AND penalty.added_at <= ?
           AND NOT ${PENALTY_HELD}
         ORDER BY penalty.recipient_id`,
      )
      .all(ownerId, excusableAfter) as { recipient_id: string }[];
    for (const { recipient_id: recipientId } of recipients) {
      const billId = this.#newId();
      this.#db
        .prepare(
          `INSERT INTO bill (id, owner_account_id, recipient_id, billed_on, created_at, due_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(billId, ownerId, recipientId, wednesday, createdAt.toISOString(), dueAt.toISOString());
      this.#db
        .prepare(
          `UPDATE penalty SET bill_id = ?
           WHERE owner_account_id = ? AND recipient_id = ? AND bill_id IS NULL AND added_at <= ?
             AND NOT ${PENALTY_HELD}`,
        )
        .run(billId, ownerId, recipientId, excusableAfter);
      const bill = this.#billsOf(ownerId, recipientId).find((b) => b.id === billId)!;
      if (bill.unpaidCents === 0) continue;
      this.#enqueue({
        recipient: ownerId,
        kind: "new-bill",
        payload: {
          recipientId,
          title: `New bill: ${money(bill.unpaidCents)} to ${this.#recipientName(recipientId)}`,
          body: `Due ${formatDate(addDays(wednesday, BILL_TERM_DAYS))} at ${clockText(BILL_CLOCK)}`,
          url: APP_PATHS.ledger(recipientId),
        },
      });
    }
  }

  /**
   * For each owner Overdue to a recipient at `t` (bills past due that
   * payments awaiting approval don't cover): reminds the owner once a day,
   * and tells the reviewers of the owner's pacts with that recipient when
   * a spell of being Overdue starts, then once a week while it lasts. A
   * spell ends only when approved payments have paid every bill past due; a
   * payment awaiting approval just pauses it, so a rejected one resumes it.
   */
  #remindOverdue(t: Date): void {
    const ledgers = this.#db
      .prepare(
        `SELECT DISTINCT bill.owner_account_id, bill.recipient_id, account.name AS owner_name
         FROM bill JOIN account ON account.id = bill.owner_account_id
         WHERE bill.due_at <= ?
         ORDER BY bill.owner_account_id, bill.recipient_id`,
      )
      .all(t.toISOString()) as { owner_account_id: AccountId; recipient_id: string; owner_name: string }[];
    for (const { owner_account_id: ownerId, recipient_id: recipientId, owner_name: ownerName } of ledgers) {
      const overdue = overdueOf(this.#billsOf(ownerId, recipientId), t);
      if (overdue === null) continue;
      const notice = this.#overdueNotice(ownerId, recipientId, overdue.spellStartedAt);
      const since = (at: Date | null) => (at === null ? Infinity : t.getTime() - at.getTime());
      const recipientName = this.#recipientName(recipientId);
      const remind = since(notice.ownerRemindedAt) >= OVERDUE_REMINDER_MS;
      const tell = since(notice.reviewersToldAt) >= OVERDUE_REVIEWER_NOTICE_MS;
      if (remind) {
        this.#enqueue({
          recipient: ownerId,
          kind: "overdue-bill",
          payload: {
            recipientId,
            title: `${money(overdue.cents)} overdue to ${recipientName}`,
            body: `Your ${formatDate(overdue.billedOn)} bill was due ${formatDate(localDateOf(overdue.dueAt, this.#timezoneOf(ownerId)))}. Record your payment.`,
            url: APP_PATHS.ledger(recipientId),
          },
        });
      }
      if (tell) {
        for (const reviewerId of this.#paymentReviewers(ownerId, recipientId)) {
          this.#enqueue({
            recipient: reviewerId,
            kind: "overdue-bill",
            payload: {
              recipientId,
              title: `${ownerName} is overdue`,
              body: `${money(overdue.cents)} to ${recipientName}, due ${formatDate(localDateOf(overdue.dueAt, this.#timezoneOf(ownerId)))}`,
              url: APP_PATHS.today,
            },
          });
        }
      }
      if (remind || tell) {
        this.#db
          .prepare(
            `INSERT INTO overdue_notice (owner_account_id, recipient_id, owner_reminded_at, reviewers_told_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (owner_account_id, recipient_id) DO UPDATE
             SET owner_reminded_at = excluded.owner_reminded_at, reviewers_told_at = excluded.reviewers_told_at`,
          )
          .run(
            ownerId,
            recipientId,
            remind ? t.toISOString() : (notice.ownerRemindedAt?.toISOString() ?? null),
            tell ? t.toISOString() : (notice.reviewersToldAt?.toISOString() ?? null),
          );
      }
    }
  }

  /**
   * When the owner was last reminded about a ledger's overdue bills, and when
   * its reviewers were last told, in the Overdue spell that started at
   * `spellStartedAt`. A notice from an earlier spell, before the bills now
   * unpaid fell due, doesn't count: null.
   */
  #overdueNotice(
    ownerId: AccountId,
    recipientId: string,
    spellStartedAt: Date,
  ): { ownerRemindedAt: Date | null; reviewersToldAt: Date | null } {
    const row = this.#db
      .prepare(
        `SELECT owner_reminded_at, reviewers_told_at FROM overdue_notice
         WHERE owner_account_id = ? AND recipient_id = ?`,
      )
      .get(ownerId, recipientId) as { owner_reminded_at: string | null; reviewers_told_at: string | null } | undefined;
    const ifThisSpell = (at: string | null | undefined) =>
      at === null || at === undefined || new Date(at).getTime() < spellStartedAt.getTime() ? null : new Date(at);
    return {
      ownerRemindedAt: ifThisSpell(row?.owner_reminded_at),
      reviewersToldAt: ifThisSpell(row?.reviewers_told_at),
    };
  }

  #timezoneOf(accountId: AccountId): string {
    const row = this.#db.prepare(`SELECT timezone FROM account WHERE id = ?`).get(accountId) as {
      timezone: string | null;
    };
    return ownerZone(row.timezone, accountId);
  }

  /** Today's bill cards and overdue alerts: one of each at most per recipient. */
  #billsForToday(ownerId: AccountId, now: Date): { cards: TodayBillCard[]; alerts: TodayAlert[] } {
    const cards: TodayBillCard[] = [];
    const alerts: TodayAlert[] = [];
    const recipients = this.#db
      .prepare(
        `SELECT DISTINCT recipient.id, recipient.name FROM bill
         JOIN recipient ON recipient.id = bill.recipient_id
         WHERE bill.owner_account_id = ?`,
      )
      .all(ownerId) as Recipient[];
    for (const { id: recipientId, name } of recipients.sort(byName)) {
      const bills = this.#billsOf(ownerId, recipientId);
      const overdue = overdueOf(bills, now);
      if (overdue !== null) {
        // Named only once the core has told them in this spell: until the scheduler's next tick, nobody has been.
        // A reviewer with overdue notifications off is never told, so never named.
        const told = this.#overdueNotice(ownerId, recipientId, overdue.spellStartedAt).reviewersToldAt !== null;
        alerts.push({
          kind: "bill-overdue",
          recipientId,
          recipientName: name,
          overdueCents: overdue.cents,
          billedOn: overdue.billedOn,
          dueAt: overdue.dueAt,
          reviewerNames: told
            ? this.#friendsSortedByName(
                this.#paymentReviewers(ownerId, recipientId).filter((id) => !this.#settingIsOff(id, "overdue-bill")),
              ).map((friend) => friend.name)
            : [],
        });
      }
      const due = billDueOf(bills, now);
      if (due !== null) cards.push({ kind: "bill", recipientId, recipientName: name, ...due });
    }
    return { cards, alerts };
  }

  /** The owner's payments to `recipientId` and where each one's review stands, newest recorded first. */
  #ledgerPayments(ownerId: AccountId, recipientId: string): LedgerPayment[] {
    const rows = this.#db
      .prepare(
        `SELECT payment.id, payment.amount_cents, payment.note, payment.recorded_at, ${reviewStateColumns("payment")}
         FROM payment LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
         WHERE payment.owner_account_id = ? AND payment.recipient_id = ?
         ORDER BY payment.recorded_at DESC, payment.id`,
      )
      .all(ownerId, recipientId) as (ReviewStateRow & {
      id: string;
      amount_cents: number;
      note: string | null;
      recorded_at: string;
    })[];
    return rows.map((row) => ({
      kind: "payment",
      paymentId: row.id,
      amountCents: row.amount_cents,
      note: row.note,
      recordedAt: new Date(row.recorded_at),
      state: reviewStateOf(row),
    }));
  }

  /**
   * Whether `ownerId` may record `payment`, screenshot aside: to one of their
   * recipients, a positive whole number of cents, and no more than the
   * ledger's `payableCents`: owed less payments already awaiting approval.
   */
  #paymentAcceptance(
    ownerId: AccountId,
    payment: NewPayment,
  ): { ok: true } | { ok: false; reason: RecordPaymentRefusal } {
    const isOwnRecipient = this.#db
      .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
      .get(payment.recipientId, ownerId);
    if (!isOwnRecipient) return { ok: false, reason: "recipient-not-found" };
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      return { ok: false, reason: "invalid-amount" };
    }
    // A recipient no pact names and with no penalties has no ledger: nothing is owed.
    const [ledger] = this.#ledgerSummaries(ownerId, payment.recipientId);
    if (payment.amountCents > (ledger?.payableCents ?? 0)) return { ok: false, reason: "payment-exceeds-owed" };
    return { ok: true };
  }

  /**
   * Records a reviewer's decision on waiting evidence and tells the owner.
   * A rejection is final: it judges the occurrence Missed as of now, open or
   * not. An approval judges it Satisfied as of now once judging has reached it,
   * since it was waiting on this decision; before that, judging at the due
   * time will.
   */
  #decideEvidence(evidence: EvidenceToDecide, decided: Decided, reviewerId: AccountId): void {
    const { outcome, reason } = decided;
    const now = this.#clock.now();
    this.#recordDecision("evidence", evidence.id, decided, reviewerId, now);
    // A day ahead with an approved excuse stays for judging at its due time, which makes it Excused.
    const excusedAhead = this.#excuseOn(evidence.pact_id, evidence.occurrence_date) === "approved";
    const occurrence = this.#occurrencesOf(evidence.pact_id, evidence.timezone).covering(evidence.occurrence_date);
    if (occurrence === null || this.#dueAfterEnd(evidence.pact_id, occurrence)) {
      // The pact Ended before the day fell due: it's never judged.
    } else if (this.#isWeekly(evidence.pact_id)) {
      // A week waiting on this decision past its due time is judged now; the decision told the owner.
      if (
        !this.#isJudged(evidence.pact_id, evidence.occurrence_date) &&
        this.#judgingReached(evidence.pact_id, evidence.occurrence_date, now)
      ) {
        this.#judgeWeek(evidence.pact_id, occurrence, now, false);
      }
    } else if (
      !this.#isJudged(evidence.pact_id, evidence.occurrence_date) &&
      ((outcome === "rejected" && !excusedAhead) ||
        this.#judgingReached(evidence.pact_id, evidence.occurrence_date, now))
    ) {
      const judged = outcome === "approved" ? "satisfied" : excusedAhead ? "excused" : "missed";
      this.#judge(evidence.pact_id, evidence.occurrence_date, judged, now);
    }
    this.#enqueue({
      recipient: evidence.owner_account_id,
      kind: "evidence-decided",
      payload: {
        itemKind: "evidence",
        itemId: evidence.id,
        pactId: evidence.pact_id,
        ...decisionDetails(decided),
        title: `${this.#accountName(reviewerId)} ${outcome} your evidence`,
        body: `${this.#pactName(evidence.pact_id)} · ${reason === null ? formatDate(evidence.day) : `“${reason}”`}`,
        // A rejection shows as an alert on Today, where the owner can respond to it.
        url: outcome === "approved" ? APP_PATHS.pact(evidence.pact_id) : APP_PATHS.today,
      },
    });
  }

  /**
   * Where the pact's occurrence `occurrence` stands as of `now`, excuses
   * included.
   */
  #occurrenceStatus(pactId: string, occurrence: Occurrence): OccurrenceStatus {
    const { date } = occurrence;
    const row = this.#db
      .prepare(
        `SELECT occurrence.outcome, occurrence.judged_at, penalty.amount_cents
         FROM occurrence
         LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
      )
      .get(pactId, date) as
      | { outcome: "satisfied" | "missed" | "excused" | null; judged_at: string | null; amount_cents: number | null }
      | undefined;
    const excuse = this.#excuseOn(pactId, date);
    if (row?.outcome === "satisfied") return { kind: "satisfied" };
    if (row?.outcome === "excused") return { kind: "excused" };
    if (row?.outcome === "missed") {
      return {
        kind: "missed",
        penaltyCents: row.amount_cents!,
        held: excuse === "waiting",
        excusableUntil: new Date(new Date(row.judged_at!).getTime() + EXCUSE_WINDOW_MS),
      };
    }
    return {
      kind: "not-judged",
      opensAt: occurrence.opensAt,
      dueAt: occurrence.dueAt,
      evidenceWaiting: this.#evidenceDecision(pactId, date) === "waiting",
      excuse,
    };
  }

  /** The pact page's history: its one occurrence, its weeks, or its days, from the first occurrence `first`. */
  #pactHistory(row: PactRow, timezone: string, first: Occurrence, now: Date): PactHistory {
    switch (scheduleOf(row.schedule).kind) {
      case "one-time":
        return { kind: "one-time", day: { date: first.date, occurrence: this.#occurrenceRecord(row, first) } };
      case "weekly-count":
        return { kind: "weekly-count", weeks: this.#heatMapWeeks(row, timezone, first.date, now) };
      case "fixed-days":
        return { kind: "fixed-days", days: this.#heatMapDays(row, timezone, first.date, now) };
    }
  }

  /**
   * The pact's heat map as of `now`: every day from its first occurrence
   * through the Sunday ending this week, or the week it Ended, or its first
   * occurrence's week while that's ahead.
   */
  #heatMapDays(pact: PactRow, timezone: string, first: LocalDate, now: Date): HeatMapDay[] {
    const endedOn = endedOnOf(pact, timezone);
    const last = laterDate(first, endedOn ?? localDateOf(now, timezone));
    const sunday = addDays(last, WEEKDAYS.length - 1 - WEEKDAYS.indexOf(weekdayOf(last)));
    return this.#occurrenceRecords(pact, timezone, first, sunday);
  }

  /**
   * A Weekly count pact's heat map as of `now`: every week from its first
   * through this one, or the one it Ended, or its first while that's ahead;
   * none from the week it Ended that was never judged.
   */
  #heatMapWeeks(pact: PactRow, timezone: string, first: LocalDate, now: Date): HeatMapWeek[] {
    const endedOn = endedOnOf(pact, timezone);
    const last = laterDate(first, endedOn ?? localDateOf(now, timezone));
    return this.#occurrencesOf(pact.id, timezone)
      .between(first, last)
      .map((week) => {
        const record = this.#occurrenceRecord(pact, week);
        const afterEnd = endedOn !== null && week.date >= mondayOf(endedOn) && record.status.kind === "not-judged";
        return {
          date: week.date,
          occurrence: afterEnd ? null : record,
          progress: this.#weekProgress(pact.id, week.date),
        };
      });
  }

  /** The owner's pacts due yesterday, by name, each with how its occurrence went. */
  #yesterday(ownerId: AccountId, timezone: string): TodayYesterdayEntry[] {
    const yesterday = addDays(localDateOf(this.#clock.now(), timezone), -1);
    // A Weekly count week isn't due on any one day.
    const pacts = this.#db
      .prepare(
        `SELECT * FROM pact WHERE owner_account_id = ? AND NOT ${WEEKLY_COUNT_PACT} ORDER BY name, created_at, id`,
      )
      .all(ownerId) as PactRow[];
    return pacts.flatMap((pact) =>
      this.#occurrenceRecords(pact, timezone, yesterday, yesterday).flatMap(({ date, occurrence }) =>
        occurrence
          ? [{ pactId: pact.id, name: pact.name, evidenceKind: pact.evidence_kind, occurrenceDate: date, occurrence }]
          : [],
      ),
    );
  }

  /**
   * How each of the pact's days from `from` to `to` went, oldest first: null
   * on a day it has no occurrence. An Ended pact has none from the day it
   * Ended, except one a decision has judged since.
   */
  #occurrenceRecords(pact: PactRow, timezone: string, from: LocalDate, to: LocalDate): HeatMapDay[] {
    const endedOn = endedOnOf(pact, timezone);
    const found = new Map(
      this.#occurrencesOf(pact.id, timezone)
        .between(from, to)
        .map((occurrence) => [occurrence.date, occurrence]),
    );
    const days: HeatMapDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const occurrence = found.get(date);
      const record = occurrence ? this.#occurrenceRecord(pact, occurrence) : null;
      const afterEnd = endedOn !== null && date >= endedOn && record?.status.kind === "not-judged";
      days.push({ date, occurrence: afterEnd ? null : record });
    }
    return days;
  }

  /** How the pact's `occurrence` went, as of now: where it stands, who settled it, and a bedtime night's sleep. */
  #occurrenceRecord(
    pact: Pick<PactRow, "id" | "evidence_kind" | "schedule">,
    occurrence: Occurrence,
  ): OccurrenceRecord {
    const status = this.#occurrenceStatus(pact.id, occurrence);
    const row = this.#db
      .prepare(
        `SELECT occurrence.bedtime_start, occurrence.anki_cards_left, occurrence.anki_checked_at,
                recipient.name AS recipient_name
         FROM occurrence
         LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         LEFT JOIN recipient ON recipient.id = penalty.recipient_id
         WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
      )
      .get(pact.id, occurrence.date) as
      | {
          bedtime_start: string | null;
          anki_cards_left: number | null;
          anki_checked_at: string | null;
          recipient_name: string | null;
        }
      | undefined;
    const judged = status.kind === "satisfied" || status.kind === "missed";
    let detail: OccurrenceDetail | null = null;
    if (pact.evidence_kind === "oura" && judged) {
      const bedtimeStart = row?.bedtime_start ?? null;
      detail = { kind: "night", inBedAt: bedtimeStart === null ? null : wallClock(bedtimeStart).slice(11) };
    }
    if (pact.evidence_kind === "anki" && row && judged) detail = { kind: "anki", lastCheck: ankiCheckOf(row) };
    return { status: this.#recordedStatus(pact, occurrence.date, status, row?.recipient_name ?? null), detail };
  }

  /**
   * `status` with the decision that settled it: its approved evidence
   * (Satisfied), its rejected evidence and where the penalty went (Missed), or
   * the approved excuse that covers it (Excused, or a day not judged yet it
   * already excuses).
   */
  #recordedStatus(
    pact: Pick<PactRow, "id" | "schedule">,
    date: LocalDate,
    status: OccurrenceStatus,
    recipientName: string | null,
  ): RecordedStatus {
    const pactId = pact.id;
    // A Weekly count week is Satisfied or Missed by its days, not by any one decision.
    const weekly = scheduleOf(pact.schedule).kind === "weekly-count";
    switch (status.kind) {
      case "satisfied": {
        const row = weekly
          ? undefined
          : (this.#db
              .prepare(
                `SELECT account.name FROM evidence JOIN account ON account.id = evidence.decided_by_account_id
                 WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'approved'`,
              )
              .get(pactId, date) as { name: string } | undefined);
        return { ...status, approvedBy: row?.name ?? null };
      }
      case "missed":
        return { ...status, recipientName, rejection: weekly ? null : this.#rejection(pactId, date) };
      case "excused":
      case "not-judged": {
        const covered = status.kind === "excused" || status.excuse === "approved";
        const row = covered
          ? (this.#db
              .prepare(
                `SELECT account.name, excuse.reason FROM excuse_day
                 JOIN excuse ON excuse.id = excuse_day.excuse_id
                 JOIN account ON account.id = excuse.decided_by_account_id
                 WHERE excuse_day.pact_id = ? AND excuse_day.date = ? AND excuse.decision = 'approved'
                 ORDER BY excuse.decided_at DESC LIMIT 1`,
              )
              .get(pactId, date) as { name: string; reason: string } | undefined)
          : undefined;
        return { ...status, excuseApproval: row ? { reviewerName: row.name, reason: row.reason } : null };
      }
    }
  }

  /** Whether an excuse waiting for approval, or else an approved one, covers the occurrence. */
  #excuseOn(pactId: string, date: LocalDate): "waiting" | "approved" | null {
    const decisions = (
      this.#db
        .prepare(
          `SELECT excuse.decision FROM excuse_day JOIN excuse ON excuse.id = excuse_day.excuse_id
           WHERE excuse_day.pact_id = ? AND excuse_day.date = ?`,
        )
        .all(pactId, date) as { decision: ReviewOutcome | null }[]
    ).map((row) => row.decision);
    if (decisions.includes(null)) return "waiting";
    return decisions.includes("approved") ? "approved" : null;
  }

  /** Why a day with `status` can't be excused at `now`, or null if it can. */
  #skipReason(status: OccurrenceStatus, now: Date): ExcuseSkipReason | null {
    switch (status.kind) {
      case "satisfied":
        return "satisfied";
      case "excused":
        return "excused";
      case "missed":
        if (status.held) return "on-waiting-excuse";
        return status.excusableUntil.getTime() > now.getTime() ? null : "window-closed";
      case "not-judged":
        if (status.excuse === "waiting") return "on-waiting-excuse";
        return status.excuse === "approved" ? "excused" : null;
    }
  }

  /**
   * The owner's pact `pactId` and the days an excuse for it with `dates`
   * would cover at `now`, or why the dates are refused.
   */
  #excusePreview(
    ownerId: AccountId,
    timezone: string | null,
    pactId: string,
    dates: ExcuseDates,
    now: Date,
  ): { ok: true; preview: ExcusePreview } | { ok: false; reason: ExcuseDatesRefusal } {
    const pact = this.#ownPact(ownerId, pactId);
    if (!pact || timezone === null) return { ok: false, reason: "pact-not-found" };
    if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
    const { from, to } = dates;
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) return { ok: false, reason: "invalid-dates" };
    if (to > addDays(from, MAX_EXCUSE_SPAN_DAYS - 1)) return { ok: false, reason: "too-many-days" };
    const preview: ExcusePreview = { covered: [], skipped: [], heldCents: 0 };
    // On Weekly count, a day of a week covers the whole week. An Ended pact has no days after its end.
    for (const occurrence of this.#occurrencesOf(pactId, timezone).overlapping(from, to)) {
      if (this.#dueAfterEnd(pactId, occurrence)) continue;
      const day = this.#excuseDay(pactId, occurrence);
      const skipped = this.#skipReason(day.status, now);
      if (skipped !== null) {
        preview.skipped.push({ date: occurrence.date, reason: skipped });
        continue;
      }
      preview.covered.push(day);
      if (day.status.kind === "missed") preview.heldCents += day.status.penaltyCents;
    }
    return { ok: true, preview };
  }

  /**
   * The days an excuse covers, oldest first, as they stand now. A day ahead
   * that an approved change took off the schedule isn't one any more.
   */
  #excuseDays(excuseId: string, pactId: string, timezone: string): ExcuseDay[] {
    const { between } = this.#occurrencesOf(pactId, timezone);
    const dates = (
      this.#db.prepare(`SELECT date FROM excuse_day WHERE excuse_id = ? ORDER BY date`).all(excuseId) as {
        date: LocalDate;
      }[]
    ).map((row) => row.date);
    return dates.flatMap((date) => {
      const [occurrence] = between(date, date);
      return occurrence ? [this.#excuseDay(pactId, occurrence)] : [];
    });
  }

  /** The pact's `occurrence` as an excuse's day: a Weekly count week runs through its Sunday. */
  #excuseDay(pactId: string, occurrence: Occurrence): ExcuseDay {
    const schedule = scheduleOf(this.#termsOn(pactId, occurrence.date).schedule);
    return {
      date: occurrence.date,
      ...(schedule.kind === "weekly-count" && { through: lastDayOf(schedule, occurrence.date) }),
      status: this.#occurrenceStatus(pactId, occurrence),
    };
  }

  /** The photos of an excuse, in the order added. */
  #excusePhotoIds(excuseId: string): string[] {
    return (
      this.#db.prepare(`SELECT photo_id FROM excuse_photo WHERE excuse_id = ? ORDER BY position`).all(excuseId) as {
        photo_id: string;
      }[]
    ).map((row) => row.photo_id);
  }

  /** The owner's timezone and the pact's terms, for an excuse's pact. */
  #excusePact(excuseId: string): (PactRow & { timezone: string }) | undefined {
    return this.#db
      .prepare(
        `SELECT pact.*, account.timezone FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN account ON account.id = pact.owner_account_id
         WHERE excuse.id = ?`,
      )
      .get(excuseId) as (PactRow & { timezone: string }) | undefined;
  }

  /** "Mon Jan 5", or "Mon Jan 5 – Fri Jan 9" for several days; "Week of Mon Jan 5" for a Weekly count week. */
  #excuseDatesText(excuseId: string): string {
    const {
      first,
      last,
      pact_id: pactId,
    } = this.#db
      .prepare(`SELECT MIN(date) AS first, MAX(date) AS last, pact_id FROM excuse_day WHERE excuse_id = ?`)
      .get(excuseId) as { first: LocalDate; last: LocalDate; pact_id: string };
    const text = first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`;
    return this.#isWeekly(pactId) ? `Week of ${text}` : text;
  }

  /**
   * Records a reviewer's decision on an excuse waiting for approval and tells
   * the owner. Approved: its Missed days become Excused as of now, without
   * their penalties, and its days not judged yet that judging has reached
   * (their evidence was waiting) are judged Excused now; the rest are judged
   * Excused at their due time. A bedtime night not judged yet is left to
   * judging, which waits for Oura until it closes. Days the pact no longer
   * has after it Ended are left alone. Rejected: nothing to change, as its
   * holds are released by no longer waiting and its days are judged as usual.
   */
  #decideExcuse(excuse: ExcuseToDecide, decided: Decided, reviewerId: AccountId): void {
    const { outcome, reason } = decided;
    const now = this.#clock.now();
    this.#recordDecision("excuse", excuse.id, decided, reviewerId, now);
    if (outcome === "approved") {
      const dates = this.#db.prepare(`SELECT date FROM excuse_day WHERE excuse_id = ?`).all(excuse.id) as {
        date: LocalDate;
      }[];
      const { timezone, evidence_kind: evidenceKind } = this.#excusePact(excuse.id)!;
      const { covering } = this.#occurrencesOf(excuse.pact_id, timezone);
      for (const { date } of dates) {
        const occurrence = covering(date);
        // The pact Ended before the day fell due: it's never judged.
        if (occurrence === null || this.#dueAfterEnd(excuse.pact_id, occurrence)) continue;
        const row = this.#db
          .prepare(`SELECT outcome FROM occurrence WHERE pact_id = ? AND date = ?`)
          .get(excuse.pact_id, date) as { outcome: string | null } | undefined;
        if (row?.outcome === "missed") {
          this.#db.prepare(`DELETE FROM penalty WHERE pact_id = ? AND occurrence_date = ?`).run(excuse.pact_id, date);
          this.#db
            .prepare(`UPDATE occurrence SET outcome = 'excused', judged_at = ? WHERE pact_id = ? AND date = ?`)
            .run(now.toISOString(), excuse.pact_id, date);
        } else if (
          (row?.outcome ?? null) === null &&
          // A bedtime night waits for Oura until it closes: an on-time bedtime beats the excuse.
          evidenceKind !== "oura" &&
          this.#judgingReached(excuse.pact_id, date, now)
        ) {
          this.#judge(excuse.pact_id, date, "excused", now);
        }
      }
    }
    const dates = this.#excuseDatesText(excuse.id);
    this.#enqueue({
      recipient: excuse.owner_account_id,
      kind: "excuse-decided",
      payload: {
        itemKind: "excuse",
        itemId: excuse.id,
        pactId: excuse.pact_id,
        ...decisionDetails(decided),
        title: `${this.#accountName(reviewerId)} ${outcome} your excuse`,
        body: `${this.#pactName(excuse.pact_id)} · ${reason === null ? dates : `“${reason}”`}`,
        // A rejection shows as an alert on Today, where the owner can respond to it.
        url: outcome === "approved" ? APP_PATHS.excuse(excuse.id) : APP_PATHS.today,
      },
    });
  }

  /** Excuses waiting for approval that `reviewerId` may decide: those for pacts they review. */
  #excusesToReview(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#db
      .prepare(
        `SELECT excuse.id, excuse.reason, excuse.filed_at, pact.id AS pact_id, pact.name AS pact_name,
                owner.name AS owner_name, owner.timezone, recipient.name AS recipient_name
         FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN recipient ON recipient.id = pact.recipient_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE excuse.decision IS NULL
         ORDER BY excuse.filed_at, excuse.id`,
      )
      .all(reviewerId) as (ExcuseViewRow & { owner_name: string; recipient_name: string })[];
    return rows.map((row): ReviewItem => {
      const excuse = this.#excuseView(row);
      return {
        kind: "excuse",
        ...excuse,
        ownerName: row.owner_name,
        heldCents: excuse.days.reduce(
          (sum, { status }) => sum + (status.kind === "missed" ? status.penaltyCents : 0),
          0,
        ),
        recipientName: row.recipient_name,
        thread: this.#thread(row.id, true),
      };
    });
  }

  /** The owner's excuses waiting for a decision (or just those for `pactId`), newest first. */
  #waitingExcuses(ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
    const rows = this.#db
      .prepare(
        `SELECT excuse.id, excuse.pact_id, pact.name, excuse.filed_at,
                (SELECT MIN(date) FROM excuse_day WHERE excuse_id = excuse.id) AS first_date,
                (SELECT MAX(date) FROM excuse_day WHERE excuse_id = excuse.id) AS last_date
         FROM excuse JOIN pact ON pact.id = excuse.pact_id
         WHERE pact.owner_account_id = ? AND excuse.decision IS NULL AND (? IS NULL OR pact.id = ?)
         ORDER BY excuse.filed_at DESC, excuse.id`,
      )
      .all(ownerId, pactId ?? null, pactId ?? null) as {
      id: string;
      pact_id: string;
      name: string;
      filed_at: string;
      first_date: string;
      last_date: string;
    }[];
    return rows.map((row) => ({
      kind: "excuse",
      id: row.id,
      pactId: row.pact_id,
      name: row.name,
      firstDate: row.first_date,
      lastDate: row.last_date,
      filedAt: new Date(row.filed_at),
    }));
  }

  /**
   * One alert per rejected excuse of the owner's, newest rejection first,
   * until the owner takes the L on it or files a new excuse for any of its
   * days, and while it still covers a day on the schedule. With when it was
   * rejected, for ordering among the alerts.
   */
  #rejectedExcuseAlerts(ownerId: AccountId, now: Date): { at: Date; alert: TodayAlert }[] {
    const rows = this.#db
      .prepare(
        `SELECT excuse.id, excuse.pact_id, excuse.reject_reason, excuse.decided_at, pact.name, owner.timezone,
                reviewer.name AS reviewer_name
         FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN account AS reviewer ON reviewer.id = excuse.decided_by_account_id
         WHERE pact.owner_account_id = ? AND excuse.decision = 'rejected' AND excuse.rejection_accepted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM excuse_day AS mine
                           JOIN excuse_day AS other ON other.pact_id = mine.pact_id AND other.date = mine.date
                           JOIN excuse AS later ON later.id = other.excuse_id
                           WHERE mine.excuse_id = excuse.id AND later.filed_at > excuse.filed_at)
         ORDER BY excuse.decided_at DESC, excuse.id`,
      )
      .all(ownerId) as {
      id: string;
      pact_id: string;
      reject_reason: string;
      decided_at: string;
      name: string;
      timezone: string;
      reviewer_name: string;
    }[];
    return rows.flatMap((row) => {
      const days = this.#excuseDays(row.id, row.pact_id, row.timezone);
      // An approved change took all its days off the schedule: nothing is owed and nothing is left to do.
      if (days.length === 0) return [];
      const { owed } = this.#db
        .prepare(
          `SELECT COALESCE(SUM(penalty.amount_cents), 0) AS owed FROM excuse_day
           JOIN penalty ON penalty.pact_id = excuse_day.pact_id AND penalty.occurrence_date = excuse_day.date
           WHERE excuse_day.excuse_id = ? AND penalty.added_at <= ?`,
        )
        .get(row.id, row.decided_at) as { owed: number };
      const excusable = days.filter(({ status }) => this.#skipReason(status, now) === null);
      const closing = excusable.flatMap(({ status }) => (status.kind === "missed" ? [status.excusableUntil] : []));
      const closesAt = closing.length === 0 ? null : new Date(Math.min(...closing.map((d) => d.getTime())));
      return [
        {
          at: new Date(row.decided_at),
          alert: {
            kind: "excuse-rejected",
            excuseId: row.id,
            pactId: row.pact_id,
            name: row.name,
            reviewerName: row.reviewer_name,
            reason: row.reject_reason,
            firstDate: days[0]!.date,
            lastDate: days.at(-1)!.date,
            owedAgainCents: owed,
            hasDaysNotJudged: days.some(({ status }) => status.kind === "not-judged"),
            refile: excusable.length === 0 ? null : { closesAt },
          },
        },
      ];
    });
  }

  /**
   * The timing terms `pact` had before each change, oldest first. A One-time
   * change applies to its one occurrence, so it has none that count.
   */
  #earlierTermsOf(pact: PactClock & Pick<PactRow, "id">): EarlierTerms[] {
    const rows = this.#db
      .prepare(`SELECT until, schedule, in_bed_by, due_by FROM pact_earlier_terms WHERE pact_id = ? ORDER BY until`)
      .all(pact.id) as { until: LocalDate; schedule: string; in_bed_by: string | null; due_by: string | null }[];
    return rows.flatMap((row) => {
      const terms = scheduleTermsOf(pact, scheduleOf(row.schedule), row.in_bed_by, row.due_by);
      return hasSchedule(terms, "one-time") ? [] : [{ ...terms, until: row.until }];
    });
  }

  /**
   * The occurrences of pact `pactId` in `timezone`, each dated one on the
   * terms it opened with. A bedtime night closes on Oura's clock where the
   * owner is (`#ouraOffset`).
   */
  #occurrencesOf(pactId: string, timezone: string): Occurrences {
    const pact = this.#db
      .prepare(
        `SELECT id, schedule, first_occurrence, in_bed_by, due_by, end_date, created_at, owner_account_id,
                evidence_kind, anki_rollover_hour
         FROM pact WHERE id = ?`,
      )
      .get(pactId) as
      | Pick<
          PactRow,
          | "id"
          | "schedule"
          | "first_occurrence"
          | "in_bed_by"
          | "due_by"
          | "end_date"
          | "created_at"
          | "evidence_kind"
          | "owner_account_id"
          | "anki_rollover_hour"
        >
      | undefined;
    if (!pact) throw new Error(`no pact ${pactId}`);
    const ouraOffset = pact.evidence_kind === "oura" ? this.#ouraOffset(pact.owner_account_id, timezone) : null;
    return occurrencesOverTime(occurrenceTermsOf(pact), this.#earlierTermsOf(pact), timezone, ouraOffset);
  }

  /**
   * The UTC offset a bedtime night with no period yet closes on: the one on
   * the latest sleep Oura reported for `account`. Null, the account's
   * `timezone`, when Oura hasn't reported one with an offset, or when that
   * offset is the timezone's own at that moment: the owner was at home, and
   * the timezone also knows when its clocks change.
   */
  #ouraOffset(account: AccountId, timezone: string): OuraOffset {
    const row = this.#db.prepare(`SELECT oura_latest_bedtime_start FROM account WHERE id = ?`).get(account) as
      { oura_latest_bedtime_start: string | null } | undefined;
    const latest = row?.oura_latest_bedtime_start ?? null;
    const offset = latest === null ? null : utcOffsetOf(latest);
    if (latest === null || offset === null) return null;
    return utcOffsetMs(offset) === zoneOffsetAt(new Date(latest), timezone) ? null : offset;
  }

  /**
   * Keeps, for each account in `sleep`, the latest bedtime_start Oura has
   * reported with a UTC offset, by when it happened: Oura's clock where the
   * owner is now, for `#ouraOffset`. Deleted periods don't count.
   */
  #noteOuraClock(sleep: Map<AccountId, OuraSleepPeriod[]>): void {
    for (const [account, periods] of sleep) {
      const row = this.#db.prepare(`SELECT oura_latest_bedtime_start FROM account WHERE id = ?`).get(account) as
        { oura_latest_bedtime_start: string | null } | undefined;
      let latest = row?.oura_latest_bedtime_start ?? null;
      for (const { type, bedtime_start: start } of periods) {
        if (type === "deleted" || utcOffsetOf(start) === null) continue;
        if (latest === null || Date.parse(start) > Date.parse(latest)) latest = start;
      }
      if (latest === null || latest === row?.oura_latest_bedtime_start) continue;
      this.#db.prepare(`UPDATE account SET oura_latest_bedtime_start = ? WHERE id = ?`).run(latest, account);
    }
  }

  /** The terms the pact's occurrence dated `date` follows: those in force when it opened. */
  #termsOn(pactId: string, date: LocalDate): DatedTerms {
    const columns = `description, schedule, in_bed_by, due_by, penalty_cents, recipient_id, anki_deck_id`;
    const earlier = this.#db
      .prepare(`SELECT ${columns} FROM pact_earlier_terms WHERE pact_id = ? AND until > ? ORDER BY until LIMIT 1`)
      .get(pactId, date) as DatedTerms | undefined;
    return earlier ?? (this.#db.prepare(`SELECT ${columns} FROM pact WHERE id = ?`).get(pactId) as DatedTerms);
  }

  /** The pact's terms an owner can change, as they stand. */
  #changeableTerms(pact: PactRow): ChangeableTerms {
    return {
      name: pact.name,
      description: pact.description,
      inBedBy: pact.in_bed_by,
      dueBy: pact.due_by,
      startDate: pact.start_date,
      endDate: pact.end_date,
      schedule: scheduleOf(pact.schedule),
      penaltyCents: pact.penalty_cents,
      recipientId: pact.recipient_id,
      reviewerIds: this.#reviewersOf(pact.id),
      reminders: remindersOf(pact.reminders),
      ankiDeckId: pact.anki_deck_id,
    };
  }

  /** The pact's terms as the pact page and a change request show them. */
  #currentTerms(pact: PactRow): CurrentTerms & Pick<PactTerms, "reminders"> {
    const [recipient] = this.#selectRecipients(`id = ?`, pact.recipient_id);
    if (!recipient) throw new Error(`pact ${pact.id} has no recipient ${pact.recipient_id}`);
    return {
      ...this.#termsByKind(pact),
      name: pact.name,
      description: pact.description,
      startDate: pact.start_date,
      endDate: pact.end_date,
      penaltyCents: pact.penalty_cents,
      recipient,
      reviewers: this.#friendsSortedByName(this.#reviewersOf(pact.id)),
      reminders: remindersOf(pact.reminders),
    };
  }

  /** The terms that depend on the pact's evidence kind. */
  #termsByKind(pact: PactRow): TermsByKind {
    const schedule = scheduleOf(pact.schedule);
    if (pact.evidence_kind === "camera") return { evidenceKind: "camera", schedule, dueBy: pact.due_by };
    if (schedule.kind !== "fixed-days") throw new Error(`${pact.evidence_kind} pact ${pact.id} isn't on Fixed days`);
    if (pact.evidence_kind === "oura") {
      if (pact.in_bed_by === null) throw new Error(`Oura Ring pact ${pact.id} has no in-bed-by time`);
      return { evidenceKind: "oura", schedule, inBedBy: pact.in_bed_by };
    }
    const anki = this.#ankiTerms(pact);
    if (!anki) throw new Error(`Anki pact ${pact.id} has no deck`);
    return { evidenceKind: "anki", schedule, dueBy: pact.due_by, anki };
  }

  /** The accounts `ids` as friends, sorted by name. */
  #friendsSortedByName(ids: AccountId[]): Friend[] {
    return ids.map((id) => ({ id, name: this.#accountName(id) })).sort(byName);
  }

  /** The id of the pact's change request waiting for a decision, or null. */
  #waitingChangeRequestId(pactId: string): string | null {
    const row = this.#db
      .prepare(`SELECT id FROM change_request WHERE pact_id = ? AND decision IS NULL AND withdrawn_at IS NULL`)
      .get(pactId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * What sending `change` to the owner's pact would do at `now`: the pact,
   * its terms before and after, what each changed term does, and the whole
   * change's outcome; or why it's refused.
   */
  #checkedChange(
    ownerId: AccountId,
    timezone: string | null,
    pactId: string,
    change: PactChange,
    now: Date,
  ):
    | {
        ok: true;
        pact: PactRow;
        timezone: string;
        before: ChangeableTerms;
        after: ChangeableTerms;
        diffs: TermDiff[];
        outcome: ChangeOutcome;
      }
    | { ok: false; reason: ChangePactRefusal } {
    const pact = this.#ownPact(ownerId, pactId);
    if (!pact) return { ok: false, reason: "pact-not-found" };
    if (pact.stage === "ended") return { ok: false, reason: "pact-ended" };
    if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
    const { note: _note, ankiDeckId: newDeckId, ...terms } = change;
    // An Anki pact keeps its deck unless the change names another.
    const ankiDeckId = pact.anki_deck_id === null ? undefined : (newDeckId ?? pact.anki_deck_id);
    const checked = this.#checkedPact(
      ownerId,
      timezone,
      { ...terms, evidenceKind: pact.evidence_kind, ...(ankiDeckId !== undefined && { ankiDeckId }) },
      new Date(pact.created_at),
      pact,
    );
    if (!checked.ok) return checked;
    const zone = checked.timezone;
    const before = this.#changeableTerms(pact);
    // Only a new pact can swap a week's count for its days, or back.
    if (checked.terms.schedule.kind !== before.schedule.kind) return { ok: false, reason: "schedule-kind-fixed" };
    const after = changeableTermsOf(checked, change);
    // Reminders apply at once, so they go off before the due time in force now as well as the new one.
    const currentDueAt = this.#occurrencesOf(pact.id, zone).first.dueAt;
    if (!remindersGoOffInTime(after.reminders, occurrenceTermsOf(pact), currentDueAt, zone)) {
      return { ok: false, reason: "reminder-after-due-time" };
    }
    const diffs = termDiffs(before, after, dayClockOf(pact, pact.in_bed_by, pact.due_by));
    if (this.#waitingChangeRequestId(pactId) !== null && diffs.some((diff) => diff.effect !== "at-once")) {
      return { ok: false, reason: "change-request-waiting" };
    }
    // A One-time change applies to its occurrence even once it's open, given an hour to the new deadline.
    if (checked.terms.schedule.kind === "one-time" && !this.#deadlineFarEnough(pact, zone, after, now)) {
      return { ok: false, reason: "deadline-too-soon" };
    }
    const reason = openOccurrencesRefusal(pact.first_occurrence, before, after, localDateOf(now, zone));
    if (reason !== null) return { ok: false, reason };
    return {
      ok: true,
      pact,
      timezone: zone,
      before,
      after,
      diffs,
      outcome: this.#changeOutcome(pact, zone, before, after, diffs, now),
    };
  }

  #changeOutcome(
    pact: PactRow,
    timezone: string,
    before: ChangeableTerms,
    after: ChangeableTerms,
    diffs: TermDiff[],
    now: Date,
  ): ChangeOutcome {
    if (diffs.length === 0) return { kind: "nothing" };
    if (diffs.some((diff) => diff.effect === "needs-approval")) {
      // Added reviewers join at once; removed ones review until it's approved.
      const deciders = [...new Set([...before.reviewerIds, ...after.reviewerIds])];
      return {
        kind: "needs-approval",
        reviewerNames: this.#friendsSortedByName(deciders).map((friend) => friend.name),
        bundlesStricter: diffs.some((diff) => diff.effect === "stricter"),
        appliesNow: appliesNow(before, after, diffs),
      };
    }
    if (diffs.some((diff) => diff.effect === "stricter")) {
      return {
        kind: "stricter",
        ...this.#startOfNewTerms(pact, timezone, after, now),
        appliesNow: appliesNow(before, after, diffs),
      };
    }
    return { kind: "at-once" };
  }

  /**
   * If `after` took effect at `at`: the first occurrence it would apply to,
   * the first not open yet, and today's penalty when today is an occurrence
   * whose penalty it changes.
   */
  #startOfNewTerms(
    pact: PactRow,
    timezone: string,
    after: Pick<ChangeableTerms, "schedule" | "inBedBy" | "dueBy" | "startDate" | "endDate" | "penaltyCents">,
    at: Date,
  ): ChangeStart {
    // One-time: the change applies to its one occurrence, open or not.
    if (after.schedule.kind === "one-time") return { appliesFrom: after.schedule.deadline, todayKeepsCents: null };
    const today = localDateOf(at, timezone);
    const from = firstDayNotOpen(after.schedule, today);
    const current = occurrenceTermsOf(pact);
    const earlier = this.#earlierTermsOf(pact);
    const firstOccurrence = firstOccurrenceAfterChange(pact.first_occurrence, after.schedule, from, after.startDate);
    // A schedule keeps its kind once its edit window has closed, so the terms in force now are on a recurring schedule too.
    if (hasSchedule(current, "one-time")) throw new Error(`pact ${pact.id} is One-time, but its change isn't`);
    // The terms in force now stay with the occurrences dated before `from`, unless a change made today put them there.
    const planned = earlier.some((terms) => terms.until === from) ? earlier : [...earlier, { ...current, until: from }];
    const start = laterDate(firstOccurrence, from);
    const changed = scheduleTermsOf(pact, after.schedule, after.inBedBy, after.dueBy);
    // With no day left before its end date, the change still starts tomorrow (or next week).
    const [first] = occurrencesOverTime(
      { ...changed, firstOccurrence, endDate: after.endDate },
      planned,
      timezone,
    ).between(from, addDays(start, 7));
    return {
      appliesFrom: first?.date ?? from,
      todayKeepsCents: this.#todayKeeps(pact.id, occurrencesOverTime(current, earlier, timezone), today, after),
    };
  }

  /** The penalty the occurrence of `occurrences` open `today` keeps, when it differs from `after`'s; else null. */
  #todayKeeps(
    pactId: string,
    occurrences: Occurrences,
    today: LocalDate,
    after: Pick<ChangeableTerms, "penaltyCents">,
  ): number | null {
    const open = occurrences.covering(today);
    if (!open) return null;
    const { penalty_cents: penalty } = this.#termsOn(pactId, open.date);
    return penalty !== after.penaltyCents ? penalty : null;
  }

  /**
   * Puts `after` in force for the pact's occurrences not open at `at`, those
   * dated from tomorrow (for Weekly count, next Monday) in the owner's
   * timezone; the terms it had stay with those dated before. A pact whose first occurrence hasn't come gets the
   * first day of the new schedule from tomorrow. The name and reviewers are
   * left as they are.
   */
  #applyTerms(pact: PactRow, after: ChangeableTerms, at: Date, timezone: string): void {
    if (after.schedule.kind === "one-time") return this.#applyOneTimeTerms(pact, after);
    const today = localDateOf(at, timezone);
    const from = firstDayNotOpen(after.schedule, today);
    // A change already made today put the terms today keeps there first.
    this.#db
      .prepare(
        `INSERT INTO pact_earlier_terms (pact_id, until, description, schedule, in_bed_by, due_by, penalty_cents,
                                         recipient_id, anki_deck_id)
         SELECT id, ?, description, schedule, in_bed_by, due_by, penalty_cents, recipient_id, anki_deck_id
         FROM pact WHERE id = ?
         ON CONFLICT (pact_id, until) DO NOTHING`,
      )
      .run(from, pact.id);
    // Approved after the pact started, a new start date is moot; approved after
    // the end date it asked for, the pact still keeps today (or this week), which is open.
    const started = pact.first_occurrence < from;
    const lastOpen = addDays(from, -1);
    const endDate = after.endDate === null ? null : laterDate(after.endDate, lastOpen);
    this.#db
      .prepare(
        `UPDATE pact SET description = ?, schedule = ?, in_bed_by = ?, due_by = ?, start_date = ?, end_date = ?,
                         penalty_cents = ?, recipient_id = ?, first_occurrence = ?,
                         anki_deck_id = COALESCE(?, anki_deck_id)
         WHERE id = ?`,
      )
      .run(
        after.description,
        JSON.stringify(after.schedule),
        after.inBedBy,
        after.dueBy,
        started ? pact.start_date : after.startDate,
        endDate,
        after.penaltyCents,
        after.recipientId,
        firstOccurrenceAfterChange(pact.first_occurrence, after.schedule, from, after.startDate),
        after.ankiDeckId,
        pact.id,
      );
  }

  /**
   * Puts `after` in force for a One-time pact's one occurrence, open or not:
   * its evidence and any excuse for it move with the deadline's date. An
   * occurrence already judged has Ended the pact, and keeps its terms.
   */
  #applyOneTimeTerms(pact: PactRow, after: ChangeableTerms): void {
    if (after.schedule.kind !== "one-time" || pact.stage === "ended") return;
    this.#db
      .prepare(
        `UPDATE pact SET description = ?, schedule = ?, due_by = ?, penalty_cents = ?, recipient_id = ?,
                         first_occurrence = ?
         WHERE id = ?`,
      )
      .run(
        after.description,
        JSON.stringify(after.schedule),
        after.dueBy,
        after.penaltyCents,
        after.recipientId,
        after.schedule.deadline,
        pact.id,
      );
    this.#moveOneTimeOccurrence(pact.id, pact.first_occurrence, after.schedule.deadline);
  }

  /**
   * Re-dates a One-time pact's occurrence, not judged yet, from `from` to
   * `to`: its row, its evidence and the excuses that cover it.
   */
  #moveOneTimeOccurrence(pactId: string, from: LocalDate, to: LocalDate): void {
    if (from === to) return;
    this.#db
      .prepare(
        `INSERT INTO occurrence (pact_id, date, outcome, judged_at, bedtime_start, miss_accepted_at)
         SELECT pact_id, ?, outcome, judged_at, bedtime_start, miss_accepted_at FROM occurrence
         WHERE pact_id = ? AND date = ?`,
      )
      .run(to, pactId, from);
    this.#db
      .prepare(`UPDATE evidence SET occurrence_date = ?, day = ? WHERE pact_id = ? AND occurrence_date = ?`)
      .run(to, to, pactId, from);
    this.#db.prepare(`UPDATE excuse_day SET date = ? WHERE pact_id = ? AND date = ?`).run(to, pactId, from);
    this.#db.prepare(`DELETE FROM occurrence WHERE pact_id = ? AND date = ?`).run(pactId, from);
  }

  /**
   * Whether a One-time pact changed to `after` at `at` is due at least an
   * hour later, or keeps the deadline it has.
   */
  #deadlineFarEnough(
    pact: PactRow,
    timezone: string,
    after: Pick<ChangeableTerms, "schedule" | "dueBy">,
    at: Date,
  ): boolean {
    const current = this.#occurrencesOf(pact.id, timezone).first;
    const terms = scheduleTermsOf(pact, after.schedule, pact.in_bed_by, after.dueBy);
    const changed = occurrences(
      { ...terms, firstOccurrence: pact.first_occurrence, endDate: pact.end_date },
      timezone,
    ).first;
    return changed.dueAt.getTime() === current.dueAt.getTime() || dueSoonEnough(changed, at);
  }

  /** The changed terms, old and new, with names for the recipient and reviewers. */
  #termChanges(ownerId: AccountId, before: ChangeableTerms, after: ChangeableTerms, diffs: TermDiff[]): TermChange[] {
    const deck = (id: string) => ({ id, name: this.#ankiDeckName(ownerId, id) });
    return diffs.map((diff): TermChange => {
      const effect = effectOf(diff);
      switch (diff.term) {
        case "deck":
          return { term: diff.term, before: deck(diff.before), after: deck(diff.after), ...effect };
        case "name":
          return { term: diff.term, before: before.name, after: after.name, ...effect };
        case "description":
          return { term: diff.term, before: before.description, after: after.description, ...effect };
        case "in-bed-by":
          return { term: diff.term, before: diff.before, after: diff.after, ...effect };
        case "due-by":
          return { term: diff.term, before: before.dueBy, after: after.dueBy, ...effect };
        case "start-date":
          return { term: diff.term, before: before.startDate, after: after.startDate, ...effect };
        case "end-date":
          return { term: diff.term, before: before.endDate, after: after.endDate, ...effect };
        case "schedule":
          return { term: diff.term, before: before.schedule, after: after.schedule, ...effect };
        case "penalty":
          return { term: diff.term, before: before.penaltyCents, after: after.penaltyCents, ...effect };
        case "recipient":
          return {
            term: diff.term,
            before: { id: before.recipientId, name: this.#recipientName(before.recipientId) },
            after: { id: after.recipientId, name: this.#recipientName(after.recipientId) },
            ...effect,
          };
        case "reviewers":
          return {
            term: diff.term,
            before: this.#friendsSortedByName(before.reviewerIds),
            after: this.#friendsSortedByName(after.reviewerIds),
            added: this.#friendsSortedByName(after.reviewerIds.filter((id) => !before.reviewerIds.includes(id))),
            removed: this.#friendsSortedByName(before.reviewerIds.filter((id) => !after.reviewerIds.includes(id))),
            ...effect,
          };
        case "reminders":
          return { term: diff.term, before: before.reminders, after: after.reminders, ...effect };
      }
    });
  }

  /** Records a change request for the pact, and gives its reviewers a review item. */
  #sendChangeRequest(
    pact: PactRow,
    ownerName: string,
    before: ChangeableTerms,
    after: ChangeableTerms | null,
    note: string | undefined,
  ): string {
    const id = this.#newId();
    const trimmed = note?.trim() ?? "";
    this.#db
      .prepare(
        `INSERT INTO change_request (id, pact_id, ends_pact, before_terms, after_terms, note, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pact.id,
        after === null ? 1 : 0,
        JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        trimmed === "" ? null : trimmed,
        this.#clock.now().toISOString(),
      );
    const what =
      after === null
        ? []
        : termDiffs(before, after, dayClockOf(pact, pact.in_bed_by, pact.due_by)).map(({ term }) =>
            term === "schedule" && after.schedule.kind === "one-time" ? "Deadline" : TERM_LABELS[term],
          );
    const body = [...what, ...(trimmed === "" ? [] : [`“${trimmed}”`])].join(" · ");
    this.#tellAll(this.#reviewersOf(pact.id), "review-item", {
      itemKind: "change-request",
      itemId: id,
      pactId: pact.id,
      title: `${ownerName} asked to ${after === null ? "end" : "change"} ${pact.name}`,
      body: body === "" ? "It needs your approval" : body,
      url: APP_PATHS.review,
    });
    return id;
  }

  /** A change request with its pact's owner and their timezone, and the reviewer who decided it. */
  #changeRequestRow(id: string): StoredChangeRequest | undefined {
    const row = this.#db
      .prepare(
        `SELECT change_request.*, pact.owner_account_id, owner.name AS owner_name, owner.timezone,
                reviewer.name AS reviewer_name
         FROM change_request
         JOIN pact ON pact.id = change_request.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         LEFT JOIN account AS reviewer ON reviewer.id = change_request.decided_by_account_id
         WHERE change_request.id = ?`,
      )
      .get(id) as ChangeRequestRow | undefined;
    return row && storedChangeRequestOf(row);
  }

  #changeRequestView(row: StoredChangeRequest): ChangeRequestView {
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    const { request } = row;
    const waiting = row.decision === null && row.withdrawn_at === null;
    const base = {
      id: row.id,
      pactId: row.pact_id,
      pactName: pact.name,
      note: row.note,
      requestedAt: new Date(row.requested_at),
      // Reminders are the owner's own: reviewers don't see them.
      current: withoutReminders(this.#currentTerms(pact)),
    };
    if (request.kind === "end") return { ...base, endsPact: true };
    return {
      ...base,
      endsPact: false,
      changes: this.#termChanges(
        pact.owner_account_id,
        request.before,
        request.after,
        termDiffs(request.before, request.after, dayClockOf(pact, pact.in_bed_by, pact.due_by)),
      ),
      start: waiting
        ? this.#startOfNewTerms(pact, ownerZone(row.timezone, row.owner_account_id), request.after, this.#clock.now())
        : null,
    };
  }

  /** Change requests waiting for a decision that `reviewerId` may make: those for pacts they review, oldest first. */
  #changeRequestsToReview(reviewerId: AccountId): ReviewItem[] {
    const ids = this.#db
      .prepare(
        `SELECT change_request.id FROM change_request
         JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                           AND pact_reviewer.reviewer_account_id = ?
         WHERE change_request.decision IS NULL AND change_request.withdrawn_at IS NULL
         ORDER BY change_request.requested_at, change_request.id`,
      )
      .all(reviewerId) as { id: string }[];
    return ids.map(({ id }) => {
      const row = this.#changeRequestRow(id)!;
      return {
        kind: "change-request",
        ownerName: row.owner_name,
        thread: this.#thread(id, true),
        ...this.#changeRequestView(row),
      };
    });
  }

  /** The owner's change requests waiting for a decision (or just that for `pactId`), newest first. */
  #waitingChangeRequests(ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
    const rows = this.#db
      .prepare(
        `SELECT change_request.id, change_request.pact_id, pact.name, change_request.ends_pact,
                change_request.requested_at
         FROM change_request JOIN pact ON pact.id = change_request.pact_id
         WHERE pact.owner_account_id = ? AND change_request.decision IS NULL AND change_request.withdrawn_at IS NULL
           AND (? IS NULL OR pact.id = ?)
         ORDER BY change_request.requested_at DESC, change_request.id`,
      )
      .all(ownerId, pactId ?? null, pactId ?? null) as {
      id: string;
      pact_id: string;
      name: string;
      ends_pact: 0 | 1;
      requested_at: string;
    }[];
    return rows.map((row) => ({
      kind: "change-request",
      id: row.id,
      pactId: row.pact_id,
      name: row.name,
      endsPact: row.ends_pact === 1,
      requestedAt: new Date(row.requested_at),
    }));
  }

  /**
   * Records a reviewer's decision on a change request and tells the owner.
   * Approved, an end makes the pact Ended at once; a change applies its terms
   * from the first occurrence not open yet, and takes off the reviewers it
   * removes. Rejected, nothing changes.
   */
  #decideChangeRequest(row: StoredChangeRequest, decided: Decided, reviewerId: AccountId): void {
    const { outcome } = decided;
    const now = this.#clock.now();
    this.#recordDecision("change_request", row.id, decided, reviewerId, now);
    const { request } = row;
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    const reviewerName = this.#accountName(reviewerId);
    const title = `${reviewerName} ${outcome} ${request.kind === "end" ? `ending ${pact.name}` : "your change"}`;
    let body: string;
    if (decided.outcome === "rejected") {
      body = `${pact.name} · “${decided.reason}”`;
    } else if (request.kind === "end") {
      this.#endPact(pact.id, now);
      body = `${pact.name} is Ended`;
    } else {
      const { before, after } = request;
      for (const removed of before.reviewerIds.filter((id) => !after.reviewerIds.includes(id))) {
        this.#db
          .prepare(`DELETE FROM pact_reviewer WHERE pact_id = ? AND reviewer_account_id = ?`)
          .run(pact.id, removed);
      }
      const timezone = ownerZone(row.timezone, row.owner_account_id);
      const { appliesFrom } = this.#startOfNewTerms(pact, timezone, after, now);
      this.#applyTerms(pact, after, now, timezone);
      body = `${pact.name} · New terms start ${formatDate(appliesFrom)}`;
    }
    this.#enqueue({
      recipient: row.owner_account_id,
      kind: "change-request-decided",
      payload: {
        itemKind: "change-request",
        itemId: row.id,
        pactId: pact.id,
        ...decisionDetails(decided),
        title,
        body,
        url: APP_PATHS.pact(pact.id),
      },
    });
  }

  /**
   * Whether approving the change request now leaves its One-time pact's new
   * deadline at least an hour off, or keeps the deadline it has. Any other
   * change can always be approved.
   */
  #approvableNow(row: StoredChangeRequest): boolean {
    const { request } = row;
    if (request.kind === "end" || request.after.schedule.kind !== "one-time") return true;
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    if (pact.stage === "ended") return true;
    return this.#deadlineFarEnough(
      pact,
      ownerZone(row.timezone, row.owner_account_id),
      request.after,
      this.#clock.now(),
    );
  }

  /** As the pact page puts it: when the newest terms start, while their first occurrence hasn't opened. */
  #newTerms(pact: PactRow, timezone: string, now: Date): PactTerms["newTerms"] {
    if (pact.stage === "ended") return null;
    const latest = this.#db
      .prepare(`SELECT until FROM pact_earlier_terms WHERE pact_id = ? ORDER BY until DESC LIMIT 1`)
      .get(pact.id) as { until: LocalDate } | undefined;
    if (!latest) return null;
    const occurrences = this.#occurrencesOf(pact.id, timezone);
    // A start date may put the first occurrence further off than a week.
    const from = laterDate(pact.first_occurrence, latest.until);
    const [start] = occurrences.between(from, addDays(from, 7));
    const today = localDateOf(now, timezone);
    if (!start || start.date <= today) return null;
    const todayKeepsCents = this.#todayKeeps(pact.id, occurrences, today, { penaltyCents: pact.penalty_cents });
    return { appliesFrom: start.date, todayKeepsCents };
  }

  /** `ownerId`'s pact `pactId`, if it is one. */
  #ownPact(ownerId: AccountId, pactId: string): PactRow | undefined {
    return this.#db.prepare(`SELECT * FROM pact WHERE id = ? AND owner_account_id = ?`).get(pactId, ownerId) as
      PactRow | undefined;
  }

  /**
   * What creating and editing share: `pact` checked as a pact made at
   * `createdAt`, or why it's refused. `existing` is the pact being edited or
   * changed: an Anki pact keeps its rollover hour, and its own deck counts as
   * known even once it's gone from the deck list. The evidence source is
   * checked first, then the terms, then the recipient and reviewers.
   */
  #checkedPact(
    ownerId: AccountId,
    timezone: string | null,
    pact: NewPact,
    createdAt: Date,
    existing?: Pick<PactRow, "anki_deck_id" | "anki_rollover_hour">,
  ): CheckedPact | { ok: false; reason: CreatePactRefusal } {
    const source = this.#evidenceSource(ownerId, pact, existing);
    if (!source.ok) return source;
    const terms = checkedTerms(pact, source.ankiRollover, timezone, createdAt);
    if (!terms.ok) return terms;
    const people = this.#checkedPeople(ownerId, pact);
    if (!people.ok) return people;
    return { ...terms, reviewerIds: people.reviewerIds, ankiDeckId: source.ankiDeckId };
  }

  /**
   * Where `pact`'s evidence comes from, or why it can't: Oura Ring and Anki
   * need their connection, and an Anki pact a deck from the owner's deck list
   * (or `existing`'s own deck). An Anki pact's day turns at the collection's
   * rollover hour; `existing` keeps the one it has.
   */
  #evidenceSource(
    ownerId: AccountId,
    pact: NewPact,
    existing: Pick<PactRow, "anki_deck_id" | "anki_rollover_hour"> | undefined,
  ): { ok: true; ankiDeckId: string | null; ankiRollover: number | null } | { ok: false; reason: CreatePactRefusal } {
    switch (pact.evidenceKind) {
      case "camera":
        return { ok: true, ankiDeckId: null, ankiRollover: null };
      case "oura":
        if (!this.#hasConnection(ownerId, "oura")) return { ok: false, reason: "oura-not-connected" };
        return { ok: true, ankiDeckId: null, ankiRollover: null };
      case "anki": {
        if (!this.#hasConnection(ownerId, "anki")) return { ok: false, reason: "anki-not-connected" };
        const list = this.#ankiDeckList(ownerId);
        const deckId = pact.ankiDeckId ?? "";
        const ownDeck = existing?.anki_deck_id === deckId && existing.anki_rollover_hour !== null;
        if (!ownDeck && !list?.decks.some((deck) => deck.id === deckId)) return { ok: false, reason: "unknown-deck" };
        return { ok: true, ankiDeckId: deckId, ankiRollover: existing?.anki_rollover_hour ?? list!.rolloverHour };
      }
    }
  }

  /** `pact`'s recipient and reviewers, or why they're refused: the owner's own recipient, and friends. */
  #checkedPeople(
    ownerId: AccountId,
    pact: NewPact,
  ): { ok: true; reviewerIds: AccountId[] } | { ok: false; reason: CreatePactRefusal } {
    const isOwnRecipient = this.#db
      .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
      .get(pact.recipientId, ownerId);
    if (!isOwnRecipient) return { ok: false, reason: "unknown-recipient" };
    const reviewerIds = [...new Set(pact.reviewerIds)];
    if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
    if (!reviewerIds.every((id) => this.#areFriends(ownerId, id))) return { ok: false, reason: "not-a-friend" };
    return { ok: true, reviewerIds };
  }

  #hasConnection(accountId: AccountId, service: ConnectionService): boolean {
    return (
      this.#db.prepare(`SELECT 1 FROM connection WHERE account_id = ? AND service = ?`).get(accountId, service) !==
      undefined
    );
  }

  /** The account's deck list as AnkiWeb last gave it, or null before the first. */
  #ankiDeckList(accountId: AccountId): { decks: AnkiDeck[]; rolloverHour: number } | null {
    const row = this.#db
      .prepare(`SELECT decks, rollover_hour FROM anki_deck_list WHERE account_id = ?`)
      .get(accountId) as { decks: string; rollover_hour: number } | undefined;
    return row ? { decks: JSON.parse(row.decks) as AnkiDeck[], rolloverHour: row.rollover_hour } : null;
  }

  /** The deck's name as the last deck list or check found it, or null once it's gone from the list. */
  #ankiDeckName(accountId: AccountId, deckId: string): string | null {
    const listed = this.#ankiDeckList(accountId)?.decks.find((deck) => deck.id === deckId)?.name;
    return listed ?? this.#ankiPactDeck(accountId, deckId)?.name ?? null;
  }

  /** The deck an Anki pact's day `date` is judged on: the one in force when it opened. */
  #ankiDeckOn(pactId: string, date: LocalDate): string {
    const deckId = this.#termsOn(pactId, date).anki_deck_id;
    if (deckId === null) throw new Error(`pact ${pactId} has no Anki deck`);
    return deckId;
  }

  /** A deck an Anki pact is on, as checks last found it; undefined before the first check. */
  #ankiPactDeck(
    accountId: AccountId,
    deckId: string,
  ): { name: string | null; missing_since: string | null } | undefined {
    return this.#db
      .prepare(`SELECT name, missing_since FROM anki_pact_deck WHERE account_id = ? AND deck_id = ?`)
      .get(accountId, deckId) as { name: string | null; missing_since: string | null } | undefined;
  }

  /** Whether the last check found the deck gone from the account's collection. */
  #ankiDeckMissing(accountId: AccountId, deckId: string): boolean {
    return (this.#ankiPactDeck(accountId, deckId)?.missing_since ?? null) !== null;
  }

  /** An Anki pact's deck and rollover hour; null for any other pact. */
  #ankiTerms(pact: Pick<PactRow, "owner_account_id" | "anki_deck_id" | "anki_rollover_hour">): AnkiTerms | null {
    if (pact.anki_deck_id === null || pact.anki_rollover_hour === null) return null;
    return {
      deckId: pact.anki_deck_id,
      deckName: this.#ankiDeckName(pact.owner_account_id, pact.anki_deck_id),
      deckMissing: this.#ankiDeckMissing(pact.owner_account_id, pact.anki_deck_id),
      rolloverHour: pact.anki_rollover_hour,
    };
  }

  /** How many of the account's Active pacts are judged from `service`. */
  #activePactsUsing(accountId: AccountId, service: ConnectionService): number {
    // Each service supplies the evidence kind of the same name (SERVICE_OF_KIND).
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM pact WHERE owner_account_id = ? AND stage = 'active' AND evidence_kind = ?`)
      .get(accountId, service) as { n: number };
    return row.n;
  }

  /** Connects the account to `service`, or marks a connection that needs reconnecting connected again. */
  #connect(accountId: AccountId, service: ConnectionService): void {
    this.#db
      .prepare(
        `INSERT INTO connection (account_id, service, status, connected_at) VALUES (?, ?, 'connected', ?)
         ON CONFLICT (account_id, service) DO UPDATE SET status = 'connected', connected_at = excluded.connected_at`,
      )
      .run(accountId, service, this.#clock.now().toISOString());
  }

  #disconnect(accountId: AccountId, service: ConnectionService): void {
    this.#db.prepare(`DELETE FROM connection WHERE account_id = ? AND service = ?`).run(accountId, service);
  }

  /** Why the service can't be read for the account, or null when its connection works. */
  #connectionProblem(accountId: AccountId, service: ConnectionService): ConnectionProblem | null {
    const row = this.#db
      .prepare(`SELECT status FROM connection WHERE account_id = ? AND service = ?`)
      .get(accountId, service) as { status: Connection["status"] } | undefined;
    if (!row) return "not-connected";
    return row.status === "connected" ? null : row.status;
  }

  #setReviewers(pactId: string, reviewerIds: AccountId[]): void {
    for (const reviewerId of reviewerIds) {
      this.#db
        .prepare(`INSERT INTO pact_reviewer (pact_id, reviewer_account_id) VALUES (?, ?)`)
        .run(pactId, reviewerId);
    }
  }

  /** Pacts created by this time, as an ISO string, are past their edit window: for comparing in SQL. */
  #editWindowCutoff(at = this.#clock.now()): string {
    return new Date(at.getTime() - EDIT_WINDOW_MS).toISOString();
  }

  /** Removes the pact's evidence on the dates `removed` picks, and those occurrences, none of them judged. */
  #removeEvidence(pactId: string, removed: (date: LocalDate) => boolean): void {
    const rows = this.#db.prepare(`SELECT id, occurrence_date FROM evidence WHERE pact_id = ?`).all(pactId) as {
      id: string;
      occurrence_date: LocalDate;
    }[];
    for (const { id, occurrence_date } of rows.filter((row) => removed(row.occurrence_date))) {
      this.#db.prepare(`DELETE FROM evidence_photo WHERE evidence_id = ?`).run(id);
      this.#db.prepare(`DELETE FROM evidence WHERE id = ?`).run(id);
      this.#db.prepare(`DELETE FROM occurrence WHERE pact_id = ? AND date = ?`).run(pactId, occurrence_date);
    }
  }

  #reviewersOf(pactId: string): AccountId[] {
    return (
      this.#db
        .prepare(`SELECT reviewer_account_id FROM pact_reviewer WHERE pact_id = ? ORDER BY reviewer_account_id`)
        .all(pactId) as { reviewer_account_id: AccountId }[]
    ).map((row) => row.reviewer_account_id);
  }

  #enqueueEvidenceReviewItems(pactId: string, evidenceId: string, date: LocalDate, ownerName: string): void {
    this.#tellAll(this.#reviewersOf(pactId), "review-item", {
      itemKind: "evidence",
      itemId: evidenceId,
      pactId,
      title: `${ownerName} submitted evidence`,
      body: `${this.#pactName(pactId)} · ${formatDate(date)}`,
      url: APP_PATHS.review,
    });
  }

  /** Tells each of `reviewerIds` they now review the pact, and what it asks. */
  #tellPickedAsReviewer(
    reviewerIds: readonly AccountId[],
    title: string,
    pact: { id: string; name: string; schedule: Schedule; penaltyCents: number },
  ): void {
    this.#tellAll(reviewerIds, "picked-as-reviewer", {
      pactId: pact.id,
      title,
      body: `${pact.name} · ${scheduleText(pact.schedule)} · ${money(pact.penaltyCents)} per miss`,
      url: APP_PATHS.review,
    });
  }

  /**
   * For each pact whose edit window has closed by `t` and whose reviewers
   * haven't been told: tells them they've been picked, then about any
   * evidence submitted in the window.
   */
  #closeEditWindows(t: Date): void {
    const pacts = this.#db
      .prepare(`SELECT * FROM pact WHERE reviewers_notified_at IS NULL AND created_at <= ? ORDER BY created_at, id`)
      .all(this.#editWindowCutoff(t)) as PactRow[];
    for (const pact of pacts) {
      const ownerName = this.#accountName(pact.owner_account_id);
      this.#tellPickedAsReviewer(this.#reviewersOf(pact.id), `${ownerName} picked you as a reviewer`, {
        id: pact.id,
        name: pact.name,
        schedule: scheduleOf(pact.schedule),
        penaltyCents: pact.penalty_cents,
      });
      const closedAt = editWindowEnd(pact).toISOString();
      const held = this.#db
        .prepare(
          `SELECT id, day FROM evidence
           WHERE pact_id = ? AND decision IS NULL AND submitted_at < ?
           ORDER BY submitted_at, id`,
        )
        .all(pact.id, closedAt) as { id: string; day: LocalDate }[];
      for (const { id, day } of held) {
        this.#enqueueEvidenceReviewItems(pact.id, id, day, ownerName);
      }
      this.#db.prepare(`UPDATE pact SET reviewers_notified_at = ? WHERE id = ?`).run(t.toISOString(), pact.id);
    }
  }

  #accountName(accountId: AccountId): string {
    return (this.#db.prepare(`SELECT name FROM account WHERE id = ?`).get(accountId) as { name: string }).name;
  }

  #pactName(pactId: string): string {
    return (this.#db.prepare(`SELECT name FROM pact WHERE id = ?`).get(pactId) as { name: string }).name;
  }

  #recipientName(recipientId: string): string {
    return (this.#db.prepare(`SELECT name FROM recipient WHERE id = ?`).get(recipientId) as { name: string }).name;
  }

  /** Payments awaiting approval that `reviewerId` may decide, oldest recorded first. */
  #paymentsToReview(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#db
      .prepare(
        `SELECT payment.id, payment.owner_account_id, payment.recipient_id, owner.name AS owner_name,
                recipient.name AS recipient_name, payment.amount_cents, payment.note, payment.photo_id,
                payment.recorded_at
         FROM payment
         JOIN account AS owner ON owner.id = payment.owner_account_id
         JOIN recipient ON recipient.id = payment.recipient_id
         WHERE payment.decision IS NULL AND ${MAY_DECIDE_PAYMENT}
         ORDER BY payment.recorded_at, payment.id`,
      )
      .all(reviewerId) as (PaymentViewRow & {
      owner_account_id: AccountId;
      recipient_id: string;
      owner_name: string;
    })[];
    return rows.map((row): ReviewItem => {
      const owedCents = this.#ledgerSummaries(row.owner_account_id, row.recipient_id)[0]?.owedCents ?? 0;
      return {
        kind: "payment",
        ...paymentView(row),
        ownerName: row.owner_name,
        owedCents,
        owedAfterApprovalCents: Math.max(0, owedCents - row.amount_cents),
        thread: this.#thread(row.id, true),
      };
    });
  }

  /** Who reviews payments from `ownerId` to `recipientId`, each once. */
  #paymentReviewers(ownerId: AccountId, recipientId: string): AccountId[] {
    return (
      this.#db
        .prepare(
          `SELECT DISTINCT reviewer_account_id FROM (${paymentReviewersSql("@owner", "@recipient")})
           ORDER BY reviewer_account_id`,
        )
        .all({ owner: ownerId, recipient: recipientId }) as { reviewer_account_id: AccountId }[]
    ).map((row) => row.reviewer_account_id);
  }

  /**
   * The payment `itemId`, if `reviewerId` may decide it: they review any of
   * the owner's pacts with its recipient.
   */
  #paymentToDecide(reviewerId: AccountId, itemId: string): PaymentToDecide | undefined {
    return this.#db
      .prepare(
        `SELECT payment.id, payment.owner_account_id, payment.recipient_id, payment.decision
         FROM payment
         WHERE payment.id = ? AND ${MAY_DECIDE_PAYMENT}`,
      )
      .get(itemId, reviewerId) as PaymentToDecide | undefined;
  }

  /**
   * Records a reviewer's decision on a payment awaiting approval and tells
   * the owner. Approved, it counts against the ledger; rejected, it never did.
   */
  #decidePayment(payment: PaymentToDecide, decided: Decided, reviewerId: AccountId): void {
    const { outcome, reason } = decided;
    this.#recordDecision("payment", payment.id, decided, reviewerId, this.#clock.now());
    const { amount_cents } = this.#db.prepare(`SELECT amount_cents FROM payment WHERE id = ?`).get(payment.id) as {
      amount_cents: number;
    };
    const paid = `${money(amount_cents)} to ${this.#recipientName(payment.recipient_id)}`;
    this.#enqueue({
      recipient: payment.owner_account_id,
      kind: "payment-decided",
      payload: {
        itemKind: "payment",
        itemId: payment.id,
        recipientId: payment.recipient_id,
        ...decisionDetails(decided),
        title: `${this.#accountName(reviewerId)} ${outcome} your payment`,
        body: reason === null ? paid : `${paid} · “${reason}”`,
        url: APP_PATHS.ledger(payment.recipient_id),
      },
    });
  }

  /** Stores a reviewer's decision on the review item `id` in `table`. */
  #recordDecision(
    table: "evidence" | "excuse" | "payment" | "change_request",
    id: string,
    { outcome, reason }: Decided,
    reviewerId: AccountId,
    at: Date,
  ): void {
    this.#db
      .prepare(
        `UPDATE ${table} SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, at.toISOString(), reason, id);
  }

  /**
   * Whether the pact Ended before `occurrence` fell due and it isn't judged:
   * it's no longer one of the pact's, so it's never judged or excused.
   */
  #dueAfterEnd(pactId: string, occurrence: Occurrence): boolean {
    const { ended_at: endedAt } = this.#db.prepare(`SELECT ended_at FROM pact WHERE id = ?`).get(pactId) as {
      ended_at: string | null;
    };
    if (endedAt === null || occurrence.dueAt.getTime() <= new Date(endedAt).getTime()) return false;
    return !this.#isJudged(pactId, occurrence.date);
  }

  /**
   * Whether judging at `t` reaches the pact's occurrence on `date`: it's on
   * or before the pact's `judged_through`, or due by `t` in the owner's
   * timezone now. The cursor counts on its own because a timezone change can
   * move a due time it already went past back into the future.
   */
  #judgingReached(pactId: string, date: LocalDate, t: Date): boolean {
    const [pact] = this.#pactsToJudge(pactId);
    if (!pact) throw new Error(`no pact ${pactId}`);
    if (pact.judged_through !== null && date <= pact.judged_through) return true;
    return this.#occurrencesOf(pactId, ownerZone(pact.timezone, pact.owner_account_id))
      .dueAfter(pact.judged_through, t)
      .some((occurrence) => occurrence.date === date);
  }

  /** Whether `photoId` is a photo of some evidence or excuse (`table`) and `accountId` owns or reviews its pact. */
  #mayViewPactItemPhoto(table: "evidence" | "excuse", photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM ${table}_photo
           JOIN ${table} ON ${table}.id = ${table}_photo.${table}_id
           JOIN pact ON pact.id = ${table}.pact_id
           WHERE ${table}_photo.photo_id = ?
             AND (pact.owner_account_id = ?
                  OR EXISTS (SELECT 1 FROM pact_reviewer
                             WHERE pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?))`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /**
   * Whether `photoId` is a payment's screenshot and `accountId` made the
   * payment or reviews any of the owner's pacts with its recipient: those who
   * may decide it.
   */
  #mayViewPaymentPhoto(photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM payment
           WHERE payment.photo_id = ?
             AND (payment.owner_account_id = ? OR ${MAY_DECIDE_PAYMENT})`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /** The photos of some evidence, in the order taken. */
  #evidencePhotoIds(evidenceId: string): string[] {
    return (
      this.#db
        .prepare(`SELECT photo_id FROM evidence_photo WHERE evidence_id = ? ORDER BY position`)
        .all(evidenceId) as { photo_id: string }[]
    ).map((row) => row.photo_id);
  }

  /**
   * Whether `ownerId` may submit evidence with `photoCount` photos for
   * `pactId` at `at`, and if so for which occurrence and day: the one open at
   * `at`, unless evidence for it is already waiting or approved, or it's
   * already judged (a rejection judges it Missed at once). On Weekly count
   * that's for the day: one day of evidence counts per day, and a day whose
   * evidence was rejected is made up on another.
   */
  #evidenceAcceptance(
    ownerId: AccountId,
    timezone: string | null,
    pactId: string,
    photoCount: number,
    at: Date,
  ): { ok: true; occurrence: Occurrence; day: LocalDate } | { ok: false; reason: SubmitEvidenceRefusal } {
    const row = this.#db
      .prepare(
        `SELECT schedule, first_occurrence, evidence_kind, stage FROM pact WHERE id = ? AND owner_account_id = ?`,
      )
      .get(pactId, ownerId) as Pick<PactRow, "schedule" | "first_occurrence" | "evidence_kind" | "stage"> | undefined;
    if (!row || timezone === null) return { ok: false, reason: "pact-not-found" };
    // Oura reports a bedtime night; there's never a photo to submit.
    if (row.evidence_kind !== "camera") return { ok: false, reason: "not-open" };
    if (photoCount === 0) return { ok: false, reason: "no-photos" };
    if (photoCount > MAX_EVIDENCE_PHOTOS) return { ok: false, reason: "too-many-photos" };
    const { kind } = scheduleOf(row.schedule);
    const occurrences = this.#occurrencesOf(pactId, timezone);
    const occurrence = occurrences.openAt(at);
    // One-time evidence is for its one occurrence, whichever day it comes.
    const day = occurrence && kind === "one-time" ? occurrence.date : localDateOf(at, timezone);
    // Past its due-by time, the day takes no more evidence.
    if (!occurrence || at.getTime() >= occurrences.dayDueAt(localDateOf(at, timezone))!.getTime()) {
      return { ok: false, reason: "not-open" };
    }
    const decision = this.#evidenceDecision(pactId, day, "day");
    if (decision === "waiting") return { ok: false, reason: "evidence-waiting" };
    if (decision === "approved") return { ok: false, reason: "already-approved" };
    if ((kind === "weekly-count" && decision === "rejected") || this.#isJudged(pactId, occurrence.date)) {
      return { ok: false, reason: "already-judged" };
    }
    // An Ended pact has no day open any more.
    if (row.stage === "ended") return { ok: false, reason: "not-open" };
    return { ok: true, occurrence, day };
  }

  /**
   * Where the evidence for an occurrence (or with `by` "day", for one day of
   * it) stands: waiting or approved if any is, else rejected or none.
   */
  #evidenceDecision(
    pactId: string,
    date: LocalDate,
    by: "occurrence_date" | "day" = "occurrence_date",
  ): ReviewOutcome | "waiting" | "none" {
    const decisions = (
      this.#db.prepare(`SELECT decision FROM evidence WHERE pact_id = ? AND ${by} = ?`).all(pactId, date) as {
        decision: ReviewOutcome | null;
      }[]
    ).map((row) => row.decision ?? "waiting");
    if (decisions.includes("waiting")) return "waiting";
    if (decisions.includes("approved")) return "approved";
    return decisions.length > 0 ? "rejected" : "none";
  }

  /** The owner's evidence, excuses and payments still waiting for a decision, newest first. */
  #waiting(ownerId: AccountId): TodayWaitingItem[] {
    return mergeByTime(
      waitingSince,
      "newest-first",
      this.#waitingChangeRequests(ownerId),
      this.#waitingEvidence(ownerId),
      this.#waitingExcuses(ownerId),
      this.#waitingPayments(ownerId),
    );
  }

  /** The owner's payments still waiting for a decision, newest first. */
  #waitingPayments(ownerId: AccountId): TodayWaitingItem[] {
    return (
      this.#db
        .prepare(
          `SELECT payment.id, payment.recipient_id, recipient.name AS recipient_name, payment.amount_cents,
                  payment.recorded_at
           FROM payment JOIN recipient ON recipient.id = payment.recipient_id
           WHERE payment.owner_account_id = ? AND payment.decision IS NULL
           ORDER BY payment.recorded_at DESC, payment.id`,
        )
        .all(ownerId) as {
        id: string;
        recipient_id: string;
        recipient_name: string;
        amount_cents: number;
        recorded_at: string;
      }[]
    ).map((row): TodayWaitingItem => ({
      kind: "payment",
      id: row.id,
      recipientId: row.recipient_id,
      recipientName: row.recipient_name,
      amountCents: row.amount_cents,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  /** The owner's evidence still waiting for a decision (or just that for `pactId`), newest first. */
  #waitingEvidence(ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
    const rows = this.#db
      .prepare(
        `SELECT evidence.id, evidence.pact_id, pact.name, evidence.day AS occurrence_date, evidence.submitted_at
         FROM evidence JOIN pact ON pact.id = evidence.pact_id
         WHERE pact.owner_account_id = ? AND evidence.decision IS NULL AND (? IS NULL OR pact.id = ?)
         ORDER BY evidence.submitted_at DESC, evidence.id`,
      )
      .all(ownerId, pactId ?? null, pactId ?? null) as {
      id: string;
      pact_id: string;
      name: string;
      occurrence_date: string;
      submitted_at: string;
    }[];
    return rows.map((row) => ({
      kind: "evidence",
      id: row.id,
      pactId: row.pact_id,
      name: row.name,
      occurrenceDate: row.occurrence_date,
      submittedAt: new Date(row.submitted_at),
    }));
  }

  /** Today's alerts and sections for the owner, as `#todayAlerts` and `#todaySections` put them. */
  #todayCards(ownerId: AccountId, timezone: string): { alerts: TodayAlert[]; sections: TodaySection[] } {
    const now = this.#clock.now();
    const bills = this.#billsForToday(ownerId, now);
    return {
      alerts: this.#todayAlerts(ownerId, now, bills.alerts),
      sections: this.#todaySections(ownerId, timezone, now, bills.cards),
    };
  }

  /**
   * Today's alerts: connection problems while an Active pact is judged from
   * the connection, then `billAlerts`, then occurrences Missed through a
   * rejection, and rejected excuses, until accepted or excused again, and
   * reviewer questions until the owner replies or the item is decided;
   * newest first.
   */
  #todayAlerts(ownerId: AccountId, now: Date, billAlerts: TodayAlert[]): TodayAlert[] {
    const alerts = [
      ...this.#rejectedEvidenceAlerts(ownerId),
      ...this.#rejectedDayAlerts(ownerId),
      ...this.#rejectedExcuseAlerts(ownerId, now),
      ...this.#questionAlerts(ownerId),
    ];
    // A connection matters only while an Active pact is judged from it.
    const problemWith = (service: ConnectionService) =>
      this.#activePactsUsing(ownerId, service) > 0 ? this.#connectionProblem(ownerId, service) : null;
    const connectionAlerts = (["oura", "anki"] as const).flatMap((service): TodayAlert[] => {
      const status = problemWith(service);
      return status ? [{ kind: "connection", service, status }] : [];
    });
    return [
      ...connectionAlerts,
      ...billAlerts,
      ...mergeByTime(({ at }) => at, "newest-first", alerts).map(({ alert }) => alert),
    ];
  }

  /**
   * Today's sections. No Oura data: bedtime nights past their deadline that
   * Oura hasn't reported. To do: pacts with an occurrence open now that still
   * needs evidence, and `billCards`. Missed: other occurrences judged Missed
   * in the last 48 hours and not accepted. Automatic: bedtime nights open
   * now. Coming up: pacts whose first occurrence hasn't opened yet. A pact on
   * a day it isn't due appears in neither To do nor Coming up. Empty sections
   * are left out.
   */
  #todaySections(ownerId: AccountId, timezone: string, now: Date, billCards: TodayBillCard[]): TodaySection[] {
    const toDo: (TodayToDoCard | TodayAnkiCard | TodayBillCard)[] = [];
    const automatic: TodayAutomaticCard[] = [];
    const noOuraData: TodayNoOuraDataCard[] = [];
    const comingUp: TodayComingUpCard[] = [];
    for (const pact of this.#activePacts(ownerId)) {
      const placed = this.#pactToday(ownerId, pact, timezone, now);
      if (placed === null) continue;
      switch (placed.section) {
        case "to-do":
          toDo.push(placed.card);
          break;
        case "automatic":
          automatic.push(placed.card);
          break;
        case "no-oura-data":
          noOuraData.push(placed.card);
          break;
        case "coming-up":
          comingUp.push(placed.card);
          break;
      }
    }
    toDo.push(...billCards);
    // Rows come sorted by name, and the sorts are stable.
    toDo.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    automatic.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    noOuraData.sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
    comingUp.sort((a, b) => a.opensOn.localeCompare(b.opensOn, "en-US"));
    const sections: TodaySection[] = [];
    if (noOuraData.length > 0) sections.push({ kind: "no-oura-data", cards: noOuraData });
    if (toDo.length > 0) sections.push({ kind: "to-do", cards: toDo });
    const missed = this.#recentlyMissed(ownerId, timezone, now);
    if (missed.length > 0) sections.push({ kind: "missed", cards: missed });
    if (automatic.length > 0) sections.push({ kind: "automatic", cards: automatic });
    if (comingUp.length > 0) sections.push({ kind: "coming-up", cards: comingUp });
    return sections;
  }

  /** The Active pact's card on Today and the section it goes in, or null when it has none now. */
  #pactToday(ownerId: AccountId, pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
    switch (pact.evidenceKind) {
      case "oura":
        return this.#bedtimeToday(pact, timezone, now);
      case "anki":
        return this.#ankiToday(ownerId, pact, timezone, now);
      case "camera":
        return this.#cameraToday(pact, timezone, now);
    }
  }

  /**
   * A bedtime pact on Today: Coming up before its first night opens; then
   * last night under No Oura data, else tonight under Automatic. A night with
   * an excuse filed is under Waiting for approval instead.
   */
  #bedtimeToday(pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
    const { first, between } = this.#occurrencesOf(pact.id, timezone);
    if (now.getTime() < first.opensAt.getTime()) {
      return { section: "coming-up", card: this.#comingUpCard(pact, first) };
    }
    const today = localDateOf(now, timezone);
    // Nights the owner needn't hear about: judged, or with an excuse filed.
    const open = (night: Occurrence) =>
      !this.#isJudged(pact.id, night.date) && this.#excuseOn(pact.id, night.date) === null;
    const nights = between(addDays(today, -2), today);
    // Tonight: the night open now whose deadline hasn't passed. Past midnight that may be last night's.
    const tonight = nights.find(
      (night) => night.opensAt.getTime() <= now.getTime() && now.getTime() < night.dueAt.getTime() && open(night),
    );
    // Last night: past its deadline, and Oura hasn't reported it before it closes.
    const lastNight = nights.find(
      (night) => night.dueAt.getTime() <= now.getTime() && now.getTime() < night.closesAt.getTime() && open(night),
    );
    const tonightCard = tonight && {
      occurrenceDate: tonight.date,
      dueAt: tonight.dueAt,
      inBedBy: this.#termsOn(pact.id, tonight.date).in_bed_by!,
    };
    if (lastNight) {
      // Tonight's deadline rides on this card.
      return {
        section: "no-oura-data",
        card: {
          ...this.#cardOn(pact, lastNight.date),
          occurrenceDate: lastNight.date,
          closesAt: lastNight.closesAt,
          tonight: tonightCard ?? null,
        },
      };
    }
    if (tonightCard) {
      return {
        section: "automatic",
        card: {
          ...this.#cardOn(pact, tonightCard.occurrenceDate),
          editWindowClosesAt: pact.editWindowClosesAt,
          ...tonightCard,
        },
      };
    }
    return null;
  }

  /**
   * An Anki pact on Today: its day open now under To do until it's judged
   * (Satisfied the moment Pact sees the deck finished) or past its due time,
   * unless an excuse covers it; Coming up before its first day opens.
   */
  #ankiToday(ownerId: AccountId, pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
    const { first, openAt } = this.#occurrencesOf(pact.id, timezone);
    const open = openAt(now);
    if (open && !this.#isJudged(pact.id, open.date) && now.getTime() < open.dueAt.getTime()) {
      if (this.#excuseOn(pact.id, open.date) !== null) return null;
      return { section: "to-do", card: this.#ankiCard(pact, ownerId, open) };
    }
    if (!open && now.getTime() < first.opensAt.getTime()) {
      return { section: "coming-up", card: this.#comingUpCard(pact, first) };
    }
    return null;
  }

  /**
   * A Camera pact on Today: its occurrence open now under To do while it
   * still needs evidence; Coming up before its first occurrence opens.
   */
  #cameraToday(pact: ActivePact, timezone: string, now: Date): TodayPlacement | null {
    const { first, openAt, dayDueAt } = this.#occurrencesOf(pact.id, timezone);
    const open = openAt(now);
    if (!open) {
      return now.getTime() < first.opensAt.getTime()
        ? { section: "coming-up", card: this.#comingUpCard(pact, first) }
        : null;
    }
    // Judged while still open: its evidence was rejected, so it's an alert, or
    // it's past its due-by time, so it's Missed. Past it and not judged yet,
    // the next tick judges it.
    if (this.#isJudged(pact.id, open.date) || now.getTime() >= open.dueAt.getTime()) return null;
    const { editWindowClosesAt } = pact;
    if (pact.terms.schedule.kind === "weekly-count") {
      const today = localDateOf(now, timezone);
      const week = this.#weekToDo(pact.id, open, today, dayDueAt(today)!, now);
      if (!week) return null;
      return {
        section: "to-do",
        card: { kind: "evidence", ...this.#cardOn(pact, open.date), editWindowClosesAt, ...week },
      };
    }
    // Evidence waiting or approved: Waiting for approval, or done.
    const decision = this.#evidenceDecision(pact.id, open.date);
    if (decision === "waiting" || decision === "approved") return null;
    // An excuse waiting for today is under Waiting for approval; an approved one excuses it.
    if (this.#excuseOn(pact.id, open.date) !== null) return null;
    return {
      section: "to-do",
      card: {
        kind: "evidence",
        ...this.#cardOn(pact, open.date),
        editWindowClosesAt,
        occurrenceDate: open.date,
        dueAt: open.dueAt,
        dueBy: this.#termsOn(pact.id, open.date).due_by,
      },
    };
  }

  /** What every pact card on Today shows: the terms of the occurrence on `date`, the one it's about. */
  #cardOn(pact: ActivePact, date: LocalDate): Pick<TodayComingUpCard, "pactId" | "name" | "penaltyCents"> {
    return { pactId: pact.id, name: pact.name, penaltyCents: this.#termsOn(pact.id, date).penalty_cents };
  }

  /** The pact's Coming up card, until its first occurrence `first` opens. */
  #comingUpCard(pact: ActivePact, first: Occurrence): TodayComingUpCard {
    return {
      ...this.#cardOn(pact, first.date),
      editWindowClosesAt: pact.editWindowClosesAt,
      opensOn: first.date,
      startDate: pact.startDate,
    };
  }

  /** An Anki pact's open day on Today: its due time, and how the deck stood at the last check. */
  #ankiCard(pact: ActivePact, ownerId: AccountId, open: Occurrence): TodayAnkiCard {
    return {
      kind: "anki",
      ...this.#cardOn(pact, open.date),
      editWindowClosesAt: pact.editWindowClosesAt,
      occurrenceDate: open.date,
      dueAt: open.dueAt,
      dueBy: this.#termsOn(pact.id, open.date).due_by,
      deckName: this.#ankiDeckName(ownerId, this.#ankiDeckOn(pact.id, open.date)),
      deckMissing: this.#ankiDeckMissing(ownerId, this.#ankiDeckOn(pact.id, open.date)),
      lastCheck: this.#lastAnkiCheck(pact.id, open.date),
    };
  }

  /**
   * A Weekly count week's To do card as of `now`, when `today` still takes
   * evidence (before `todayDueAt`) and has none, no excuse covers the week,
   * and its target isn't met or waiting for approval; else null.
   */
  #weekToDo(
    pactId: string,
    week: Occurrence,
    today: LocalDate,
    todayDueAt: Date,
    now: Date,
  ): Pick<TodayToDoCard, "occurrenceDate" | "dueAt" | "dueBy" | "week"> | null {
    if (now.getTime() >= todayDueAt.getTime()) return null;
    if (this.#excuseOn(pactId, week.date) !== null) return null;
    if (this.#evidenceDecision(pactId, today, "day") !== "none") return null;
    const progress = this.#weekProgress(pactId, week.date);
    if (progress.sessions + progress.waiting >= progress.target) return null;
    const { due_by: dueBy } = this.#termsOn(pactId, week.date);
    return { occurrenceDate: week.date, dueAt: week.dueAt, dueBy, week: progress };
  }

  /**
   * One alert per occurrence of the owner's judged Missed through a
   * rejection, newest rejection first, with when it was judged. No time
   * limit. It goes once the owner accepts the miss, or files an excuse for
   * the day (one waiting before the rejection counts too); a rejected
   * excuse's own alert takes over then.
   */
  #rejectedEvidenceAlerts(ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, occurrence.date, occurrence.judged_at, penalty.amount_cents,
                recipient.name AS recipient_name
         FROM occurrence
         JOIN pact ON pact.id = occurrence.pact_id
         JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         JOIN recipient ON recipient.id = penalty.recipient_id
         WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND occurrence.miss_accepted_at IS NULL
           AND ${MISSED_THROUGH_REJECTION}
           AND NOT ${excuseCoversSql(
             "occurrence.pact_id",
             "occurrence.date",
             "(excuse.decision IS NULL OR excuse.filed_at >= occurrence.judged_at)",
           )}
         ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
      )
      .all(ownerId) as {
      id: string;
      name: string;
      date: LocalDate;
      judged_at: string;
      amount_cents: number;
      recipient_name: string;
    }[];
    return rows.map((row) => {
      const rejection = this.#rejection(row.id, row.date);
      if (!rejection) throw new Error(`no rejected evidence for pact ${row.id} on ${row.date}`);
      const judgedAt = new Date(row.judged_at);
      return {
        at: judgedAt,
        alert: {
          kind: "evidence-rejected",
          pactId: row.id,
          name: row.name,
          ...rejection,
          occurrenceDate: row.date,
          penaltyCents: row.amount_cents,
          recipientName: row.recipient_name,
          excusableUntil: new Date(judgedAt.getTime() + EXCUSE_WINDOW_MS),
          week: false,
        },
      };
    });
  }

  /**
   * One alert per Weekly count day of the owner's whose evidence was
   * rejected, newest rejection first, with when it was rejected: nothing is
   * Missed, and the day can be made up another day. It goes once the owner
   * takes the L on it, an excuse covers the week (one rejected after the
   * rejection has its own alert), or the week is judged.
   */
  #rejectedDayAlerts(ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, evidence.occurrence_date, evidence.day, evidence.decided_at,
                evidence.reject_reason, reviewer.name AS reviewer_name
         FROM evidence
         JOIN pact ON pact.id = evidence.pact_id
         JOIN account AS reviewer ON reviewer.id = evidence.decided_by_account_id
         WHERE pact.owner_account_id = ? AND ${WEEKLY_COUNT_PACT}
           AND evidence.decision = 'rejected' AND evidence.rejection_accepted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM occurrence
                           WHERE occurrence.pact_id = evidence.pact_id AND occurrence.date = evidence.occurrence_date
                             AND occurrence.outcome IS NOT NULL)
           AND NOT ${excuseCoversSql(
             "evidence.pact_id",
             "evidence.occurrence_date",
             "(excuse.decision IS NULL OR excuse.decision = 'approved' OR excuse.filed_at >= evidence.decided_at)",
           )}
         ORDER BY evidence.decided_at DESC, pact.name, pact.id`,
      )
      .all(ownerId) as {
      id: string;
      name: string;
      occurrence_date: LocalDate;
      day: LocalDate;
      decided_at: string;
      reject_reason: string;
      reviewer_name: string;
    }[];
    return rows.map((row) => {
      const terms = this.#termsOn(row.id, row.occurrence_date);
      return {
        at: new Date(row.decided_at),
        alert: {
          kind: "evidence-rejected",
          pactId: row.id,
          name: row.name,
          reviewerName: row.reviewer_name,
          reason: row.reject_reason,
          occurrenceDate: row.day,
          penaltyCents: terms.penalty_cents,
          recipientName: this.#recipientName(terms.recipient_id),
          excusableUntil: null,
          week: true,
        },
      };
    });
  }

  /**
   * The owner's occurrences judged Missed in the 48 hours before `now`,
   * latest first, but not accepted misses, nor those Missed through a
   * rejection or on a rejected excuse (those are alerts), nor those on an
   * excuse waiting for approval. Today's day of a Camera pact with a due-by
   * time is Closed.
   */
  #recentlyMissed(ownerId: AccountId, timezone: string, now: Date): TodayMissedCard[] {
    const today = localDateOf(now, timezone);
    const since = new Date(now.getTime() - EXCUSE_WINDOW_MS);
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, penalty.amount_cents, occurrence.date,
                occurrence.judged_at, occurrence.bedtime_start, occurrence.anki_cards_left, occurrence.anki_checked_at
         FROM occurrence
         JOIN pact ON pact.id = occurrence.pact_id
         JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         WHERE pact.owner_account_id = ? AND occurrence.outcome = 'missed' AND occurrence.judged_at > ?
           AND occurrence.miss_accepted_at IS NULL AND NOT ${MISSED_THROUGH_REJECTION}
           AND NOT ${excuseCoversSql(
             "occurrence.pact_id",
             "occurrence.date",
             "(excuse.decision IS NULL OR (excuse.decision = 'rejected' AND excuse.decided_at >= occurrence.judged_at))",
           )}
         ORDER BY occurrence.judged_at DESC, pact.name, pact.id`,
      )
      .all(ownerId, since.toISOString()) as {
      id: string;
      name: string;
      evidence_kind: EvidenceKind;
      schedule: string;
      amount_cents: number;
      date: LocalDate;
      judged_at: string;
      bedtime_start: string | null;
      anki_cards_left: number | null;
      anki_checked_at: string | null;
    }[];
    return rows.map((row) => {
      const weekly = scheduleOf(row.schedule).kind === "weekly-count";
      const dueBy = row.date === today && !weekly ? this.#termsOn(row.id, row.date).due_by : null;
      return {
        pactId: row.id,
        name: row.name,
        penaltyCents: row.amount_cents,
        occurrenceDate: row.date,
        missedAt: new Date(row.judged_at),
        excusableUntil: new Date(new Date(row.judged_at).getTime() + EXCUSE_WINDOW_MS),
        detail: this.#missedDetail(row, dueBy, weekly),
      };
    });
  }

  /**
   * What a Missed card's line says beyond its day: Closed at today's due-by
   * time, how far a Weekly count week got, the Anki check that decided it, or
   * when Oura saw the owner get into bed.
   */
  #missedDetail(
    row: {
      id: string;
      evidence_kind: EvidenceKind;
      date: LocalDate;
      bedtime_start: string | null;
      anki_cards_left: number | null;
      anki_checked_at: string | null;
    },
    dueBy: string | null,
    weekly: boolean,
  ): MissedDetail | null {
    if (dueBy !== null && row.evidence_kind !== "anki") return { kind: "closed", dueBy };
    if (weekly) return { kind: "week", progress: this.#weekProgress(row.id, row.date) };
    if (row.evidence_kind === "anki") return { kind: "anki", lastCheck: ankiCheckOf(row) };
    if (row.evidence_kind === "oura") {
      return { kind: "night", inBedAt: row.bedtime_start === null ? null : wallClock(row.bedtime_start).slice(11) };
    }
    return null;
  }

  /** Who rejected the latest rejected evidence for an occurrence, and why; null if none was rejected. */
  #rejection(pactId: string, date: LocalDate): EvidenceRejection | null {
    const row = this.#db
      .prepare(
        `SELECT account.name, evidence.reject_reason FROM evidence
         JOIN account ON account.id = evidence.decided_by_account_id
         WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'rejected'
         ORDER BY evidence.decided_at DESC, evidence.submitted_at DESC
         LIMIT 1`,
      )
      .get(pactId, date) as { name: string; reject_reason: string } | undefined;
    return row ? { reviewerName: row.name, reason: row.reject_reason } : null;
  }

  /** `ownerId`'s Active pacts, sorted by name. */
  #activePacts(ownerId: AccountId): ActivePact[] {
    const now = this.#clock.now();
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.name, pact.schedule, pact.in_bed_by, pact.due_by, pact.start_date, pact.end_date,
                pact.penalty_cents, pact.first_occurrence, pact.created_at, pact.evidence_kind,
                pact.anki_rollover_hour
         FROM pact
         WHERE pact.owner_account_id = ? AND pact.stage = 'active'
         ORDER BY pact.name, pact.created_at, pact.id`,
      )
      .all(ownerId) as Pick<
      PactRow,
      | "id"
      | "name"
      | "schedule"
      | "in_bed_by"
      | "due_by"
      | "start_date"
      | "end_date"
      | "penalty_cents"
      | "first_occurrence"
      | "created_at"
      | "evidence_kind"
      | "anki_rollover_hour"
    >[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      evidenceKind: row.evidence_kind,
      penaltyCents: row.penalty_cents,
      terms: occurrenceTermsOf(row),
      startDate: row.start_date,
      editWindowClosesAt: editWindowClosesAt(row, now),
    }));
  }

  /** The recipients matching the SQL `condition` on `recipient`, sorted by name. */
  #selectRecipients(condition: string, ...params: string[]): Recipient[] {
    const recipients = this.#db.prepare(`SELECT id, name FROM recipient WHERE ${condition}`).all(...params);
    return (recipients as Recipient[]).sort(byName);
  }

  async advanceTo(t: Date): Promise<void> {
    // Before the transaction, never in it: a slow Oura can't hold up other writes.
    // An account whose call throws has no data this tick; the next one retries.
    const fetched = await this.#fetchSleep(t);
    const checked = await this.#fetchAnki(t);
    await this.#command(
      () => {
        this.#closeEditWindows(t);
        // Before judging at due times: a check made before a day's due time can still satisfy it.
        this.#recordAnkiChecks(checked);
        this.#judgeDueBy(t);
        for (const account of fetched.disconnected) this.#markDisconnected("oura", account, fetched.askedAt);
        this.#noteOuraClock(fetched.sleep);
        this.#judgeNights(t, fetched.sleep);
        this.#pushNoOuraData(t);
        const dropped = this.#remind(t);
        this.#endPastEndDate(t);
        this.#makeBills(t);
        this.#remindOverdue(t);
        this.#db
          .prepare(
            `INSERT INTO scheduler_state (id, last_tick_at) VALUES (1, ?)
             ON CONFLICT (id) DO UPDATE SET last_tick_at = excluded.last_tick_at`,
          )
          .run(t.toISOString());
        return dropped;
      },
      // Logged once committed, like any operator alert: the log line never depends on delivery.
      (dropped) => {
        for (const drop of dropped) {
          this.#log(
            `reminder dropped: pact ${drop.pactId}, ${drop.time} for ${drop.date}, ` +
              `${Math.floor(drop.lateMs / 60_000)} min late at ${t.toISOString()}`,
          );
        }
        if (dropped.length > 0) this.#log(`OPERATOR_ALERT ${droppedText(dropped.length)} after downtime`);
      },
    );
    await this.#delivery;
  }

  /**
   * Sends each Active pact's reminders whose time has come since the
   * scheduler last looked (the pact's `reminded_through`), so a stopped
   * scheduler catches up, but drops those more than 15 minutes late and
   * tells the operator. A reminder goes off before its occurrence's due time
   * and only while it's useful: a Camera day with no evidence and not judged
   * (on Weekly count, any day of the week while its target isn't met or
   * waiting for approval), any scheduled bedtime night (the app can't know the owner is in bed until
   * the ring syncs), an Anki day not judged yet, never one an approved excuse covers.
   */
  #remind(t: Date): DroppedReminder[] {
    const pacts = this.#db
      .prepare(
        `SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, pact.reminders, pact.reminded_through,
                pact.anki_rollover_hour, pact.in_bed_by, pact.due_by, pact.created_at, pact.owner_account_id,
                account.timezone
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'active'
         ORDER BY pact.created_at, pact.id`,
      )
      .all() as (Pick<
      PactRow,
      | "id"
      | "name"
      | "evidence_kind"
      | "schedule"
      | "reminders"
      | "reminded_through"
      | "anki_rollover_hour"
      | "in_bed_by"
      | "due_by"
      | "created_at"
    > & {
      owner_account_id: AccountId;
      timezone: string | null;
    })[];
    const dropped: DroppedReminder[] = [];
    for (const pact of pacts) {
      const from = pact.reminded_through === null ? t : new Date(pact.reminded_through);
      if (from.getTime() >= t.getTime()) continue;
      this.#db.prepare(`UPDATE pact SET reminded_through = ? WHERE id = ?`).run(t.toISOString(), pact.id);
      const times = remindersOf(pact.reminders);
      if (times.length === 0) continue;
      const timezone = ownerZone(pact.timezone, pact.owner_account_id);
      // A night's or an Anki day's reminder can go off the morning after, so start a day early.
      const fromDate = addDays(localDateOf(from, timezone), -1);
      const due = remindersDue(
        pact,
        times,
        this.#occurrencesOf(pact.id, timezone),
        fromDate,
        localDateOf(t, timezone),
        timezone,
      );
      // A reminder sent before the owner moved west comes round again: it went off already.
      this.#db.prepare(`DELETE FROM reminder_sent WHERE pact_id = ? AND date < ?`).run(pact.id, addDays(fromDate, -1));
      for (const { date, dueAt, time, at } of due) {
        if (at.getTime() <= from.getTime() || at.getTime() > t.getTime()) continue;
        if (at.getTime() >= dueAt.getTime() || !this.#worthReminding(pact, date)) continue;
        const lateMs = t.getTime() - at.getTime();
        if (lateMs > REMINDER_LATE_MS) {
          dropped.push({ pactId: pact.id, date, time, lateMs });
          continue;
        }
        const sent = this.#db
          .prepare(`INSERT INTO reminder_sent (pact_id, date, time) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
          .run(pact.id, date, time);
        if (sent.changes === 1) this.#enqueueReminder(pact, date);
      }
    }
    const operator = this.#db.prepare(`SELECT id FROM account WHERE is_operator = 1`).get() as
      { id: AccountId } | undefined;
    if (dropped.length > 0 && operator) {
      this.#enqueue({
        recipient: operator.id,
        kind: "operator-alert",
        payload: {
          alert: "reminders-dropped",
          dropped: dropped.length,
          title: "Operator alert",
          body: `${capitalized(droppedText(dropped.length))} after downtime.`,
          url: APP_PATHS.today,
        },
      });
    }
    return dropped;
  }

  /**
   * Whether the day `day` still needs a nudge: a bedtime night always, a
   * Camera day with nothing submitted or judged, and on Weekly count a day
   * with nothing submitted of a week not judged, whose target isn't met or
   * waiting for approval.
   */
  #worthReminding(pact: Pick<PactRow, "id" | "evidence_kind" | "schedule">, day: LocalDate): boolean {
    const weekly = scheduleOf(pact.schedule).kind === "weekly-count";
    const date = weekly ? mondayOf(day) : day;
    if (this.#excuseOn(pact.id, date) === "approved") return false;
    if (pact.evidence_kind === "oura") return true;
    // Pact doesn't see the deck finished until a check does: an Anki day is worth reminding until it's judged.
    if (pact.evidence_kind === "anki") return !this.#isJudged(pact.id, date);
    const submitted = this.#db.prepare(`SELECT 1 FROM evidence WHERE pact_id = ? AND day = ?`).get(pact.id, day);
    if (submitted !== undefined || this.#isJudged(pact.id, date)) return false;
    if (!weekly) return true;
    const { sessions, waiting, target } = this.#weekProgress(pact.id, date);
    return sessions + waiting < target;
  }

  /** A reminder about the day `date` (on Weekly count, a day of the week). */
  #enqueueReminder(
    pact: Pick<PactRow, "id" | "name" | "evidence_kind" | "schedule"> & { owner_account_id: AccountId },
    date: LocalDate,
  ): void {
    const { kind } = scheduleOf(pact.schedule);
    const weekly = kind === "weekly-count";
    const terms = this.#termsOn(pact.id, weekly ? mondayOf(date) : date);
    const due = terms.due_by === null ? "midnight" : clockText(terms.due_by);
    let body = `No photo yet today. Due at ${due}.`;
    if (pact.evidence_kind === "oura") body = `In bed by ${clockText(terms.in_bed_by!)} tonight.`;
    if (pact.evidence_kind === "anki") {
      const check = this.#lastAnkiCheck(pact.id, date);
      body = check === null ? `Due at ${due}. Not checked yet.` : `${cardsText(check.cardsLeft)} left, due at ${due}`;
    }
    if (kind === "one-time") body = `No photo yet. Due ${formatDate(date)} at ${due}.`;
    if (weekly) {
      const { sessions, target } = this.#weekProgress(pact.id, mondayOf(date));
      body = `${sessions} of ${target} this week. Today's photo is due at ${due}.`;
    }
    this.#enqueue({
      recipient: pact.owner_account_id,
      kind: "reminder",
      payload: { pactId: pact.id, occurrenceDate: date, title: pact.name, body, url: APP_PATHS.today },
    });
  }

  /**
   * Judges each pact's occurrences due by `t`, from where judging got to last
   * time (the pact's `judged_through`), so a stopped scheduler catches up.
   */
  #judgeDueBy(t: Date): void {
    for (const pact of this.#pactsToJudge()) this.#judgePactDueBy(pact, t);
  }

  /**
   * Judges one Camera or Anki pact's occurrences due by `t`, from where
   * judging got to. An Anki day still not judged is Missed then, with the
   * last check that counted for it, unless a check that started before its
   * due time is still running: judging stops there, and a later tick judges
   * it once the check is recorded.
   */
  #judgePactDueBy(pact: PactToJudge, t: Date): void {
    // Oura reports bedtime nights.
    if (pact.evidence_kind === "oura") return;
    const timezone = ownerZone(pact.timezone, pact.owner_account_id);
    const due = this.#occurrencesOf(pact.id, timezone).dueAfter(pact.judged_through, t);
    let through: LocalDate | null = null;
    for (const occurrence of due) {
      const judged = this.#isJudged(pact.id, occurrence.date);
      if (pact.evidence_kind === "anki" && !judged && this.#ankiCheckHolds(pact.owner_account_id, occurrence, t)) {
        break;
      }
      this.#judgeAtDueTime(pact, occurrence);
      if (pact.evidence_kind === "anki" && !judged) this.#noteAnkiMiss(pact, occurrence);
      through = occurrence.date;
    }
    if (through !== null) this.#db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(through, pact.id);
  }

  /**
   * Whether a check of the account's AnkiWeb that started before `day`'s due
   * time is still running at `t`, and not for so long it's given up.
   */
  #ankiCheckHolds(account: AccountId, day: Occurrence, t: Date): boolean {
    return [...(this.#ankiChecksRunning.get(account) ?? [])].some(
      ({ startedAt }) => startedAt < day.dueAt.getTime() && t.getTime() - startedAt < ANKI_CHECK_HOLDS_JUDGING_MS,
    );
  }

  /**
   * Ends each Active pact whose end date has passed by `t`: at the start of
   * the next day, or once its last occurrence closes if that's later (a
   * bedtime night closes at 18:00 the next day). Judging has had its turn
   * first, so the last occurrence is judged unless its evidence still waits
   * for a decision, which judges it then. A pact whose last Anki day a running
   * check holds (`#ankiCheckHolds`) ends on a later tick, once it's judged.
   */
  #endPastEndDate(t: Date): void {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.end_date, pact.evidence_kind, pact.owner_account_id, account.timezone
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'active' AND pact.end_date IS NOT NULL
         ORDER BY pact.created_at, pact.id`,
      )
      .all() as {
      id: string;
      end_date: LocalDate;
      evidence_kind: PactRow["evidence_kind"];
      owner_account_id: AccountId;
      timezone: string | null;
    }[];
    for (const { id, end_date: endDate, evidence_kind: kind, owner_account_id: owner, timezone: zone } of rows) {
      const timezone = ownerZone(zone, owner);
      const dayAfter = startOfDay(addDays(endDate, 1), timezone);
      const last = this.#occurrencesOf(id, timezone).between(addDays(endDate, -7), endDate).at(-1);
      const endsAt = last && last.closesAt.getTime() > dayAfter.getTime() ? last.closesAt : dayAfter;
      if (endsAt.getTime() > t.getTime()) continue;
      if (kind === "anki" && last && !this.#isJudged(id, last.date) && this.#ankiCheckHolds(owner, last, t)) continue;
      this.#endPact(id, endsAt);
    }
  }

  /**
   * Each night of a bedtime pact that hasn't been judged, from where judging
   * got to, whose window (18:00 that day to 18:00 the next) has started by `t`.
   * An Ended pact still has the nights that fell due before it Ended.
   */
  #nightsWaiting(t: Date, owner?: AccountId): { pact: PactToJudge & { timezone: string }; night: Occurrence }[] {
    const waiting = [];
    for (const pact of [...this.#pactsToJudge(), ...this.#endedBedtimePacts()]) {
      if (pact.evidence_kind !== "oura") continue;
      if (owner !== undefined && pact.owner_account_id !== owner) continue;
      const timezone = ownerZone(pact.timezone, pact.owner_account_id);
      const endedAt = pact.ended_at === null ? null : new Date(pact.ended_at);
      const until = endedAt !== null && endedAt.getTime() < t.getTime() ? endedAt : t;
      const from = pact.judged_through === null ? pact.first_occurrence : addDays(pact.judged_through, 1);
      // The window is on the clock the night closes on.
      const ouraOffset = this.#ouraOffset(pact.owner_account_id, timezone);
      for (const night of this.#occurrencesOf(pact.id, timezone).between(from, localDateOf(until, timezone))) {
        if (nightStartsAt(night.date, timezone, ouraOffset).getTime() > t.getTime()) break;
        if (endedAt !== null && night.dueAt.getTime() > endedAt.getTime()) break;
        if (!this.#isJudged(pact.id, night.date)) waiting.push({ pact: { ...pact, timezone }, night });
      }
    }
    return waiting;
  }

  /**
   * The sleep periods of each account (or just `owner`) with a bedtime night
   * waiting on Oura and a working connection, for the days those nights
   * could fall on. Accounts with nothing waiting, and connections that need
   * reconnecting, cause no calls. A "disconnected" result is no data, and
   * the account is listed for `#markDisconnected`. A call that fails (a
   * timeout, Oura erroring) is no data too, but never disconnected: it's
   * logged, the next tick tries again, and one account's Oura never holds up
   * anyone else's tick.
   */
  async #fetchSleep(t: Date, owner?: AccountId): Promise<FetchedSleep> {
    const askedAt = this.#clock.now();
    const ranges = new Map<AccountId, { startDate: LocalDate; endDate: LocalDate }>();
    for (const { pact, night } of this.#nightsWaiting(t, owner)) {
      if (this.#connectionProblem(pact.owner_account_id, "oura") !== null) continue;
      // Oura files a night's sleep under the day it ends, usually the day after;
      // a day more covers a sleep that ends late, whether Oura's end_date is inclusive or not.
      const range = ranges.get(pact.owner_account_id);
      const endDate = addDays(night.date, 2);
      ranges.set(pact.owner_account_id, {
        startDate: range ? earlierDate(range.startDate, night.date) : night.date,
        endDate: range ? laterDate(range.endDate, endDate) : endDate,
      });
    }
    const sleep = new Map<AccountId, OuraSleepPeriod[]>();
    const disconnected: AccountId[] = [];
    for (const [account, range] of ranges) {
      try {
        const result = await this.#ouraSource.sleepPeriods(account, range);
        if (result.ok) sleep.set(account, result.periods);
        else disconnected.push(account);
      } catch (error) {
        this.#log(`Oura sleep for account ${account} failed, no data this tick: ${errorText(error)}`);
      }
    }
    return { sleep, disconnected, askedAt };
  }

  /**
   * Marks the account's connection to `service` Needs reconnecting after the
   * service refused it (Oura its tokens, AnkiWeb its login), once: the owner
   * gets one push, and the Today and pact alerts show until they reconnect.
   * Until then no call is made. A connection made again since the service
   * was asked (`askedAt`) is left alone: its new tokens weren't the ones refused.
   */
  #markDisconnected(service: ConnectionService, account: AccountId, askedAt: Date): void {
    const marked = this.#db
      .prepare(
        `UPDATE connection SET status = 'needs-reconnecting'
         WHERE account_id = ? AND service = ? AND status = 'connected' AND connected_at <= ?`,
      )
      .run(account, service, askedAt.toISOString());
    if (marked.changes === 0) return;
    this.#enqueue({
      recipient: account,
      kind: "connection-problem",
      payload: { ...RECONNECT_PUSH[service], url: APP_PATHS.today },
    });
  }

  /**
   * At 15:00 the day after, a bedtime night still not judged sends its owner
   * one push, unless an excuse was filed for it. One per owner and night, so
   * two pacts waiting on the same night send one. A night already closed by
   * the time the scheduler gets here was just judged, so it sends none.
   */
  #pushNoOuraData(t: Date): void {
    for (const { pact, night } of this.#nightsWaiting(t)) {
      const ouraOffset = this.#ouraOffset(pact.owner_account_id, pact.timezone);
      if (t.getTime() < noOuraDataPushAt(night.date, pact.timezone, ouraOffset).getTime()) continue;
      if (t.getTime() >= night.closesAt.getTime() || this.#isJudged(pact.id, night.date)) continue;
      if (this.#excuseOn(pact.id, night.date) !== null) continue;
      const sent = this.#db
        .prepare(`INSERT INTO no_oura_data_push_sent (account_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
        .run(pact.owner_account_id, night.date);
      if (sent.changes === 0) continue;
      const fix = this.#connectionProblem(pact.owner_account_id, "oura") === null ? "Sync your ring" : "Reconnect Oura";
      this.#enqueue({
        recipient: pact.owner_account_id,
        kind: "connection-problem",
        payload: {
          occurrenceDate: night.date,
          title: "No Oura data",
          body: `No Oura data for ${formatDate(night.date).split(" ")[0]} night yet. ${fix} before 6pm or it counts as missed.`,
          url: APP_PATHS.today,
        },
      });
    }
  }

  /**
   * Judges bedtime nights in order, from where judging got to. A night is
   * decided by the first long_sleep Oura reports starting in its window,
   * read on Oura's own clock: Satisfied if it starts before the in-bed-by time,
   * else Missed, as of `t`, when it arrived. With an approved excuse, a late
   * period makes it Excused instead, and so does no period by 18:00 the next
   * day, then. With neither by then, it's Missed then. The first night still
   * waiting stops the cursor.
   */
  #judgeNights(t: Date, sleep: Map<AccountId, OuraSleepPeriod[]>, owner?: AccountId): void {
    const stopped = new Set<string>();
    for (const { pact, night } of this.#nightsWaiting(t, owner)) {
      if (stopped.has(pact.id)) continue;
      const inBedBy = this.#termsOn(pact.id, night.date).in_bed_by!;
      const period = (sleep.get(pact.owner_account_id) ?? [])
        .filter((p) => p.type === "long_sleep" && nightOf(p.bedtime_start) === night.date)
        .sort((a, b) => wallClock(a.bedtime_start).localeCompare(wallClock(b.bedtime_start), "en-US"))[0];
      const excuse = this.#excuseOn(pact.id, night.date);
      const satisfied =
        period !== undefined && wallClock(period.bedtime_start) < deadlineWallClock(night.date, inBedBy);
      // As for a photo: an on-time bedtime beats an approved excuse, and an approved excuse beats a late one.
      // So with no period yet, an approved excuse waits for one until the night closes.
      if (excuse === "approved" && !satisfied && (period !== undefined || night.closesAt.getTime() <= t.getTime())) {
        this.#judge(pact.id, night.date, "excused", period ? t : night.closesAt);
      } else if (period) {
        this.#judge(pact.id, night.date, satisfied ? "satisfied" : "missed", t);
        this.#db
          .prepare(`UPDATE occurrence SET bedtime_start = ? WHERE pact_id = ? AND date = ?`)
          .run(period.bedtime_start, pact.id, night.date);
        if (!satisfied && excuse === null) this.#enqueueMissed(pact.id, night.date);
      } else if (night.closesAt.getTime() <= t.getTime()) {
        this.#judge(pact.id, night.date, "missed", night.closesAt);
        if (excuse === null) this.#enqueueMissed(pact.id, night.date);
      } else {
        stopped.add(pact.id);
        continue;
      }
      this.#db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(night.date, pact.id);
    }
  }

  /**
   * Each Active Anki pact (of `owner`, or everyone's) whose day is open at
   * `t`, before its due time, not judged yet and not covered by an approved
   * excuse, with a working AnkiWeb connection: what a check is for.
   */
  #ankiDaysWaiting(t: Date, owner?: AccountId): { pactId: string; account: AccountId; deckId: string }[] {
    const pacts = this.#db
      .prepare(
        `SELECT pact.id, pact.owner_account_id, account.timezone
         FROM pact
         JOIN account ON account.id = pact.owner_account_id
         JOIN connection ON connection.account_id = pact.owner_account_id AND connection.service = 'anki'
         WHERE pact.stage = 'active' AND pact.evidence_kind = 'anki' AND connection.status = 'connected'
           AND (? IS NULL OR pact.owner_account_id = ?)
         ORDER BY pact.created_at, pact.id`,
      )
      .all(owner ?? null, owner ?? null) as { id: string; owner_account_id: AccountId; timezone: string | null }[];
    return pacts.flatMap((pact) => {
      const open = this.#occurrencesOf(pact.id, ownerZone(pact.timezone, pact.owner_account_id)).openAt(t);
      if (!open || t.getTime() >= open.dueAt.getTime() || this.#isJudged(pact.id, open.date)) return [];
      // An approved excuse covers it: it's Excused at its due time whatever the deck shows.
      if (this.#excuseOn(pact.id, open.date) === "approved") return [];
      return [{ pactId: pact.id, account: pact.owner_account_id, deckId: this.#ankiDeckOn(pact.id, open.date) }];
    });
  }

  /**
   * Checks AnkiWeb for each account (or just `owner`) with an Anki day
   * waiting: one call per account, for every deck its waiting pacts are on.
   * A tick checks an account at most every 10 minutes; `owner`'s check now
   * always does. Accounts are checked at once, so a slow AnkiWeb delays the
   * tick by its own call only, never by the sum of everyone's. A call that
   * throws is logged and forgotten, so the next tick tries again. A
   * "disconnected" answer checks nothing, and `#recordAnkiChecks` marks the
   * connection Needs reconnecting. While a call runs, it holds judging
   * the days it may still satisfy (`#ankiCheckHolds`).
   */
  async #fetchAnki(t: Date, owner?: AccountId): Promise<FetchedAnki[]> {
    const decks = new Map<AccountId, string[]>();
    for (const { account, deckId } of this.#ankiDaysWaiting(t, owner)) {
      const list = decks.get(account) ?? [];
      if (!list.includes(deckId)) list.push(deckId);
      decks.set(account, list);
    }
    const check = async (account: AccountId, deckIds: string[]): Promise<FetchedAnki | null> => {
      const last = this.#ankiPolls.get(account);
      if (owner === undefined && last !== undefined && t.getTime() - last < ANKI_POLL_INTERVAL_MS) return null;
      this.#ankiPolls.set(account, t.getTime());
      const running = { startedAt: t.getTime() };
      const checks = this.#ankiChecksRunning.get(account) ?? new Set();
      this.#ankiChecksRunning.set(account, checks.add(running));
      try {
        const result = await this.#ankiSource.deckCounts(account, deckIds);
        return { account, result, checkedAt: t };
      } catch (error) {
        this.#ankiPolls.delete(account);
        this.#log(`AnkiWeb check for account ${account} failed, nothing checked: ${errorText(error)}`);
        return null;
      } finally {
        checks.delete(running);
        if (checks.size === 0) this.#ankiChecksRunning.delete(account);
      }
    };
    const settled = await Promise.allSettled([...decks].map(([account, deckIds]) => check(account, deckIds)));
    return settled.flatMap((outcome) => (outcome.status === "fulfilled" && outcome.value ? [outcome.value] : []));
  }

  /**
   * Records each check AnkiWeb answered, deck by deck, and judges each Active
   * Anki pact on a checked deck Satisfied as of the check when it found the
   * deck finished (New, Learn and Due all 0) for the pact's day, evaluated
   * before that day's due time. A deck gone from the collection records
   * nothing. A refused login marks the connection Needs reconnecting.
   */
  #recordAnkiChecks(fetched: FetchedAnki[]): void {
    for (const { account, result, checkedAt } of fetched) {
      if (!result.ok) {
        this.#markDisconnected("anki", account, checkedAt);
        continue;
      }
      this.#renameAnkiDecks(account, result.names);
      const { ankiDate, asOf } = result;
      for (const [deckId, counts] of Object.entries(result.decks)) {
        this.#notePactDeck(account, deckId, counts === null ? null : (result.names[deckId] ?? null), checkedAt);
        if (counts === null) continue;
        this.#db
          .prepare(
            `INSERT INTO anki_check (account_id, deck_id, new_count, learn_count, review_count, anki_date, as_of,
                                     checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            account,
            deckId,
            counts.new,
            counts.learn,
            counts.review,
            ankiDate,
            asOf.toISOString(),
            checkedAt.toISOString(),
          );
      }
      const pacts = this.#db
        .prepare(
          `SELECT pact.id, account.timezone FROM pact JOIN account ON account.id = pact.owner_account_id
           WHERE pact.owner_account_id = ? AND pact.stage = 'active' AND pact.evidence_kind = 'anki'
           ORDER BY pact.created_at, pact.id`,
        )
        .all(account) as { id: string; timezone: string | null }[];
      for (const pact of pacts) {
        const { includes, covering } = this.#occurrencesOf(pact.id, ownerZone(pact.timezone, account));
        const day = includes(ankiDate) ? covering(ankiDate) : null;
        if (!day || asOf.getTime() >= day.dueAt.getTime() || checkedAt.getTime() >= day.dueAt.getTime()) continue;
        // The deck the day is on: a deck change approved since it opened applies from the next.
        const counts = result.decks[this.#ankiDeckOn(pact.id, day.date)];
        if (!counts || counts.new + counts.learn + counts.review > 0) continue;
        if (this.#isJudged(pact.id, day.date)) continue;
        this.#judge(pact.id, day.date, "satisfied", checkedAt);
        this.#noteAnkiResult(pact.id, day.date, { cardsLeft: 0, checkedAt });
      }
    }
  }

  /**
   * Gives the checked decks in the account's stored deck list the names the
   * check found, so a deck renamed in Anki shows its new name before the deck
   * picker loads again.
   */
  #renameAnkiDecks(accountId: AccountId, names: Record<string, string>): void {
    const list = this.#ankiDeckList(accountId);
    if (!list) return;
    let renamed = false;
    const decks = list.decks.map((deck) => {
      const name = names[deck.id];
      if (name === undefined || name === deck.name) return deck;
      renamed = true;
      return { ...deck, name };
    });
    if (!renamed) return;
    this.#db.prepare(`UPDATE anki_deck_list SET decks = ? WHERE account_id = ?`).run(JSON.stringify(decks), accountId);
  }

  /**
   * Keeps what a check found of a deck an Anki pact is on: its name, or with
   * `name` null, that it's gone from the collection since `checkedAt`, under
   * the last name Pact knew.
   */
  #notePactDeck(account: AccountId, deckId: string, name: string | null, checkedAt: Date): void {
    if (name !== null) {
      this.#db
        .prepare(
          `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, NULL)
           ON CONFLICT (account_id, deck_id) DO UPDATE SET name = excluded.name, missing_since = NULL`,
        )
        .run(account, deckId, name);
      return;
    }
    this.#db
      .prepare(
        `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, deck_id) DO UPDATE SET name = COALESCE(anki_pact_deck.name, excluded.name),
           missing_since = COALESCE(anki_pact_deck.missing_since, excluded.missing_since)`,
      )
      .run(account, deckId, this.#ankiDeckName(account, deckId), checkedAt.toISOString());
  }

  /** On an Anki day just judged Missed at its due time: why, from the last check that counted for it. */
  #noteAnkiMiss(pact: PactToJudge, day: Occurrence): void {
    const row = this.#db
      .prepare(`SELECT outcome FROM occurrence WHERE pact_id = ? AND date = ?`)
      .get(pact.id, day.date) as { outcome: string | null } | undefined;
    if (row?.outcome !== "missed") return;
    const check = this.#lastAnkiCheck(pact.id, day.date, day.dueAt);
    this.#noteAnkiResult(pact.id, day.date, check);
  }

  /**
   * The latest check of the Anki pact's deck for its day `date`: all of
   * them, or with `before`, only those that count for a day due then, made
   * and evaluated before it.
   */
  #lastAnkiCheck(pactId: string, date: LocalDate, before?: Date): AnkiCheck | null {
    const until = before?.toISOString() ?? "9999-12-31T23:59:59.999Z";
    const row = this.#db
      .prepare(
        `SELECT anki_check.new_count + anki_check.learn_count + anki_check.review_count AS cards_left,
                anki_check.checked_at
         FROM anki_check JOIN pact ON pact.owner_account_id = anki_check.account_id
         WHERE pact.id = ? AND anki_check.deck_id = ? AND anki_check.anki_date = ? AND anki_check.as_of < ?
           AND anki_check.checked_at < ?
         ORDER BY anki_check.checked_at DESC, anki_check.id DESC
         LIMIT 1`,
      )
      .get(pactId, this.#ankiDeckOn(pactId, date), date, until, until) as
      { cards_left: number; checked_at: string } | undefined;
    return row ? { cardsLeft: row.cards_left, checkedAt: new Date(row.checked_at) } : null;
  }

  /** Stores the check that decided an Anki day; null when none reached AnkiWeb. */
  #noteAnkiResult(pactId: string, date: LocalDate, check: AnkiCheck | null): void {
    this.#db
      .prepare(`UPDATE occurrence SET anki_cards_left = ?, anki_checked_at = ? WHERE pact_id = ? AND date = ?`)
      .run(check?.cardsLeft ?? null, check?.checkedAt.toISOString() ?? null, pactId, date);
  }

  /**
   * Every Active pact (or just `pactId`, Active or Ended) with what judging
   * reads of it: its terms, cursor and owner's timezone. An Ended pact makes
   * no more occurrences, but a decision can still judge one it had.
   */
  #pactsToJudge(pactId?: string): PactToJudge[] {
    return this.#db
      .prepare(
        `SELECT ${PACT_TO_JUDGE_COLUMNS}
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE (? IS NULL AND pact.stage = 'active') OR pact.id = ?
         ORDER BY pact.created_at, pact.id`,
      )
      .all(pactId ?? null, pactId ?? null) as PactToJudge[];
  }

  /** Ended bedtime pacts with a night not judged that fell due before they Ended, as `#pactsToJudge` reads them. */
  #endedBedtimePacts(): PactToJudge[] {
    return this.#db
      .prepare(
        `SELECT ${PACT_TO_JUDGE_COLUMNS}
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'ended' AND pact.evidence_kind = 'oura' AND pact.ended_at IS NOT NULL
           AND (pact.judged_through IS NULL OR pact.judged_through < date(pact.ended_at, '+1 day'))
         ORDER BY pact.created_at, pact.id`,
      )
      .all() as PactToJudge[];
  }

  /**
   * Judges an occurrence as of its due time, unless a decision after that
   * already judged it or its evidence is still waiting for one: Satisfied with
   * approved evidence, else Excused with an approved excuse, else Missed. A
   * Missed day on an excuse waiting for approval has its penalty held, and the
   * owner, who asked for it to be excused, isn't told it's Missed.
   */
  #judgeAtDueTime(pact: Pick<PactRow, "id" | "schedule">, occurrence: Occurrence): void {
    const pactId = pact.id;
    if (this.#isJudged(pactId, occurrence.date)) return;
    if (scheduleOf(pact.schedule).kind === "weekly-count") {
      return this.#judgeWeek(pactId, occurrence, occurrence.dueAt, true);
    }
    const decision = this.#evidenceDecision(pactId, occurrence.date);
    const excuse = this.#excuseOn(pactId, occurrence.date);
    if (decision !== "approved" && excuse === "approved") {
      return this.#judge(pactId, occurrence.date, "excused", occurrence.dueAt);
    }
    if (decision === "waiting") return;
    const outcome = decision === "approved" ? "satisfied" : "missed";
    this.#judge(pactId, occurrence.date, outcome, occurrence.dueAt);
    if (outcome === "missed" && excuse === null) this.#enqueueMissed(pactId, occurrence.date);
  }

  /**
   * Judges a Weekly count week at `at`, unless its evidence still waits for a
   * decision that could change it: Satisfied once enough days have approved
   * evidence, else Excused with an approved excuse, else Missed, with one
   * penalty per day short. `tell` the owner it's Missed, unless a decision
   * judged it (that told them) or they asked for it to be excused.
   */
  #judgeWeek(pactId: string, week: Occurrence, at: Date, tell: boolean): void {
    const { sessions, waiting, target } = this.#weekProgress(pactId, week.date);
    const excuse = this.#excuseOn(pactId, week.date);
    if (sessions >= target) return this.#judge(pactId, week.date, "satisfied", at);
    if (excuse === "approved") return this.#judge(pactId, week.date, "excused", at);
    if (waiting > 0) return;
    this.#judge(pactId, week.date, "missed", at);
    if (tell && excuse === null) this.#enqueueMissed(pactId, week.date);
  }

  /** How far the pact's Weekly count week starting `monday` has got: see `WeekProgress`. */
  #weekProgress(pactId: string, monday: LocalDate): WeekProgress {
    const schedule = scheduleOf(this.#termsOn(pactId, monday).schedule);
    const counts = this.#db
      .prepare(
        `SELECT COUNT(DISTINCT CASE WHEN decision = 'approved' THEN day END) AS sessions,
                COUNT(DISTINCT CASE WHEN decision IS NULL THEN day END) AS waiting
         FROM evidence WHERE pact_id = ? AND occurrence_date = ?`,
      )
      .get(pactId, monday) as { sessions: number; waiting: number };
    return { ...counts, target: schedule.kind === "weekly-count" ? schedule.target : 1 };
  }

  /** Whether the pact's schedule is Weekly count. It keeps its kind once its edit window has closed. */
  #isWeekly(pactId: string): boolean {
    const row = this.#db.prepare(`SELECT schedule FROM pact WHERE id = ?`).get(pactId) as { schedule: string };
    return scheduleOf(row.schedule).kind === "weekly-count";
  }

  /** Only for judging at the due time: a rejection already told the owner, with the reason. */
  #enqueueMissed(pactId: string, date: LocalDate): void {
    const pact = {
      ...(this.#db.prepare(`SELECT owner_account_id, name FROM pact WHERE id = ?`).get(pactId) as {
        owner_account_id: AccountId;
        name: string;
      }),
      ...this.#termsOn(pactId, date),
    };
    const schedule = scheduleOf(pact.schedule);
    const recipient = this.#recipientName(pact.recipient_id);
    let body = `${formatDate(date)} · ${money(pact.penalty_cents)} to ${recipient}`;
    if (schedule.kind === "weekly-count") {
      const { sessions, target } = this.#weekProgress(pactId, date);
      const short = target - sessions;
      body = `Week of ${formatDate(date)} · ${short} short · ${money(short * pact.penalty_cents)} to ${recipient}`;
    }
    this.#enqueue({
      recipient: pact.owner_account_id,
      kind: "missed-occurrence",
      payload: { pactId, occurrenceDate: date, title: `${pact.name} is Missed`, body, url: APP_PATHS.pact(pactId) },
    });
  }

  /** Whether the occurrence already has an outcome: Satisfied, Missed or Excused. */
  #isJudged(pactId: string, date: LocalDate): boolean {
    return (
      this.#db
        .prepare(`SELECT 1 FROM occurrence WHERE pact_id = ? AND date = ? AND outcome IS NOT NULL`)
        .get(pactId, date) !== undefined
    );
  }

  /**
   * Records an occurrence's outcome as of `at`. Missed adds the penalty to
   * the owner's ledger for the recipient, both as the pact's terms stood when
   * the occurrence opened (held, while an excuse for it waits for approval):
   * for a Weekly count week, one penalty for each day short of its target.
   */
  #judge(pactId: string, date: LocalDate, outcome: "satisfied" | "missed" | "excused", at: Date): void {
    const pact = {
      ...(this.#db.prepare(`SELECT owner_account_id FROM pact WHERE id = ?`).get(pactId) as {
        owner_account_id: AccountId;
      }),
      ...this.#termsOn(pactId, date),
    };
    this.#db
      .prepare(
        `INSERT INTO occurrence (pact_id, date, outcome, judged_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (pact_id, date) DO UPDATE SET outcome = excluded.outcome, judged_at = excluded.judged_at`,
      )
      .run(pactId, date, outcome, at.toISOString());
    const schedule = scheduleOf(pact.schedule);
    // A One-time pact has no occurrence left once its one is judged.
    if (schedule.kind === "one-time") this.#endPact(pactId, at);
    if (outcome === "missed") {
      const short = schedule.kind === "weekly-count" ? schedule.target - this.#weekProgress(pactId, date).sessions : 1;
      this.#db
        .prepare(
          `INSERT INTO penalty (id, owner_account_id, recipient_id, pact_id, occurrence_date, amount_cents, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#newId(),
          pact.owner_account_id,
          pact.recipient_id,
          pactId,
          date,
          pact.penalty_cents * short,
          at.toISOString(),
        );
    }
  }

  /**
   * Makes an Active pact Ended as of `at`. A change request still waiting
   * for it is withdrawn: there's nothing left for it to change.
   */
  #endPact(pactId: string, at: Date): void {
    this.#db
      .prepare(`UPDATE pact SET stage = 'ended', ended_at = ? WHERE id = ? AND stage = 'active'`)
      .run(at.toISOString(), pactId);
    this.#db
      .prepare(
        `UPDATE change_request SET withdrawn_at = ? WHERE pact_id = ? AND decision IS NULL AND withdrawn_at IS NULL`,
      )
      .run(at.toISOString(), pactId);
  }

  lastTick(): Date | null {
    const row = this.#db.prepare(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`).get() as
      { last_tick_at: string } | undefined;
    return row ? new Date(row.last_tick_at) : null;
  }

  health(): Health {
    const lastTick = this.lastTick();
    const ok = lastTick !== null && this.#clock.now().getTime() - lastTick.getTime() <= HEALTHY_TICK_AGE_MS;
    return { ok, lastTick };
  }

  schemaVersion(): number {
    return this.#db.pragma("user_version", { simple: true }) as number;
  }

  async raiseRestoreAlert(): Promise<void> {
    await this.#command(
      () => {
        const lastTick = this.lastTick()?.toISOString() ?? null;
        const operator = this.#db.prepare(`SELECT id FROM account WHERE is_operator = 1`).get() as
          { id: string } | undefined;
        if (operator) {
          this.#enqueue({
            recipient: operator.id,
            kind: "operator-alert",
            payload: {
              alert: "database-restored",
              lastTick,
              title: "Operator alert",
              body: `Database restored from backup. Last tick: ${lastTick ?? "none"}`,
              url: APP_PATHS.today,
            },
          });
        }
        return lastTick;
      },
      // The log line is the alert's channel that never depends on delivery.
      (lastTick) =>
        this.#log(
          `OPERATOR_ALERT database restored from backup; last scheduler tick before the restore: ${lastTick ?? "none"}`,
        ),
    );
    await this.#delivery;
  }

  deliveriesSettled(): Promise<void> {
    return this.#delivery;
  }

  async close(): Promise<void> {
    await this.#delivery;
    this.#db.close();
  }
}

function isPushDevice({ endpoint, p256dh, auth }: PushDevice): boolean {
  if (!URL.canParse(endpoint)) return false;
  const { protocol, hostname } = new URL(endpoint);
  return (
    protocol === "https:" &&
    PUSH_SERVICE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
    isBase64UrlOfLength(p256dh, P256DH_BYTES) &&
    isBase64UrlOfLength(auth, AUTH_BYTES) &&
    isPointOnCurve(p256dh)
  );
}

/** Encrypting for a key that isn't a real P-256 point throws, for every notification to it. */
function isPointOnCurve(publicKey: string): boolean {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  try {
    ecdh.computeSecret(Buffer.from(publicKey, "base64url"));
    return true;
  } catch {
    return false;
  }
}

function isBase64UrlOfLength(text: string, bytes: number): boolean {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(text) && Buffer.from(text, "base64url").length === bytes;
}

interface InviteRow {
  token: string;
  inviter_account_id: string;
  inviter_name: string;
  expires_at: string;
  used_at: string | null;
  claimed_by_account_id: string | null;
}

/**
 * Orders people (accounts or recipients) by name the same way on every page:
 * by the en-US collation, so "alice" comes before "Bob", ties broken by id.
 */
function byName(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id, "en-US");
}

/** A friendship row's two account ids, in the order the table stores them. */
function friendshipPair(a: AccountId, b: AccountId): [AccountId, AccountId] {
  return a < b ? [a, b] : [b, a];
}

/** An Active pact as Today and the Pacts tab read it. */
interface ActivePact {
  id: string;
  name: string;
  evidenceKind: EvidenceKind;
  penaltyCents: number;
  terms: OccurrenceTerms;
  startDate: LocalDate | null;
  editWindowClosesAt: Date | null;
}

/** A pact's card on Today and the section it goes in. */
type TodayPlacement =
  | { section: "to-do"; card: TodayToDoCard | TodayAnkiCard }
  | { section: "automatic"; card: TodayAutomaticCard }
  | { section: "no-oura-data"; card: TodayNoOuraDataCard }
  | { section: "coming-up"; card: TodayComingUpCard };

function editWindowEnd({ created_at }: Pick<PactRow, "created_at">): Date {
  return new Date(new Date(created_at).getTime() + EDIT_WINDOW_MS);
}

/** When a pact's edit window closes; null once it has, as of `now`. */
function editWindowClosesAt(pact: Pick<PactRow, "created_at">, now: Date): Date | null {
  const closesAt = editWindowEnd(pact);
  return now.getTime() < closesAt.getTime() ? closesAt : null;
}

/** What a pact's day clock and One-time occurrence follow from, besides its times. */
type PactClock = Pick<PactRow, "evidence_kind" | "anki_rollover_hour" | "created_at">;

/** A pact row's occurrence terms, its stored schedule parsed. */
function occurrenceTermsOf(
  row: PactClock & Pick<PactRow, "schedule" | "first_occurrence" | "in_bed_by" | "due_by" | "end_date">,
): OccurrenceTerms {
  const terms = scheduleTermsOf(row, scheduleOf(row.schedule), row.in_bed_by, row.due_by);
  return { ...terms, firstOccurrence: row.first_occurrence, endDate: row.end_date };
}

/** `pact`'s terms on `schedule` with the times `inBedBy` and `dueBy`, as its columns store them. */
function scheduleTermsOf(
  pact: PactClock,
  schedule: Schedule,
  inBedBy: ClockTime | null,
  dueBy: ClockTime | null,
): RecurringTerms | OneTimeTerms {
  switch (schedule.kind) {
    case "fixed-days":
      return { schedule, day: dayClockOf(pact, inBedBy, dueBy) };
    case "weekly-count":
      return { schedule, dueBy };
    case "one-time":
      return { schedule, dueBy, createdAt: new Date(pact.created_at) };
  }
}

/**
 * The day clock of `pact` with the times `inBedBy` and `dueBy`: a Camera
 * pact's days, an Oura Ring pact's nights, an Anki pact's Anki days. The
 * schema keeps the rollover hour set on Anki pacts, and only on them.
 */
function dayClockOf(
  pact: Pick<PactRow, "evidence_kind" | "anki_rollover_hour">,
  inBedBy: ClockTime | null,
  dueBy: ClockTime | null,
): DayClock {
  switch (pact.evidence_kind) {
    case "camera":
      return { kind: "day", dueBy };
    case "oura":
      if (inBedBy === null) throw new Error("an Oura Ring pact has no in-bed-by time");
      return { kind: "night", inBedBy };
    case "anki":
      if (pact.anki_rollover_hour === null) throw new Error("an Anki pact has no rollover hour");
      return { kind: "anki", rollover: pact.anki_rollover_hour, dueBy };
  }
}

/** `schedule`'s terms for a new pact: Fixed days due on the day clock `day`, any other schedule by `dueBy`. */
function newTermsOf(schedule: Schedule, day: DayClock, dueBy: ClockTime | null): NewTerms {
  switch (schedule.kind) {
    case "fixed-days":
      return { schedule, day };
    case "weekly-count":
      return { schedule, dueBy };
    case "one-time":
      return { schedule, dueBy };
  }
}

/**
 * The day clock a pact form's times give as far as it has them: an Anki
 * day's with a rollover hour, else a night's with an in-bed-by time, else a
 * Camera day's.
 */
function formDayClock(times: ClockTimes): DayClock {
  if (times.ankiRollover !== null) return { kind: "anki", rollover: times.ankiRollover, dueBy: times.dueBy };
  if (times.inBedBy !== null) return { kind: "night", inBedBy: times.inBedBy };
  return { kind: "day", dueBy: times.dueBy };
}

/** A pact's times as its columns store them: each null where its terms have none. */
interface ClockTimes {
  inBedBy: ClockTime | null;
  dueBy: ClockTime | null;
  ankiRollover: number | null;
}

/** `terms`' times as the pact's columns store them. */
function timesOf(terms: OccurrenceTerms): ClockTimes {
  if (!hasSchedule(terms, "fixed-days")) return { inBedBy: null, dueBy: terms.dueBy, ankiRollover: null };
  const { day } = terms;
  switch (day.kind) {
    case "day":
      return { inBedBy: null, dueBy: day.dueBy, ankiRollover: null };
    case "night":
      return { inBedBy: day.inBedBy, dueBy: null, ankiRollover: null };
    case "anki":
      return { inBedBy: null, dueBy: day.dueBy, ankiRollover: day.rollover };
  }
}

/**
 * A pact owner's timezone. Every pact's owner has one: creating a pact needs
 * it, and a timezone can be changed but never cleared.
 */
function ownerZone(timezone: string | null, ownerId: AccountId): string {
  if (timezone === null) throw new Error(`account ${ownerId} owns a pact but has no timezone`);
  return timezone;
}

/** A pact's stored schedule. Its kind never changes once the edit window has closed. */
function scheduleOf(json: string): Schedule {
  return JSON.parse(json) as Schedule;
}

/** A pact's stored reminders: "HH:MM" times, or dated ones on One-time. */
function remindersOf(json: string): string[] {
  return JSON.parse(json) as string[];
}

/** "1 card", "42 cards". */
function cardsText(n: number): string {
  return `${n} ${n === 1 ? "card" : "cards"}`;
}

/** The day an Ended pact Ended, in `timezone`; null while it's Active. */
function endedOnOf(pact: Pick<PactRow, "ended_at">, timezone: string): LocalDate | null {
  return pact.ended_at === null ? null : localDateOf(new Date(pact.ended_at), timezone);
}

/** A pact's stage, and when it ended. Ending a pact sets both columns at once. */
function stageOf(
  row: Pick<PactRow, "id" | "stage" | "ended_at">,
): { stage: "active" } | { stage: "ended"; endedAt: Date } {
  if (row.stage === "active") return { stage: "active" };
  if (row.ended_at === null) throw new Error(`pact ${row.id} ended with no ended_at`);
  return { stage: "ended", endedAt: new Date(row.ended_at) };
}

/** An Anki day's deciding check as its occurrence row stores it; null when no check reached AnkiWeb. */
function ankiCheckOf(row: { anki_cards_left: number | null; anki_checked_at: string | null }): AnkiCheck | null {
  if (row.anki_cards_left === null || row.anki_checked_at === null) return null;
  return { cardsLeft: row.anki_cards_left, checkedAt: new Date(row.anki_checked_at) };
}

/**
 * A timestamp as Oura wrote it, read on Oura's own clock: "YYYY-MM-DDTHH:MM".
 * Oura's timestamps carry the UTC offset where the ring was, so their wall
 * time is the time there.
 */
function wallClock(timestamp: string): string {
  return timestamp.slice(0, 16);
}

/**
 * The UTC offset `timestamp` carries, "+HH:MM" or "-HH:MM" ("Z" is "+00:00"),
 * or null for a timestamp written without one.
 */
function utcOffsetOf(timestamp: string): string | null {
  if (timestamp.endsWith("Z")) return "+00:00";
  return /T.*([+-]\d{2}:\d{2})$/.exec(timestamp)?.[1] ?? null;
}

/** The night a sleep starting at `timestamp` counts for: its day from 18:00, else the day before. */
function nightOf(timestamp: string): LocalDate {
  const date = timestamp.slice(0, 10);
  return Number(timestamp.slice(11, 13)) >= NIGHT_STARTS_HOUR ? date : addDays(date, -1);
}

/** The night of `date`'s in-bed-by deadline as a wall-clock "YYYY-MM-DDTHH:MM". */
function deadlineWallClock(date: LocalDate, inBedBy: ClockTime): string {
  return `${parseClockTime(inBedBy).hour >= NIGHT_STARTS_HOUR ? date : addDays(date, 1)}T${inBedBy}`;
}

/** A pact's terms as `#checkedPact` checks them. */
interface CheckedTerms {
  ok: true;
  /** The owner's: a pact needs one. */
  timezone: string;
  name: string;
  description: string;
  terms: OccurrenceTerms;
  startDate: LocalDate | null;
  reminders: string[];
}

/** A pact checked for creating or editing. */
interface CheckedPact extends CheckedTerms {
  reviewerIds: AccountId[];
  ankiDeckId: string | null;
}

/**
 * `pact`'s terms checked as a pact made at `createdAt` by an owner in
 * `timezone`, or why they're refused. An Anki pact's day turns at
 * `ankiRollover` (null for other pacts).
 */
function checkedTerms(
  pact: NewPact,
  ankiRollover: number | null,
  timezone: string | null,
  createdAt: Date,
): CheckedTerms | { ok: false; reason: CreatePactRefusal } {
  const oura = pact.evidenceKind === "oura";
  const anki = pact.evidenceKind === "anki";
  if (oura && (pact.inBedBy === undefined || !isClockTime(pact.inBedBy))) {
    return { ok: false, reason: "invalid-in-bed-by" };
  }
  // A ring's nights are Fixed days only, and at most one day of evidence counts a day.
  if (pact.schedule.kind === "weekly-count") {
    const { target } = pact.schedule;
    if (oura || anki || !Number.isSafeInteger(target) || target < 1 || target > MAX_WEEKLY_TARGET) {
      return { ok: false, reason: "invalid-schedule" };
    }
  }
  const oneTime = pact.schedule.kind === "one-time";
  if (pact.schedule.kind === "one-time" && (oura || anki || !isLocalDate(pact.schedule.deadline))) {
    return { ok: false, reason: "invalid-schedule" };
  }
  // A due-by time is for evidence the owner submits; a ring's night has its in-bed-by time.
  if (
    pact.dueBy !== undefined &&
    (oura || !isDueBy(pact.dueBy) || (ankiRollover !== null && !ankiDueByFits(pact.dueBy, ankiRollover)))
  ) {
    return { ok: false, reason: "invalid-due-by" };
  }
  // A One-time pact has just its deadline: Submit anytime sets when it opens.
  if (pact.startDate !== undefined && (oneTime || !isLocalDate(pact.startDate))) {
    return { ok: false, reason: "invalid-start-date" };
  }
  if (pact.endDate !== undefined && (oneTime || !isLocalDate(pact.endDate))) {
    return { ok: false, reason: "invalid-end-date" };
  }
  const unique = [...new Set(pact.reminders ?? [])];
  if (unique.length > MAX_REMINDERS || !unique.every(oneTime ? isDatedReminder : isClockTime)) {
    return { ok: false, reason: "invalid-reminders" };
  }
  const name = pact.name.trim();
  // Oura Ring and Anki pacts have no photo to describe.
  const description = oura || anki ? "" : pact.description.trim();
  if (name === "") return { ok: false, reason: "blank-name" };
  if (!oura && !anki && description === "") return { ok: false, reason: "blank-description" };
  if (timezone === null) return { ok: false, reason: "no-timezone" };
  const dueBy = pact.dueBy ?? null;
  // The day clock is for Fixed days: Oura Ring and Anki pacts were refused any other schedule above.
  const day = dayClockOf(
    { evidence_kind: pact.evidenceKind, anki_rollover_hour: ankiRollover },
    pact.inBedBy ?? null,
    dueBy,
  );
  const terms = newTermsOf(pact.schedule, day, dueBy);
  const timing = newOccurrenceTerms(terms, createdAt, timezone, pact.startDate ?? null);
  if (!timing.ok) return timing;
  const reminders = sortedReminders(unique, timing.terms);
  if (!remindersGoOffInTime(reminders, timing.terms, timing.first.dueAt, timezone)) {
    return { ok: false, reason: "reminder-after-due-time" };
  }
  const endDate = pact.endDate ?? null;
  // The first occurrence has to end by the end date: a whole week, for Weekly count.
  if (endDate !== null && endDate < lastDayOf(timing.terms.schedule, timing.terms.firstOccurrence)) {
    return { ok: false, reason: "end-date-too-early" };
  }
  if (!Number.isSafeInteger(pact.penaltyCents) || pact.penaltyCents <= 0) {
    return { ok: false, reason: "invalid-penalty" };
  }
  return {
    ok: true,
    timezone,
    name,
    description,
    terms: { ...timing.terms, endDate },
    startDate: pact.startDate ?? null,
    reminders,
  };
}

/**
 * `reminders` in the order they go off on a pact with `terms`: a One-time
 * pact's by date and time, any other's from the hour its day starts
 * (`dayStartHour`): a night's from 18:00 to the morning after, an Anki
 * day's from its rollover hour, any other day's from midnight.
 */
function sortedReminders(reminders: string[], terms: OccurrenceTerms): string[] {
  // "YYYY-MM-DDTHH:MM" sorts as text.
  if (hasSchedule(terms, "one-time")) return [...reminders].sort((a, b) => a.localeCompare(b, "en-US"));
  const dayStarts = dayStartHour(terms);
  return [...reminders].sort((a, b) => minutesFrom(a, dayStarts) - minutesFrom(b, dayStarts));
}

/**
 * Whether every reminder goes off before the due time a pact with `terms`
 * has: a One-time pact's deadline (its occurrence's `dueAt`), a bedtime's
 * in-bed-by time (a night running from 18:00), an Anki day's due-by time
 * (from its rollover hour; midnight with none), or else the due-by time, if
 * there is one.
 */
function remindersGoOffInTime(reminders: string[], terms: OccurrenceTerms, dueAt: Date, timezone: string): boolean {
  return reminders.every((time) => {
    if (hasSchedule(terms, "one-time")) return oneTimeReminderAt(time, timezone).getTime() < dueAt.getTime();
    if (hasSchedule(terms, "weekly-count")) return terms.dueBy === null || time < terms.dueBy;
    const { day } = terms;
    switch (day.kind) {
      case "day":
        return day.dueBy === null || time < day.dueBy;
      case "night":
        return minutesFrom(time, NIGHT_STARTS_HOUR) < minutesFrom(day.inBedBy, NIGHT_STARTS_HOUR);
      case "anki":
        // A due-by time that can't fit is refused before this.
        return minutesFrom(time, day.rollover) < ankiDueByOrder(day.dueBy, day.rollover);
    }
  });
}

/**
 * An error for the log: its name and message. A SyntaxError's message quotes
 * the response it couldn't parse, which could hold a token, so it's left out.
 */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return error.name === "SyntaxError" ? error.name : `${error.name}: ${error.message}`;
}

function withoutReminders({
  reminders: _reminders,
  ...terms
}: CurrentTerms & Pick<PactTerms, "reminders">): CurrentTerms {
  return terms;
}

/** Whether `text` is a clock time, "HH:MM" on a 24-hour clock. */
function isClockTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** Whether `text` is a One-time pact's reminder, "YYYY-MM-DDTHH:MM". */
function isDatedReminder(text: string): boolean {
  const { date, time } = parseDatedReminder(text);
  return text.length === 16 && isLocalDate(date) && isClockTime(time);
}

/** A due-by time: a clock time after the day starts. Midnight ending the day is the due time without one. */
function isDueBy(text: string): boolean {
  return isClockTime(text) && text !== "00:00";
}

interface PactRow {
  id: string;
  name: string;
  description: string;
  evidence_kind: EvidenceKind;
  schedule: string;
  in_bed_by: string | null;
  due_by: string | null;
  start_date: string | null;
  end_date: string | null;
  penalty_cents: number;
  recipient_id: string;
  stage: PactTerms["stage"];
  first_occurrence: string;
  created_at: string;
  reviewers_notified_at: string | null;
  ended_at: string | null;
  /** JSON: "HH:MM" each, in the order they go off. */
  reminders: string;
  reminded_through: string | null;
  owner_account_id: AccountId;
  anki_deck_id: string | null;
  anki_rollover_hour: number | null;
}

/** The terms an occurrence follows: the pact's, as they stood when it opened. */
type DatedTerms = Pick<
  PactRow,
  "description" | "schedule" | "in_bed_by" | "due_by" | "penalty_cents" | "recipient_id" | "anki_deck_id"
>;

/** A change request as stored, with its pact's owner, their name and timezone, and its deciding reviewer's name. */
interface ChangeRequestRow extends ReviewStateRow {
  id: string;
  pact_id: string;
  ends_pact: 0 | 1;
  /** JSON ChangeableTerms. */
  before_terms: string;
  after_terms: string | null;
  note: string | null;
  requested_at: string;
  decided_by_account_id: AccountId | null;
  withdrawn_at: string | null;
  owner_account_id: AccountId;
  owner_name: string;
  timezone: string | null;
}

/**
 * What a change request asks: to end the pact, or to change its terms.
 * `ends_pact` is set exactly when `after_terms` is null (a CHECK holds it).
 */
type RequestedChange = { kind: "end" } | { kind: "change"; before: ChangeableTerms; after: ChangeableTerms };

/** A change request as `#changeRequestRow` reads it, with what it asks parsed. */
type StoredChangeRequest = Omit<ChangeRequestRow, "ends_pact" | "before_terms" | "after_terms"> & {
  request: RequestedChange;
};

function storedChangeRequestOf({
  ends_pact: _endsPact,
  before_terms: before,
  after_terms: after,
  ...row
}: ChangeRequestRow): StoredChangeRequest {
  return {
    ...row,
    request:
      after === null ? { kind: "end" } : { kind: "change", before: storedTerms(before), after: storedTerms(after) },
  };
}

/** A review item a reviewer may decide, as `decide` and `askOwner` read it. */
type ItemToDecide =
  | { kind: "evidence"; row: EvidenceToDecide }
  | { kind: "excuse"; row: ExcuseToDecide }
  | { kind: "payment"; row: PaymentToDecide }
  | { kind: "change-request"; row: StoredChangeRequest };

/** SQL: the columns `reviewStateOf` reads from `table`, joined to its deciding reviewer as `reviewer`. */
function reviewStateColumns(table: "evidence" | "excuse" | "payment"): string {
  return `${table}.decision, ${table}.decided_at, ${table}.reject_reason, reviewer.name AS reviewer_name`;
}

interface ReviewStateRow {
  decision: ReviewOutcome | null;
  decided_at: string | null;
  reject_reason: string | null;
  reviewer_name: string | null;
}

function reviewStateOf(row: ReviewStateRow): ReviewState {
  if (row.decision === null) return { kind: "waiting" };
  const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
  return row.decision === "approved"
    ? { kind: "approved", ...decided }
    : { kind: "rejected", ...decided, reason: row.reject_reason! };
}

/** The owner's page for a review item: where a question about it opens. */
function itemPath(kind: ReviewItem["kind"], itemId: string): string {
  switch (kind) {
    case "evidence":
      return APP_PATHS.evidence(itemId);
    case "excuse":
      return APP_PATHS.excuse(itemId);
    case "payment":
      return APP_PATHS.payment(itemId);
    case "change-request":
      return APP_PATHS.changeRequest(itemId);
  }
}

/** How a review item's push names each changed term. */
const TERM_LABELS: Record<TermDiff["term"], string> = {
  name: "Name",
  description: "Photo shows",
  deck: "Deck",
  "in-bed-by": "In bed by",
  schedule: "Days",
  "due-by": "Due by",
  "start-date": "Starts",
  "end-date": "Ends",
  penalty: "Penalty",
  recipient: "Recipient",
  reviewers: "Reviewers",
  reminders: "Reminders",
};

/** The terms a change would give a pact: `checked`, from `change`, with the penalty and recipient it names. */
function changeableTermsOf(checked: CheckedPact, change: PactChange): ChangeableTerms {
  const { inBedBy, dueBy } = timesOf(checked.terms);
  return {
    name: checked.name,
    description: checked.description,
    inBedBy,
    dueBy,
    startDate: checked.startDate,
    endDate: checked.terms.endDate,
    schedule: checked.terms.schedule,
    penaltyCents: change.penaltyCents,
    recipientId: change.recipientId,
    reviewerIds: [...checked.reviewerIds].sort(),
    reminders: checked.reminders,
    ankiDeckId: checked.ankiDeckId,
  };
}

/**
 * Why changing a pact whose first occurrence is `firstOccurrence` from
 * `before` to `after` on `today` is refused, or null. Occurrences already
 * open keep their terms: a start date means nothing once the first has
 * opened, and an end date can't take away a day (or a week) that has.
 */
function openOccurrencesRefusal(
  firstOccurrence: LocalDate,
  before: ChangeableTerms,
  after: ChangeableTerms,
  today: LocalDate,
): "pact-started" | "end-date-too-early" | null {
  const from = firstDayNotOpen(before.schedule, today);
  if (after.startDate !== before.startDate && firstOccurrence < from) return "pact-started";
  const firstFrom = firstOccurrenceAfterChange(firstOccurrence, after.schedule, from, after.startDate);
  if (after.endDate !== null && after.endDate !== before.endDate) {
    if (after.endDate < addDays(from, -1) || after.endDate < lastDayOf(after.schedule, firstFrom)) {
      return "end-date-too-early";
    }
  }
  return null;
}

/**
 * A pact's first occurrence once a change to `schedule` and `startDate` takes
 * effect `from` a date: as it was if that's before `from`; otherwise, as the
 * change came before the pact started, the first day of the new schedule
 * from `from`, or from the start date if that's later.
 */
function firstOccurrenceAfterChange(
  firstOccurrence: LocalDate,
  schedule: Schedule,
  from: LocalDate,
  startDate: LocalDate | null,
): LocalDate {
  if (schedule.kind === "one-time") return schedule.deadline;
  if (firstOccurrence < from) return firstOccurrence;
  if (schedule.kind === "weekly-count") return firstWeekFrom(from, startDate);
  const start = startDate === null ? from : laterDate(startDate, from);
  for (let date = start, i = 0; i < 7; date = addDays(date, 1), i++) {
    if (schedule.days.includes(weekdayOf(date))) return date;
  }
  throw new Error("unreachable: a schedule has at least one day");
}

/**
 * The first day not open on `today` for a pact with `schedule`, from which a
 * change applies: tomorrow, or for Weekly count, whose week is open until its
 * Sunday, next Monday.
 */
function firstDayNotOpen(schedule: Schedule, today: LocalDate): LocalDate {
  return schedule.kind === "weekly-count" ? addDays(mondayOf(today), WEEKDAYS.length) : addDays(today, 1);
}

/**
 * A change request's stored terms. Those sent before due-by times, dates and
 * reminders existed have none. Reminders apply at once, so a request's before
 * and after always have the same ones.
 */
function storedTerms(json: string): ChangeableTerms {
  return {
    dueBy: null,
    startDate: null,
    endDate: null,
    reminders: [],
    ankiDeckId: null,
    ...(JSON.parse(json) as Partial<ChangeableTerms>),
  } as ChangeableTerms;
}

/** A reminder the scheduler reached too late to send. */
interface DroppedReminder {
  pactId: string;
  /** The occurrence it was for. */
  date: LocalDate;
  /** Its time, "HH:MM". */
  time: string;
  lateMs: number;
}

/** "dropped 1 reminder more than 15 minutes late", or "dropped 2 reminders …". */
function droppedText(count: number): string {
  return `dropped ${count} reminder${count === 1 ? "" : "s"} more than ${REMINDER_LATE_MS / 60_000} minutes late`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One check `#fetchAnki` got an answer to: whose collection, what AnkiWeb found, and when Pact checked. */
interface FetchedAnki {
  account: AccountId;
  result: AnkiCountsResult;
  /** When AnkiWeb was asked. */
  checkedAt: Date;
}

/** What `#fetchSleep` got from Oura: sleep by account, the accounts it answered "disconnected" for, and when it was asked. */
interface FetchedSleep {
  sleep: Map<AccountId, OuraSleepPeriod[]>;
  disconnected: AccountId[];
  askedAt: Date;
}

/** A pact as judging reads it. */
type PactToJudge = Pick<PactRow, "id" | "schedule" | "first_occurrence" | "evidence_kind" | "in_bed_by"> & {
  judged_through: LocalDate | null;
  /** When it Ended; null while Active. */
  ended_at: string | null;
  timezone: string | null;
  owner_account_id: AccountId;
};

/** Evidence a reviewer is deciding on, as `decide` reads it. */
interface EvidenceToDecide {
  id: string;
  pact_id: string;
  occurrence_date: LocalDate;
  /** The day it counts for: on Weekly count, the day of the week. */
  day: LocalDate;
  /** The owner's: every pact's owner has one, as creating a pact needs it. */
  timezone: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

/** An excuse a reviewer is deciding on, as `decide` reads it. */
interface ExcuseToDecide {
  id: string;
  pact_id: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

/**
 * Each of `times` that could go off for `pact` from `fromDate` through
 * `toDate`, with the day it's about and when that day's evidence is due: on
 * Weekly count, every day of an open week. On One-time each reminder has its
 * own date, and they're all about the one occurrence.
 */
function remindersDue(
  pact: PactClock & Pick<PactRow, "schedule" | "in_bed_by" | "due_by">,
  times: string[],
  occurrences: Occurrences,
  fromDate: LocalDate,
  toDate: LocalDate,
  timezone: string,
): { date: LocalDate; dueAt: Date; time: string; at: Date }[] {
  const terms = scheduleTermsOf(pact, scheduleOf(pact.schedule), pact.in_bed_by, pact.due_by);
  if (hasSchedule(terms, "one-time")) {
    const { date, dueAt } = occurrences.first;
    return times.map((time) => ({ date, dueAt, time, at: oneTimeReminderAt(time, timezone) }));
  }
  const days: { date: LocalDate; dueAt: Date }[] = [];
  if (hasSchedule(terms, "weekly-count")) {
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      const dueAt = occurrences.dayDueAt(date);
      if (dueAt) days.push({ date, dueAt });
    }
  } else {
    days.push(...occurrences.between(fromDate, toDate));
  }
  return days.flatMap(({ date, dueAt }) =>
    times.map((time) => ({ date, dueAt, time, at: reminderAt(date, time, timezone, terms) })),
  );
}

/** A decision as its notification's details carry it: a rejection with its reason. */
function decisionDetails(decided: Decided): { decision: "approved" } | { decision: "rejected"; reason: string } {
  return decided.outcome === "approved" ? { decision: "approved" } : { decision: "rejected", reason: decided.reason };
}

/** Whether `accountId` checked a service within `intervalMs` before `now`, as `checks` records. */
function checkedWithin(
  checks: ReadonlyMap<AccountId, number>,
  accountId: AccountId,
  now: Date,
  intervalMs: number,
): boolean {
  const last = checks.get(accountId);
  return last !== undefined && now.getTime() - last < intervalMs;
}

/** When a review item was sent for a decision: for ordering the Review Queue. */
function reviewItemSince(item: ReviewItem): Date {
  switch (item.kind) {
    case "evidence":
      return item.submittedAt;
    case "excuse":
      return item.filedAt;
    case "payment":
      return item.recordedAt;
    case "change-request":
      return item.requestedAt;
  }
}

/** When a waiting item was sent for a decision: for ordering them. */
function waitingSince(item: TodayWaitingItem): Date {
  switch (item.kind) {
    case "evidence":
      return item.submittedAt;
    case "excuse":
      return item.filedAt;
    case "payment":
      return item.recordedAt;
    case "change-request":
      return item.requestedAt;
  }
}

/** A bill as the ledger, Today and overdue reminders read it. */
interface BillState {
  id: string;
  /** The Wednesday it was made, "YYYY-MM-DD" in the owner's timezone. */
  billedOn: LocalDate;
  dueAt: Date;
  /** Its penalties less what approved payments have paid of them. */
  unpaidCents: number;
  /** `unpaidCents` less what payments awaiting approval cover. */
  uncoveredCents: number;
}

/**
 * What's Overdue at `now`: the uncovered part of bills past due, and the
 * oldest such bill. `spellStartedAt` is when the current spell of being
 * Overdue began: the due time of the oldest bill past due that approved
 * payments haven't paid, covered or not. Null when nothing is Overdue.
 * Bills are oldest first.
 */
function overdueOf(
  bills: BillState[],
  now: Date,
): { cents: number; billedOn: LocalDate; dueAt: Date; spellStartedAt: Date } | null {
  const pastDue = bills.filter((bill) => bill.dueAt.getTime() <= now.getTime());
  const overdue = pastDue.filter((bill) => bill.uncoveredCents > 0);
  const [oldest] = overdue;
  if (!oldest) return null;
  // An uncovered bill is unpaid too, so there's always one.
  const spellStart = pastDue.find((bill) => bill.unpaidCents > 0)!;
  return {
    cents: sum(overdue.map((bill) => bill.uncoveredCents)),
    billedOn: oldest.billedOn,
    dueAt: oldest.dueAt,
    spellStartedAt: spellStart.dueAt,
  };
}

/**
 * What's billed and not due yet at `now`, less payments awaiting approval:
 * that part, and the soonest due bill's due time and Wednesday. Null when
 * there's none. Bills are oldest first.
 */
function billDueOf(bills: BillState[], now: Date): { amountCents: number; dueAt: Date; billedOn: LocalDate } | null {
  const due = bills.filter((bill) => bill.dueAt.getTime() > now.getTime() && bill.uncoveredCents > 0);
  const [soonest] = due;
  if (!soonest) return null;
  return { amountCents: sum(due.map((bill) => bill.uncoveredCents)), dueAt: soonest.dueAt, billedOn: soonest.billedOn };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const BILL_CLOCK = `${String(BILL_TIME.hour).padStart(2, "0")}:${String(BILL_TIME.minute).padStart(2, "0")}`;

/** Wednesday `date` (or any day) at the bill time, in `timezone`. */
function billInstant(date: LocalDate, timezone: string): Date {
  return wallTime(date, BILL_TIME.hour, BILL_TIME.minute, timezone);
}

/** The Wednesdays whose bill time falls after `from` and by `to`, in `timezone`. */
function billDays(from: Date, to: Date, timezone: string): LocalDate[] {
  const days: LocalDate[] = [];
  const last = localDateOf(to, timezone);
  for (let date = localDateOf(from, timezone); date <= last; date = addDays(date, 1)) {
    if (weekdayOf(date) !== "wed") continue;
    const at = billInstant(date, timezone).getTime();
    if (at > from.getTime() && at <= to.getTime()) days.push(date);
  }
  return days;
}

/**
 * The Wednesday whose bill a penalty added at `addedAt` goes on, if nothing
 * excuses it: the first bill time after both its 48-hour window and `now`.
 */
function nextBillDay(addedAt: Date, now: Date, timezone: string): LocalDate {
  const after = Math.max(addedAt.getTime() + EXCUSE_WINDOW_MS - 1, now.getTime());
  let date = localDateOf(new Date(after), timezone);
  while (weekdayOf(date) !== "wed" || billInstant(date, timezone).getTime() <= after) date = addDays(date, 1);
  return date;
}

/** Whether `text` is a real calendar day written "YYYY-MM-DD". */
function isLocalDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && addDays(text, 0) === text;
}

/** The evidence columns `#evidenceView` reads. `day` is the day it was for; `occurrence_date` its occurrence's. */
interface EvidenceViewRow {
  id: string;
  pact_id: string;
  pact_name: string;
  occurrence_date: LocalDate;
  day: LocalDate;
  submitted_at: string;
}

/** The excuse columns `#excuseView` reads, with the owner's timezone. */
interface ExcuseViewRow {
  id: string;
  pact_id: string;
  pact_name: string;
  reason: string;
  filed_at: string;
  timezone: string;
}

/** The payment columns `paymentView` reads. */
interface PaymentViewRow {
  id: string;
  recipient_name: string;
  amount_cents: number;
  note: string | null;
  photo_id: string;
  recorded_at: string;
}

/** A payment as its reviewers and its owner see it. */
function paymentView(row: PaymentViewRow): PaymentView {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    amountCents: row.amount_cents,
    note: row.note,
    photoId: row.photo_id,
    recordedAt: new Date(row.recorded_at),
  };
}

/** A payment a reviewer is deciding on, as `decide` reads it. */
interface PaymentToDecide {
  id: string;
  owner_account_id: AccountId;
  recipient_id: string;
  decision: ReviewOutcome | null;
}

/** A reviewer's decision on some evidence or a payment, as stored. */
type ReviewOutcome = "approved" | "rejected";

/** A checked review decision, as `decide` hands it on: a rejection's reason is trimmed and never blank. */
type Decided = { outcome: "approved"; reason: null } | { outcome: "rejected"; reason: string };

/**
 * `lists` merged into one sorted by `at`, oldest or newest first. Ties keep
 * the order they have in `lists`, as the sort is stable.
 */
function mergeByTime<T>(at: (item: T) => Date, direction: "oldest-first" | "newest-first", ...lists: T[][]): T[] {
  const sign = direction === "oldest-first" ? 1 : -1;
  return lists.flat().sort((a, b) => sign * (at(a).getTime() - at(b).getTime()));
}

interface OutboxRow {
  id: number;
  recipient_account_id: string;
  kind: string;
  payload: string;
  sent_to: string;
}

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`no account ${accountId}`);
    this.name = "UnknownAccountError";
  }
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The IANA zone's canonical name, or null if `timezone` isn't an IANA zone. */
function canonicalTimezone(timezone: string): string | null {
  // Intl also accepts UTC offsets like "+05:00"; an account needs a real zone.
  if (timezone.trim() === "" || /^[+-]/.test(timezone)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
