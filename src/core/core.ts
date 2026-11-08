// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.

import { randomUUID } from "node:crypto";
import { addDays } from "../shared/calendar.ts";
import { earlierDate, laterDate, localDateOf, mondayOf } from "./calendar.ts";
import {
  BILL_CLOCK,
  BILL_TERM_DAYS,
  billDays,
  billDueOf,
  billInstant,
  nextBillDay,
  overdueOf,
  type BillState,
} from "./bill-math.ts";
import { createContext, type CoreContext } from "./context.ts";
import { openDatabase, type Db } from "./db.ts";
import {
  hasSchedule,
  nightStartsAt,
  noOuraDataPushAt,
  oneTimeReminderAt,
  reminderAt,
  type Occurrence,
  type Occurrences,
} from "./occurrences.ts";
import { deadlineWallClock, nightOf, utcOffsetOf, wallClock } from "./oura-clock.ts";
import { endPastEndDate, enqueueMissed, judge, judgeDueBy, judgePactDueBy, noteAnkiResult } from "./judging.ts";
import {
  endedBedtimePacts,
  evidenceDecision,
  excuseCoversSql,
  excuseOn,
  isJudged,
  MISSED_THROUGH_REJECTION,
  pactsToJudge,
  rejection,
  WEEKLY_COUNT_PACT,
  weekProgress,
  type PactToJudge,
} from "./occurrence-state.ts";
import { deliverPending, enqueue, notificationSettings, settingIsOff, tellAll } from "./outbox.ts";
import {
  accountName,
  accountRow,
  ankiDeckList,
  ankiDeckMissing,
  ankiDeckName,
  ankiDeckOn,
  byName,
  connectionProblem,
  decisionDetails,
  editWindowCutoff,
  friendsSortedByName,
  hasConnection,
  lastAnkiCheck,
  mergeByTime,
  occurrencesOf,
  ouraOffset,
  ownerZone,
  pactName,
  recipientName,
  recordDecision,
  remindersOf,
  reviewersOf,
  reviewStateColumns,
  reviewStateOf,
  scheduleOf,
  scheduleTermsOf,
  termsOn,
  thread,
  waitingChangeRequests,
  type Decided,
  type PactClock,
  type PactRow,
  type ReviewOutcome,
  type ReviewStateRow,
} from "./rows.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import type {
  AnkiCountsResult,
  AnkiSource,
  Clock,
  Notifier,
  OuraSleepPeriod,
  OuraSource,
  Photo,
  PhotoStore,
} from "./ports.ts";
import { APP_PATHS } from "../shared/api.ts";
import { clockText, formatDate, money } from "../shared/format.ts";
import {
  RECONNECT_TEXT,
  type AcceptExcuseRejectionResult,
  type AcceptInviteResult,
  type AcceptMissResult,
  type AccountId,
  type AddRecipientResult,
  type AnkiDecksResult,
  type AskOwnerResult,
  type ChangePactResult,
  type ChangePreviewResult,
  type ChangeRequestResult,
  type Connection,
  type ConnectionService,
  type CreatePactResult,
  type DecideResult,
  type DeletePactResult,
  type EditPactResult,
  type EvidenceKind,
  type EvidenceResult,
  type ExcuseDates,
  type ExcuseOptionsResult,
  type ExcusePreviewResult,
  type ExcuseResult,
  type FileExcuseResult,
  type FirstOccurrenceResult,
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
  type MissedDetail,
  type NewExcuse,
  type NewPact,
  type NewPayment,
  type NewRecipient,
  type NotificationSetting,
  type NotificationSettingState,
  type PactChange,
  type PactResult,
  type PactSummary,
  type PactTiming,
  type PaymentResult,
  type PaymentView,
  type Profile,
  type PushDevice,
  type Recipient,
  type RecordPaymentRefusal,
  type RecordPaymentResult,
  type ReplyResult,
  type RequestEndResult,
  type ReviewDecision,
  type ReviewItem,
  type SavePushSubscriptionResult,
  type SetTimezoneResult,
  type SignInResult,
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
  type WithdrawChangeRequestResult,
} from "../shared/types.ts";
import {
  acceptInvite,
  accountIdForEmail,
  addRecipient,
  createInvite,
  emailKey,
  friendList,
  inviteLookup,
  inviteRow,
  recipientList,
  removePushSubscription,
  savePushSubscription,
  setNotificationSetting,
  setTimezone,
  signIn,
} from "./accounts.ts";
import {
  activePacts,
  closeEditWindows,
  createPact,
  deletePact,
  editPact,
  firstOccurrence,
  pactList,
  pactPage,
  waitingSince,
  type ActivePact,
} from "./pacts.ts";
import {
  approvableNow,
  changePact,
  changePreview,
  changeRequestPage,
  changeRequestRow,
  changeRequestsToReview,
  decideChangeRequest,
  requestEnd,
  waitingChangeRequestId,
  withdrawChangeRequest,
  type StoredChangeRequest,
} from "./change-requests.ts";
import {
  acceptMiss,
  decideEvidence,
  evidencePage,
  evidenceToReview,
  rejectedDayAlerts,
  rejectedEvidenceAlerts,
  submitEvidence,
  waitingEvidence,
  type EvidenceToDecide,
} from "./evidence.ts";
import {
  acceptExcuseRejection,
  decideExcuse,
  excuseOptions,
  excusePage,
  excusePreview,
  excusesToReview,
  fileExcuse,
  rejectedExcuseAlerts,
  waitingExcuses,
  type ExcuseToDecide,
} from "./excuses.ts";
import { ankiCheckOf, yesterdayEntries } from "./history.ts";

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

/** The core ignores a check of Oura now this soon after the account's last one. */
const OURA_CHECK_INTERVAL_MS = 15_000;
/** The core ignores a check of AnkiWeb now this soon after the account's last one. */
const ANKI_CHECK_INTERVAL_MS = 15_000;
/** While an account has an Anki day open and not judged, the scheduler checks AnkiWeb this often. */
const ANKI_POLL_INTERVAL_MS = 10 * 60 * 1000;
/** The push when a connection needs reconnecting, by service. */
const RECONNECT_PUSH: Record<ConnectionService, { title: string; body: string }> = {
  oura: { title: "Oura needs reconnecting", body: RECONNECT_TEXT.oura },
  anki: { title: "AnkiWeb needs reconnecting", body: RECONNECT_TEXT.anki },
};
/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How often an Overdue owner is reminded, and how often their reviewers are told. */
const OVERDUE_REMINDER_MS = DAY_MS;
const OVERDUE_REVIEWER_NOTICE_MS = 7 * DAY_MS;
/** A reminder the scheduler reaches later than this after its time, as after downtime, is dropped, not sent. */
const REMINDER_LATE_MS = 15 * 60 * 1000;
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
/** SQL: the `penalty` row is held: an excuse waiting for approval covers its occurrence. */
const PENALTY_HELD = excuseCoversSql("penalty.pact_id", "penalty.occurrence_date", "excuse.decision IS NULL");

class Core implements PactCore {
  readonly #ctx: CoreContext;
  readonly #notifier: Notifier;
  readonly #photoStore: PhotoStore;
  readonly #ouraSource: OuraSource;
  readonly #ankiSource: AnkiSource;
  readonly #operatorEmailKey: string;
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
    this.#ctx = createContext({
      db,
      clock: options.clock,
      newId: options.newId ?? randomUUID,
      log: options.log ?? ((line) => console.log(line)),
      enqueue: (notification) => enqueue(this.#ctx, notification),
    });
    this.#notifier = options.notifier;
    this.#photoStore = options.photoStore;
    this.#ouraSource = options.ouraSource;
    this.#ankiSource = options.ankiSource;
    this.#operatorEmailKey = emailKey(options.operatorEmail);
  }

  /**
   * Runs `change` as one transaction: all of it commits or none of it does.
   * Then runs `afterCommit` and starts delivering the outbox, without waiting:
   * a slow push service never holds up the person who tapped. A delivery failure
   * doesn't fail the command; the notification waits for the next attempt.
   */
  async #command<T>(change: () => T, afterCommit?: (result: T) => void): Promise<T> {
    const result = this.#ctx.db.transaction(change).immediate();
    afterCommit?.(result);
    void this.#deliverOutbox();
    return result;
  }

  #deliverOutbox(): Promise<void> {
    this.#delivery = this.#delivery
      .then(() => deliverPending(this.#ctx, this.#notifier))
      .catch((error: unknown) => this.#ctx.log(`outbox delivery stopped, will retry: ${String(error)}`));
    return this.#delivery;
  }

  signIn(identity: { email: string; name: string }, options: { inviteToken?: string } = {}): Promise<SignInResult> {
    return this.#command(() => signIn(this.#ctx, this.#operatorEmailKey, identity, options));
  }

  invite(token: string): InviteLookup {
    return inviteLookup(this.#ctx, inviteRow(this.#ctx, token), null);
  }

  accountIdForEmail(email: string): AccountId | null {
    return accountIdForEmail(this.#ctx, email);
  }

  as(accountId: AccountId): AccountView {
    const account = () => accountRow(this.#ctx, accountId);
    return {
      setTimezone: (timezone) => this.#command(() => setTimezone(this.#ctx, accountId, timezone)),
      createInvite: () => this.#command(() => createInvite(this.#ctx, accountId)),
      invite: (token) => {
        account();
        return inviteLookup(this.#ctx, inviteRow(this.#ctx, token), accountId);
      },
      acceptInvite: (token) => this.#command(() => acceptInvite(this.#ctx, accountId, token)),
      friends: () => friendList(this.#ctx, accountId),
      addRecipient: (recipient) => this.#command(() => addRecipient(this.#ctx, accountId, recipient)),
      recipients: () => recipientList(this.#ctx, accountId),
      createPact: (pact) => this.#command(() => createPact(this.#ctx, accountId, pact)),
      editPact: (pactId, pact) => this.#command(() => editPact(this.#ctx, accountId, pactId, pact)),
      deletePact: (pactId) => this.#command(() => deletePact(this.#ctx, accountId, pactId)),
      firstOccurrence: (timing, editing) => firstOccurrence(this.#ctx, accountId, timing, editing),
      pacts: () => pactList(this.#ctx, accountId),
      pact: (pactId) => pactPage(this.#ctx, accountId, pactId),
      changePreview: (pactId, change) => changePreview(this.#ctx, accountId, pactId, change),
      changePact: (pactId, change) => this.#command(() => changePact(this.#ctx, accountId, pactId, change)),
      requestEnd: (pactId, note) => this.#command(() => requestEnd(this.#ctx, accountId, pactId, note)),
      changeRequest: (changeRequestId) => changeRequestPage(this.#ctx, accountId, changeRequestId),
      withdrawChangeRequest: (changeRequestId) =>
        this.#command(() => withdrawChangeRequest(this.#ctx, accountId, changeRequestId)),
      profile: () => {
        const { email, name, timezone } = account();
        const connections = this.#ctx
          .all<{ service: ConnectionService; status: Connection["status"]; connected_at: string }>(
            `SELECT service, status, connected_at FROM connection WHERE account_id = ? ORDER BY service`,
            accountId,
          )
          .map((row): Connection => ({
            service: row.service,
            status: row.status,
            connectedAt: new Date(row.connected_at),
            activePacts: this.#activePactsUsing(accountId, row.service),
          }));
        return { email, name, timezone, connections };
      },
      checkOura: async () => {
        account();
        const now = this.#ctx.clock.now();
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
        if (!hasConnection(this.#ctx, accountId, "anki")) return { ok: false, reason: "not-connected" };
        const askedAt = this.#ctx.clock.now();
        let result;
        try {
          result = await this.#ankiSource.decks(accountId);
        } catch (error) {
          this.#ctx.log(`AnkiWeb deck list for account ${accountId} failed: ${errorText(error)}`);
          return { ok: false, reason: "unreachable" };
        }
        if (!result.ok) {
          await this.#command(() => this.#markDisconnected("anki", accountId, askedAt));
          return result;
        }
        const { decks, rolloverHour } = result;
        await this.#command(() => {
          this.#ctx.db
            .prepare(
              `INSERT INTO anki_deck_list (account_id, decks, rollover_hour, fetched_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (account_id) DO UPDATE SET decks = excluded.decks, rollover_hour = excluded.rollover_hour,
                 fetched_at = excluded.fetched_at`,
            )
            .run(accountId, JSON.stringify(decks), rolloverHour, this.#ctx.clock.now().toISOString());
        });
        return { ok: true, decks, rolloverHour };
      },
      checkAnki: async () => {
        account();
        const now = this.#ctx.clock.now();
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
        const hasPacts =
          this.#ctx.db.prepare(`SELECT 1 FROM pact WHERE owner_account_id = ?`).get(accountId) !== undefined;
        const yesterday = timezone === null ? [] : yesterdayEntries(this.#ctx, accountId, timezone);
        return { hasPacts, alerts, sections, waiting: this.#waiting(accountId), yesterday };
      },
      notificationSettings: () => {
        account();
        return notificationSettings(this.#ctx, accountId);
      },
      setNotificationSetting: (setting, enabled) =>
        this.#command(() => setNotificationSetting(this.#ctx, accountId, setting, enabled)),
      savePushSubscription: (device) => this.#command(() => savePushSubscription(this.#ctx, accountId, device)),
      removePushSubscription: (endpoint) => this.#command(() => removePushSubscription(this.#ctx, accountId, endpoint)),
      submitEvidence: (pactId, photos) =>
        submitEvidence(this.#ctx, accountId, pactId, photos, this.#photoStore, (change) => this.#command(change)),
      acceptMiss: (pactId, occurrenceDate) =>
        this.#command(() => acceptMiss(this.#ctx, accountId, pactId, occurrenceDate)),
      excusePreview: (pactId, dates) => {
        const { timezone } = account();
        return excusePreview(this.#ctx, accountId, timezone, pactId, dates, this.#ctx.clock.now());
      },
      excuseOptions: (pactId) => excuseOptions(this.#ctx, accountId, pactId),
      fileExcuse: (pactId, excuse, photos) =>
        fileExcuse(this.#ctx, accountId, pactId, excuse, photos, this.#photoStore, (change) => this.#command(change)),
      excuse: (excuseId) => excusePage(this.#ctx, accountId, excuseId),
      acceptExcuseRejection: (excuseId) => this.#command(() => acceptExcuseRejection(this.#ctx, accountId, excuseId)),
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
          const paymentId = this.#ctx.newId();
          this.#ctx.db
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
              this.#ctx.clock.now().toISOString(),
            );
          tellAll(this.#ctx, this.#paymentReviewers(accountId, payment.recipientId), "review-item", {
            itemKind: "payment",
            itemId: paymentId,
            recipientId: payment.recipientId,
            title: `${ownerName} recorded a payment`,
            body: `${money(payment.amountCents)} to ${recipientName(this.#ctx, payment.recipientId)}`,
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
      evidence: (evidenceId) => evidencePage(this.#ctx, accountId, evidenceId),
      payment: (paymentId) => {
        account();
        const row = this.#ctx.one<ReviewStateRow & PaymentViewRow & { recipient_id: string }>(
          `SELECT payment.id, payment.recipient_id, recipient.name AS recipient_name, payment.amount_cents,
                    payment.note, payment.photo_id, payment.recorded_at, ${reviewStateColumns("payment")}
             FROM payment
             JOIN recipient ON recipient.id = payment.recipient_id
             LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
             WHERE payment.id = ? AND payment.owner_account_id = ?`,
          paymentId,
          accountId,
        );
        if (!row) return { ok: false, reason: "payment-not-found" };
        return {
          ok: true,
          payment: {
            ...paymentView(row),
            recipientId: row.recipient_id,
            state: reviewStateOf(row),
            reviewerNames: friendsSortedByName(this.#ctx, this.#paymentReviewers(accountId, row.recipient_id)).map(
              (friend) => friend.name,
            ),
            thread: thread(this.#ctx, row.id, row.decision === null),
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
          this.#ctx.enqueue({
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
          if (!thread(this.#ctx, itemId, true).waitingOnReply) return { ok: false, reason: "no-question" };
          const text = reply.trim();
          if (text === "") return { ok: false, reason: "blank-reply" };
          this.#addComment(itemId, accountId, true, text);
          tellAll(this.#ctx, item.reviewerIds, "owner-replied", {
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
              decideEvidence(this.#ctx, item.row, decided, accountId);
              break;
            case "excuse":
              decideExcuse(this.#ctx, item.row, decided, accountId);
              break;
            case "payment":
              this.#decidePayment(item.row, decided, accountId);
              break;
            case "change-request":
              if (decided.outcome === "approved") {
                // Judging catches up on the pact first, as the scheduler would have: a change never
                // rescues an occurrence already due. Judging may End it, which withdraws the request.
                const [pact] = pactsToJudge(this.#ctx, item.row.pact_id);
                judgePactDueBy(this.#ctx, pact!, this.#ctx.clock.now(), this.#ankiChecksRunning);
                if (waitingChangeRequestId(this.#ctx, item.row.pact_id) !== item.row.id) {
                  return { ok: false, reason: "item-not-found" };
                }
              }
              if (decided.outcome === "approved" && !approvableNow(this.#ctx, item.row)) {
                return { ok: false, reason: "deadline-too-soon" };
              }
              decideChangeRequest(this.#ctx, item.row, decided, accountId);
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
    const evidence = this.#ctx.one<EvidenceToDecide>(
      `SELECT evidence.id, evidence.pact_id, evidence.occurrence_date, evidence.day, evidence.decision,
                  pact.owner_account_id, owner.timezone
           FROM evidence
           JOIN pact ON pact.id = evidence.pact_id
           JOIN account AS owner ON owner.id = pact.owner_account_id
           JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
           WHERE evidence.id = ? AND pact.created_at <= ?`,
      reviewerId,
      itemId,
      editWindowCutoff(this.#ctx),
    );
    if (evidence) return { kind: "evidence", row: evidence };
    const excuse = this.#ctx.one<ExcuseToDecide>(
      `SELECT excuse.id, excuse.pact_id, excuse.decision, pact.owner_account_id
         FROM excuse
         JOIN pact ON pact.id = excuse.pact_id
         JOIN pact_reviewer ON pact_reviewer.pact_id = pact.id AND pact_reviewer.reviewer_account_id = ?
         WHERE excuse.id = ?`,
      reviewerId,
      itemId,
    );
    if (excuse) return { kind: "excuse", row: excuse };
    const payment = this.#paymentToDecide(reviewerId, itemId);
    if (payment) return { kind: "payment", row: payment };
    const mayDecideRequest =
      this.#ctx.db
        .prepare(
          `SELECT 1 FROM change_request
           JOIN pact ON pact.id = change_request.pact_id
           JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                             AND pact_reviewer.reviewer_account_id = ?
           WHERE change_request.id = ? AND change_request.withdrawn_at IS NULL AND pact.stage = 'active'`,
        )
        .get(reviewerId, itemId) !== undefined;
    const changeRequest = mayDecideRequest ? changeRequestRow(this.#ctx, itemId) : undefined;
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
      this.#ctx.one<{ pact_id: string; decision: ReviewOutcome | null }>(
        `SELECT ${table}.pact_id, ${table}.decision FROM ${table}
           JOIN pact ON pact.id = ${table}.pact_id
           WHERE ${table}.id = ? AND pact.owner_account_id = ?`,
        itemId,
        ownerId,
      );
    for (const kind of ["evidence", "excuse"] as const) {
      const row = ofPact(kind);
      if (row) return { kind, waiting: row.decision === null, reviewerIds: reviewersOf(this.#ctx, row.pact_id) };
    }
    const payment = this.#ctx.one<{ recipient_id: string; decision: ReviewOutcome | null }>(
      `SELECT recipient_id, decision FROM payment WHERE id = ? AND owner_account_id = ?`,
      itemId,
      ownerId,
    );
    if (payment) {
      return {
        kind: "payment",
        waiting: payment.decision === null,
        reviewerIds: this.#paymentReviewers(ownerId, payment.recipient_id),
      };
    }
    const request = changeRequestRow(this.#ctx, itemId);
    if (request && request.owner_account_id === ownerId) {
      return {
        kind: "change-request",
        waiting: request.decision === null && request.withdrawn_at === null,
        reviewerIds: reviewersOf(this.#ctx, request.pact_id),
      };
    }
    return undefined;
  }

  /** How a notification names a review item after "your" or "their": "evidence for Gym", "$10 payment to Sam". */
  #itemWhat(kind: ReviewItem["kind"], itemId: string): string {
    switch (kind) {
      case "evidence":
      case "excuse": {
        const { name } = this.#ctx.db
          .prepare(`SELECT pact.name FROM ${kind} JOIN pact ON pact.id = ${kind}.pact_id WHERE ${kind}.id = ?`)
          .get(itemId) as { name: string };
        return `${kind} for ${name}`;
      }
      case "payment": {
        const { amount_cents, recipient_id } = this.#ctx.db
          .prepare(`SELECT amount_cents, recipient_id FROM payment WHERE id = ?`)
          .get(itemId) as { amount_cents: number; recipient_id: string };
        return `${money(amount_cents)} payment to ${recipientName(this.#ctx, recipient_id)}`;
      }
      case "change-request": {
        const row = changeRequestRow(this.#ctx, itemId)!;
        const name = pactName(this.#ctx, row.pact_id);
        return row.request.kind === "end" ? `request to end ${name}` : `change to ${name}`;
      }
    }
  }

  /** Adds a question (a reviewer's) or a reply (the owner's) to an item's thread. */
  #addComment(itemId: string, authorId: AccountId, fromOwner: boolean, text: string): void {
    this.#ctx.db
      .prepare(`INSERT INTO comment (item_id, author_account_id, from_owner, text, sent_at) VALUES (?, ?, ?, ?, ?)`)
      .run(itemId, authorId, fromOwner ? 1 : 0, text, this.#ctx.clock.now().toISOString());
  }

  /**
   * Alerts for the owner's items still waiting for a decision whose latest
   * comment is a reviewer's question, with when it was asked.
   */
  #questionAlerts(ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
    return this.#waiting(ownerId).flatMap((item) => {
      const { comments, waitingOnReply } = thread(this.#ctx, item.id, true);
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
    // Change requests first: one waiting holds up any other change to its pact.
    return [
      ...changeRequestsToReview(this.#ctx, reviewerId),
      ...mergeByTime(
        reviewItemSince,
        "oldest-first",
        evidenceToReview(this.#ctx, reviewerId),
        excusesToReview(this.#ctx, reviewerId),
        this.#paymentsToReview(reviewerId),
      ),
    ];
  }

  /** The owner's penalties for `recipientId`, newest first, each with what's paid and the bill it's on or will make. */
  #ledgerPenalties(ownerId: AccountId, recipientId: string, timezone: string | null): LedgerPenalty[] {
    const penaltyRows = this.#ctx.all<{
      id: string;
      pact_id: string;
      pact_name: string;
      occurrence_date: string;
      amount_cents: number;
      added_at: string;
      bill_id: string | null;
      held: 0 | 1;
      weekly: 0 | 1;
    }>(
      `SELECT penalty.id, penalty.pact_id, pact.name AS pact_name, penalty.occurrence_date,
                penalty.amount_cents, penalty.added_at, penalty.bill_id, ${PENALTY_HELD} AS held,
                ${WEEKLY_COUNT_PACT} AS weekly
         FROM penalty JOIN pact ON pact.id = penalty.pact_id
         WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ?
         ORDER BY penalty.added_at DESC, penalty.occurrence_date DESC, pact.name, penalty.id`,
      ownerId,
      recipientId,
    );
    const allocation = this.#allocate(ownerId, recipientId);
    const bills = this.#billsOf(ownerId, recipientId);
    return penaltyRows.map((row): LedgerPenalty => {
      const held = row.held === 1;
      // Missed with evidence means all of it was rejected, on Fixed days; a short week is its own miss.
      const rejected = row.weekly === 1 ? null : rejection(this.#ctx, row.pact_id, row.occurrence_date);
      const bill = bills.find((b) => b.id === row.bill_id);
      return {
        kind: "penalty",
        penaltyId: row.id,
        pactId: row.pact_id,
        pactName: row.pact_name,
        occurrenceDate: row.occurrence_date,
        amountCents: row.amount_cents,
        ...(row.weekly === 1 && { week: weekProgress(this.#ctx, row.pact_id, row.occurrence_date) }),
        addedAt: new Date(row.added_at),
        paidCents: allocation.get(row.id)?.paidCents ?? 0,
        ...(rejected && { rejection: rejected }),
        held,
        bill: bill
          ? { kind: "on-bill", billedOn: bill.billedOn, dueAt: bill.dueAt }
          : {
              // A rejected excuse releases it to the next bill it can make, as if it had never been held.
              kind: held ? "if-excuse-rejected" : "next-bill",
              billedOn: nextBillDay(new Date(row.added_at), this.#ctx.clock.now(), ownerZone(timezone, ownerId)),
            },
      };
    });
  }

  /**
   * The owner's ledgers, sorted by name: one per recipient a pact names or a
   * penalty went to. Just the one for `recipientId`, if given.
   */
  #ledgerSummaries(ownerId: AccountId, recipientId?: string): LedgerSummary[] {
    const rows = this.#ctx.all<{
      id: string;
      name: string;
      penalty_cents: number;
      paid_cents: number;
      awaiting_cents: number;
      awaiting_count: number;
    }>(
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
      ownerId,
      recipientId ?? null,
      recipientId ?? null,
    );
    const now = this.#ctx.clock.now();
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
    const totals = this.#ctx.db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE decision = 'approved'), 0) AS approved,
                COALESCE(SUM(amount_cents) FILTER (WHERE decision IS NULL), 0) AS awaiting
         FROM payment WHERE owner_account_id = ? AND recipient_id = ?`,
      )
      .get(ownerId, recipientId) as { approved: number; awaiting: number };
    const rows = this.#ctx.all<{ id: string; amount_cents: number }>(
      `SELECT penalty.id, penalty.amount_cents FROM penalty JOIN pact ON pact.id = penalty.pact_id
         LEFT JOIN bill ON bill.id = penalty.bill_id
         WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ? AND NOT ${PENALTY_HELD}
         ORDER BY bill.id IS NULL, bill.created_at, bill.id,
                  penalty.added_at, penalty.occurrence_date, pact.name DESC, penalty.id DESC`,
      ownerId,
      recipientId,
    );
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
    const bills = this.#ctx.all<{ id: string; billed_on: LocalDate; due_at: string }>(
      `SELECT id, billed_on, due_at FROM bill WHERE owner_account_id = ? AND recipient_id = ?
         ORDER BY created_at, id`,
      ownerId,
      recipientId,
    );
    return bills.map((bill) => {
      const penalties = this.#ctx.all<{
        id: string;
        amount_cents: number;
      }>(`SELECT id, amount_cents FROM penalty WHERE bill_id = ?`, bill.id);
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
    const accounts = this.#ctx.all<{
      id: AccountId;
      timezone: string;
      created_at: string;
      billed_through: string | null;
    }>(`SELECT id, timezone, created_at, billed_through FROM account WHERE timezone IS NOT NULL
                ORDER BY created_at, id`);
    for (const account of accounts) {
      const from = new Date(account.billed_through ?? account.created_at);
      if (from.getTime() >= t.getTime()) continue;
      for (const wednesday of billDays(from, t, account.timezone)) {
        this.#billOwner(account.id, wednesday, account.timezone);
      }
      this.#ctx.db.prepare(`UPDATE account SET billed_through = ? WHERE id = ?`).run(t.toISOString(), account.id);
    }
  }

  #billOwner(ownerId: AccountId, wednesday: LocalDate, timezone: string): void {
    const createdAt = billInstant(wednesday, timezone);
    const dueAt = billInstant(addDays(wednesday, BILL_TERM_DAYS), timezone);
    const excusableAfter = new Date(createdAt.getTime() - EXCUSE_WINDOW_MS).toISOString();
    const recipients = this.#ctx.all<{ recipient_id: string }>(
      `SELECT DISTINCT penalty.recipient_id FROM penalty
         WHERE penalty.owner_account_id = ? AND penalty.bill_id IS NULL AND penalty.added_at <= ?
           AND NOT ${PENALTY_HELD}
         ORDER BY penalty.recipient_id`,
      ownerId,
      excusableAfter,
    );
    for (const { recipient_id: recipientId } of recipients) {
      const billId = this.#ctx.newId();
      this.#ctx.db
        .prepare(
          `INSERT INTO bill (id, owner_account_id, recipient_id, billed_on, created_at, due_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(billId, ownerId, recipientId, wednesday, createdAt.toISOString(), dueAt.toISOString());
      this.#ctx.db
        .prepare(
          `UPDATE penalty SET bill_id = ?
           WHERE owner_account_id = ? AND recipient_id = ? AND bill_id IS NULL AND added_at <= ?
             AND NOT ${PENALTY_HELD}`,
        )
        .run(billId, ownerId, recipientId, excusableAfter);
      const bill = this.#billsOf(ownerId, recipientId).find((b) => b.id === billId)!;
      if (bill.unpaidCents === 0) continue;
      this.#ctx.enqueue({
        recipient: ownerId,
        kind: "new-bill",
        payload: {
          recipientId,
          title: `New bill: ${money(bill.unpaidCents)} to ${recipientName(this.#ctx, recipientId)}`,
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
    const ledgers = this.#ctx.all<{ owner_account_id: AccountId; recipient_id: string; owner_name: string }>(
      `SELECT DISTINCT bill.owner_account_id, bill.recipient_id, account.name AS owner_name
         FROM bill JOIN account ON account.id = bill.owner_account_id
         WHERE bill.due_at <= ?
         ORDER BY bill.owner_account_id, bill.recipient_id`,
      t.toISOString(),
    );
    for (const { owner_account_id: ownerId, recipient_id: recipientId, owner_name: ownerName } of ledgers) {
      const overdue = overdueOf(this.#billsOf(ownerId, recipientId), t);
      if (overdue === null) continue;
      const notice = this.#overdueNotice(ownerId, recipientId, overdue.spellStartedAt);
      const since = (at: Date | null) => (at === null ? Infinity : t.getTime() - at.getTime());
      const name = recipientName(this.#ctx, recipientId);
      const remind = since(notice.ownerRemindedAt) >= OVERDUE_REMINDER_MS;
      const tell = since(notice.reviewersToldAt) >= OVERDUE_REVIEWER_NOTICE_MS;
      if (remind) {
        this.#ctx.enqueue({
          recipient: ownerId,
          kind: "overdue-bill",
          payload: {
            recipientId,
            title: `${money(overdue.cents)} overdue to ${name}`,
            body: `Your ${formatDate(overdue.billedOn)} bill was due ${formatDate(localDateOf(overdue.dueAt, this.#timezoneOf(ownerId)))}. Record your payment.`,
            url: APP_PATHS.ledger(recipientId),
          },
        });
      }
      if (tell) {
        for (const reviewerId of this.#paymentReviewers(ownerId, recipientId)) {
          this.#ctx.enqueue({
            recipient: reviewerId,
            kind: "overdue-bill",
            payload: {
              recipientId,
              title: `${ownerName} is overdue`,
              body: `${money(overdue.cents)} to ${name}, due ${formatDate(localDateOf(overdue.dueAt, this.#timezoneOf(ownerId)))}`,
              url: APP_PATHS.today,
            },
          });
        }
      }
      if (remind || tell) {
        this.#ctx.db
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
    const row = this.#ctx.one<{ owner_reminded_at: string | null; reviewers_told_at: string | null }>(
      `SELECT owner_reminded_at, reviewers_told_at FROM overdue_notice
         WHERE owner_account_id = ? AND recipient_id = ?`,
      ownerId,
      recipientId,
    );
    const ifThisSpell = (at: string | null | undefined) =>
      at === null || at === undefined || new Date(at).getTime() < spellStartedAt.getTime() ? null : new Date(at);
    return {
      ownerRemindedAt: ifThisSpell(row?.owner_reminded_at),
      reviewersToldAt: ifThisSpell(row?.reviewers_told_at),
    };
  }

  #timezoneOf(accountId: AccountId): string {
    const row = this.#ctx.db.prepare(`SELECT timezone FROM account WHERE id = ?`).get(accountId) as {
      timezone: string | null;
    };
    return ownerZone(row.timezone, accountId);
  }

  /** Today's bill cards and overdue alerts: one of each at most per recipient. */
  #billsForToday(ownerId: AccountId, now: Date): { cards: TodayBillCard[]; alerts: TodayAlert[] } {
    const cards: TodayBillCard[] = [];
    const alerts: TodayAlert[] = [];
    const recipients = this.#ctx.all<Recipient>(
      `SELECT DISTINCT recipient.id, recipient.name FROM bill
         JOIN recipient ON recipient.id = bill.recipient_id
         WHERE bill.owner_account_id = ?`,
      ownerId,
    );
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
            ? friendsSortedByName(
                this.#ctx,
                this.#paymentReviewers(ownerId, recipientId).filter(
                  (id) => !settingIsOff(this.#ctx, id, "overdue-bill"),
                ),
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
    const rows = this.#ctx.all<
      ReviewStateRow & {
        id: string;
        amount_cents: number;
        note: string | null;
        recorded_at: string;
      }
    >(
      `SELECT payment.id, payment.amount_cents, payment.note, payment.recorded_at, ${reviewStateColumns("payment")}
         FROM payment LEFT JOIN account AS reviewer ON reviewer.id = payment.decided_by_account_id
         WHERE payment.owner_account_id = ? AND payment.recipient_id = ?
         ORDER BY payment.recorded_at DESC, payment.id`,
      ownerId,
      recipientId,
    );
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
    const isOwnRecipient = this.#ctx.db
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
   * Keeps, for each account in `sleep`, the latest bedtime_start Oura has
   * reported with a UTC offset, by when it happened: Oura's clock where the
   * owner is now, for `ouraOffset`. Deleted periods don't count.
   */
  #noteOuraClock(sleep: Map<AccountId, OuraSleepPeriod[]>): void {
    for (const [account, periods] of sleep) {
      const row = this.#ctx.one<{ oura_latest_bedtime_start: string | null }>(
        `SELECT oura_latest_bedtime_start FROM account WHERE id = ?`,
        account,
      );
      let latest = row?.oura_latest_bedtime_start ?? null;
      for (const { type, bedtime_start: start } of periods) {
        if (type === "deleted" || utcOffsetOf(start) === null) continue;
        if (latest === null || Date.parse(start) > Date.parse(latest)) latest = start;
      }
      if (latest === null || latest === row?.oura_latest_bedtime_start) continue;
      this.#ctx.db.prepare(`UPDATE account SET oura_latest_bedtime_start = ? WHERE id = ?`).run(latest, account);
    }
  }

  /** How many of the account's Active pacts are judged from `service`. */
  #activePactsUsing(accountId: AccountId, service: ConnectionService): number {
    // Each service supplies the evidence kind of the same name (SERVICE_OF_KIND).
    const row = this.#ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM pact WHERE owner_account_id = ? AND stage = 'active' AND evidence_kind = ?`)
      .get(accountId, service) as { n: number };
    return row.n;
  }

  /** Connects the account to `service`, or marks a connection that needs reconnecting connected again. */
  #connect(accountId: AccountId, service: ConnectionService): void {
    this.#ctx.db
      .prepare(
        `INSERT INTO connection (account_id, service, status, connected_at) VALUES (?, ?, 'connected', ?)
         ON CONFLICT (account_id, service) DO UPDATE SET status = 'connected', connected_at = excluded.connected_at`,
      )
      .run(accountId, service, this.#ctx.clock.now().toISOString());
  }

  #disconnect(accountId: AccountId, service: ConnectionService): void {
    this.#ctx.db.prepare(`DELETE FROM connection WHERE account_id = ? AND service = ?`).run(accountId, service);
  }

  /** Payments awaiting approval that `reviewerId` may decide, oldest recorded first. */
  #paymentsToReview(reviewerId: AccountId): ReviewItem[] {
    const rows = this.#ctx.all<
      PaymentViewRow & {
        owner_account_id: AccountId;
        recipient_id: string;
        owner_name: string;
      }
    >(
      `SELECT payment.id, payment.owner_account_id, payment.recipient_id, owner.name AS owner_name,
                recipient.name AS recipient_name, payment.amount_cents, payment.note, payment.photo_id,
                payment.recorded_at
         FROM payment
         JOIN account AS owner ON owner.id = payment.owner_account_id
         JOIN recipient ON recipient.id = payment.recipient_id
         WHERE payment.decision IS NULL AND ${MAY_DECIDE_PAYMENT}
         ORDER BY payment.recorded_at, payment.id`,
      reviewerId,
    );
    return rows.map((row): ReviewItem => {
      const owedCents = this.#ledgerSummaries(row.owner_account_id, row.recipient_id)[0]?.owedCents ?? 0;
      return {
        kind: "payment",
        ...paymentView(row),
        ownerName: row.owner_name,
        owedCents,
        owedAfterApprovalCents: Math.max(0, owedCents - row.amount_cents),
        thread: thread(this.#ctx, row.id, true),
      };
    });
  }

  /** Who reviews payments from `ownerId` to `recipientId`, each once. */
  #paymentReviewers(ownerId: AccountId, recipientId: string): AccountId[] {
    return this.#ctx
      .all<{ reviewer_account_id: AccountId }>(
        `SELECT DISTINCT reviewer_account_id FROM (${paymentReviewersSql("@owner", "@recipient")})
           ORDER BY reviewer_account_id`,
        { owner: ownerId, recipient: recipientId },
      )
      .map((row) => row.reviewer_account_id);
  }

  /**
   * The payment `itemId`, if `reviewerId` may decide it: they review any of
   * the owner's pacts with its recipient.
   */
  #paymentToDecide(reviewerId: AccountId, itemId: string): PaymentToDecide | undefined {
    return this.#ctx.one<PaymentToDecide>(
      `SELECT payment.id, payment.owner_account_id, payment.recipient_id, payment.decision
         FROM payment
         WHERE payment.id = ? AND ${MAY_DECIDE_PAYMENT}`,
      itemId,
      reviewerId,
    );
  }

  /**
   * Records a reviewer's decision on a payment awaiting approval and tells
   * the owner. Approved, it counts against the ledger; rejected, it never did.
   */
  #decidePayment(payment: PaymentToDecide, decided: Decided, reviewerId: AccountId): void {
    const { outcome, reason } = decided;
    recordDecision(this.#ctx, "payment", payment.id, decided, reviewerId, this.#ctx.clock.now());
    const { amount_cents } = this.#ctx.db.prepare(`SELECT amount_cents FROM payment WHERE id = ?`).get(payment.id) as {
      amount_cents: number;
    };
    const paid = `${money(amount_cents)} to ${recipientName(this.#ctx, payment.recipient_id)}`;
    this.#ctx.enqueue({
      recipient: payment.owner_account_id,
      kind: "payment-decided",
      payload: {
        itemKind: "payment",
        itemId: payment.id,
        recipientId: payment.recipient_id,
        ...decisionDetails(decided),
        title: `${accountName(this.#ctx, reviewerId)} ${outcome} your payment`,
        body: reason === null ? paid : `${paid} · “${reason}”`,
        url: APP_PATHS.ledger(payment.recipient_id),
      },
    });
  }

  /** Whether `photoId` is a photo of some evidence or excuse (`table`) and `accountId` owns or reviews its pact. */
  #mayViewPactItemPhoto(table: "evidence" | "excuse", photoId: string, accountId: AccountId): boolean {
    return (
      this.#ctx.db
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
      this.#ctx.db
        .prepare(
          `SELECT 1 FROM payment
           WHERE payment.photo_id = ?
             AND (payment.owner_account_id = ? OR ${MAY_DECIDE_PAYMENT})`,
        )
        .get(photoId, accountId, accountId) !== undefined
    );
  }

  /** The owner's evidence, excuses and payments still waiting for a decision, newest first. */
  #waiting(ownerId: AccountId): TodayWaitingItem[] {
    return mergeByTime(
      waitingSince,
      "newest-first",
      waitingChangeRequests(this.#ctx, ownerId),
      waitingEvidence(this.#ctx, ownerId),
      waitingExcuses(this.#ctx, ownerId),
      this.#waitingPayments(ownerId),
    );
  }

  /** The owner's payments still waiting for a decision, newest first. */
  #waitingPayments(ownerId: AccountId): TodayWaitingItem[] {
    return this.#ctx
      .all<{
        id: string;
        recipient_id: string;
        recipient_name: string;
        amount_cents: number;
        recorded_at: string;
      }>(
        `SELECT payment.id, payment.recipient_id, recipient.name AS recipient_name, payment.amount_cents,
                  payment.recorded_at
           FROM payment JOIN recipient ON recipient.id = payment.recipient_id
           WHERE payment.owner_account_id = ? AND payment.decision IS NULL
           ORDER BY payment.recorded_at DESC, payment.id`,
        ownerId,
      )
      .map((row): TodayWaitingItem => ({
        kind: "payment",
        id: row.id,
        recipientId: row.recipient_id,
        recipientName: row.recipient_name,
        amountCents: row.amount_cents,
        recordedAt: new Date(row.recorded_at),
      }));
  }

  /** Today's alerts and sections for the owner, as `#todayAlerts` and `#todaySections` put them. */
  #todayCards(ownerId: AccountId, timezone: string): { alerts: TodayAlert[]; sections: TodaySection[] } {
    const now = this.#ctx.clock.now();
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
      ...rejectedEvidenceAlerts(this.#ctx, ownerId),
      ...rejectedDayAlerts(this.#ctx, ownerId),
      ...rejectedExcuseAlerts(this.#ctx, ownerId, now),
      ...this.#questionAlerts(ownerId),
    ];
    // A connection matters only while an Active pact is judged from it.
    const problemWith = (service: ConnectionService) =>
      this.#activePactsUsing(ownerId, service) > 0 ? connectionProblem(this.#ctx, ownerId, service) : null;
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
    for (const pact of activePacts(this.#ctx, ownerId)) {
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
    const { first, between } = occurrencesOf(this.#ctx, pact.id, timezone);
    if (now.getTime() < first.opensAt.getTime()) {
      return { section: "coming-up", card: this.#comingUpCard(pact, first) };
    }
    const today = localDateOf(now, timezone);
    // Nights the owner needn't hear about: judged, or with an excuse filed.
    const open = (night: Occurrence) =>
      !isJudged(this.#ctx, pact.id, night.date) && excuseOn(this.#ctx, pact.id, night.date) === null;
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
      inBedBy: termsOn(this.#ctx, pact.id, tonight.date).in_bed_by!,
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
    const { first, openAt } = occurrencesOf(this.#ctx, pact.id, timezone);
    const open = openAt(now);
    if (open && !isJudged(this.#ctx, pact.id, open.date) && now.getTime() < open.dueAt.getTime()) {
      if (excuseOn(this.#ctx, pact.id, open.date) !== null) return null;
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
    const { first, openAt, dayDueAt } = occurrencesOf(this.#ctx, pact.id, timezone);
    const open = openAt(now);
    if (!open) {
      return now.getTime() < first.opensAt.getTime()
        ? { section: "coming-up", card: this.#comingUpCard(pact, first) }
        : null;
    }
    // Judged while still open: its evidence was rejected, so it's an alert, or
    // it's past its due-by time, so it's Missed. Past it and not judged yet,
    // the next tick judges it.
    if (isJudged(this.#ctx, pact.id, open.date) || now.getTime() >= open.dueAt.getTime()) return null;
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
    const decision = evidenceDecision(this.#ctx, pact.id, open.date);
    if (decision === "waiting" || decision === "approved") return null;
    // An excuse waiting for today is under Waiting for approval; an approved one excuses it.
    if (excuseOn(this.#ctx, pact.id, open.date) !== null) return null;
    return {
      section: "to-do",
      card: {
        kind: "evidence",
        ...this.#cardOn(pact, open.date),
        editWindowClosesAt,
        occurrenceDate: open.date,
        dueAt: open.dueAt,
        dueBy: termsOn(this.#ctx, pact.id, open.date).due_by,
      },
    };
  }

  /** What every pact card on Today shows: the terms of the occurrence on `date`, the one it's about. */
  #cardOn(pact: ActivePact, date: LocalDate): Pick<TodayComingUpCard, "pactId" | "name" | "penaltyCents"> {
    return { pactId: pact.id, name: pact.name, penaltyCents: termsOn(this.#ctx, pact.id, date).penalty_cents };
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
      dueBy: termsOn(this.#ctx, pact.id, open.date).due_by,
      deckName: ankiDeckName(this.#ctx, ownerId, ankiDeckOn(this.#ctx, pact.id, open.date)),
      deckMissing: ankiDeckMissing(this.#ctx, ownerId, ankiDeckOn(this.#ctx, pact.id, open.date)),
      lastCheck: lastAnkiCheck(this.#ctx, pact.id, open.date),
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
    if (excuseOn(this.#ctx, pactId, week.date) !== null) return null;
    if (evidenceDecision(this.#ctx, pactId, today, "day") !== "none") return null;
    const progress = weekProgress(this.#ctx, pactId, week.date);
    if (progress.sessions + progress.waiting >= progress.target) return null;
    const { due_by: dueBy } = termsOn(this.#ctx, pactId, week.date);
    return { occurrenceDate: week.date, dueAt: week.dueAt, dueBy, week: progress };
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
    const rows = this.#ctx.all<{
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
    }>(
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
      ownerId,
      since.toISOString(),
    );
    return rows.map((row) => {
      const weekly = scheduleOf(row.schedule).kind === "weekly-count";
      const dueBy = row.date === today && !weekly ? termsOn(this.#ctx, row.id, row.date).due_by : null;
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
    if (weekly) return { kind: "week", progress: weekProgress(this.#ctx, row.id, row.date) };
    if (row.evidence_kind === "anki") return { kind: "anki", lastCheck: ankiCheckOf(row) };
    if (row.evidence_kind === "oura") {
      return { kind: "night", inBedAt: row.bedtime_start === null ? null : wallClock(row.bedtime_start).slice(11) };
    }
    return null;
  }

  async advanceTo(t: Date): Promise<void> {
    // Before the transaction, never in it: a slow Oura can't hold up other writes.
    // An account whose call throws has no data this tick; the next one retries.
    const fetched = await this.#fetchSleep(t);
    const checked = await this.#fetchAnki(t);
    await this.#command(
      () => {
        closeEditWindows(this.#ctx, t);
        // Before judging at due times: a check made before a day's due time can still satisfy it.
        this.#recordAnkiChecks(checked);
        judgeDueBy(this.#ctx, t, this.#ankiChecksRunning);
        for (const account of fetched.disconnected) this.#markDisconnected("oura", account, fetched.askedAt);
        this.#noteOuraClock(fetched.sleep);
        this.#judgeNights(t, fetched.sleep);
        this.#pushNoOuraData(t);
        const dropped = this.#remind(t);
        endPastEndDate(this.#ctx, t, this.#ankiChecksRunning);
        this.#makeBills(t);
        this.#remindOverdue(t);
        this.#ctx.db
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
          this.#ctx.log(
            `reminder dropped: pact ${drop.pactId}, ${drop.time} for ${drop.date}, ` +
              `${Math.floor(drop.lateMs / 60_000)} min late at ${t.toISOString()}`,
          );
        }
        if (dropped.length > 0) this.#ctx.log(`OPERATOR_ALERT ${droppedText(dropped.length)} after downtime`);
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
    const pacts = this.#ctx.all<
      Pick<
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
      }
    >(`SELECT pact.id, pact.name, pact.evidence_kind, pact.schedule, pact.reminders, pact.reminded_through,
                pact.anki_rollover_hour, pact.in_bed_by, pact.due_by, pact.created_at, pact.owner_account_id,
                account.timezone
         FROM pact JOIN account ON account.id = pact.owner_account_id
         WHERE pact.stage = 'active'
         ORDER BY pact.created_at, pact.id`);
    const dropped: DroppedReminder[] = [];
    for (const pact of pacts) {
      const from = pact.reminded_through === null ? t : new Date(pact.reminded_through);
      if (from.getTime() >= t.getTime()) continue;
      this.#ctx.db.prepare(`UPDATE pact SET reminded_through = ? WHERE id = ?`).run(t.toISOString(), pact.id);
      const times = remindersOf(pact.reminders);
      if (times.length === 0) continue;
      const timezone = ownerZone(pact.timezone, pact.owner_account_id);
      // A night's or an Anki day's reminder can go off the morning after, so start a day early.
      const fromDate = addDays(localDateOf(from, timezone), -1);
      const due = remindersDue(
        pact,
        times,
        occurrencesOf(this.#ctx, pact.id, timezone),
        fromDate,
        localDateOf(t, timezone),
        timezone,
      );
      // A reminder sent before the owner moved west comes round again: it went off already.
      this.#ctx.db
        .prepare(`DELETE FROM reminder_sent WHERE pact_id = ? AND date < ?`)
        .run(pact.id, addDays(fromDate, -1));
      for (const { date, dueAt, time, at } of due) {
        if (at.getTime() <= from.getTime() || at.getTime() > t.getTime()) continue;
        if (at.getTime() >= dueAt.getTime() || !this.#worthReminding(pact, date)) continue;
        const lateMs = t.getTime() - at.getTime();
        if (lateMs > REMINDER_LATE_MS) {
          dropped.push({ pactId: pact.id, date, time, lateMs });
          continue;
        }
        const sent = this.#ctx.db
          .prepare(`INSERT INTO reminder_sent (pact_id, date, time) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
          .run(pact.id, date, time);
        if (sent.changes === 1) this.#enqueueReminder(pact, date);
      }
    }
    const operator = this.#ctx.one<{ id: AccountId }>(`SELECT id FROM account WHERE is_operator = 1`);
    if (dropped.length > 0 && operator) {
      this.#ctx.enqueue({
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
    if (excuseOn(this.#ctx, pact.id, date) === "approved") return false;
    if (pact.evidence_kind === "oura") return true;
    // Pact doesn't see the deck finished until a check does: an Anki day is worth reminding until it's judged.
    if (pact.evidence_kind === "anki") return !isJudged(this.#ctx, pact.id, date);
    const submitted = this.#ctx.db.prepare(`SELECT 1 FROM evidence WHERE pact_id = ? AND day = ?`).get(pact.id, day);
    if (submitted !== undefined || isJudged(this.#ctx, pact.id, date)) return false;
    if (!weekly) return true;
    const { sessions, waiting, target } = weekProgress(this.#ctx, pact.id, date);
    return sessions + waiting < target;
  }

  /** A reminder about the day `date` (on Weekly count, a day of the week). */
  #enqueueReminder(
    pact: Pick<PactRow, "id" | "name" | "evidence_kind" | "schedule"> & { owner_account_id: AccountId },
    date: LocalDate,
  ): void {
    const { kind } = scheduleOf(pact.schedule);
    const weekly = kind === "weekly-count";
    const terms = termsOn(this.#ctx, pact.id, weekly ? mondayOf(date) : date);
    const due = terms.due_by === null ? "midnight" : clockText(terms.due_by);
    let body = `No photo yet today. Due at ${due}.`;
    if (pact.evidence_kind === "oura") body = `In bed by ${clockText(terms.in_bed_by!)} tonight.`;
    if (pact.evidence_kind === "anki") {
      const check = lastAnkiCheck(this.#ctx, pact.id, date);
      body = check === null ? `Due at ${due}. Not checked yet.` : `${cardsText(check.cardsLeft)} left, due at ${due}`;
    }
    if (kind === "one-time") body = `No photo yet. Due ${formatDate(date)} at ${due}.`;
    if (weekly) {
      const { sessions, target } = weekProgress(this.#ctx, pact.id, mondayOf(date));
      body = `${sessions} of ${target} this week. Today's photo is due at ${due}.`;
    }
    this.#ctx.enqueue({
      recipient: pact.owner_account_id,
      kind: "reminder",
      payload: { pactId: pact.id, occurrenceDate: date, title: pact.name, body, url: APP_PATHS.today },
    });
  }

  /**
   * Each night of a bedtime pact that hasn't been judged, from where judging
   * got to, whose window (18:00 that day to 18:00 the next) has started by `t`.
   * An Ended pact still has the nights that fell due before it Ended.
   */
  #nightsWaiting(t: Date, owner?: AccountId): { pact: PactToJudge & { timezone: string }; night: Occurrence }[] {
    const waiting = [];
    for (const pact of [...pactsToJudge(this.#ctx), ...endedBedtimePacts(this.#ctx)]) {
      if (pact.evidence_kind !== "oura") continue;
      if (owner !== undefined && pact.owner_account_id !== owner) continue;
      const timezone = ownerZone(pact.timezone, pact.owner_account_id);
      const endedAt = pact.ended_at === null ? null : new Date(pact.ended_at);
      const until = endedAt !== null && endedAt.getTime() < t.getTime() ? endedAt : t;
      const from = pact.judged_through === null ? pact.first_occurrence : addDays(pact.judged_through, 1);
      // The window is on the clock the night closes on.
      const offset = ouraOffset(this.#ctx, pact.owner_account_id, timezone);
      for (const night of occurrencesOf(this.#ctx, pact.id, timezone).between(from, localDateOf(until, timezone))) {
        if (nightStartsAt(night.date, timezone, offset).getTime() > t.getTime()) break;
        if (endedAt !== null && night.dueAt.getTime() > endedAt.getTime()) break;
        if (!isJudged(this.#ctx, pact.id, night.date)) waiting.push({ pact: { ...pact, timezone }, night });
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
    const askedAt = this.#ctx.clock.now();
    const ranges = new Map<AccountId, { startDate: LocalDate; endDate: LocalDate }>();
    for (const { pact, night } of this.#nightsWaiting(t, owner)) {
      if (connectionProblem(this.#ctx, pact.owner_account_id, "oura") !== null) continue;
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
        this.#ctx.log(`Oura sleep for account ${account} failed, no data this tick: ${errorText(error)}`);
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
    const marked = this.#ctx.db
      .prepare(
        `UPDATE connection SET status = 'needs-reconnecting'
         WHERE account_id = ? AND service = ? AND status = 'connected' AND connected_at <= ?`,
      )
      .run(account, service, askedAt.toISOString());
    if (marked.changes === 0) return;
    this.#ctx.enqueue({
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
      const offset = ouraOffset(this.#ctx, pact.owner_account_id, pact.timezone);
      if (t.getTime() < noOuraDataPushAt(night.date, pact.timezone, offset).getTime()) continue;
      if (t.getTime() >= night.closesAt.getTime() || isJudged(this.#ctx, pact.id, night.date)) continue;
      if (excuseOn(this.#ctx, pact.id, night.date) !== null) continue;
      const sent = this.#ctx.db
        .prepare(`INSERT INTO no_oura_data_push_sent (account_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
        .run(pact.owner_account_id, night.date);
      if (sent.changes === 0) continue;
      const fix =
        connectionProblem(this.#ctx, pact.owner_account_id, "oura") === null ? "Sync your ring" : "Reconnect Oura";
      this.#ctx.enqueue({
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
      const inBedBy = termsOn(this.#ctx, pact.id, night.date).in_bed_by!;
      const period = (sleep.get(pact.owner_account_id) ?? [])
        .filter((p) => p.type === "long_sleep" && nightOf(p.bedtime_start) === night.date)
        .sort((a, b) => wallClock(a.bedtime_start).localeCompare(wallClock(b.bedtime_start), "en-US"))[0];
      const excuse = excuseOn(this.#ctx, pact.id, night.date);
      const satisfied =
        period !== undefined && wallClock(period.bedtime_start) < deadlineWallClock(night.date, inBedBy);
      // As for a photo: an on-time bedtime beats an approved excuse, and an approved excuse beats a late one.
      // So with no period yet, an approved excuse waits for one until the night closes.
      if (excuse === "approved" && !satisfied && (period !== undefined || night.closesAt.getTime() <= t.getTime())) {
        judge(this.#ctx, pact.id, night.date, "excused", period ? t : night.closesAt);
      } else if (period) {
        judge(this.#ctx, pact.id, night.date, satisfied ? "satisfied" : "missed", t);
        this.#ctx.db
          .prepare(`UPDATE occurrence SET bedtime_start = ? WHERE pact_id = ? AND date = ?`)
          .run(period.bedtime_start, pact.id, night.date);
        if (!satisfied && excuse === null) enqueueMissed(this.#ctx, pact.id, night.date);
      } else if (night.closesAt.getTime() <= t.getTime()) {
        judge(this.#ctx, pact.id, night.date, "missed", night.closesAt);
        if (excuse === null) enqueueMissed(this.#ctx, pact.id, night.date);
      } else {
        stopped.add(pact.id);
        continue;
      }
      this.#ctx.db.prepare(`UPDATE pact SET judged_through = ? WHERE id = ?`).run(night.date, pact.id);
    }
  }

  /**
   * Each Active Anki pact (of `owner`, or everyone's) whose day is open at
   * `t`, before its due time, not judged yet and not covered by an approved
   * excuse, with a working AnkiWeb connection: what a check is for.
   */
  #ankiDaysWaiting(t: Date, owner?: AccountId): { pactId: string; account: AccountId; deckId: string }[] {
    const pacts = this.#ctx.all<{ id: string; owner_account_id: AccountId; timezone: string | null }>(
      `SELECT pact.id, pact.owner_account_id, account.timezone
         FROM pact
         JOIN account ON account.id = pact.owner_account_id
         JOIN connection ON connection.account_id = pact.owner_account_id AND connection.service = 'anki'
         WHERE pact.stage = 'active' AND pact.evidence_kind = 'anki' AND connection.status = 'connected'
           AND (? IS NULL OR pact.owner_account_id = ?)
         ORDER BY pact.created_at, pact.id`,
      owner ?? null,
      owner ?? null,
    );
    return pacts.flatMap((pact) => {
      const open = occurrencesOf(this.#ctx, pact.id, ownerZone(pact.timezone, pact.owner_account_id)).openAt(t);
      if (!open || t.getTime() >= open.dueAt.getTime() || isJudged(this.#ctx, pact.id, open.date)) return [];
      // An approved excuse covers it: it's Excused at its due time whatever the deck shows.
      if (excuseOn(this.#ctx, pact.id, open.date) === "approved") return [];
      return [{ pactId: pact.id, account: pact.owner_account_id, deckId: ankiDeckOn(this.#ctx, pact.id, open.date) }];
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
   * the days it may still satisfy (`ankiCheckHolds`).
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
        this.#ctx.log(`AnkiWeb check for account ${account} failed, nothing checked: ${errorText(error)}`);
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
        this.#ctx.db
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
      const pacts = this.#ctx.all<{ id: string; timezone: string | null }>(
        `SELECT pact.id, account.timezone FROM pact JOIN account ON account.id = pact.owner_account_id
           WHERE pact.owner_account_id = ? AND pact.stage = 'active' AND pact.evidence_kind = 'anki'
           ORDER BY pact.created_at, pact.id`,
        account,
      );
      for (const pact of pacts) {
        const { includes, covering } = occurrencesOf(this.#ctx, pact.id, ownerZone(pact.timezone, account));
        const day = includes(ankiDate) ? covering(ankiDate) : null;
        if (!day || asOf.getTime() >= day.dueAt.getTime() || checkedAt.getTime() >= day.dueAt.getTime()) continue;
        // The deck the day is on: a deck change approved since it opened applies from the next.
        const counts = result.decks[ankiDeckOn(this.#ctx, pact.id, day.date)];
        if (!counts || counts.new + counts.learn + counts.review > 0) continue;
        if (isJudged(this.#ctx, pact.id, day.date)) continue;
        judge(this.#ctx, pact.id, day.date, "satisfied", checkedAt);
        noteAnkiResult(this.#ctx, pact.id, day.date, { cardsLeft: 0, checkedAt });
      }
    }
  }

  /**
   * Gives the checked decks in the account's stored deck list the names the
   * check found, so a deck renamed in Anki shows its new name before the deck
   * picker loads again.
   */
  #renameAnkiDecks(accountId: AccountId, names: Record<string, string>): void {
    const list = ankiDeckList(this.#ctx, accountId);
    if (!list) return;
    let renamed = false;
    const decks = list.decks.map((deck) => {
      const name = names[deck.id];
      if (name === undefined || name === deck.name) return deck;
      renamed = true;
      return { ...deck, name };
    });
    if (!renamed) return;
    this.#ctx.db
      .prepare(`UPDATE anki_deck_list SET decks = ? WHERE account_id = ?`)
      .run(JSON.stringify(decks), accountId);
  }

  /**
   * Keeps what a check found of a deck an Anki pact is on: its name, or with
   * `name` null, that it's gone from the collection since `checkedAt`, under
   * the last name Pact knew.
   */
  #notePactDeck(account: AccountId, deckId: string, name: string | null, checkedAt: Date): void {
    if (name !== null) {
      this.#ctx.db
        .prepare(
          `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, NULL)
           ON CONFLICT (account_id, deck_id) DO UPDATE SET name = excluded.name, missing_since = NULL`,
        )
        .run(account, deckId, name);
      return;
    }
    this.#ctx.db
      .prepare(
        `INSERT INTO anki_pact_deck (account_id, deck_id, name, missing_since) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, deck_id) DO UPDATE SET name = COALESCE(anki_pact_deck.name, excluded.name),
           missing_since = COALESCE(anki_pact_deck.missing_since, excluded.missing_since)`,
      )
      .run(account, deckId, ankiDeckName(this.#ctx, account, deckId), checkedAt.toISOString());
  }

  lastTick(): Date | null {
    const row = this.#ctx.one<{ last_tick_at: string }>(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`);
    return row ? new Date(row.last_tick_at) : null;
  }

  health(): Health {
    const lastTick = this.lastTick();
    const ok = lastTick !== null && this.#ctx.clock.now().getTime() - lastTick.getTime() <= HEALTHY_TICK_AGE_MS;
    return { ok, lastTick };
  }

  schemaVersion(): number {
    return this.#ctx.db.pragma("user_version", { simple: true }) as number;
  }

  async raiseRestoreAlert(): Promise<void> {
    await this.#command(
      () => {
        const lastTick = this.lastTick()?.toISOString() ?? null;
        const operator = this.#ctx.one<{ id: string }>(`SELECT id FROM account WHERE is_operator = 1`);
        if (operator) {
          this.#ctx.enqueue({
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
        this.#ctx.log(
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
    this.#ctx.db.close();
  }
}

/** A pact's card on Today and the section it goes in. */
type TodayPlacement =
  | { section: "to-do"; card: TodayToDoCard | TodayAnkiCard }
  | { section: "automatic"; card: TodayAutomaticCard }
  | { section: "no-oura-data"; card: TodayNoOuraDataCard }
  | { section: "coming-up"; card: TodayComingUpCard };

/** "1 card", "42 cards". */
function cardsText(n: number): string {
  return `${n} ${n === 1 ? "card" : "cards"}`;
}

/**
 * An error for the log: its name and message. A SyntaxError's message quotes
 * the response it couldn't parse, which could hold a token, so it's left out.
 */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return error.name === "SyntaxError" ? error.name : `${error.name}: ${error.message}`;
}

/** A review item a reviewer may decide, as `decide` and `askOwner` read it. */
type ItemToDecide =
  | { kind: "evidence"; row: EvidenceToDecide }
  | { kind: "excuse"; row: ExcuseToDecide }
  | { kind: "payment"; row: PaymentToDecide }
  | { kind: "change-request"; row: StoredChangeRequest };

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
