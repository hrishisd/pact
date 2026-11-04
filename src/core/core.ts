// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { createECDH, randomBytes, randomUUID } from "node:crypto";
import {
  addDays,
  localDateOf,
  mondayOf,
  startOfDay,
  weekdayOf,
  zonedWallTimeToInstant,
  zoneOffsetAt,
  type LocalDate,
} from "./calendar.ts";
import { openDatabase, type Db } from "./db.ts";
import { termDiffs, type ChangeableTerms, type TermDiff } from "./changes.ts";
import {
  dueSoonEnough,
  firstWeekFrom,
  lastDayOf,
  newOccurrenceTerms,
  oneTimeReminderAt,
  nightStartsAt,
  noOuraDataPushAt,
  occurrences,
  occurrencesOverTime,
  reminderAt,
  utcOffsetMs,
  type Occurrence,
  type Occurrences,
  type OccurrenceTerms,
  type OuraOffset,
  type TermsEra,
} from "./occurrences.ts";
import type {
  Clock,
  Notification,
  NotificationKind,
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
  WEEKDAYS,
  type AcceptExcuseRejectionResult,
  type AcceptInviteResult,
  type AcceptMissResult,
  type AccountId,
  type AskOwnerResult,
  type AddRecipientResult,
  type ChangeOutcome,
  type ChangePactRefusal,
  type ChangePactResult,
  type ChangePreview,
  type ChangePreviewResult,
  type ChangeRequestResult,
  type ChangeRequestState,
  type ChangeRequestView,
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
  type ExcuseDates,
  type ExcuseDatesRefusal,
  type ExcuseDay,
  type ExcuseDetail,
  type ExcuseOptionsResult,
  type ExcusePreview,
  type ExcusePreviewResult,
  type ExcuseResult,
  type ExcuseSkipReason,
  type ExcuseState,
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
  type LedgerPaymentState,
  type LedgerPenalty,
  type LedgerResult,
  type LedgerSummary,
  type NewExcuse,
  type NewPact,
  type NewRecipient,
  type NotificationSetting,
  type NotificationSettingState,
  type OccurrenceDecision,
  type OccurrenceRecord,
  type OccurrenceStatus,
  type Connection,
  type ConnectionProblem,
  type PactTiming,
  type PaymentResult,
  type QuestionThread,
  type ReplyResult,
  type ReviewState,
  type PactWaitingItem,
  type PactSummary,
  type PactResult,
  type PactTerms,
  type Recipient,
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
   * any it missed while stopped: approved evidence makes it Kept; evidence
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
   * Kept, already Excused or approved ahead, on another excuse waiting for
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
   * judges it Kept there and then; before it, judging at the due time does.
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
/** What a broken Oura connection means for the owner, in its push and on Today. */
const RECONNECT_BEFORE_6PM = "A night with no data by 6pm counts as Missed. Reconnect before then.";
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

  constructor(db: Db, options: PactCoreOptions) {
    this.#db = db;
    this.#clock = options.clock;
    this.#notifier = options.notifier;
    this.#photoStore = options.photoStore;
    this.#ouraSource = options.ouraSource;
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
  #enqueue(notification: Notification): void {
    if (!this.#db.inTransaction) throw new Error("notifications are enqueued only inside a command");
    const setting = SETTING_OF_KIND[notification.kind];
    if (setting !== null && this.#settingIsOff(notification.recipient, setting)) return;
    this.#db
      .prepare(
        `INSERT INTO outbox (recipient_account_id, kind, channel, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        notification.recipient,
        notification.kind,
        notification.channel,
        JSON.stringify(notification.payload),
        this.#clock.now().toISOString(),
      );
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
        `SELECT id, recipient_account_id, kind, channel, payload, sent_to
         FROM outbox WHERE delivered_at IS NULL ORDER BY id`,
      )
      .all() as OutboxRow[];
    for (const row of rows) {
      const notification: Notification = {
        recipient: row.recipient_account_id,
        kind: row.kind as Notification["kind"],
        channel: row.channel as Notification["channel"],
        payload: JSON.parse(row.payload) as Notification["payload"],
      };
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
        return this.#db
          .prepare(
            `SELECT account.id, account.name FROM friendship
             JOIN account ON account.id =
               CASE WHEN friendship.account_a_id = ? THEN friendship.account_b_id ELSE friendship.account_a_id END
             WHERE friendship.account_a_id = ? OR friendship.account_b_id = ?
             ORDER BY account.name, account.id`,
          )
          .all(accountId, accountId, accountId) as Friend[];
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
          this.#db
            .prepare(
              `INSERT INTO pact (id, owner_account_id, name, description, evidence_kind, schedule, in_bed_by,
                                 due_by, start_date, end_date, penalty_cents, recipient_id, stage,
                                 first_occurrence, created_at, reminders, reminded_through)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
            )
            .run(
              id,
              accountId,
              checked.name,
              checked.description,
              pact.evidenceKind,
              JSON.stringify(checked.terms.schedule),
              checked.terms.inBedBy ?? null,
              checked.terms.dueBy ?? null,
              checked.startDate,
              checked.terms.endDate ?? null,
              pact.penaltyCents,
              pact.recipientId,
              checked.terms.firstOccurrence,
              now.toISOString(),
              JSON.stringify(checked.reminders),
              now.toISOString(),
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
          const checked = this.#checkedPact(accountId, timezone, pact, new Date(row.created_at));
          if (!checked.ok) return checked;

          this.#db
            .prepare(
              `UPDATE pact SET name = ?, description = ?, schedule = ?, in_bed_by = ?, due_by = ?, start_date = ?,
                               end_date = ?, penalty_cents = ?, recipient_id = ?, first_occurrence = ?, reminders = ?
               WHERE id = ?`,
            )
            .run(
              checked.name,
              checked.description,
              JSON.stringify(checked.terms.schedule),
              checked.terms.inBedBy ?? null,
              checked.terms.dueBy ?? null,
              checked.startDate,
              checked.terms.endDate ?? null,
              pact.penaltyCents,
              pact.recipientId,
              checked.terms.firstOccurrence,
              JSON.stringify(checked.reminders),
              pactId,
            );
          this.#db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ?`).run(pactId);
          this.#setReviewers(pactId, checked.reviewerIds);
          // A One-time pact's evidence is for its one occurrence, wherever its deadline goes.
          if (isOneTime(row.schedule) && checked.terms.schedule.kind === "one-time") {
            this.#moveOneTimeOccurrence(pactId, row.first_occurrence, checked.terms.firstOccurrence);
            return { ok: true };
          }
          // #checkedPact refuses an owner with no timezone.
          const { includes } = occurrences(checked.terms, timezone!);
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
      firstOccurrence: ({ schedule, inBedBy, dueBy, startDate }, editing) => {
        const { timezone } = account();
        const pact = editing === undefined ? undefined : this.#ownPact(accountId, editing);
        if (editing !== undefined && !pact) return { ok: false, reason: "pact-not-found" };
        if (timezone === null) return { ok: false, reason: "no-timezone" };
        // The form may not have a valid time or date yet: those count as not set.
        const timing = newOccurrenceTerms(schedule, pact ? new Date(pact.created_at) : this.#clock.now(), timezone, {
          inBedBy: inBedBy !== undefined && isClockTime(inBedBy) ? inBedBy : null,
          dueBy: dueBy !== undefined && isDueBy(dueBy) ? dueBy : null,
          startDate: startDate !== undefined && isLocalDate(startDate) ? startDate : null,
        });
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
          schedule: JSON.parse(row.schedule) as Schedule,
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
        const occurrences = this.#occurrencesOf(pactId, timezone);
        const { first } = occurrences;
        const schedule = JSON.parse(row.schedule) as Schedule;
        let history: PactHistory;
        if (schedule.kind === "one-time") {
          history = { kind: "one-time", day: { date: first.date, occurrence: this.#occurrenceRecord(row, first) } };
        } else if (schedule.kind === "weekly-count") {
          history = { kind: "weekly-count", weeks: this.#heatMapWeeks(row, timezone, first.date, now) };
        } else {
          history = { kind: "fixed-days", days: this.#heatMapDays(row, timezone, first.date, now) };
        }
        const pact: PactTerms = {
          id: row.id,
          ...this.#currentTerms(row),
          stage: row.stage,
          endedAt: row.ended_at === null ? null : new Date(row.ended_at),
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
          history,
          connectionProblem:
            row.evidence_kind === "oura" && row.stage === "active" ? this.#ouraConnectionProblem(accountId) : null,
        };
        return { ok: true, pact };
      },
      changePreview: (pactId, change) => {
        const { timezone } = account();
        const checked = this.#checkedChange(accountId, timezone, pactId, change, this.#clock.now());
        if (!checked.ok) return checked;
        const { before, after, diffs, outcome } = checked;
        const preview: ChangePreview = { changes: this.#termChanges(before, after, diffs), outcome };
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
          for (const reviewerId of added) {
            this.#enqueue({
              recipient: reviewerId,
              kind: "picked-as-reviewer",
              channel: "push",
              payload: {
                pactId,
                title: `${ownerName} added you as a reviewer`,
                body: `${after.name} · ${scheduleText(before.schedule)} · ${money(before.penaltyCents)} per miss`,
                url: APP_PATHS.review,
              },
            });
          }
          if (outcome.kind === "needs-approval") {
            const sent = {
              ...before,
              name: after.name,
              reviewerIds: [...before.reviewerIds, ...added].sort(),
              reminders: after.reminders,
            };
            const id = this.#sendChangeRequest({ ...pact, name: after.name }, ownerName, sent, after, change.note);
            return { ok: true, outcome, changeRequestId: id };
          }
          if (outcome.kind === "stricter") this.#applyTerms(pact, after, now, checked.timezone);
          return { ok: true, outcome, changeRequestId: null };
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
        let state: ChangeRequestState = { kind: "waiting" };
        if (row.withdrawn_at !== null) state = { kind: "withdrawn", withdrawnAt: new Date(row.withdrawn_at) };
        if (row.decision !== null) {
          const decided = {
            reviewerName: this.#accountName(row.decided_by_account_id!),
            decidedAt: new Date(row.decided_at!),
          };
          state =
            row.decision === "approved"
              ? { kind: "approved", ...decided }
              : { kind: "rejected", ...decided, reason: row.reject_reason! };
        }
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
            .all(accountId) as { service: "oura"; status: Connection["status"]; connected_at: string }[]
        ).map((row): Connection => ({
          service: row.service,
          status: row.status,
          connectedAt: new Date(row.connected_at),
          activePacts: this.#activeOuraPacts(accountId),
        }));
        return { email, name, timezone, connections };
      },
      checkOura: async () => {
        account();
        const now = this.#clock.now();
        const last = this.#ouraChecks.get(accountId);
        if (last !== undefined && now.getTime() - last < OURA_CHECK_INTERVAL_MS) return;
        this.#ouraChecks.set(accountId, now.getTime());
        const fetched = await this.#fetchSleep(now, accountId);
        await this.#command(() => {
          this.#markDisconnected(fetched);
          this.#noteOuraClock(fetched.sleep);
          this.#judgeNights(now, fetched.sleep, accountId);
        });
      },
      disconnectOura: () =>
        this.#command(() => {
          account();
          this.#db.prepare(`DELETE FROM connection WHERE account_id = ? AND service = 'oura'`).run(accountId);
        }),
      connectOura: () =>
        this.#command(() => {
          account();
          this.#db
            .prepare(
              `INSERT INTO connection (account_id, service, status, connected_at) VALUES (?, 'oura', 'connected', ?)
               ON CONFLICT (account_id, service) DO UPDATE SET status = 'connected', connected_at = excluded.connected_at`,
            )
            .run(accountId, this.#clock.now().toISOString());
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
          // Evidence in the edit window waits for it to close: see #closeEditWindows.
          const pact = this.#ownPact(accountId, pactId);
          // Its reviewers already told, it may be from inside the window but it missed that.
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
        return this.#command((): FileExcuseResult => {
          const filedAt = this.#clock.now();
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
          for (const reviewerId of this.#reviewersOf(pactId)) {
            this.#enqueue({
              recipient: reviewerId,
              kind: "review-item",
              channel: "push",
              payload: {
                itemKind: "excuse",
                itemId: excuseId,
                pactId,
                title: `${ownerName} filed an excuse`,
                body: `${pactName} · ${dates}`,
                url: APP_PATHS.review,
              },
            });
          }
          return { ok: true, excuseId };
        });
      },
      excuse: (excuseId) => {
        account();
        const pact = this.#excusePact(excuseId);
        if (!pact || pact.owner_account_id !== accountId) return { ok: false, reason: "excuse-not-found" };
        const row = this.#db
          .prepare(
            `SELECT excuse.reason, excuse.filed_at, excuse.decision, excuse.decided_at, excuse.reject_reason,
                    reviewer.name AS reviewer_name
             FROM excuse LEFT JOIN account AS reviewer ON reviewer.id = excuse.decided_by_account_id
             WHERE excuse.id = ?`,
          )
          .get(excuseId) as {
          reason: string;
          filed_at: string;
          decision: ReviewOutcome | null;
          decided_at: string | null;
          reject_reason: string | null;
          reviewer_name: string | null;
        };
        let state: ExcuseState = { kind: "waiting" };
        if (row.decision !== null) {
          const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
          state =
            row.decision === "approved"
              ? { kind: "approved", ...decided }
              : { kind: "rejected", ...decided, reason: row.reject_reason! };
        }
        const reviewerNames = (
          this.#db
            .prepare(
              `SELECT account.name FROM pact_reviewer JOIN account ON account.id = pact_reviewer.reviewer_account_id
               WHERE pact_reviewer.pact_id = ? ORDER BY account.name, account.id`,
            )
            .all(pact.id) as { name: string }[]
        ).map((r) => r.name);
        const excuse: ExcuseDetail = {
          id: excuseId,
          pactId: pact.id,
          pactName: pact.name,
          reason: row.reason,
          photoIds: this.#excusePhotoIds(excuseId),
          filedAt: new Date(row.filed_at),
          days: this.#excuseDays(excuseId, pact.id, pact.timezone),
          state,
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
          for (const reviewerId of this.#paymentReviewers(accountId, payment.recipientId)) {
            this.#enqueue({
              recipient: reviewerId,
              kind: "review-item",
              channel: "push",
              payload: {
                itemKind: "payment",
                itemId: paymentId,
                recipientId: payment.recipientId,
                title: `${ownerName} recorded a payment`,
                body: `${money(payment.amountCents)} to ${this.#recipientName(payment.recipientId)}`,
                url: APP_PATHS.review,
              },
            });
          }
          return { ok: true, paymentId };
        });
      },
      photo: async (photoId) => {
        account();
        const viewable =
          this.#mayViewEvidencePhoto(photoId, accountId) ||
          this.#mayViewExcusePhoto(photoId, accountId) ||
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
          .get(evidenceId, accountId) as
          | (ReviewStateRow & {
              id: string;
              pact_id: string;
              pact_name: string;
              occurrence_date: LocalDate;
              day: LocalDate;
              submitted_at: string;
            })
          | undefined;
        if (!row) return { ok: false, reason: "evidence-not-found" };
        return {
          ok: true,
          evidence: {
            id: row.id,
            pactId: row.pact_id,
            pactName: row.pact_name,
            occurrenceDate: row.day,
            description: this.#termsOn(row.pact_id, row.occurrence_date).description,
            photoIds: this.#evidencePhotoIds(row.id),
            submittedAt: new Date(row.submitted_at),
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
          .get(paymentId, accountId) as
          | (ReviewStateRow & {
              id: string;
              recipient_id: string;
              recipient_name: string;
              amount_cents: number;
              note: string | null;
              photo_id: string;
              recorded_at: string;
            })
          | undefined;
        if (!row) return { ok: false, reason: "payment-not-found" };
        return {
          ok: true,
          payment: {
            id: row.id,
            recipientId: row.recipient_id,
            recipientName: row.recipient_name,
            amountCents: row.amount_cents,
            note: row.note,
            photoId: row.photo_id,
            recordedAt: new Date(row.recorded_at),
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
            channel: "push",
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
          const what = this.#itemWhat(item.kind, itemId);
          for (const reviewerId of item.reviewerIds) {
            this.#enqueue({
              recipient: reviewerId,
              kind: "owner-replied",
              channel: "push",
              payload: {
                itemKind: item.kind,
                itemId,
                title: `${name} replied about their ${what}`,
                body: `“${text}” It's back in your queue.`,
                url: APP_PATHS.review,
              },
            });
          }
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
          const decided: Decided = { outcome: reason === null ? "approved" : "rejected", reason };
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
              if (decided.outcome === "approved" && !this.#approvableNow(item.row.id)) {
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
        account();
        const [summary] = this.#ledgerSummaries(accountId, recipientId);
        if (!summary) return { ok: false, reason: "recipient-not-found" };
        const penaltyRows = this.#db
          .prepare(
            `SELECT penalty.id, penalty.pact_id, pact.name AS pact_name, penalty.occurrence_date,
                    penalty.amount_cents, penalty.added_at, penalty.bill_id, ${PENALTY_HELD} AS held,
                    ${WEEKLY_COUNT_PACT} AS weekly
             FROM penalty JOIN pact ON pact.id = penalty.pact_id
             WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ?
             ORDER BY penalty.added_at DESC, penalty.occurrence_date DESC, pact.name, penalty.id`,
          )
          .all(accountId, recipientId) as {
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
        const allocation = this.#allocate(accountId, recipientId);
        const bills = this.#billsOf(accountId, recipientId);
        const timezone = account().timezone;
        const penalties = penaltyRows.map((row): LedgerPenalty => {
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
                  // Every owner with a penalty has a timezone: making a pact needs it.
                  billedOn: nextBillDay(new Date(row.added_at), this.#clock.now(), timezone!),
                },
          };
        });
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
    const excuse = evidence
      ? undefined
      : (this.#db
          .prepare(
            `SELECT excuse.id, excuse.pact_id, excuse.decision, pact.owner_account_id
               FROM excuse
               JOIN pact ON pact.id = excuse.pact_id
               JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
               WHERE excuse.id = ?`,
          )
          .get(reviewerId, itemId) as ExcuseToDecide | undefined);
    const payment = evidence || excuse ? undefined : this.#paymentToDecide(reviewerId, itemId);
    const changeRequest =
      evidence || excuse || payment
        ? undefined
        : (this.#db
            .prepare(
              `SELECT change_request.id, change_request.pact_id, change_request.decision, pact.owner_account_id
                 FROM change_request
                 JOIN pact ON pact.id = change_request.pact_id
                 JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                                   AND pact_reviewer.reviewer_account_id = ?
                 WHERE change_request.id = ? AND change_request.withdrawn_at IS NULL AND pact.stage = 'active'`,
            )
            .get(reviewerId, itemId) as ChangeRequestToDecide | undefined);
    if (evidence) return { kind: "evidence", row: evidence };
    if (excuse) return { kind: "excuse", row: excuse };
    if (payment) return { kind: "payment", row: payment };
    if (changeRequest) return { kind: "change-request", row: changeRequest };
    return undefined;
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
        return row.ends_pact === 1 ? `request to end ${name}` : `change to ${name}`;
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

  /**
   * Every item `reviewerId` may decide, waiting on the owner's reply or not:
   * change requests first, then the rest oldest first.
   */
  #reviewItems(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#db
      .prepare(
        `SELECT evidence.id, evidence.pact_id, pact.name AS pact_name, owner.name AS owner_name,
                pact.description, evidence.submitted_at, evidence.occurrence_date, evidence.day,
                pact.penalty_cents, recipient.name AS recipient_name, ${WEEKLY_COUNT_PACT} AS weekly
         FROM evidence
         JOIN pact ON pact.id = evidence.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN recipient ON recipient.id = pact.recipient_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE evidence.decision IS NULL AND pact.created_at <= ?
         ORDER BY evidence.submitted_at, evidence.id`,
      )
      .all(reviewerId, this.#editWindowCutoff()) as {
      id: string;
      pact_id: string;
      pact_name: string;
      owner_name: string;
      description: string;
      submitted_at: string;
      occurrence_date: string;
      day: string;
      penalty_cents: number;
      recipient_name: string;
      weekly: 0 | 1;
    }[];
    const evidence = rows.map((row): ReviewItem => {
      // What counts, and what rejecting costs: the terms of the occurrence's day.
      const terms = this.#termsOn(row.pact_id, row.occurrence_date);
      return {
        kind: "evidence",
        id: row.id,
        pactId: row.pact_id,
        pactName: row.pact_name,
        ownerName: row.owner_name,
        description: terms.description,
        photoIds: this.#evidencePhotoIds(row.id),
        submittedAt: new Date(row.submitted_at),
        occurrenceDate: row.day,
        penaltyCents: terms.penalty_cents,
        recipientName: this.#recipientName(terms.recipient_id),
        ...(row.weekly === 1 && { week: this.#weekProgress(row.pact_id, row.occurrence_date) }),
        thread: this.#thread(row.id, true),
      };
    });
    // Change requests first: one waiting holds up any other change to its pact.
    return [
      ...this.#changeRequestsToReview(reviewerId),
      ...mergeByTime(
        (item) =>
          item.kind === "evidence"
            ? item.submittedAt
            : item.kind === "excuse"
              ? item.filedAt
              : item.kind === "payment"
                ? item.recordedAt
                : item.requestedAt,
        "oldest-first",
        evidence,
        this.#excusesToReview(reviewerId),
        this.#paymentsToReview(reviewerId),
      ),
    ];
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
         GROUP BY recipient.id
         ORDER BY recipient.name, recipient.id`,
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
    return rows.map((row) => {
      // An excuse approved after its penalty was paid leaves more paid than
      // owed. The surplus pays the next penalties (#allocate), and owed is $0
      // meanwhile, never below.
      const owedCents = Math.max(0, row.penalty_cents - row.paid_cents);
      const bills = this.#billsOf(ownerId, row.id);
      const due = bills.filter((bill) => bill.dueAt.getTime() > now.getTime() && bill.uncoveredCents > 0);
      return {
        recipientId: row.id,
        name: row.name,
        owedCents,
        payableCents: Math.max(0, owedCents - row.awaiting_cents),
        awaitingCents: row.awaiting_cents,
        awaitingCount: row.awaiting_count,
        paidCents: row.paid_cents,
        overdueCents: overdueOf(bills, now).cents,
        billDue:
          due.length === 0 ? null : { amountCents: sum(due.map((bill) => bill.uncoveredCents)), dueAt: due[0]!.dueAt },
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
        channel: "push",
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
      if (overdue.cents === 0) continue;
      const notice = this.#overdueNotice(ownerId, recipientId, overdue.spellStartedAt!);
      const since = (at: Date | null) => (at === null ? Infinity : t.getTime() - at.getTime());
      const recipientName = this.#recipientName(recipientId);
      const remind = since(notice.ownerRemindedAt) >= OVERDUE_REMINDER_MS;
      const tell = since(notice.reviewersToldAt) >= OVERDUE_REVIEWER_NOTICE_MS;
      if (remind) {
        this.#enqueue({
          recipient: ownerId,
          kind: "overdue-bill",
          channel: "push",
          payload: {
            recipientId,
            title: `${money(overdue.cents)} overdue to ${recipientName}`,
            body: `Your ${formatDate(overdue.billedOn!)} bill was due ${formatDate(localDateOf(overdue.dueAt!, this.#timezoneOf(ownerId)))}. Record your payment.`,
            url: APP_PATHS.ledger(recipientId),
          },
        });
      }
      if (tell) {
        for (const reviewerId of this.#paymentReviewers(ownerId, recipientId)) {
          this.#enqueue({
            recipient: reviewerId,
            kind: "overdue-bill",
            channel: "push",
            payload: {
              recipientId,
              title: `${ownerName} is overdue`,
              body: `${money(overdue.cents)} to ${recipientName}, due ${formatDate(localDateOf(overdue.dueAt!, this.#timezoneOf(ownerId)))}`,
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
    // Every owner with a bill has a timezone: billing needs it.
    return row.timezone!;
  }

  /** Today's bill cards and overdue alerts: one of each at most per recipient. */
  #billsForToday(ownerId: AccountId, now: Date): { cards: TodayBillCard[]; alerts: TodayAlert[] } {
    const cards: TodayBillCard[] = [];
    const alerts: TodayAlert[] = [];
    const recipients = this.#db
      .prepare(
        `SELECT DISTINCT bill.recipient_id, recipient.name FROM bill
         JOIN recipient ON recipient.id = bill.recipient_id
         WHERE bill.owner_account_id = ? ORDER BY recipient.name, recipient.id`,
      )
      .all(ownerId) as { recipient_id: string; name: string }[];
    for (const { recipient_id: recipientId, name } of recipients) {
      const bills = this.#billsOf(ownerId, recipientId);
      const overdue = overdueOf(bills, now);
      if (overdue.cents > 0) {
        // Named only once the core has told them in this spell: until the scheduler's next tick, nobody has been.
        // A reviewer with overdue notifications off is never told, so never named.
        const told = this.#overdueNotice(ownerId, recipientId, overdue.spellStartedAt!).reviewersToldAt !== null;
        alerts.push({
          kind: "bill-overdue",
          recipientId,
          recipientName: name,
          overdueCents: overdue.cents,
          billedOn: overdue.billedOn!,
          dueAt: overdue.dueAt!,
          reviewerNames: told
            ? this.#paymentReviewers(ownerId, recipientId)
                .filter((id) => !this.#settingIsOff(id, "overdue-bill"))
                .map((id) => this.#accountName(id))
                .sort()
            : [],
        });
      }
      const due = bills.filter((bill) => bill.dueAt.getTime() > now.getTime() && bill.uncoveredCents > 0);
      if (due.length > 0) {
        cards.push({
          kind: "bill",
          recipientId,
          recipientName: name,
          amountCents: sum(due.map((bill) => bill.uncoveredCents)),
          dueAt: due[0]!.dueAt,
          billedOn: due[0]!.billedOn,
        });
      }
    }
    return { cards, alerts };
  }

  /** The owner's payments to `recipientId` and where each one's review stands, newest recorded first. */
  #ledgerPayments(ownerId: AccountId, recipientId: string): LedgerPayment[] {
    const rows = this.#db
      .prepare(
        `SELECT payment.id, payment.amount_cents, payment.note, payment.recorded_at, payment.decision,
                payment.decided_at, payment.reject_reason, reviewer.name AS reviewer_name
         FROM payment LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
         WHERE payment.owner_account_id = ? AND payment.recipient_id = ?
         ORDER BY payment.recorded_at DESC, payment.id`,
      )
      .all(ownerId, recipientId) as {
      id: string;
      amount_cents: number;
      note: string | null;
      recorded_at: string;
      decision: ReviewOutcome | null;
      decided_at: string | null;
      reject_reason: string | null;
      reviewer_name: string | null;
    }[];
    return rows.map((row) => {
      let state: LedgerPaymentState = { kind: "awaiting-approval" };
      if (row.decision !== null) {
        const decided = { reviewerName: row.reviewer_name!, decidedAt: new Date(row.decided_at!) };
        state =
          row.decision === "approved"
            ? { kind: "approved", ...decided }
            : { kind: "rejected", ...decided, reason: row.reject_reason! };
      }
      return {
        kind: "payment",
        paymentId: row.id,
        amountCents: row.amount_cents,
        note: row.note,
        recordedAt: new Date(row.recorded_at),
        state,
      };
    });
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
   * not. An approval judges it Kept as of now once judging has reached it,
   * since it was waiting on this decision; before that, judging at the due
   * time will.
   */
  #decideEvidence(evidence: EvidenceToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    const now = this.#clock.now();
    this.#db
      .prepare(
        `UPDATE evidence SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, now.toISOString(), reason, evidence.id);
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
      const judged = outcome === "approved" ? "kept" : excusedAhead ? "excused" : "missed";
      this.#judge(evidence.pact_id, evidence.occurrence_date, judged, now);
    }
    this.#enqueue({
      recipient: evidence.owner_account_id,
      kind: "evidence-decided",
      channel: "push",
      payload: {
        itemKind: "evidence",
        itemId: evidence.id,
        pactId: evidence.pact_id,
        decision: outcome,
        ...(reason !== null && { reason }),
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
      | { outcome: "kept" | "missed" | "excused" | null; judged_at: string | null; amount_cents: number | null }
      | undefined;
    const excuse = this.#excuseOn(pactId, date);
    if (row?.outcome === "kept") return { kind: "kept" };
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

  /**
   * The pact's heat map as of `now`: every day from its first occurrence
   * through the Sunday ending this week, or the week it Ended, or its first
   * occurrence's week while that's ahead.
   */
  #heatMapDays(pact: PactRow, timezone: string, first: LocalDate, now: Date): HeatMapDay[] {
    const endedOn = pact.ended_at === null ? null : localDateOf(new Date(pact.ended_at), timezone);
    const last = [first, endedOn ?? localDateOf(now, timezone)].sort().at(-1)!;
    const sunday = addDays(last, WEEKDAYS.length - 1 - WEEKDAYS.indexOf(weekdayOf(last)));
    return this.#occurrenceRecords(pact, timezone, first, sunday);
  }

  /**
   * A Weekly count pact's heat map as of `now`: every week from its first
   * through this one, or the one it Ended, or its first while that's ahead;
   * none from the week it Ended that was never judged.
   */
  #heatMapWeeks(pact: PactRow, timezone: string, first: LocalDate, now: Date): HeatMapWeek[] {
    const endedOn = pact.ended_at === null ? null : localDateOf(new Date(pact.ended_at), timezone);
    const last = [first, endedOn ?? localDateOf(now, timezone)].sort().at(-1)!;
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
    const endedOn = pact.ended_at === null ? null : localDateOf(new Date(pact.ended_at), timezone);
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
  #occurrenceRecord(pact: Pick<PactRow, "id" | "evidence_kind">, occurrence: Occurrence): OccurrenceRecord {
    const status = this.#occurrenceStatus(pact.id, occurrence);
    const row = this.#db
      .prepare(
        `SELECT occurrence.bedtime_start, recipient.name AS recipient_name
         FROM occurrence
         LEFT JOIN penalty ON penalty.pact_id = occurrence.pact_id AND penalty.occurrence_date = occurrence.date
         LEFT JOIN recipient ON recipient.id = penalty.recipient_id
         WHERE occurrence.pact_id = ? AND occurrence.date = ?`,
      )
      .get(pact.id, occurrence.date) as { bedtime_start: string | null; recipient_name: string | null } | undefined;
    const record: OccurrenceRecord = {
      status,
      decidedBy: this.#decidedBy(pact.id, occurrence.date, status),
      recipientName: status.kind === "missed" ? (row?.recipient_name ?? null) : null,
    };
    if (pact.evidence_kind === "oura" && (status.kind === "kept" || status.kind === "missed")) {
      const bedtimeStart = row?.bedtime_start ?? null;
      record.night = { inBedAt: bedtimeStart === null ? null : wallClock(bedtimeStart).slice(11) };
    }
    return record;
  }

  /**
   * The decision that settled an occurrence with `status`: its approved
   * evidence (Kept), its rejected evidence (Missed), or the approved excuse
   * that covers it (Excused, or a day not judged yet it already excuses).
   */
  #decidedBy(pactId: string, date: LocalDate, status: OccurrenceStatus): OccurrenceDecision | null {
    // A Weekly count week is Kept or Missed by its days, not by any one decision.
    if ((status.kind === "kept" || status.kind === "missed") && this.#isWeekly(pactId)) return null;
    if (status.kind === "kept") {
      const row = this.#db
        .prepare(
          `SELECT account.name FROM evidence JOIN account ON account.id = evidence.decided_by_account_id
           WHERE evidence.pact_id = ? AND evidence.occurrence_date = ? AND evidence.decision = 'approved'`,
        )
        .get(pactId, date) as { name: string } | undefined;
      return row ? { kind: "evidence-approved", reviewerName: row.name } : null;
    }
    if (status.kind === "missed") {
      const rejection = this.#rejection(pactId, date);
      return rejection && { kind: "evidence-rejected", ...rejection };
    }
    if (status.kind === "excused" || (status.kind === "not-judged" && status.excuse === "approved")) {
      const row = this.#db
        .prepare(
          `SELECT account.name, excuse.reason FROM excuse_day
           JOIN excuse ON excuse.id = excuse_day.excuse_id
           JOIN account ON account.id = excuse.decided_by_account_id
           WHERE excuse_day.pact_id = ? AND excuse_day.date = ? AND excuse.decision = 'approved'
           ORDER BY excuse.decided_at DESC LIMIT 1`,
        )
        .get(pactId, date) as { name: string; reason: string } | undefined;
      return row ? { kind: "excuse-approved", reviewerName: row.name, reason: row.reason } : null;
    }
    return null;
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
      case "kept":
        return "kept";
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
    const schedule = JSON.parse(this.#termsOn(pactId, occurrence.date).schedule) as Schedule;
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
  #excusePact(excuseId: string): (PactRow & { owner_account_id: AccountId; timezone: string }) | undefined {
    return this.#db
      .prepare(
        `SELECT pact.*, account.timezone FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN account ON account.id = pact.owner_account_id
         WHERE excuse.id = ?`,
      )
      .get(excuseId) as (PactRow & { owner_account_id: AccountId; timezone: string }) | undefined;
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
  #decideExcuse(excuse: ExcuseToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    const now = this.#clock.now();
    this.#db
      .prepare(
        `UPDATE excuse SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, now.toISOString(), reason, excuse.id);
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
          evidenceKind === "camera" &&
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
      channel: "push",
      payload: {
        itemKind: "excuse",
        itemId: excuse.id,
        pactId: excuse.pact_id,
        decision: outcome,
        ...(reason !== null && { reason }),
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
                owner.name AS owner_name, owner.timezone, recipient.name AS recipient_name,
                pact.schedule, pact.first_occurrence
         FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         JOIN recipient ON recipient.id = pact.recipient_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE excuse.decision IS NULL
         ORDER BY excuse.filed_at, excuse.id`,
      )
      .all(reviewerId) as {
      id: string;
      reason: string;
      filed_at: string;
      pact_id: string;
      pact_name: string;
      owner_name: string;
      timezone: string;
      recipient_name: string;
      schedule: string;
      first_occurrence: string;
    }[];
    return rows.map((row): ReviewItem => {
      const days = this.#excuseDays(row.id, row.pact_id, row.timezone);
      return {
        kind: "excuse",
        id: row.id,
        pactId: row.pact_id,
        pactName: row.pact_name,
        ownerName: row.owner_name,
        reason: row.reason,
        photoIds: this.#excusePhotoIds(row.id),
        filedAt: new Date(row.filed_at),
        days,
        heldCents: days.reduce((sum, { status }) => sum + (status.kind === "missed" ? status.penaltyCents : 0), 0),
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
   * days. With when it was rejected, for ordering among the alerts.
   */
  #rejectedExcuseAlerts(ownerId: AccountId, now: Date): { at: Date; alert: TodayAlert }[] {
    const rows = this.#db
      .prepare(
        `SELECT excuse.id, excuse.pact_id, excuse.reject_reason, excuse.decided_at, pact.name,
                pact.schedule, pact.first_occurrence, owner.timezone, reviewer.name AS reviewer_name
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
      schedule: string;
      first_occurrence: string;
      timezone: string;
      reviewer_name: string;
    }[];
    return rows.map((row) => {
      const days = this.#excuseDays(row.id, row.pact_id, row.timezone);
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
      return {
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
      };
    });
  }

  /** The pact's terms over time, oldest first: those it had before each change, then those it has now. */
  #erasOf(
    pact: Pick<PactRow, "id" | "schedule" | "first_occurrence" | "in_bed_by" | "due_by" | "end_date" | "created_at">,
  ): TermsEra[] {
    const earlier = this.#db
      .prepare(`SELECT until, schedule, in_bed_by, due_by FROM pact_earlier_terms WHERE pact_id = ? ORDER BY until`)
      .all(pact.id) as { until: LocalDate; schedule: string; in_bed_by: string | null; due_by: string | null }[];
    return [
      ...earlier.map((row) => ({
        until: row.until,
        terms: occurrenceTermsOf({ ...row, first_occurrence: pact.first_occurrence }),
      })),
      { until: null, terms: occurrenceTermsOf(pact) },
    ];
  }

  /**
   * The occurrences of pact `pactId` in `timezone`, each dated one on the
   * terms it opened with. A bedtime night closes on Oura's clock where the
   * owner is (`#ouraOffset`).
   */
  #occurrencesOf(pactId: string, timezone: string): Occurrences {
    const pact = this.#db
      .prepare(
        `SELECT id, schedule, first_occurrence, in_bed_by, due_by, end_date, created_at, owner_account_id, evidence_kind
         FROM pact WHERE id = ?`,
      )
      .get(pactId) as
      | (Pick<
          PactRow,
          "id" | "schedule" | "first_occurrence" | "in_bed_by" | "due_by" | "end_date" | "created_at" | "evidence_kind"
        > & { owner_account_id: AccountId })
      | undefined;
    if (!pact) throw new Error(`no pact ${pactId}`);
    const ouraOffset = pact.evidence_kind === "oura" ? this.#ouraOffset(pact.owner_account_id, timezone) : null;
    return occurrencesOverTime(this.#erasOf(pact), timezone, ouraOffset);
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
    const columns = `description, schedule, in_bed_by, due_by, penalty_cents, recipient_id`;
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
      schedule: JSON.parse(pact.schedule) as Schedule,
      penaltyCents: pact.penalty_cents,
      recipientId: pact.recipient_id,
      reviewerIds: this.#reviewersOf(pact.id),
      reminders: JSON.parse(pact.reminders) as string[],
    };
  }

  /** The pact's terms as the pact page and a change request show them. */
  #currentTerms(pact: PactRow): CurrentTerms & Pick<PactTerms, "reminders"> {
    const [recipient] = this.#selectRecipients(`id = ?`, pact.recipient_id);
    if (!recipient) throw new Error(`pact ${pact.id} has no recipient ${pact.recipient_id}`);
    return {
      name: pact.name,
      description: pact.description,
      evidenceKind: pact.evidence_kind,
      inBedBy: pact.in_bed_by,
      dueBy: pact.due_by,
      startDate: pact.start_date,
      endDate: pact.end_date,
      schedule: JSON.parse(pact.schedule) as Schedule,
      penaltyCents: pact.penalty_cents,
      recipient,
      reviewers: this.#friendsSortedByName(this.#reviewersOf(pact.id)),
      reminders: JSON.parse(pact.reminders) as string[],
    };
  }

  /** The accounts `ids` as friends, sorted by name. */
  #friendsSortedByName(ids: AccountId[]): Friend[] {
    return ids
      .map((id) => ({ id, name: this.#accountName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id, "en-US"));
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
    const { note: _note, ...terms } = change;
    const checked = this.#checkedPact(
      ownerId,
      timezone,
      { ...terms, evidenceKind: pact.evidence_kind },
      new Date(pact.created_at),
    );
    if (!checked.ok) return checked;
    // #checkedPact refuses an owner with no timezone.
    const zone = timezone!;
    const before = this.#changeableTerms(pact);
    // Only a new pact can swap a week's count for its days, or back.
    if (checked.terms.schedule.kind !== before.schedule.kind) return { ok: false, reason: "schedule-kind-fixed" };
    const after: ChangeableTerms = {
      name: checked.name,
      description: checked.description,
      inBedBy: checked.terms.inBedBy ?? null,
      dueBy: checked.terms.dueBy ?? null,
      startDate: checked.startDate,
      endDate: checked.terms.endDate ?? null,
      schedule: checked.terms.schedule,
      penaltyCents: change.penaltyCents,
      recipientId: change.recipientId,
      reviewerIds: [...checked.reviewerIds].sort(),
      reminders: checked.reminders,
    };
    // Reminders apply at once, so they go off before the due time in force now as well as the new one.
    const current = {
      oneTime: before.schedule.kind === "one-time",
      inBedBy: pact.in_bed_by,
      dueBy: pact.due_by,
      dueAt: this.#occurrencesOf(pact.id, zone).first.dueAt,
    };
    if (!remindersGoOffInTime(after.reminders, current, zone)) return { ok: false, reason: "reminder-after-due-time" };
    const diffs = termDiffs(before, after);
    if (this.#waitingChangeRequestId(pactId) !== null && diffs.some((diff) => diff.effect !== "at-once")) {
      return { ok: false, reason: "change-request-waiting" };
    }
    // A One-time change applies to its occurrence even once it's open, given an hour to the new deadline.
    if (checked.terms.schedule.kind === "one-time" && !this.#deadlineFarEnough(pact, zone, after, now)) {
      return { ok: false, reason: "deadline-too-soon" };
    }
    // Occurrences already open keep their terms: a start date means nothing once the first has opened,
    // and an end date can't take away a day (or a week) that has.
    const from = firstDayNotOpen(before.schedule, localDateOf(now, zone));
    if (after.startDate !== before.startDate && pact.first_occurrence < from) {
      return { ok: false, reason: "pact-started" };
    }
    const firstFrom = firstOccurrenceAfterChange(pact.first_occurrence, after.schedule, from, after.startDate);
    if (after.endDate !== null && after.endDate !== before.endDate) {
      if (after.endDate < addDays(from, -1) || after.endDate < lastDayOf(after.schedule, firstFrom)) {
        return { ok: false, reason: "end-date-too-early" };
      }
    }
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
      };
    }
    if (diffs.some((diff) => diff.effect === "stricter")) {
      return { kind: "stricter", ...this.#startOfNewTerms(pact, timezone, after, now) };
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
  ): { appliesFrom: LocalDate; todayKeepsCents: number | null } {
    // One-time: the change applies to its one occurrence, open or not.
    if (after.schedule.kind === "one-time") return { appliesFrom: after.schedule.deadline, todayKeepsCents: null };
    const today = localDateOf(at, timezone);
    const from = firstDayNotOpen(after.schedule, today);
    const eras = this.#erasOf(pact);
    const earlier = eras.slice(0, -1);
    const firstOccurrence = firstOccurrenceAfterChange(pact.first_occurrence, after.schedule, from, after.startDate);
    const planned: TermsEra[] = [
      ...earlier,
      ...(earlier.some((era) => era.until === from) ? [] : [{ until: from, terms: eras.at(-1)!.terms }]),
      {
        until: null,
        terms: {
          schedule: after.schedule,
          firstOccurrence,
          inBedBy: after.inBedBy,
          dueBy: after.dueBy,
          endDate: after.endDate,
        },
      },
    ];
    const start = firstOccurrence > from ? firstOccurrence : from;
    // With no day left before its end date, the change still starts tomorrow (or next week).
    const [first] = occurrencesOverTime(planned, timezone).between(from, addDays(start, 7));
    return {
      appliesFrom: first?.date ?? from,
      todayKeepsCents: this.#todayKeeps(pact.id, eras, timezone, today, after),
    };
  }

  /** The penalty the occurrence open `today` keeps, when it differs from `after`'s; else null. */
  #todayKeeps(
    pactId: string,
    eras: TermsEra[],
    timezone: string,
    today: LocalDate,
    after: Pick<ChangeableTerms, "penaltyCents">,
  ): number | null {
    const open = occurrencesOverTime(eras, timezone).covering(today);
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
                                         recipient_id)
         SELECT id, ?, description, schedule, in_bed_by, due_by, penalty_cents, recipient_id FROM pact WHERE id = ?
         ON CONFLICT (pact_id, until) DO NOTHING`,
      )
      .run(from, pact.id);
    // Approved after the pact started, a new start date is moot; approved after
    // the end date it asked for, the pact still keeps today (or this week), which is open.
    const started = pact.first_occurrence < from;
    const lastOpen = addDays(from, -1);
    const endDate = after.endDate !== null && after.endDate < lastOpen ? lastOpen : after.endDate;
    this.#db
      .prepare(
        `UPDATE pact SET description = ?, schedule = ?, in_bed_by = ?, due_by = ?, start_date = ?, end_date = ?,
                         penalty_cents = ?, recipient_id = ?, first_occurrence = ?
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
    const changed = occurrences(
      { schedule: after.schedule, firstOccurrence: current.date, dueBy: after.dueBy },
      timezone,
    ).first;
    return changed.dueAt.getTime() === current.dueAt.getTime() || dueSoonEnough(changed, at);
  }

  /** The changed terms, old and new, with names for the recipient and reviewers. */
  #termChanges(before: ChangeableTerms, after: ChangeableTerms, diffs: TermDiff[]): TermChange[] {
    return diffs.map(({ term, effect }): TermChange => {
      switch (term) {
        case "name":
          return { term, before: before.name, after: after.name, effect };
        case "description":
          return { term, before: before.description, after: after.description, effect };
        case "in-bed-by":
          return { term, before: before.inBedBy!, after: after.inBedBy!, effect };
        case "due-by":
          return { term, before: before.dueBy, after: after.dueBy, effect };
        case "start-date":
          return { term, before: before.startDate, after: after.startDate, effect };
        case "end-date":
          return { term, before: before.endDate, after: after.endDate, effect };
        case "schedule":
          return { term, before: before.schedule, after: after.schedule, effect };
        case "penalty":
          return { term, before: before.penaltyCents, after: after.penaltyCents, effect };
        case "recipient":
          return {
            term,
            before: { id: before.recipientId, name: this.#recipientName(before.recipientId) },
            after: { id: after.recipientId, name: this.#recipientName(after.recipientId) },
            effect,
          };
        case "reviewers":
          return {
            term,
            before: this.#friendsSortedByName(before.reviewerIds),
            after: this.#friendsSortedByName(after.reviewerIds),
            added: this.#friendsSortedByName(after.reviewerIds.filter((id) => !before.reviewerIds.includes(id))),
            removed: this.#friendsSortedByName(before.reviewerIds.filter((id) => !after.reviewerIds.includes(id))),
            effect,
          };
        case "reminders":
          return { term, before: before.reminders, after: after.reminders, effect };
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
        : termDiffs(before, after).map(({ term }) =>
            term === "schedule" && after.schedule.kind === "one-time" ? "Deadline" : TERM_LABELS[term],
          );
    const body = [...what, ...(trimmed === "" ? [] : [`“${trimmed}”`])].join(" · ");
    for (const reviewerId of this.#reviewersOf(pact.id)) {
      this.#enqueue({
        recipient: reviewerId,
        kind: "review-item",
        channel: "push",
        payload: {
          itemKind: "change-request",
          itemId: id,
          pactId: pact.id,
          title: `${ownerName} asked to ${after === null ? "end" : "change"} ${pact.name}`,
          body: body === "" ? "It needs your approval" : body,
          url: APP_PATHS.review,
        },
      });
    }
    return id;
  }

  /** A change request with its pact's owner and their timezone. */
  #changeRequestRow(id: string): ChangeRequestRow | undefined {
    return this.#db
      .prepare(
        `SELECT change_request.*, pact.owner_account_id, owner.name AS owner_name, owner.timezone
         FROM change_request
         JOIN pact ON pact.id = change_request.pact_id
         JOIN account AS owner ON owner.id = pact.owner_account_id
         WHERE change_request.id = ?`,
      )
      .get(id) as ChangeRequestRow | undefined;
  }

  #changeRequestView(row: ChangeRequestRow): ChangeRequestView {
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    const before = storedTerms(row.before_terms);
    const after = row.after_terms === null ? null : storedTerms(row.after_terms);
    const waiting = row.decision === null && row.withdrawn_at === null;
    // Every pact's owner has a timezone: creating one needs it.
    const start =
      waiting && after !== null ? this.#startOfNewTerms(pact, row.timezone!, after, this.#clock.now()) : null;
    return {
      id: row.id,
      pactId: row.pact_id,
      pactName: pact.name,
      endsPact: row.ends_pact === 1,
      note: row.note,
      requestedAt: new Date(row.requested_at),
      changes: after === null ? [] : this.#termChanges(before, after, termDiffs(before, after)),
      // Reminders are the owner's own: reviewers don't see them.
      current: withoutReminders(this.#currentTerms(pact)),
      appliesFrom: start?.appliesFrom ?? null,
      todayKeepsCents: start?.todayKeepsCents ?? null,
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
  #decideChangeRequest(request: ChangeRequestToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    const now = this.#clock.now();
    this.#db
      .prepare(
        `UPDATE change_request SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, now.toISOString(), reason, request.id);
    const row = this.#changeRequestRow(request.id)!;
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    const reviewerName = this.#accountName(reviewerId);
    const endsPact = row.ends_pact === 1;
    const title = `${reviewerName} ${outcome} ${endsPact ? `ending ${pact.name}` : "your change"}`;
    let body = `${pact.name} · “${reason}”`;
    if (outcome === "approved" && endsPact) {
      this.#endPact(pact.id, now);
      body = `${pact.name} is Ended`;
    } else if (outcome === "approved") {
      const before = storedTerms(row.before_terms);
      const after = storedTerms(row.after_terms!);
      for (const removed of before.reviewerIds.filter((id) => !after.reviewerIds.includes(id))) {
        this.#db
          .prepare(`DELETE FROM pact_reviewer WHERE pact_id = ? AND reviewer_account_id = ?`)
          .run(pact.id, removed);
      }
      // Every pact's owner has a timezone: creating one needs it.
      const { appliesFrom } = this.#startOfNewTerms(pact, row.timezone!, after, now);
      this.#applyTerms(pact, after, now, row.timezone!);
      body = `${pact.name} · New terms start ${formatDate(appliesFrom)}`;
    }
    this.#enqueue({
      recipient: row.owner_account_id,
      kind: "change-request-decided",
      channel: "push",
      payload: {
        itemKind: "change-request",
        itemId: request.id,
        pactId: pact.id,
        decision: outcome,
        ...(reason !== null && { reason }),
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
  #approvableNow(changeRequestId: string): boolean {
    const row = this.#changeRequestRow(changeRequestId)!;
    if (row.after_terms === null) return true;
    const pact = this.#db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
    const after = storedTerms(row.after_terms);
    if (after.schedule.kind !== "one-time" || pact.stage === "ended") return true;
    // Every pact's owner has a timezone: creating one needs it.
    return this.#deadlineFarEnough(pact, row.timezone!, after, this.#clock.now());
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
    const from = pact.first_occurrence > latest.until ? pact.first_occurrence : latest.until;
    const [start] = occurrences.between(from, addDays(from, 7));
    const today = localDateOf(now, timezone);
    if (!start || start.date <= today) return null;
    const todayKeepsCents = this.#todayKeeps(pact.id, this.#erasOf(pact), timezone, today, {
      penaltyCents: pact.penalty_cents,
    });
    return { startsOn: start.date, todayKeepsCents };
  }

  /** `ownerId`'s pact `pactId`, if it is one. */
  #ownPact(ownerId: AccountId, pactId: string): PactRow | undefined {
    return this.#db.prepare(`SELECT * FROM pact WHERE id = ? AND owner_account_id = ?`).get(pactId, ownerId) as
      PactRow | undefined;
  }

  /** What creating and editing share: `pact` checked as a pact made at `createdAt`, or why it's refused. */
  #checkedPact(
    ownerId: AccountId,
    timezone: string | null,
    pact: NewPact,
    createdAt: Date,
  ):
    | {
        ok: true;
        name: string;
        description: string;
        terms: OccurrenceTerms;
        startDate: LocalDate | null;
        reviewerIds: AccountId[];
        reminders: string[];
      }
    | { ok: false; reason: CreatePactRefusal } {
    const oura = pact.evidenceKind === "oura";
    if (oura && !this.#hasOuraConnection(ownerId)) return { ok: false, reason: "oura-not-connected" };
    if (oura && (pact.inBedBy === undefined || !isClockTime(pact.inBedBy))) {
      return { ok: false, reason: "invalid-in-bed-by" };
    }
    // A ring's nights are Fixed days only, and at most one day of evidence counts a day.
    if (pact.schedule.kind === "weekly-count") {
      const { target } = pact.schedule;
      if (oura || !Number.isSafeInteger(target) || target < 1 || target > MAX_WEEKLY_TARGET) {
        return { ok: false, reason: "invalid-schedule" };
      }
    }
    const oneTime = pact.schedule.kind === "one-time";
    if (pact.schedule.kind === "one-time" && (oura || !isLocalDate(pact.schedule.deadline))) {
      return { ok: false, reason: "invalid-schedule" };
    }
    // A due-by time is for evidence the owner submits; a ring's night has its in-bed-by time.
    if (pact.dueBy !== undefined && (oura || !isDueBy(pact.dueBy))) return { ok: false, reason: "invalid-due-by" };
    // A One-time pact has just its deadline: Submit anytime sets when it opens.
    if (pact.startDate !== undefined && (oneTime || !isLocalDate(pact.startDate))) {
      return { ok: false, reason: "invalid-start-date" };
    }
    if (pact.endDate !== undefined && (oneTime || !isLocalDate(pact.endDate))) {
      return { ok: false, reason: "invalid-end-date" };
    }
    const reminders = [...new Set(pact.reminders ?? [])];
    if (reminders.length > MAX_REMINDERS || !reminders.every(oneTime ? isDatedReminder : isClockTime)) {
      return { ok: false, reason: "invalid-reminders" };
    }
    // In the order they go off: a night's run from 18:00 to the morning after.
    reminders.sort((a, b) =>
      oura ? nightOrder(a).localeCompare(nightOrder(b), "en-US") : a.localeCompare(b, "en-US"),
    );
    const name = pact.name.trim();
    // An Oura Ring pact has no photo to describe.
    const description = oura ? "" : pact.description.trim();
    if (name === "") return { ok: false, reason: "blank-name" };
    if (!oura && description === "") return { ok: false, reason: "blank-description" };
    if (timezone === null) return { ok: false, reason: "no-timezone" };
    const timing = newOccurrenceTerms(pact.schedule, createdAt, timezone, {
      inBedBy: oura ? pact.inBedBy! : null,
      dueBy: pact.dueBy ?? null,
      startDate: pact.startDate ?? null,
    });
    if (!timing.ok) return timing;
    const due = {
      oneTime,
      inBedBy: oura ? pact.inBedBy! : null,
      dueBy: timing.terms.dueBy ?? null,
      dueAt: timing.first.dueAt,
    };
    if (!remindersGoOffInTime(reminders, due, timezone)) return { ok: false, reason: "reminder-after-due-time" };
    const endDate = pact.endDate ?? null;
    // The first occurrence has to end by the end date: a whole week, for Weekly count.
    if (endDate !== null && endDate < lastDayOf(timing.terms.schedule, timing.terms.firstOccurrence)) {
      return { ok: false, reason: "end-date-too-early" };
    }
    if (!Number.isSafeInteger(pact.penaltyCents) || pact.penaltyCents <= 0) {
      return { ok: false, reason: "invalid-penalty" };
    }
    const isOwnRecipient = this.#db
      .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
      .get(pact.recipientId, ownerId);
    if (!isOwnRecipient) return { ok: false, reason: "unknown-recipient" };
    const reviewerIds = [...new Set(pact.reviewerIds)];
    if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
    if (!reviewerIds.every((id) => this.#areFriends(ownerId, id))) return { ok: false, reason: "not-a-friend" };
    return {
      ok: true,
      name,
      description,
      terms: endDate === null ? timing.terms : { ...timing.terms, endDate },
      startDate: pact.startDate ?? null,
      reviewerIds,
      reminders,
    };
  }

  #hasOuraConnection(accountId: AccountId): boolean {
    return (
      this.#db.prepare(`SELECT 1 FROM connection WHERE account_id = ? AND service = 'oura'`).get(accountId) !==
      undefined
    );
  }
  /** Why Oura can't be read for the account, or null when its connection works. */
  #ouraConnectionProblem(accountId: AccountId): ConnectionProblem | null {
    const row = this.#db
      .prepare(`SELECT status FROM connection WHERE account_id = ? AND service = 'oura'`)
      .get(accountId) as { status: Connection["status"] } | undefined;
    if (!row) return "not-connected";
    return row.status === "connected" ? null : row.status;
  }

  /** How many of the account's Active pacts are judged from Oura. */
  #activeOuraPacts(accountId: AccountId): number {
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) AS n FROM pact WHERE owner_account_id = ? AND stage = 'active' AND evidence_kind = 'oura'`,
      )
      .get(accountId) as { n: number };
    return row.n;
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
    const pactName = this.#pactName(pactId);
    for (const reviewerId of this.#reviewersOf(pactId)) {
      this.#enqueue({
        recipient: reviewerId,
        kind: "review-item",
        channel: "push",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          pactId,
          title: `${ownerName} submitted evidence`,
          body: `${pactName} · ${formatDate(date)}`,
          url: APP_PATHS.review,
        },
      });
    }
  }

  /**
   * For each pact whose edit window has closed by `t` and whose reviewers
   * haven't been told: tells them they've been picked, then about any
   * evidence submitted in the window.
   */
  #closeEditWindows(t: Date): void {
    const pacts = this.#db
      .prepare(`SELECT * FROM pact WHERE reviewers_notified_at IS NULL AND created_at <= ? ORDER BY created_at, id`)
      .all(this.#editWindowCutoff(t)) as (PactRow & { owner_account_id: AccountId })[];
    for (const pact of pacts) {
      const ownerName = this.#accountName(pact.owner_account_id);
      const { schedule } = occurrenceTermsOf(pact);
      for (const reviewerId of this.#reviewersOf(pact.id)) {
        this.#enqueue({
          recipient: reviewerId,
          kind: "picked-as-reviewer",
          channel: "push",
          payload: {
            pactId: pact.id,
            title: `${ownerName} picked you as a reviewer`,
            body: `${pact.name} · ${scheduleText(schedule)} · ${money(pact.penalty_cents)} per miss`,
            url: APP_PATHS.review,
          },
        });
      }
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
        `SELECT payment.id, owner.name AS owner_name, recipient.name AS recipient_name, payment.amount_cents,
                payment.note, payment.photo_id, payment.recorded_at,
                MAX(0, (SELECT COALESCE(SUM(penalty.amount_cents), 0) FROM penalty
                        WHERE penalty.owner_account_id = payment.owner_account_id
                          AND penalty.recipient_id = payment.recipient_id AND NOT ${PENALTY_HELD})
                       - (SELECT COALESCE(SUM(approved.amount_cents), 0) FROM payment AS approved
                          WHERE approved.owner_account_id = payment.owner_account_id
                            AND approved.recipient_id = payment.recipient_id AND approved.decision = 'approved'))
                  AS owed_cents
         FROM payment
         JOIN account AS owner ON owner.id = payment.owner_account_id
         JOIN recipient ON recipient.id = payment.recipient_id
         WHERE payment.decision IS NULL AND ${MAY_DECIDE_PAYMENT}
         ORDER BY payment.recorded_at, payment.id`,
      )
      .all(reviewerId) as {
      id: string;
      owner_name: string;
      recipient_name: string;
      amount_cents: number;
      note: string | null;
      photo_id: string;
      recorded_at: string;
      owed_cents: number;
    }[];
    return rows.map((row) => ({
      kind: "payment",
      id: row.id,
      ownerName: row.owner_name,
      recipientName: row.recipient_name,
      amountCents: row.amount_cents,
      note: row.note,
      photoId: row.photo_id,
      recordedAt: new Date(row.recorded_at),
      owedCents: row.owed_cents,
      owedAfterApprovalCents: Math.max(0, row.owed_cents - row.amount_cents),
      thread: this.#thread(row.id, true),
    }));
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
  #decidePayment(payment: PaymentToDecide, { outcome, reason }: Decided, reviewerId: AccountId): void {
    this.#db
      .prepare(
        `UPDATE payment SET decision = ?, decided_by_account_id = ?, decided_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .run(outcome, reviewerId, this.#clock.now().toISOString(), reason, payment.id);
    const { amount_cents } = this.#db.prepare(`SELECT amount_cents FROM payment WHERE id = ?`).get(payment.id) as {
      amount_cents: number;
    };
    const paid = `${money(amount_cents)} to ${this.#recipientName(payment.recipient_id)}`;
    this.#enqueue({
      recipient: payment.owner_account_id,
      kind: "payment-decided",
      channel: "push",
      payload: {
        itemKind: "payment",
        itemId: payment.id,
        recipientId: payment.recipient_id,
        decision: outcome,
        ...(reason !== null && { reason }),
        title: `${this.#accountName(reviewerId)} ${outcome} your payment`,
        body: reason === null ? paid : `${paid} · “${reason}”`,
        url: APP_PATHS.ledger(payment.recipient_id),
      },
    });
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
    // Every pact's owner has a timezone: creating one needs it.
    if (pact.timezone === null) return false;
    return this.#occurrencesOf(pactId, pact.timezone)
      .dueAfter(pact.judged_through, t)
      .some((occurrence) => occurrence.date === date);
  }

  /** Whether `photoId` is a photo of some evidence and `accountId` owns or reviews its pact. */
  #mayViewEvidencePhoto(photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM evidence_photo
           JOIN evidence ON evidence.id = evidence_photo.evidence_id
           JOIN pact ON pact.id = evidence.pact_id
           WHERE evidence_photo.photo_id = ?
             AND (pact.owner_account_id = ?
                  OR EXISTS (SELECT 1 FROM pact_reviewer
                             WHERE pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?))`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /** Whether `photoId` is a photo of some excuse and `accountId` owns or reviews its pact. */
  #mayViewExcusePhoto(photoId: string, accountId: AccountId): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM excuse_photo
           JOIN excuse ON excuse.id = excuse_photo.excuse_id
           JOIN pact ON pact.id = excuse.pact_id
           WHERE excuse_photo.photo_id = ?
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
    const occurrences = this.#occurrencesOf(pactId, timezone);
    const occurrence = occurrences.openAt(at);
    // One-time evidence is for its one occurrence, whichever day it comes.
    const day = occurrence && isOneTime(row.schedule) ? occurrence.date : localDateOf(at, timezone);
    // Past its due-by time, the day takes no more evidence.
    if (!occurrence || at.getTime() >= occurrences.dayDueAt(localDateOf(at, timezone))!.getTime()) {
      return { ok: false, reason: "not-open" };
    }
    const decision = this.#evidenceDecision(pactId, day, "day");
    if (decision === "waiting") return { ok: false, reason: "evidence-waiting" };
    if (decision === "approved") return { ok: false, reason: "already-approved" };
    const weekly = (JSON.parse(row.schedule) as Schedule).kind === "weekly-count";
    if ((weekly && decision === "rejected") || this.#isJudged(pactId, occurrence.date)) {
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
    const payments = (
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
    return mergeByTime(
      waitingSince,
      "newest-first",
      this.#waitingChangeRequests(ownerId),
      this.#waitingEvidence(ownerId),
      this.#waitingExcuses(ownerId),
      payments,
    );
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

  /**
   * Alerts: occurrences Missed through a rejection, and rejected excuses,
   * until accepted or excused again, and reviewer questions until the owner
   * replies or the item is decided; newest first. To do:
   * pacts with an occurrence open now that still needs evidence. Missed:
   * other occurrences judged Missed in the last 48 hours and not accepted.
   * Coming up: pacts whose first
   * occurrence hasn't opened yet. A pact on a day it isn't due appears in
   * neither To do nor Coming up. Empty sections are left out.
   */
  #todayCards(ownerId: AccountId, timezone: string): { alerts: TodayAlert[]; sections: TodaySection[] } {
    const now = this.#clock.now();
    const toDo: (TodayToDoCard | TodayBillCard)[] = [];
    const automatic: TodayAutomaticCard[] = [];
    const noOuraData: TodayNoOuraDataCard[] = [];
    const comingUp: TodayComingUpCard[] = [];
    for (const pact of this.#activePacts(ownerId)) {
      // Each card shows the terms of the occurrence it's about.
      const cardOn = (date: LocalDate) => ({
        pactId: pact.id,
        name: pact.name,
        penaltyCents: this.#termsOn(pact.id, date).penalty_cents,
      });
      const { editWindowClosesAt } = pact;
      const { first, openAt, between, dayDueAt } = this.#occurrencesOf(pact.id, timezone);
      if (pact.terms.inBedBy) {
        if (now.getTime() < first.opensAt.getTime()) {
          comingUp.push({ ...cardOn(first.date), editWindowClosesAt, opensOn: first.date, startDate: pact.startDate });
          continue;
        }
        // Nights the owner needn't hear about: judged, or with an excuse filed (it's under Waiting for approval).
        const today = localDateOf(now, timezone);
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
          noOuraData.push({
            ...cardOn(lastNight.date),
            occurrenceDate: lastNight.date,
            closesAt: lastNight.closesAt,
            tonight: tonightCard ?? null,
          });
        } else if (tonightCard) {
          automatic.push({ ...cardOn(tonightCard.occurrenceDate), editWindowClosesAt, ...tonightCard });
        }
        continue;
      }
      const open = openAt(now);
      // Judged while still open: its evidence was rejected, so it's an alert, or
      // it's past its due-by time, so it's Missed. Past it and not judged yet,
      // the next tick judges it.
      if (open && (this.#isJudged(pact.id, open.date) || now.getTime() >= open.dueAt.getTime())) continue;
      if (open && pact.terms.schedule.kind === "weekly-count") {
        const today = localDateOf(now, timezone);
        const week = this.#weekToDo(pact.id, open, today, dayDueAt(today)!, now);
        if (week) toDo.push({ kind: "evidence", ...cardOn(open.date), editWindowClosesAt, ...week });
      } else if (open) {
        // Evidence waiting or approved: Waiting for approval, or done.
        const decision = this.#evidenceDecision(pact.id, open.date);
        if (decision === "waiting" || decision === "approved") continue;
        // An excuse waiting for today is under Waiting for approval; an approved one excuses it.
        if (this.#excuseOn(pact.id, open.date) !== null) continue;
        toDo.push({
          kind: "evidence",
          ...cardOn(open.date),
          editWindowClosesAt,
          occurrenceDate: open.date,
          dueAt: open.dueAt,
          dueBy: this.#termsOn(pact.id, open.date).due_by,
        });
      } else if (now.getTime() < first.opensAt.getTime()) {
        comingUp.push({ ...cardOn(first.date), editWindowClosesAt, opensOn: first.date, startDate: pact.startDate });
      }
    }
    const bills = this.#billsForToday(ownerId, now);
    toDo.push(...bills.cards);
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
    const alerts = [
      ...this.#rejectedEvidenceAlerts(ownerId),
      ...this.#rejectedDayAlerts(ownerId, timezone),
      ...this.#rejectedExcuseAlerts(ownerId, now),
      ...this.#questionAlerts(ownerId),
    ];
    const connectionProblem = this.#activeOuraPacts(ownerId) > 0 ? this.#ouraConnectionProblem(ownerId) : null;
    return {
      alerts: [
        ...(connectionProblem ? [{ kind: "oura-connection" as const, status: connectionProblem }] : []),
        ...bills.alerts,
        ...mergeByTime(({ at }) => at, "newest-first", alerts).map(({ alert }) => alert),
      ],
      sections,
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
  #rejectedDayAlerts(ownerId: AccountId, timezone: string): { at: Date; alert: TodayAlert }[] {
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
      const week = this.#occurrencesOf(row.id, timezone).covering(row.occurrence_date)!;
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
          excusableUntil: new Date(week.dueAt.getTime() + EXCUSE_WINDOW_MS),
          week: { dueAt: week.dueAt },
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
                occurrence.judged_at, occurrence.bedtime_start
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
      evidence_kind: PactTerms["evidenceKind"];
      schedule: string;
      amount_cents: number;
      date: LocalDate;
      judged_at: string;
      bedtime_start: string | null;
    }[];
    return rows.map((row) => {
      const weekly = (JSON.parse(row.schedule) as Schedule).kind === "weekly-count";
      const dueBy = row.date === today && !weekly ? this.#termsOn(row.id, row.date).due_by : null;
      return {
        pactId: row.id,
        name: row.name,
        penaltyCents: row.amount_cents,
        occurrenceDate: row.date,
        missedAt: new Date(row.judged_at),
        excusableUntil: new Date(new Date(row.judged_at).getTime() + EXCUSE_WINDOW_MS),
        ...(row.evidence_kind === "oura" && {
          night: { inBedAt: row.bedtime_start === null ? null : wallClock(row.bedtime_start).slice(11) },
        }),
        ...(dueBy !== null && { closed: { dueBy } }),
        ...(weekly && { week: this.#weekProgress(row.id, row.date) }),
      };
    });
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
                pact.penalty_cents, pact.first_occurrence, pact.created_at, recipient.name AS recipient_name
         FROM pact JOIN recipient ON recipient.id = pact.recipient_id
         WHERE pact.owner_account_id = ? AND pact.stage = 'active'
         ORDER BY pact.name, pact.created_at, pact.id`,
      )
      .all(ownerId) as (Pick<
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
    > & {
      recipient_name: string;
    })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      penaltyCents: row.penalty_cents,
      recipientName: row.recipient_name,
      terms: occurrenceTermsOf(row),
      startDate: row.start_date,
      editWindowClosesAt: editWindowClosesAt(row, now),
    }));
  }

  /** The recipients matching the SQL `condition` on `recipient`, sorted by name. */
  #selectRecipients(condition: string, ...params: string[]): Recipient[] {
    return this.#db
      .prepare(`SELECT id, name FROM recipient WHERE ${condition} ORDER BY name, id`)
      .all(...params) as Recipient[];
  }

  async advanceTo(t: Date): Promise<void> {
    // Before the transaction, never in it: a slow Oura can't hold up other writes.
    // An account whose call throws has no data this tick; the next one retries.
    const fetched = await this.#fetchSleep(t);
    await this.#command(
      () => {
        this.#closeEditWindows(t);
        this.#judgeDueBy(t);
        this.#markDisconnected(fetched);
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
   * the ring syncs), never one an approved excuse covers.
   */
  #remind(t: Date): DroppedReminder[] {
    const pacts = this.#db
      .prepare(
        `SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, pact.reminders, pact.reminded_through,
                pact.owner_account_id, account.timezone
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'active'
         ORDER BY pact.created_at, pact.id`,
      )
      .all() as (Pick<PactRow, "id" | "name" | "evidence_kind" | "schedule" | "reminders" | "reminded_through"> & {
      owner_account_id: AccountId;
      timezone: string | null;
    })[];
    const dropped: DroppedReminder[] = [];
    for (const pact of pacts) {
      const from = pact.reminded_through === null ? t : new Date(pact.reminded_through);
      if (from.getTime() >= t.getTime()) continue;
      this.#db.prepare(`UPDATE pact SET reminded_through = ? WHERE id = ?`).run(t.toISOString(), pact.id);
      const times = JSON.parse(pact.reminders) as string[];
      // Every pact's owner has a timezone: creating one needs it.
      if (times.length === 0 || pact.timezone === null) continue;
      const timezone = pact.timezone;
      const night = pact.evidence_kind === "oura";
      const occurrences = this.#occurrencesOf(pact.id, timezone);
      // A night's reminder can go off the morning after, so start a day early.
      const fromDate = addDays(localDateOf(from, timezone), -1);
      const toDate = localDateOf(t, timezone);
      // Each reminder that could go off, with the day it's about and when that
      // day's evidence is due: on Weekly count, every day of an open week. On
      // One-time each reminder has its own date, and they're all about the one occurrence.
      const due: { date: LocalDate; dueAt: Date; time: string; at: Date }[] = [];
      const schedule = JSON.parse(pact.schedule) as Schedule;
      if (schedule.kind === "one-time") {
        const { date, dueAt } = occurrences.first;
        due.push(...times.map((time) => ({ date, dueAt, time, at: oneTimeReminderAt(time, timezone) })));
      } else {
        const days: { date: LocalDate; dueAt: Date }[] = [];
        if (schedule.kind === "weekly-count") {
          for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
            const dueAt = occurrences.dayDueAt(date);
            if (dueAt) days.push({ date, dueAt });
          }
        } else {
          days.push(...occurrences.between(fromDate, toDate));
        }
        for (const { date, dueAt } of days) {
          due.push(...times.map((time) => ({ date, dueAt, time, at: reminderAt(date, time, timezone, night) })));
        }
      }
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
        channel: "push",
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
    const weekly = (JSON.parse(pact.schedule) as Schedule).kind === "weekly-count";
    const date = weekly ? mondayOf(day) : day;
    if (this.#excuseOn(pact.id, date) === "approved") return false;
    if (pact.evidence_kind === "oura") return true;
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
    const weekly = (JSON.parse(pact.schedule) as Schedule).kind === "weekly-count";
    const terms = this.#termsOn(pact.id, weekly ? mondayOf(date) : date);
    const due = terms.due_by === null ? "midnight" : clockText(terms.due_by);
    let body = `No photo yet today. Due at ${due}.`;
    if (pact.evidence_kind === "oura") body = `In bed by ${clockText(terms.in_bed_by!)} tonight.`;
    if (isOneTime(pact.schedule)) body = `No photo yet. Due ${formatDate(date)} at ${due}.`;
    if (weekly) {
      const { sessions, target } = this.#weekProgress(pact.id, mondayOf(date));
      body = `${sessions} of ${target} this week. Today's photo is due at ${due}.`;
    }
    this.#enqueue({
      recipient: pact.owner_account_id,
      kind: "reminder",
      channel: "push",
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

  /** Judges one Camera pact's occurrences due by `t`, from where judging got to. */
  #judgePactDueBy(pact: PactToJudge, t: Date): void {
    // Every pact's owner has a timezone: creating one needs it. Oura reports bedtime nights.
    if (pact.timezone === null || pact.evidence_kind !== "camera") return;
    const due = this.#occurrencesOf(pact.id, pact.timezone).dueAfter(pact.judged_through, t);
    for (const occurrence of due) this.#judgeAtDueTime(pact.id, occurrence);
    const last = due.at(-1);
    if (last) this.#db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(last.date, pact.id);
  }

  /**
   * Ends each Active pact whose end date has passed by `t`: at the start of
   * the next day, or once its last occurrence closes if that's later (a
   * bedtime night closes at 18:00 the next day). Judging has had its turn
   * first, so the last occurrence is judged unless its evidence still waits
   * for a decision, which judges it then.
   */
  #endPastEndDate(t: Date): void {
    const rows = this.#db
      .prepare(
        `SELECT pact.id, pact.end_date, account.timezone FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'active' AND pact.end_date IS NOT NULL
         ORDER BY pact.created_at, pact.id`,
      )
      .all() as { id: string; end_date: LocalDate; timezone: string | null }[];
    for (const { id, end_date: endDate, timezone } of rows) {
      // Every pact's owner has a timezone: creating one needs it.
      if (timezone === null) continue;
      const dayAfter = startOfDay(addDays(endDate, 1), timezone);
      const last = this.#occurrencesOf(id, timezone).between(addDays(endDate, -7), endDate).at(-1);
      const endsAt = last && last.closesAt.getTime() > dayAfter.getTime() ? last.closesAt : dayAfter;
      if (endsAt.getTime() > t.getTime()) continue;
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
      if (pact.evidence_kind !== "oura" || pact.timezone === null) continue;
      if (owner !== undefined && pact.owner_account_id !== owner) continue;
      const { timezone } = pact;
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
      if (this.#ouraConnectionProblem(pact.owner_account_id) !== null) continue;
      // Oura files a night's sleep under the day it ends, usually the day after;
      // a day more covers a sleep that ends late, whether Oura's end_date is inclusive or not.
      const range = ranges.get(pact.owner_account_id);
      const endDate = addDays(night.date, 2);
      ranges.set(pact.owner_account_id, {
        startDate: range && range.startDate < night.date ? range.startDate : night.date,
        endDate: range && range.endDate > endDate ? range.endDate : endDate,
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
   * Marks each connection Oura answered "disconnected" Needs reconnecting,
   * once: the owner gets one notification, and the Today and pact alerts
   * show until they reconnect. A connection made again since the call was
   * asked is left alone: its new tokens weren't the ones refused.
   */
  #markDisconnected({ disconnected, askedAt }: FetchedSleep): void {
    for (const account of disconnected) {
      const marked = this.#db
        .prepare(
          `UPDATE connection SET status = 'needs-reconnecting'
           WHERE account_id = ? AND service = 'oura' AND status = 'connected' AND connected_at <= ?`,
        )
        .run(account, askedAt.toISOString());
      if (marked.changes === 0) continue;
      this.#enqueue({
        recipient: account,
        kind: "connection-problem",
        channel: "push",
        payload: { title: "Oura needs reconnecting", body: RECONNECT_BEFORE_6PM, url: APP_PATHS.today },
      });
    }
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
      const fix = this.#ouraConnectionProblem(pact.owner_account_id) === null ? "Sync your ring" : "Reconnect Oura";
      this.#enqueue({
        recipient: pact.owner_account_id,
        kind: "connection-problem",
        channel: "push",
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
   * read on Oura's own clock: Kept if it starts before the in-bed-by time,
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
      const kept = period !== undefined && wallClock(period.bedtime_start) < deadlineWallClock(night.date, inBedBy);
      // As for a photo: an on-time bedtime beats an approved excuse, and an approved excuse beats a late one.
      // So with no period yet, an approved excuse waits for one until the night closes.
      if (excuse === "approved" && !kept && (period !== undefined || night.closesAt.getTime() <= t.getTime())) {
        this.#judge(pact.id, night.date, "excused", period ? t : night.closesAt);
      } else if (period) {
        this.#judge(pact.id, night.date, kept ? "kept" : "missed", t);
        this.#db
          .prepare(`UPDATE occurrence SET bedtime_start = ? WHERE pact_id = ? AND date = ?`)
          .run(period.bedtime_start, pact.id, night.date);
        if (!kept && excuse === null) this.#enqueueMissed(pact.id, night.date);
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
   * already judged it or its evidence is still waiting for one: Kept with
   * approved evidence, else Excused with an approved excuse, else Missed. A
   * Missed day on an excuse waiting for approval has its penalty held, and the
   * owner, who asked for it to be excused, isn't told it's Missed.
   */
  #judgeAtDueTime(pactId: string, occurrence: Occurrence): void {
    if (this.#isJudged(pactId, occurrence.date)) return;
    if (this.#isWeekly(pactId)) return this.#judgeWeek(pactId, occurrence, occurrence.dueAt, true);
    const decision = this.#evidenceDecision(pactId, occurrence.date);
    const excuse = this.#excuseOn(pactId, occurrence.date);
    if (decision !== "approved" && excuse === "approved") {
      return this.#judge(pactId, occurrence.date, "excused", occurrence.dueAt);
    }
    if (decision === "waiting") return;
    const outcome = decision === "approved" ? "kept" : "missed";
    this.#judge(pactId, occurrence.date, outcome, occurrence.dueAt);
    if (outcome === "missed" && excuse === null) this.#enqueueMissed(pactId, occurrence.date);
  }

  /**
   * Judges a Weekly count week at `at`, unless its evidence still waits for a
   * decision that could change it: Kept once enough days have approved
   * evidence, else Excused with an approved excuse, else Missed, with one
   * penalty per day short. `tell` the owner it's Missed, unless a decision
   * judged it (that told them) or they asked for it to be excused.
   */
  #judgeWeek(pactId: string, week: Occurrence, at: Date, tell: boolean): void {
    const { sessions, waiting, target } = this.#weekProgress(pactId, week.date);
    const excuse = this.#excuseOn(pactId, week.date);
    if (sessions >= target) return this.#judge(pactId, week.date, "kept", at);
    if (excuse === "approved") return this.#judge(pactId, week.date, "excused", at);
    if (waiting > 0) return;
    this.#judge(pactId, week.date, "missed", at);
    if (tell && excuse === null) this.#enqueueMissed(pactId, week.date);
  }

  /** How far the pact's Weekly count week starting `monday` has got: see `WeekProgress`. */
  #weekProgress(pactId: string, monday: LocalDate): WeekProgress {
    const schedule = JSON.parse(this.#termsOn(pactId, monday).schedule) as Schedule;
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
    return (JSON.parse(row.schedule) as Schedule).kind === "weekly-count";
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
    const schedule = JSON.parse(pact.schedule) as Schedule;
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
      channel: "push",
      payload: { pactId, occurrenceDate: date, title: `${pact.name} is Missed`, body, url: APP_PATHS.pact(pactId) },
    });
  }

  /** Whether the occurrence already has an outcome: Kept, Missed or Excused. */
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
  #judge(pactId: string, date: LocalDate, outcome: "kept" | "missed" | "excused", at: Date): void {
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
    // A One-time pact has no occurrence left once its one is judged.
    if (isOneTime(pact.schedule)) this.#endPact(pactId, at);
    if (outcome === "missed") {
      const schedule = JSON.parse(pact.schedule) as Schedule;
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
            channel: "push",
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

/** A friendship row's two account ids, in the order the table stores them. */
function friendshipPair(a: AccountId, b: AccountId): [AccountId, AccountId] {
  return a < b ? [a, b] : [b, a];
}

/** An Active pact as Today and the Pacts tab read it. */
interface ActivePact {
  id: string;
  name: string;
  penaltyCents: number;
  recipientName: string;
  terms: OccurrenceTerms;
  startDate: LocalDate | null;
  editWindowClosesAt: Date | null;
}

function editWindowEnd({ created_at }: Pick<PactRow, "created_at">): Date {
  return new Date(new Date(created_at).getTime() + EDIT_WINDOW_MS);
}

/** When a pact's edit window closes; null once it has, as of `now`. */
function editWindowClosesAt(pact: Pick<PactRow, "created_at">, now: Date): Date | null {
  const closesAt = editWindowEnd(pact);
  return now.getTime() < closesAt.getTime() ? closesAt : null;
}

/** A pact row's occurrence terms: the one place a stored schedule is read. */
function occurrenceTermsOf(
  row: Pick<PactRow, "schedule" | "first_occurrence"> & {
    in_bed_by?: string | null;
    due_by?: string | null;
    end_date?: string | null;
    created_at?: string;
  },
): OccurrenceTerms {
  return {
    schedule: JSON.parse(row.schedule) as Schedule,
    firstOccurrence: row.first_occurrence,
    inBedBy: row.in_bed_by ?? null,
    dueBy: row.due_by ?? null,
    endDate: row.end_date ?? null,
    createdAt: row.created_at === undefined ? null : new Date(row.created_at),
  };
}

/** Whether a stored schedule is One-time. Its kind never changes once the edit window has closed. */
function isOneTime(schedule: string): boolean {
  return (JSON.parse(schedule) as Schedule).kind === "one-time";
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
  return Number(timestamp.slice(11, 13)) >= 18 ? date : addDays(date, -1);
}

/** The night of `date`'s in-bed-by deadline as a wall-clock "YYYY-MM-DDTHH:MM". */
function deadlineWallClock(date: LocalDate, inBedBy: string): string {
  return `${Number(inBedBy.slice(0, 2)) >= 18 ? date : addDays(date, 1)}T${inBedBy}`;
}

/** A clock time "HH:MM" as it sorts in a night, which runs from 18:00 to 17:59 the next day. */
/**
 * Whether every reminder goes off before the due time `due` sets: a One-time
 * pact's deadline (`dueAt`), a bedtime's in-bed-by time (a night running from
 * 18:00), or else the due-by time, if there is one.
 */
function remindersGoOffInTime(
  reminders: string[],
  due: { oneTime: boolean; inBedBy: string | null; dueBy: string | null; dueAt: Date },
  timezone: string,
): boolean {
  return reminders.every((time) => {
    if (due.oneTime) return oneTimeReminderAt(time, timezone).getTime() < due.dueAt.getTime();
    if (due.inBedBy !== null) return nightOrder(time) < nightOrder(due.inBedBy);
    return due.dueBy === null || time < due.dueBy;
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

function nightOrder(time: string): string {
  return `${Number(time.slice(0, 2)) < 18 ? 1 : 0}${time}`;
}

/** "HH:MM" on a 24-hour clock. */
function isClockTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** A One-time pact's reminder: a date and a clock time, "YYYY-MM-DDTHH:MM". */
function isDatedReminder(text: string): boolean {
  const [date = "", time = ""] = text.split("T");
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
  evidence_kind: PactTerms["evidenceKind"];
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
}

/** The terms an occurrence follows: the pact's, as they stood when it opened. */
type DatedTerms = Pick<PactRow, "description" | "schedule" | "in_bed_by" | "due_by" | "penalty_cents" | "recipient_id">;

/** A change request as stored, with its pact's owner, their name and timezone. */
interface ChangeRequestRow {
  id: string;
  pact_id: string;
  ends_pact: 0 | 1;
  /** JSON ChangeableTerms. */
  before_terms: string;
  after_terms: string | null;
  note: string | null;
  requested_at: string;
  decision: ReviewOutcome | null;
  decided_by_account_id: AccountId | null;
  decided_at: string | null;
  reject_reason: string | null;
  withdrawn_at: string | null;
  owner_account_id: AccountId;
  owner_name: string;
  timezone: string | null;
}

/** A change request a reviewer is deciding on, as `decide` reads it. */
interface ChangeRequestToDecide {
  id: string;
  pact_id: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
}

/** A review item a reviewer may decide, as `decide` and `askOwner` read it. */
type ItemToDecide =
  | { kind: "evidence"; row: EvidenceToDecide }
  | { kind: "excuse"; row: ExcuseToDecide }
  | { kind: "payment"; row: PaymentToDecide }
  | { kind: "change-request"; row: ChangeRequestToDecide };

/** SQL: the columns `reviewStateOf` reads from `table`, joined to its deciding reviewer as `reviewer`. */
function reviewStateColumns(table: "evidence" | "payment"): string {
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
  const start = startDate !== null && startDate > from ? startDate : from;
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

/** A pact as judging reads it. */
/** What `#fetchSleep` got from Oura: sleep by account, the accounts it answered "disconnected" for, and when it was asked. */
interface FetchedSleep {
  sleep: Map<AccountId, OuraSleepPeriod[]>;
  disconnected: AccountId[];
  askedAt: Date;
}

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
 * payments haven't paid, covered or not. Bills are oldest first.
 */
function overdueOf(
  bills: BillState[],
  now: Date,
): { cents: number; billedOn: LocalDate | null; dueAt: Date | null; spellStartedAt: Date | null } {
  const pastDue = bills.filter((bill) => bill.dueAt.getTime() <= now.getTime());
  const overdue = pastDue.filter((bill) => bill.uncoveredCents > 0);
  return {
    cents: sum(overdue.map((bill) => bill.uncoveredCents)),
    billedOn: overdue[0]?.billedOn ?? null,
    dueAt: overdue[0]?.dueAt ?? null,
    spellStartedAt: overdue.length > 0 ? pastDue.find((bill) => bill.unpaidCents > 0)!.dueAt : null,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const BILL_CLOCK = `${String(BILL_TIME.hour).padStart(2, "0")}:${String(BILL_TIME.minute).padStart(2, "0")}`;

/** Wednesday `date` (or any day) at the bill time, in `timezone`. */
function billInstant(date: LocalDate, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToInstant(year, month, day, BILL_TIME.hour, BILL_TIME.minute, timezone);
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
interface Decided {
  outcome: ReviewOutcome;
  reason: string | null;
}

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
  channel: string;
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
