// The Pact core: every domain rule, behind a command/query interface.
//
// Commands are async and all-or-nothing: each runs in one SQLite transaction,
// and the notifications it produces are written to the outbox in that same
// transaction and delivered only after it commits. Queries are synchronous
// reads. The core reads time only from the Clock port.
//
// This file holds the interface and `Core`: the transaction boundary, the
// ports, what's kept in memory, and the scheduler tick's order. `as()` hands
// each call to a feature file (accounts, pacts, history, change-requests,
// evidence, excuses, money, review, connections, bedtime, anki-days,
// reminders, today), whose functions take the CoreContext (context.ts). They
// share writes (judging.ts, outbox.ts), reads (rows.ts, occurrence-state.ts)
// and pure rules (pact-rules.ts, occurrences.ts, changes.ts, calendar.ts,
// bill-math.ts, oura-clock.ts).

import { randomUUID } from "node:crypto";
import { APP_PATHS } from "../shared/api.ts";
import type {
  AcceptExcuseRejectionResult,
  AcceptInviteResult,
  AcceptMissResult,
  AccountId,
  AddRecipientResult,
  AddReviewersResult,
  AnkiDecksResult,
  AskOwnerResult,
  ChangePactResult,
  ChangePreviewResult,
  ChangeRequestResult,
  CreatePactResult,
  DailySummarySetting,
  DecideResult,
  DeletePactResult,
  EditPactResult,
  EvidenceResult,
  ExcuseDates,
  ExcuseOptionsResult,
  ExcusePreviewResult,
  ExcuseResult,
  FileExcuseResult,
  FirstOccurrenceResult,
  Friend,
  Health,
  Invite,
  InviteLookup,
  LedgerResult,
  LedgerSummary,
  NewExcuse,
  NewPact,
  NewPayment,
  NewRecipient,
  NotificationSetting,
  NotificationSettingState,
  PactChange,
  PactResult,
  PactSummary,
  PactTiming,
  PaymentResult,
  Profile,
  PushDevice,
  Recipient,
  RecordPaymentResult,
  RenamePactResult,
  ReplyResult,
  RequestEndResult,
  ReviewDecision,
  ReviewItem,
  SavePushSubscriptionResult,
  SetRemindersResult,
  SetTimezoneResult,
  SignInResult,
  SubmitEvidenceResult,
  Today,
  FileVacationResult,
  NewVacation,
  LastVacation,
  VacationCard,
  VacationOptions,
  VacationPreviewResult,
  VacationRequest,
  WithdrawChangeRequestResult,
  WithdrawVacationResult,
  AcceptVacationRejectionResult,
} from "../shared/types.ts";
import {
  acceptInvite,
  accountIdForEmail,
  addRecipient,
  createInvite,
  dailySummarySetting,
  emailKey,
  friendList,
  inviteLookup,
  invitePage,
  inviteRow,
  notificationSettingList,
  recipientList,
  removePushSubscription,
  savePushSubscription,
  setDailySummary,
  setNotificationSetting,
  setTimezone,
  signIn,
} from "./accounts.ts";
import { ankiDecks, checkAnki, fetchAnki, recordAnkiChecks, type AnkiPolling } from "./anki-days.ts";
import { checkOura, fetchSleep, judgeNights, noteOuraClock, pushNoOuraData } from "./bedtime.ts";
import {
  addReviewers,
  changePact,
  changePreview,
  changeRequestPage,
  renamePact,
  requestEnd,
  setReminders,
  withdrawChangeRequest,
} from "./change-requests.ts";
import { connectAnki, connectOura, disconnectAnki, disconnectOura, markDisconnected, profile } from "./connections.ts";
import { createContext, type CoreContext } from "./context.ts";
import { openDatabase, type Db } from "./db.ts";
import { acceptMiss, evidencePage, submitEvidence } from "./evidence.ts";
import { acceptExcuseRejection, excuseOptions, excusePage, fileExcuse, previewExcuse } from "./excuses.ts";
import { endPastEndDate } from "./ending.ts";
import { ledgerList, ledgerPage, makeBills, paymentPage, recordPayment, remindOverdue } from "./money.ts";
import { remindStale } from "./stale-items.ts";
import {
  alertGivenUpEmails,
  deliverEmails,
  deliverPending,
  enqueue,
  giveUpEmails,
  releaseEmailClaims,
} from "./outbox.ts";
import { closeEditWindows, createPact, deletePact, editPact, firstOccurrence, pactList, pactPage } from "./pacts.ts";
import type { RaiseOperatorAlert } from "./operator-alerts.ts";
import type { AnkiSource, Clock, Mailer, Notifier, OuraSource, Photo, PhotoStore } from "./ports.ts";
import { droppedText, remind } from "./reminders.ts";
import {
  askOwner,
  decide,
  ownerReply,
  reviewQueue,
  viewPhoto,
  waitingOnReply,
  withdrawMoot,
  type PhotoResult,
} from "./review.ts";
import { accountRow } from "./rows.ts";
import { settleAll } from "./settle.ts";
import { todayPage } from "./today.ts";
import { waitingFor } from "./waiting.ts";
import {
  acceptVacationRejection,
  fileVacation,
  previewVacation,
  lastVacation,
  vacationCards,
  vacationOptions,
  withdrawVacation,
} from "./vacations.ts";

export interface PactCoreOptions {
  /** SQLite file. Production: on the /data volume. */
  dbPath: string;
  clock: Clock;
  notifier: Notifier;
  /** Sends the daily summary, through the outbox. Operator alert emails go through `raiseOperatorAlert` instead. */
  mailer: Mailer;
  /** The app's address, such as "https://pact.example.com": the links in an email start with it. */
  appUrl: string;
  /**
   * The operator alert path (operator-alerts.ts): the log line and the email,
   * which must go to the same operator as `operatorEmail`. The server shares
   * it with the adapters.
   */
  raiseOperatorAlert: RaiseOperatorAlert;
  ouraSource: OuraSource;
  ankiSource: AnkiSource;
  photoStore: PhotoStore;
  /** The operator's email; their first sign-in may create an account without an invite. */
  operatorEmail: string;
  /** Where the core writes log lines. Default: console.log. */
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
   * A new account gets `timezone`, the browser's, under its canonical name,
   * or UTC when it is missing or not a zone; an existing account keeps its own.
   */
  signIn(
    identity: { email: string; name: string },
    options?: { inviteToken?: string; timezone?: string },
  ): Promise<SignInResult>;
  /** The invite page's view of `token` for a signed-out visitor: a claimed invite shows as used. */
  invite(token: string): InviteLookup;
  /** The account signed in with `email` (whatever its case), or null if there is none. Never writes. */
  accountIdForEmail(email: string): AccountId | null;
  /** Commands and queries made as one account. */
  as(accountId: AccountId): AccountView;
  /**
   * Runs everything due by `t`, records the tick, then delivers the outbox's
   * pushes, and starts sending its emails without waiting for them.
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
  /**
   * Waits for the email pass in progress, if any. The tick starts one and
   * doesn't wait for it; shutdown waits for it briefly, and tests do.
   */
  emailsSettled(): Promise<void>;
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
   * The owner changes an Active pact past its edit window: the Request change
   * form, which sends the whole terms. The name, the reminders and added
   * reviewers apply at once (each new reviewer is told). If anything else
   * relaxes the pact, the rest waits as one change request for a reviewer,
   * stricter parts included, and the reviewers get a review item. Otherwise
   * the stricter parts apply now, to every occurrence not open yet (from
   * tomorrow, in the owner's timezone). While a change request or an approved
   * end waits, only the name, the reminders and added reviewers may change.
   * The same checks as `createPact`, so a pact never has zero reviewers. A
   * refusal changes nothing.
   */
  changePact(pactId: string, change: PactChange): Promise<ChangePactResult>;
  /**
   * The owner renames an Active pact past its edit window, from the pact page:
   * at once, with no review, even while a change request or an approved end
   * waits. Only the name changes. The same name rules as `createPact`. A
   * refusal changes nothing.
   */
  renamePact(pactId: string, name: string): Promise<RenamePactResult>;
  /**
   * The owner adds reviewers to an Active pact past its edit window, from the
   * pact page: each of `reviewerIds` joins at once and is told, even while a
   * change request or an approved end waits, and can decide it. One who
   * already reviews the pact is left as they are. Each must be the owner's
   * friend. A refusal changes nothing.
   */
  addReviewers(pactId: string, reviewerIds: AccountId[]): Promise<AddReviewersResult>;
  /**
   * The owner sets an Active pact's reminders past its edit window, from the
   * pact page: the whole list, at once, even while a change request or an
   * approved end waits. Each must go off before the due time in force now. A
   * refusal changes nothing.
   */
  setReminders(pactId: string, reminders: string[]): Promise<SetRemindersResult>;
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
   * What Plan a vacation offers: the owner's Active pacts whose edit window
   * has closed, recurring and One-time apart, each with its reviewers.
   */
  vacationOptions(): VacationOptions;
  /**
   * What a vacation with `request`'s dates and ticked pacts would cover if
   * filed now, for every offered pact, and what it would skip and why: what
   * the confirm step shows. `fileVacation` files exactly what this returns.
   */
  vacationPreview(request: VacationRequest): VacationPreviewResult;
  /**
   * The owner asks the reviewers in `vacation` for its dates off from its
   * ticked pacts. It covers the occurrences in its dates that haven't opened
   * yet, fixed at filing: each scheduled day, a Weekly count week whose
   * Thursday is inside, a One-time deadline inside. It skips those already
   * Excused, on an excuse waiting for approval or on another vacation. Refused
   * when no pact is ticked or none is left to cover, no reviewer is picked or
   * one reviews no ticked pact, a ticked pact isn't offered, or the dates are
   * refused: the first day today or earlier, the last before the first, or
   * more than 62 days. A refusal writes nothing.
   */
  fileVacation(vacation: NewVacation): Promise<FileVacationResult>;
  /**
   * The owner's vacations waiting for approval, and those approved whose last
   * day hasn't passed (ahead or on now), soonest first, as their Profile
   * cards show them.
   */
  vacations(): VacationCard[];
  /** The owner's approved vacation that ended last, for Profile's "Last one"; null when none has ended. */
  lastVacation(): LastVacation | null;
  /** The owner withdraws a vacation waiting for approval: it covers nothing any more. */
  withdrawVacation(vacationId: string): Promise<WithdrawVacationResult>;
  /** The owner takes the L on a rejected vacation: its alert goes, with the Missed occurrences it covered. */
  acceptVacationRejection(vacationId: string): Promise<AcceptVacationRejectionResult>;
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
  /** The daily summary email's setting, off until turned on, and the address it goes to. */
  dailySummary(): DailySummarySetting;
  /** Turns the daily summary on or off. It doesn't follow the push settings, nor they it. */
  setDailySummary(enabled: boolean): Promise<DailySummarySetting>;
  /**
   * Notifications for this account go to this device too, from now on. Only
   * the known push services are accepted, since the server sends to whatever
   * is saved here. A device another account saved moves to this one.
   */
  savePushSubscription(device: PushDevice): Promise<SavePushSubscriptionResult>;
  /** Stops sending to this device, if it's this account's. */
  removePushSubscription(endpoint: string): Promise<void>;
}

/** The synchronous calls of an AccountView: its queries, `photo` apart. */
type Queries = {
  [K in keyof AccountView as AccountView[K] extends (...args: never[]) => Promise<unknown> ? never : K]: AccountView[K];
};
/** The asynchronous ones: its commands, and `photo`. */
type Commands = Omit<AccountView, keyof Queries>;

type Call = (...args: never[]) => unknown;

/** `calls` with each one replaced by what `wrap` makes of it. */
function eachCall<T extends Record<string, Call>>(calls: T, wrap: (call: Call) => Call): T {
  return Object.fromEntries(Object.entries(calls).map(([name, call]) => [name, wrap(call)])) as T;
}

export function createPactCore(options: PactCoreOptions): PactCore {
  const db = openDatabase(options.dbPath);
  return new Core(db, options);
}

/** /health fails when the last scheduler tick is older than this. */
const HEALTHY_TICK_AGE_MS = 5 * 60 * 1000;

class Core implements PactCore {
  readonly #ctx: CoreContext;
  readonly #notifier: Notifier;
  readonly #mailer: Mailer;
  readonly #appUrl: string;
  readonly #photoStore: PhotoStore;
  readonly #ouraSource: OuraSource;
  readonly #ankiSource: AnkiSource;
  readonly #operatorEmailKey: string;
  readonly #raiseOperatorAlert: RaiseOperatorAlert;
  /** Outbox deliveries run one at a time, in this chain. */
  #delivery: Promise<void> = Promise.resolve();
  /** The email pass running, if any: at most one at a time, apart from `#delivery`. */
  #emailPass: Promise<void> | null = null;
  /**
   * When each account last checked Oura now. In memory: a restart forgets
   * it, which costs at most one more call. Set before the call, so two
   * checks at once make one.
   */
  readonly #ouraChecks = new Map<AccountId, number>();
  /** When each account's AnkiWeb was checked, and the checks still running. */
  readonly #ankiPolling: AnkiPolling = { checks: new Map(), polls: new Map(), checksRunning: new Map() };

  constructor(db: Db, options: PactCoreOptions) {
    this.#ctx = createContext({
      db,
      clock: options.clock,
      newId: options.newId ?? randomUUID,
      log: options.log ?? ((line) => console.log(line)),
      enqueue: (notification) => enqueue(this.#ctx, notification),
      ankiChecksRunning: this.#ankiPolling.checksRunning,
    });
    this.#notifier = options.notifier;
    this.#mailer = options.mailer;
    this.#appUrl = options.appUrl;
    this.#photoStore = options.photoStore;
    this.#ouraSource = options.ouraSource;
    this.#ankiSource = options.ankiSource;
    this.#operatorEmailKey = emailKey(options.operatorEmail);
    this.#raiseOperatorAlert = options.raiseOperatorAlert;
    releaseEmailClaims(this.#ctx);
  }

  /**
   * Runs `change` as one transaction: all of it commits or none of it does.
   * In it, after `change`, the review items it left moot are withdrawn as of
   * `at` (now unless given: a tick's time), silently (R8). Then runs
   * `afterCommit` and starts delivering the outbox, without waiting: a slow
   * push service never holds up the person who tapped. A delivery failure
   * doesn't fail the command; the notification waits for the next attempt.
   */
  async #command<T>(change: () => T, afterCommit?: (result: T) => void, at?: Date): Promise<T> {
    const result = this.#ctx.db
      .transaction(() => {
        const changed = change();
        withdrawMoot(this.#ctx, at ?? this.#ctx.clock.now());
        return changed;
      })
      .immediate();
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

  /** Starts an email pass unless one is running. Only the tick calls it, and doesn't wait for it. */
  #deliverEmails(): void {
    if (this.#emailPass) return;
    this.#emailPass = deliverEmails(this.#ctx, this.#mailer)
      .catch((error: unknown) => this.#ctx.log(`email delivery stopped, will retry next tick: ${String(error)}`))
      .finally(() => {
        this.#emailPass = null;
      });
  }

  signIn(
    identity: { email: string; name: string },
    options: { inviteToken?: string; timezone?: string } = {},
  ): Promise<SignInResult> {
    return this.#command(() => signIn(this.#ctx, this.#operatorEmailKey, identity, options));
  }

  invite(token: string): InviteLookup {
    return inviteLookup(this.#ctx, inviteRow(this.#ctx, token), null);
  }

  accountIdForEmail(email: string): AccountId | null {
    return accountIdForEmail(this.#ctx, email);
  }

  as(accountId: AccountId): AccountView {
    // Every call first checks that the account exists, so no feature function
    // has to: a query as an unknown account throws `UnknownAccountError`, and
    // a command (or `photo`) rejects with it, having written nothing. The
    // check runs once per call, since a view may be kept, before the command's
    // work. It need not share the command's transaction: nothing deletes accounts.
    const exists = () => void accountRow(this.#ctx, accountId);
    const queries: Queries = {
      invite: (token) => invitePage(this.#ctx, accountId, token),
      friends: () => friendList(this.#ctx, accountId),
      recipients: () => recipientList(this.#ctx, accountId),
      firstOccurrence: (timing, editing) => firstOccurrence(this.#ctx, accountId, timing, editing),
      pacts: () => pactList(this.#ctx, accountId),
      pact: (pactId) => pactPage(this.#ctx, accountId, pactId, waitingFor),
      changePreview: (pactId, change) => changePreview(this.#ctx, accountId, pactId, change),
      changeRequest: (changeRequestId) => changeRequestPage(this.#ctx, accountId, changeRequestId),
      profile: () => profile(this.#ctx, accountId),
      today: () => todayPage(this.#ctx, accountId),
      notificationSettings: () => notificationSettingList(this.#ctx, accountId),
      dailySummary: () => dailySummarySetting(this.#ctx, accountId),
      excusePreview: (pactId, dates) => previewExcuse(this.#ctx, accountId, pactId, dates),
      excuseOptions: (pactId) => excuseOptions(this.#ctx, accountId, pactId),
      excuse: (excuseId) => excusePage(this.#ctx, accountId, excuseId),
      vacationOptions: () => vacationOptions(this.#ctx, accountId),
      vacationPreview: (request) => previewVacation(this.#ctx, accountId, request),
      vacations: () => vacationCards(this.#ctx, accountId),
      lastVacation: () => lastVacation(this.#ctx, accountId),
      reviewQueue: () => reviewQueue(this.#ctx, accountId),
      waitingOnReply: () => waitingOnReply(this.#ctx, accountId),
      evidence: (evidenceId) => evidencePage(this.#ctx, accountId, evidenceId),
      payment: (paymentId) => paymentPage(this.#ctx, accountId, paymentId),
      ledgers: () => ledgerList(this.#ctx, accountId),
      ledger: (recipientId) => ledgerPage(this.#ctx, accountId, recipientId),
    };
    const commands: Commands = {
      setTimezone: (timezone) => this.#command(() => setTimezone(this.#ctx, accountId, timezone)),
      createInvite: () => this.#command(() => createInvite(this.#ctx, accountId)),
      acceptInvite: (token) => this.#command(() => acceptInvite(this.#ctx, accountId, token)),
      addRecipient: (recipient) => this.#command(() => addRecipient(this.#ctx, accountId, recipient)),
      createPact: (pact) => this.#command(() => createPact(this.#ctx, accountId, pact)),
      editPact: (pactId, pact) => this.#command(() => editPact(this.#ctx, accountId, pactId, pact)),
      deletePact: (pactId) => this.#command(() => deletePact(this.#ctx, accountId, pactId)),
      changePact: (pactId, change) => this.#command(() => changePact(this.#ctx, accountId, pactId, change)),
      renamePact: (pactId, name) => this.#command(() => renamePact(this.#ctx, accountId, pactId, name)),
      addReviewers: (pactId, reviewerIds) =>
        this.#command(() => addReviewers(this.#ctx, accountId, pactId, reviewerIds)),
      setReminders: (pactId, reminders) => this.#command(() => setReminders(this.#ctx, accountId, pactId, reminders)),
      requestEnd: (pactId, note) => this.#command(() => requestEnd(this.#ctx, accountId, pactId, note)),
      withdrawChangeRequest: (changeRequestId) =>
        this.#command(() => withdrawChangeRequest(this.#ctx, accountId, changeRequestId)),
      checkOura: () =>
        checkOura(this.#ctx, accountId, this.#ouraChecks, this.#ouraSource, (change) => this.#command(change)),
      disconnectOura: () => this.#command(() => disconnectOura(this.#ctx, accountId)),
      connectAnki: () => this.#command(() => connectAnki(this.#ctx, accountId, this.#ankiPolling.polls)),
      ankiDecks: () => ankiDecks(this.#ctx, accountId, this.#ankiSource, (change) => this.#command(change)),
      checkAnki: () =>
        checkAnki(this.#ctx, accountId, this.#ankiPolling, this.#ankiSource, (change) => this.#command(change)),
      disconnectAnki: () => this.#command(() => disconnectAnki(this.#ctx, accountId)),
      connectOura: () => this.#command(() => connectOura(this.#ctx, accountId)),
      setNotificationSetting: (setting, enabled) =>
        this.#command(() => setNotificationSetting(this.#ctx, accountId, setting, enabled)),
      setDailySummary: (enabled) => this.#command(() => setDailySummary(this.#ctx, accountId, enabled)),
      savePushSubscription: (device) => this.#command(() => savePushSubscription(this.#ctx, accountId, device)),
      removePushSubscription: (endpoint) => this.#command(() => removePushSubscription(this.#ctx, accountId, endpoint)),
      submitEvidence: (pactId, photos) =>
        submitEvidence(this.#ctx, accountId, pactId, photos, this.#photoStore, (change) => this.#command(change)),
      acceptMiss: (pactId, occurrenceDate) =>
        this.#command(() => acceptMiss(this.#ctx, accountId, pactId, occurrenceDate)),
      fileExcuse: (pactId, excuse, photos) =>
        fileExcuse(this.#ctx, accountId, pactId, excuse, photos, this.#photoStore, (change) => this.#command(change)),
      acceptExcuseRejection: (excuseId) => this.#command(() => acceptExcuseRejection(this.#ctx, accountId, excuseId)),
      fileVacation: (vacation) => this.#command(() => fileVacation(this.#ctx, accountId, vacation)),
      withdrawVacation: (vacationId) => this.#command(() => withdrawVacation(this.#ctx, accountId, vacationId)),
      acceptVacationRejection: (vacationId) =>
        this.#command(() => acceptVacationRejection(this.#ctx, accountId, vacationId)),
      recordPayment: (payment, screenshot) =>
        recordPayment(this.#ctx, accountId, payment, screenshot, this.#photoStore, (change) => this.#command(change)),
      photo: (photoId) => viewPhoto(this.#ctx, accountId, photoId, this.#photoStore),
      askOwner: (itemId, question) => this.#command(() => askOwner(this.#ctx, accountId, itemId, question)),
      reply: (itemId, reply) => this.#command(() => ownerReply(this.#ctx, accountId, itemId, reply)),
      decide: (itemId, decision) => this.#command(() => decide(this.#ctx, accountId, itemId, decision)),
    };
    return {
      ...eachCall(queries, (call) => (...args) => {
        exists();
        return call(...args);
      }),
      ...eachCall(commands, (call) => (...args) => {
        try {
          exists();
        } catch (error) {
          return Promise.reject(error);
        }
        return call(...args);
      }),
    };
  }

  async advanceTo(t: Date): Promise<void> {
    // Before the transaction, never in it: a slow Oura can't hold up other writes.
    // An account whose call throws has no data this tick; the next one retries.
    const fetched = await fetchSleep(this.#ctx, this.#ouraSource, t);
    const checked = await fetchAnki(this.#ctx, this.#ankiSource, this.#ankiPolling, t);
    const { dropped, givenUp } = await this.#command(
      () => {
        // Before this tick's email pass: an email 24 hours old is never tried again.
        const givenUp = alertGivenUpEmails(this.#ctx, giveUpEmails(this.#ctx, t));
        closeEditWindows(this.#ctx, t);
        // Before judging at due times: a check made before a day's due time can still satisfy it.
        recordAnkiChecks(this.#ctx, checked);
        settleAll(this.#ctx, t);
        for (const account of fetched.disconnected) markDisconnected(this.#ctx, "oura", account, fetched.askedAt);
        noteOuraClock(this.#ctx, fetched.sleep);
        judgeNights(this.#ctx, t, fetched.sleep);
        pushNoOuraData(this.#ctx, t);
        const dropped = remind(this.#ctx, t);
        endPastEndDate(this.#ctx, t);
        makeBills(this.#ctx, t);
        remindOverdue(this.#ctx, t);
        remindStale(this.#ctx, t, this.#appUrl);
        this.#ctx.db
          .prepare(
            `INSERT INTO scheduler_state (id, last_tick_at) VALUES (1, ?)
             ON CONFLICT (id) DO UPDATE SET last_tick_at = excluded.last_tick_at`,
          )
          .run(t.toISOString());
        return { dropped, givenUp };
      },
      ({ dropped }) => {
        for (const drop of dropped) {
          this.#ctx.log(
            `reminder dropped: pact ${drop.pactId}, ${drop.time} for ${drop.date}, ` +
              `${Math.floor(drop.lateMs / 60_000)} min late at ${t.toISOString()}`,
          );
        }
      },
      t,
    );
    // Raised once committed. Neither the log line nor the email depends on delivery, and the tick doesn't wait for the email.
    if (dropped.length > 0) {
      this.#raiseOperatorAlert({
        title: "reminders dropped after downtime",
        text: `${droppedText(dropped.length)} after downtime`,
      });
    }
    for (const text of givenUp) this.#raiseOperatorAlert({ title: "daily summary given up", text, withoutEmail: true });
    // Apart from the pushes, and not waited for: a slow mail server never holds up the tick.
    this.#deliverEmails();
    await this.#delivery;
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
    // The log line and the email go first, and even when the database can't say its last tick:
    // they are the channels that never depend on it. The push may not reach a restored database's operator.
    const title = "database restored from backup";
    const said = "database restored from backup; last scheduler tick before the restore";
    let lastTick: string | null;
    try {
      lastTick = this.lastTick()?.toISOString() ?? null;
    } catch (error) {
      this.#raiseOperatorAlert({ title, text: `${said}: unknown, reading it failed: ${String(error)}` });
      throw error;
    }
    this.#raiseOperatorAlert({ title, text: `${said}: ${lastTick ?? "none"}` });
    await this.#command(() => {
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
    });
    await this.#delivery;
  }

  deliveriesSettled(): Promise<void> {
    return this.#delivery;
  }

  async emailsSettled(): Promise<void> {
    await this.#emailPass;
  }

  async close(): Promise<void> {
    await this.#delivery;
    this.#ctx.db.close();
  }
}
