// Money: recording a payment, the payment page and its review, the ledgers,
// Wednesday bills and the reminders while a bill is Overdue.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { clockText, formatDate, money } from "../shared/format.ts";
import type {
  AccountId,
  LedgerEntry,
  LedgerPayment,
  LedgerPenalty,
  LedgerResult,
  LedgerSummary,
  LocalDate,
  NewPayment,
  PaymentResult,
  PaymentView,
  Recipient,
  RecordPaymentRefusal,
  RecordPaymentResult,
  TodayAlert,
  TodayBillCard,
  TodayWaitingItem,
} from "../shared/types.ts";
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
import { localDateOf } from "./calendar.ts";
import type { Command, CoreContext } from "./context.ts";
import { coveredSql, excuseWindowOpensSql } from "./covers.ts";
import { rejection, WEEKLY_COUNT_PACT, weekProgress } from "./occurrence-state.ts";
import { settingIsOff, tellAll } from "./outbox.ts";
import { EXCUSE_WINDOW_MS } from "./pact-rules.ts";
import type { Photo, PhotoStore } from "./ports.ts";
import { textTooLong } from "./text-limits.ts";
import { accountName, accountRow, byName, friendsSortedByName, mergeByTime, recipientName } from "./rows.ts";
import {
  decisionDetails,
  recordDecision,
  reviewStateColumns,
  reviewStateOf,
  thread,
  type Decided,
  type QueuedItem,
  type RequestKindHandler,
  type ReviewOutcome,
  type ReviewStateRow,
} from "./requests.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How often an Overdue owner is reminded, and how often their reviewers are told. */
const OVERDUE_REMINDER_MS = DAY_MS;
const OVERDUE_REVIEWER_NOTICE_MS = 7 * DAY_MS;

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
/** SQL: when the `penalty` row's occurrence's excuse window opens; a bill takes it only once the window has closed. */
const PENALTY_WINDOW_OPENS = excuseWindowOpensSql("penalty.pact_id", "penalty.occurrence_date", "penalty.added_at");
/** SQL: the `penalty` row is held: an excuse or vacation waiting for approval covers its occurrence. */
const PENALTY_HELD = coveredSql("penalty.pact_id", "penalty.occurrence_date", "waiting");
/** SQL: what holds the `penalty` row is a vacation waiting for approval. */
const PENALTY_HELD_BY_VACATION = coveredSql(
  "penalty.pact_id",
  "penalty.occurrence_date",
  "waiting",
  "cover.kind = 'vacation'",
);

export async function recordPayment(
  ctx: CoreContext,
  accountId: AccountId,
  payment: NewPayment,
  screenshot: Photo | null,
  photoStore: PhotoStore,
  command: Command,
): Promise<RecordPaymentResult> {
  const { name: ownerName } = accountRow(ctx, accountId);
  // Refuse cheaply before storing anything, then check again in the
  // transaction that writes, as another payment may have come first.
  const early = paymentAcceptance(ctx, accountId, payment);
  if (!early.ok) return early;
  if (screenshot === null) return { ok: false, reason: "no-screenshot" };
  const { photoId } = await photoStore.store(screenshot);
  return command((): RecordPaymentResult => {
    const acceptance = paymentAcceptance(ctx, accountId, payment);
    if (!acceptance.ok) return acceptance;
    const note = payment.note?.trim() ?? "";
    const paymentId = ctx.newId();
    ctx.db
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
        ctx.clock.now().toISOString(),
      );
    tellAll(ctx, paymentReviewers(ctx, accountId, payment.recipientId), "review-item", {
      itemKind: "payment",
      itemId: paymentId,
      recipientId: payment.recipientId,
      title: `${ownerName} recorded a payment`,
      body: `${money(payment.amountCents)} to ${recipientName(ctx, payment.recipientId)}`,
      url: APP_PATHS.review,
    });
    return { ok: true, paymentId };
  });
}

export function paymentPage(ctx: CoreContext, accountId: AccountId, paymentId: string): PaymentResult {
  const row = ctx.one<ReviewStateRow & PaymentViewRow & { recipient_id: string }>(
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
      reviewerNames: friendsSortedByName(ctx, paymentReviewers(ctx, accountId, row.recipient_id)).map(
        (friend) => friend.name,
      ),
      thread: thread(ctx, row.id, row.decision === null),
    },
  };
}

export function ledgerList(ctx: CoreContext, accountId: AccountId): LedgerSummary[] {
  return ledgerSummaries(ctx, accountId);
}

export function ledgerPage(ctx: CoreContext, accountId: AccountId, recipientId: string): LedgerResult {
  const { timezone } = accountRow(ctx, accountId);
  const [summary] = ledgerSummaries(ctx, accountId, recipientId);
  if (!summary) return { ok: false, reason: "recipient-not-found" };
  const penalties = ledgerPenalties(ctx, accountId, recipientId, timezone);
  // A payment recorded the instant a penalty was added came after it, so it's listed first.
  const history = mergeByTime<LedgerEntry>(
    (entry) => (entry.kind === "penalty" ? entry.addedAt : entry.recordedAt),
    "newest-first",
    ledgerPayments(ctx, accountId, recipientId),
    penalties,
  );
  return { ok: true, ledger: { summary, history } };
}

/** The owner's penalties for `recipientId`, newest first, each with what's paid and the bill it's on or will make. */
function ledgerPenalties(ctx: CoreContext, ownerId: AccountId, recipientId: string, timezone: string): LedgerPenalty[] {
  const penaltyRows = ctx.all<{
    id: string;
    pact_id: string;
    pact_name: string;
    occurrence_date: string;
    amount_cents: number;
    added_at: string;
    excuse_window_opens: string;
    bill_id: string | null;
    held: 0 | 1;
    held_by_vacation: 0 | 1;
    weekly: 0 | 1;
  }>(
    `SELECT penalty.id, penalty.pact_id, pact.name AS pact_name, penalty.occurrence_date,
              penalty.amount_cents, penalty.added_at, ${PENALTY_WINDOW_OPENS} AS excuse_window_opens,
              penalty.bill_id, ${PENALTY_HELD} AS held,
              ${PENALTY_HELD_BY_VACATION} AS held_by_vacation, ${WEEKLY_COUNT_PACT} AS weekly
       FROM penalty JOIN pact ON pact.id = penalty.pact_id
       WHERE penalty.owner_account_id = ? AND penalty.recipient_id = ?
       ORDER BY penalty.added_at DESC, penalty.occurrence_date DESC, pact.name, penalty.id`,
    ownerId,
    recipientId,
  );
  const allocation = allocate(ctx, ownerId, recipientId);
  const bills = billsOf(ctx, ownerId, recipientId);
  const now = ctx.clock.now();
  return penaltyRows.map((row): LedgerPenalty => {
    const held = row.held === 1;
    // Missed with evidence means all of it was rejected, on Fixed days; a short week is its own miss.
    const rejected = row.weekly === 1 ? null : rejection(ctx, row.pact_id, row.occurrence_date);
    const bill = bills.find((b) => b.id === row.bill_id);
    return {
      kind: "penalty",
      penaltyId: row.id,
      pactId: row.pact_id,
      pactName: row.pact_name,
      occurrenceDate: row.occurrence_date,
      amountCents: row.amount_cents,
      ...(row.weekly === 1 && { week: weekProgress(ctx, row.pact_id, row.occurrence_date) }),
      addedAt: new Date(row.added_at),
      paidCents: allocation.get(row.id)?.paidCents ?? 0,
      ...(rejected && { rejection: rejected }),
      held,
      bill: bill
        ? { kind: "on-bill", billedOn: bill.billedOn, dueAt: bill.dueAt }
        : {
            // A rejected excuse or vacation releases it to the next bill it can make after its excuse window,
            // which a vacation's rejection reopens from then (R3).
            kind: !held ? "next-bill" : row.held_by_vacation === 1 ? "if-vacation-rejected" : "if-excuse-rejected",
            billedOn: nextBillDay(row.held_by_vacation === 1 ? now : new Date(row.excuse_window_opens), now, timezone),
          },
    };
  });
}

/**
 * The owner's ledgers, sorted by name: one per recipient a pact names or a
 * penalty went to. Just the one for `recipientId`, if given.
 */
function ledgerSummaries(ctx: CoreContext, ownerId: AccountId, recipientId?: string): LedgerSummary[] {
  const rows = ctx.all<{
    id: string;
    name: string;
    penalty_cents: number;
    held_by_excuse_cents: number;
    held_by_vacation_cents: number;
    paid_cents: number;
    awaiting_cents: number;
    awaiting_count: number;
  }>(
    `SELECT recipient.id, recipient.name,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM penalty
               WHERE penalty.owner_account_id = recipient.owner_account_id
                 AND penalty.recipient_id = recipient.id AND NOT ${PENALTY_HELD}) AS penalty_cents,
              (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE NOT ${PENALTY_HELD_BY_VACATION}), 0) FROM penalty
               WHERE penalty.owner_account_id = recipient.owner_account_id
                 AND penalty.recipient_id = recipient.id AND ${PENALTY_HELD}) AS held_by_excuse_cents,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM penalty
               WHERE penalty.owner_account_id = recipient.owner_account_id
                 AND penalty.recipient_id = recipient.id AND ${PENALTY_HELD_BY_VACATION}) AS held_by_vacation_cents,
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
  const now = ctx.clock.now();
  return rows.sort(byName).map((row) => {
    // An excuse approved after its penalty was paid leaves more paid than
    // owed. The surplus is the ledger's credit: it pays the next penalties
    // (`allocate`), and owed is $0 meanwhile, never below (R12).
    const owedCents = Math.max(0, row.penalty_cents - row.paid_cents);
    const creditCents = Math.max(0, row.paid_cents - row.penalty_cents);
    // A held penalty released by a rejection would take the credit first.
    const creditWaitsOn: LedgerSummary["creditWaitsOn"] =
      creditCents === 0
        ? []
        : [
            ...(row.held_by_excuse_cents > 0 ? (["excuse"] as const) : []),
            ...(row.held_by_vacation_cents > 0 ? (["vacation"] as const) : []),
          ];
    const payableCents = Math.max(0, owedCents - row.awaiting_cents);
    const bills = billsOf(ctx, ownerId, row.id);
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
      creditCents,
      creditWaitsOn,
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
function allocate(
  ctx: CoreContext,
  ownerId: AccountId,
  recipientId: string,
): Map<string, { paidCents: number; coveredCents: number }> {
  const totals = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE decision = 'approved'), 0) AS approved,
              COALESCE(SUM(amount_cents) FILTER (WHERE decision IS NULL), 0) AS awaiting
       FROM payment WHERE owner_account_id = ? AND recipient_id = ?`,
    )
    .get(ownerId, recipientId) as { approved: number; awaiting: number };
  const rows = ctx.all<{ id: string; amount_cents: number }>(
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
function billsOf(ctx: CoreContext, ownerId: AccountId, recipientId: string): BillState[] {
  const allocation = allocate(ctx, ownerId, recipientId);
  const bills = ctx.all<{ id: string; billed_on: LocalDate; due_at: string }>(
    `SELECT id, billed_on, due_at FROM bill WHERE owner_account_id = ? AND recipient_id = ?
       ORDER BY created_at, id`,
    ownerId,
    recipientId,
  );
  return bills.map((bill) => {
    const penalties = ctx.all<{
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
export function makeBills(ctx: CoreContext, t: Date): void {
  const accounts = ctx.all<{
    id: AccountId;
    timezone: string;
    created_at: string;
    billed_through: string | null;
  }>(`SELECT id, timezone, created_at, billed_through FROM account ORDER BY created_at, id`);
  for (const account of accounts) {
    const from = new Date(account.billed_through ?? account.created_at);
    if (from.getTime() >= t.getTime()) continue;
    for (const wednesday of billDays(from, t, account.timezone)) {
      billOwner(ctx, account.id, wednesday, account.timezone);
    }
    ctx.db.prepare(`UPDATE account SET billed_through = ? WHERE id = ?`).run(t.toISOString(), account.id);
  }
}

function billOwner(ctx: CoreContext, ownerId: AccountId, wednesday: LocalDate, timezone: string): void {
  const createdAt = billInstant(wednesday, timezone);
  const dueAt = billInstant(addDays(wednesday, BILL_TERM_DAYS), timezone);
  const excusableAfter = new Date(createdAt.getTime() - EXCUSE_WINDOW_MS).toISOString();
  const recipients = ctx.all<{ recipient_id: string }>(
    `SELECT DISTINCT penalty.recipient_id FROM penalty
       WHERE penalty.owner_account_id = ? AND penalty.bill_id IS NULL AND ${PENALTY_WINDOW_OPENS} <= ?
         AND NOT ${PENALTY_HELD}
       ORDER BY penalty.recipient_id`,
    ownerId,
    excusableAfter,
  );
  for (const { recipient_id: recipientId } of recipients) {
    const billId = ctx.newId();
    ctx.db
      .prepare(
        `INSERT INTO bill (id, owner_account_id, recipient_id, billed_on, created_at, due_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(billId, ownerId, recipientId, wednesday, createdAt.toISOString(), dueAt.toISOString());
    ctx.db
      .prepare(
        `UPDATE penalty SET bill_id = ?
         WHERE owner_account_id = ? AND recipient_id = ? AND bill_id IS NULL AND ${PENALTY_WINDOW_OPENS} <= ?
           AND NOT ${PENALTY_HELD}`,
      )
      .run(billId, ownerId, recipientId, excusableAfter);
    const bill = billsOf(ctx, ownerId, recipientId).find((b) => b.id === billId)!;
    if (bill.unpaidCents === 0) continue;
    ctx.enqueue({
      recipient: ownerId,
      kind: "new-bill",
      payload: {
        recipientId,
        title: `New bill: ${money(bill.unpaidCents)} to ${recipientName(ctx, recipientId)}`,
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
export function remindOverdue(ctx: CoreContext, t: Date): void {
  const ledgers = ctx.all<{
    owner_account_id: AccountId;
    recipient_id: string;
    owner_name: string;
    owner_timezone: string;
  }>(
    `SELECT DISTINCT bill.owner_account_id, bill.recipient_id, account.name AS owner_name,
              account.timezone AS owner_timezone
       FROM bill JOIN account ON account.id = bill.owner_account_id
       WHERE bill.due_at <= ?
       ORDER BY bill.owner_account_id, bill.recipient_id`,
    t.toISOString(),
  );
  for (const {
    owner_account_id: ownerId,
    recipient_id: recipientId,
    owner_name: ownerName,
    owner_timezone: timezone,
  } of ledgers) {
    const overdue = overdueOf(billsOf(ctx, ownerId, recipientId), t);
    if (overdue === null) continue;
    const notice = overdueNotice(ctx, ownerId, recipientId, overdue.spellStartedAt);
    const since = (at: Date | null) => (at === null ? Infinity : t.getTime() - at.getTime());
    const name = recipientName(ctx, recipientId);
    const remind = since(notice.ownerRemindedAt) >= OVERDUE_REMINDER_MS;
    const tell = since(notice.reviewersToldAt) >= OVERDUE_REVIEWER_NOTICE_MS;
    if (remind) {
      ctx.enqueue({
        recipient: ownerId,
        kind: "overdue-bill",
        payload: {
          recipientId,
          title: `${money(overdue.cents)} overdue to ${name}`,
          body: `Your ${formatDate(overdue.billedOn)} bill was due ${formatDate(localDateOf(overdue.dueAt, timezone))}. Record your payment.`,
          url: APP_PATHS.ledger(recipientId),
        },
      });
    }
    if (tell) {
      for (const reviewerId of paymentReviewers(ctx, ownerId, recipientId)) {
        ctx.enqueue({
          recipient: reviewerId,
          kind: "overdue-bill",
          payload: {
            recipientId,
            title: `${ownerName} is overdue`,
            body: `${money(overdue.cents)} to ${name}, due ${formatDate(localDateOf(overdue.dueAt, timezone))}`,
            url: APP_PATHS.today,
          },
        });
      }
    }
    if (remind || tell) {
      ctx.db
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
function overdueNotice(
  ctx: CoreContext,
  ownerId: AccountId,
  recipientId: string,
  spellStartedAt: Date,
): { ownerRemindedAt: Date | null; reviewersToldAt: Date | null } {
  const row = ctx.one<{ owner_reminded_at: string | null; reviewers_told_at: string | null }>(
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

/** Today's bill cards and overdue alerts: one of each at most per recipient. */
export function billsForToday(
  ctx: CoreContext,
  ownerId: AccountId,
  now: Date,
): { cards: TodayBillCard[]; alerts: TodayAlert[] } {
  const cards: TodayBillCard[] = [];
  const alerts: TodayAlert[] = [];
  const recipients = ctx.all<Recipient>(
    `SELECT DISTINCT recipient.id, recipient.name FROM bill
       JOIN recipient ON recipient.id = bill.recipient_id
       WHERE bill.owner_account_id = ?`,
    ownerId,
  );
  for (const { id: recipientId, name } of recipients.sort(byName)) {
    const bills = billsOf(ctx, ownerId, recipientId);
    const overdue = overdueOf(bills, now);
    if (overdue !== null) {
      // Named only once the core has told them in this spell: until the scheduler's next tick, nobody has been.
      // A reviewer with overdue notifications off is never told, so never named.
      const told = overdueNotice(ctx, ownerId, recipientId, overdue.spellStartedAt).reviewersToldAt !== null;
      alerts.push({
        kind: "bill-overdue",
        recipientId,
        recipientName: name,
        overdueCents: overdue.cents,
        billedOn: overdue.billedOn,
        dueAt: overdue.dueAt,
        reviewerNames: told
          ? friendsSortedByName(
              ctx,
              paymentReviewers(ctx, ownerId, recipientId).filter((id) => !settingIsOff(ctx, id, "overdue-bill")),
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
function ledgerPayments(ctx: CoreContext, ownerId: AccountId, recipientId: string): LedgerPayment[] {
  const rows = ctx.all<
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
function paymentAcceptance(
  ctx: CoreContext,
  ownerId: AccountId,
  payment: NewPayment,
): { ok: true } | { ok: false; reason: RecordPaymentRefusal } {
  const isOwnRecipient = ctx.db
    .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
    .get(payment.recipientId, ownerId);
  if (!isOwnRecipient) return { ok: false, reason: "recipient-not-found" };
  if (textTooLong(payment.note)) return { ok: false, reason: "text-too-long" };
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
    return { ok: false, reason: "invalid-amount" };
  }
  // A recipient no pact names and with no penalties has no ledger: nothing is owed.
  const [ledger] = ledgerSummaries(ctx, ownerId, payment.recipientId);
  if (payment.amountCents > (ledger?.payableCents ?? 0)) return { ok: false, reason: "payment-exceeds-owed" };
  return { ok: true };
}

/** Payments awaiting approval that `reviewerId` may decide, oldest recorded first. */
function paymentsToReview(ctx: CoreContext, reviewerId: AccountId): QueuedItem[] {
  const rows = ctx.all<
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
  return rows.map((row) => {
    const owedCents = ledgerSummaries(ctx, row.owner_account_id, row.recipient_id)[0]?.owedCents ?? 0;
    return {
      item: {
        kind: "payment",
        ...paymentView(row),
        ownerName: row.owner_name,
        owedCents,
        owedAfterApprovalCents: Math.max(0, owedCents - row.amount_cents),
        thread: thread(ctx, row.id, true),
      },
      since: new Date(row.recorded_at),
    };
  });
}

/** Who reviews payments from `ownerId` to `recipientId`, each once. */
export function paymentReviewers(ctx: CoreContext, ownerId: AccountId, recipientId: string): AccountId[] {
  return ctx
    .all<{ reviewer_account_id: AccountId }>(
      `SELECT DISTINCT reviewer_account_id FROM (${paymentReviewersSql("@owner", "@recipient")})
         ORDER BY reviewer_account_id`,
      { owner: ownerId, recipient: recipientId },
    )
    .map((row) => row.reviewer_account_id);
}

/**
 * Records a reviewer's decision on a payment awaiting approval and tells
 * the owner. Approved, it counts against the ledger; rejected, it never did.
 */
export function decidePayment(
  ctx: CoreContext,
  payment: PaymentToDecide,
  decided: Decided,
  reviewerId: AccountId,
): void {
  const { outcome, reason } = decided;
  recordDecision(ctx, "payment", payment.id, decided, reviewerId, ctx.clock.now());
  const paid = `${money(payment.amount_cents)} to ${recipientName(ctx, payment.recipient_id)}`;
  ctx.enqueue({
    recipient: payment.owner_account_id,
    kind: "payment-decided",
    payload: {
      itemKind: "payment",
      itemId: payment.id,
      recipientId: payment.recipient_id,
      ...decisionDetails(decided),
      title: `${accountName(ctx, reviewerId)} ${outcome} your payment`,
      body: reason === null ? paid : `${paid} · “${reason}”`,
      url: APP_PATHS.ledger(payment.recipient_id),
    },
  });
}

/**
 * Payments as review items: decided by the reviewers of any of the owner's
 * pacts with the recipient (`paymentReviewersSql`). The pact page lists none.
 */
export const paymentKind: RequestKindHandler<PaymentToDecide> = {
  kind: "payment",
  load: (ctx, id) =>
    ctx.one<PaymentToDecide>(
      `SELECT id, 'payment' AS kind, NULL AS withdrawn_at, NULL AS withdrawn_reason, owner_account_id, recipient_id,
              amount_cents, decision
         FROM payment WHERE id = ?`,
      id,
    ),
  deciders: (ctx, payment) => paymentReviewers(ctx, payment.owner_account_id, payment.recipient_id),
  apply: (ctx, payment, decided, reviewerId) => decidePayment(ctx, payment, decided, reviewerId),
  describe: (ctx, payment) => ({
    what: `${money(payment.amount_cents)} payment to ${recipientName(ctx, payment.recipient_id)}`,
    ownerPath: APP_PATHS.payment(payment.id),
  }),
  queue: paymentsToReview,
  waiting: (ctx, ownerId, pactId) => (pactId === undefined ? waitingPayments(ctx, ownerId) : []),
  itemsWithPhoto: (ctx, photoId) =>
    ctx.all<{ id: string }>(`SELECT id FROM payment WHERE photo_id = ?`, photoId).map((row) => row.id),
  // A payment belongs to a recipient, not a pact; and it's never moot: approving one always changes the ledger.
  pactNames: () => [],
};

/** The owner's payments still waiting for a decision, newest first. */
function waitingPayments(ctx: CoreContext, ownerId: AccountId): TodayWaitingItem[] {
  return ctx
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
export interface PaymentToDecide {
  id: string;
  kind: "payment";
  /** A payment is never withdrawn. */
  withdrawn_at: null;
  withdrawn_reason: null;
  owner_account_id: AccountId;
  recipient_id: string;
  amount_cents: number;
  decision: ReviewOutcome | null;
}
