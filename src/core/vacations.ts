// Vacations: what one would cover, filing it, the owner's vacations,
// withdrawing one while it waits, and its review by the reviewers picked.

import { APP_PATHS } from "../shared/api.ts";
import { addDays, dayCount } from "../shared/calendar.ts";
import { dateSpan, daysText, formatDayTime, pactNamesText } from "../shared/format.ts";
import { lastDayOf } from "../shared/schedules.ts";
import {
  MAX_EXCUSE_SPAN_DAYS,
  type AcceptVacationRejectionResult,
  type AccountId,
  type ExcusableDays,
  type TodayAlert,
  type TodayVacation,
  type TodayWaitingItem,
  type VacationCover,
  type VacationState,
  type FileVacationResult,
  type LastVacation,
  type LocalDate,
  type NewVacation,
  type VacationCard,
  type WithdrawVacationResult,
  type VacationOccurrence,
  type VacationOptions,
  type VacationPactOption,
  type VacationPactPreview,
  type VacationPacts,
  type VacationPreview,
  type VacationPreviewResult,
  type VacationRequest,
  type VacationSkipReason,
  type Schedule,
  type WithdrawnReason,
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { coveredSql, coverOn, coversOn, excusableUntil, excuseWindowOpensSql } from "./covers.ts";
import { dueAfterEnd, occurrenceSpan } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import { isLocalDate } from "./pact-rules.ts";
import { assertHoldsNoPenalty, mootReason, type TouchedOccurrence } from "./moot.ts";
import { settleCoverDays } from "./settle.ts";
import { textTooLong } from "./text-limits.ts";
import { tripAheadOf } from "./trips.ts";
import {
  accountName,
  accountRow,
  editWindowCutoff,
  friendsSortedByName,
  occurrencesOf,
  reviewersOf,
  scheduleOf,
  termsOn,
  type PactRow,
} from "./rows.ts";
import {
  decisionDetails,
  recordDecision,
  thread,
  type Decided,
  type QueuedItem,
  type RequestKindHandler,
  type ReviewOutcome,
} from "./requests.ts";

export function vacationOptions(ctx: CoreContext, ownerId: AccountId): VacationOptions {
  const now = ctx.clock.now();
  const { timezone } = accountRow(ctx, ownerId);
  const offered = offeredPacts(ctx, ownerId, timezone, now).map((pact): VacationPactOption => ({
    ...pact,
    reviewers: friendsSortedByName(ctx, reviewersOf(ctx, pact.id)),
  }));
  const inEditWindow =
    ctx.one(
      `SELECT 1 FROM pact WHERE owner_account_id = ? AND stage = 'active' AND created_at > ?`,
      ownerId,
      editWindowCutoff(ctx, now),
    ) !== undefined;
  return {
    today: localDateOf(now, timezone),
    recurring: offered.filter((pact) => pact.schedule.kind !== "one-time"),
    oneTime: offered.filter((pact) => pact.schedule.kind === "one-time"),
    inEditWindow,
  };
}

/** The owner's Active pacts whose edit window has closed at `now`: recurring ones first, then One-time, each oldest first. */
function offeredPacts(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
  now: Date,
): Omit<VacationPactOption, "reviewers">[] {
  const rows = ctx.all<PactRow>(
    `SELECT * FROM pact WHERE owner_account_id = ? AND stage = 'active' AND created_at <= ?
     ORDER BY created_at, id`,
    ownerId,
    editWindowCutoff(ctx, now),
  );
  const offered = rows.map((row): Omit<VacationPactOption, "reviewers"> => {
    const schedule = scheduleOf(row.schedule);
    return {
      id: row.id,
      name: row.name,
      evidenceKind: row.evidence_kind,
      schedule,
      penaltyCents: row.penalty_cents,
      alreadyOpen:
        schedule.kind === "one-time" && occurrencesOf(ctx, row.id, timezone).first.opensAt.getTime() <= now.getTime(),
    };
  });
  return offered.toSorted((a, b) => Number(a.schedule.kind === "one-time") - Number(b.schedule.kind === "one-time"));
}

export function previewVacation(ctx: CoreContext, ownerId: AccountId, request: VacationRequest): VacationPreviewResult {
  const { timezone } = accountRow(ctx, ownerId);
  return vacationPreview(ctx, ownerId, timezone, request, ctx.clock.now());
}

/**
 * What a vacation with `request` would cover at `now` for each of the
 * owner's offered pacts, or why it's refused. Filing records exactly this.
 */
function vacationPreview(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
  { from, to, pactIds }: VacationRequest,
  now: Date,
): VacationPreviewResult {
  if (!isLocalDate(from) || !isLocalDate(to) || to < from) return { ok: false, reason: "invalid-dates" };
  if (from <= localDateOf(now, timezone)) return { ok: false, reason: "not-after-today" };
  if (to > addDays(from, MAX_EXCUSE_SPAN_DAYS - 1)) return { ok: false, reason: "too-many-days" };
  const offered = offeredPacts(ctx, ownerId, timezone, now);
  const tickable = new Set(offered.filter((pact) => !pact.alreadyOpen).map((pact) => pact.id));
  if (pactIds.some((id) => !tickable.has(id))) return { ok: false, reason: "pact-not-offered" };
  const ticked = new Set(pactIds);
  const pacts = offered.map((pact): VacationPactPreview => ({
    pactId: pact.id,
    ticked: ticked.has(pact.id),
    ...pactPreview(ctx, pact.id, timezone, from, to, now),
  }));
  const preview: VacationPreview = {
    days: dayCount(from, to),
    pacts,
    summary: summaryOf(
      offered,
      offered.filter((pact) => ticked.has(pact.id)),
    ),
    coversNothing: pacts.every((pact) => !pact.ticked || pact.covered.length === 0),
  };
  return { ok: true, preview };
}

/**
 * The pact's occurrences from `from` to `to` that a vacation filed at `now`
 * would cover or skip: each one whose `coveringDays` are inside (the periods
 * it touches with them outside are `notCovered`). A period it doesn't cover,
 * or skips as already open, that it would be a trip ahead of has the day to
 * do it by. An Ended pact has no occurrences after its end.
 */
function pactPreview(
  ctx: CoreContext,
  pactId: string,
  timezone: string,
  from: LocalDate,
  to: LocalDate,
  now: Date,
): Pick<VacationPactPreview, "covered" | "skipped" | "notCovered"> {
  const result: Pick<VacationPactPreview, "covered" | "skipped" | "notCovered"> = {
    covered: [],
    skipped: [],
    notCovered: [],
  };
  const today = localDateOf(now, timezone);
  for (const occurrence of occurrencesOf(ctx, pactId, timezone).overlapping(from, to)) {
    if (dueAfterEnd(ctx, pactId, occurrence)) continue;
    const schedule = scheduleOf(termsOn(ctx, pactId, occurrence.date).schedule);
    const span: VacationOccurrence = occurrenceSpan(ctx, pactId, occurrence);
    // A period it would leave to do is due before it starts.
    const doItBy = tripAheadOf(schedule, occurrence.date, from, to, today)?.doItBy;
    const entry = doItBy === undefined ? span : { ...span, doItBy };
    const covering = coveringDays(schedule, occurrence.date);
    if (covering.first < from || covering.last > to) {
      if (entry.through !== undefined) result.notCovered.push(entry);
      continue;
    }
    const reason = vacationSkipReason(ctx, pactId, occurrence, now);
    if (reason === null) result.covered.push(span);
    else result.skipped.push({ ...(reason === "already-open" ? entry : span), reason });
  }
  return result;
}

/**
 * The days a vacation must take in to cover the occurrence on `schedule`
 * dated `date`: a day's own day; a week's Thursday, the middle of its
 * Mon–Sun, so a vacation starting on a Sunday doesn't take the week before;
 * the whole second week of two; the 15th of a month to its last day.
 */
function coveringDays(schedule: Schedule, date: LocalDate): { first: LocalDate; last: LocalDate } {
  switch (schedule.kind) {
    case "weekly-count":
      return { first: addDays(date, 3), last: addDays(date, 3) };
    case "every-2-weeks":
      return { first: addDays(date, 7), last: lastDayOf(schedule, date) };
    case "once-a-month":
      return { first: addDays(date, 14), last: lastDayOf(schedule, date) };
    case "fixed-days":
    case "one-time":
      return { first: date, last: date };
  }
}

/** Why a vacation filed at `now` can't cover the pact's `occurrence`, or null if it can. */
function vacationSkipReason(
  ctx: CoreContext,
  pactId: string,
  occurrence: Occurrence,
  now: Date,
): VacationSkipReason | null {
  if (occurrence.opensAt.getTime() <= now.getTime()) return "already-open";
  if (coversOn(ctx, pactId, occurrence.date).some((c) => c.kind === "vacation")) return "on-vacation";
  const cover = coverOn(ctx, pactId, occurrence.date);
  if (cover?.state === "waiting") return "on-waiting-excuse";
  return cover?.state === "approved" ? "excused" : null;
}

/**
 * Which pacts `ticked` are, among the `offered` ones: all of those that can
 * be ticked, every recurring one and no One-time one, or their names.
 */
function summaryOf(
  offered: Pick<VacationPactOption, "id" | "schedule" | "alreadyOpen">[],
  ticked: Pick<VacationPactOption, "id" | "name" | "schedule">[],
): VacationPacts {
  const has = new Set(ticked.map((pact) => pact.id));
  const tickable = offered.filter((pact) => !pact.alreadyOpen);
  if (ticked.length > 0 && tickable.every((pact) => has.has(pact.id))) return { kind: "all" };
  const recurring = tickable.filter((pact) => pact.schedule.kind !== "one-time");
  if (
    recurring.length > 0 &&
    recurring.every((pact) => has.has(pact.id)) &&
    ticked.every((pact) => pact.schedule.kind !== "one-time")
  ) {
    return { kind: "all-recurring" };
  }
  return { kind: "some", names: ticked.map((pact) => pact.name) };
}

export function fileVacation(ctx: CoreContext, ownerId: AccountId, vacation: NewVacation): FileVacationResult {
  const now = ctx.clock.now();
  const { timezone } = accountRow(ctx, ownerId);
  const pactIds = [...new Set(vacation.pactIds)];
  const reviewerIds = [...new Set(vacation.reviewerIds)];
  if (pactIds.length === 0) return { ok: false, reason: "no-pacts" };
  const checked = vacationPreview(ctx, ownerId, timezone, { ...vacation, pactIds }, now);
  if (!checked.ok) return checked;
  if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
  const offered = new Set(pactIds.flatMap((pactId) => reviewersOf(ctx, pactId)));
  if (reviewerIds.some((id) => !offered.has(id))) return { ok: false, reason: "reviewer-not-offered" };
  if (checked.preview.coversNothing) return { ok: false, reason: "nothing-to-cover" };
  if (textTooLong(vacation.note)) return { ok: false, reason: "text-too-long" };
  const note = vacation.note?.trim() || null;
  const vacationId = ctx.newId();
  ctx.db
    .prepare(
      `INSERT INTO vacation (id, owner_account_id, first_day, last_day, note, pacts_summary, filed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(vacationId, ownerId, vacation.from, vacation.to, note, checked.preview.summary.kind, now.toISOString());
  for (const pactId of pactIds) {
    ctx.db.prepare(`INSERT INTO vacation_pact (vacation_id, pact_id) VALUES (?, ?)`).run(vacationId, pactId);
  }
  for (const reviewerId of reviewerIds) {
    ctx.db
      .prepare(`INSERT INTO vacation_reviewer (vacation_id, reviewer_account_id) VALUES (?, ?)`)
      .run(vacationId, reviewerId);
  }
  for (const pact of checked.preview.pacts) {
    if (!pact.ticked) continue;
    for (const { date } of pact.covered) {
      ctx.db
        .prepare(`INSERT INTO vacation_day (vacation_id, pact_id, date) VALUES (?, ?, ?)`)
        .run(vacationId, pact.pactId, date);
    }
  }
  tellVacationFiled(ctx, vacationDeciders(ctx, vacationId), {
    id: vacationId,
    owner_account_id: ownerId,
    first_day: vacation.from,
    last_day: vacation.to,
  });
  return { ok: true, vacationId };
}

/** A `vacation` row with what Profile and the review item show of it. */
interface VacationRow {
  id: string;
  owner_account_id: AccountId;
  first_day: LocalDate;
  last_day: LocalDate;
  note: string | null;
  pacts_summary: VacationPacts["kind"];
  filed_at: string;
  decision: ReviewOutcome | null;
  decided_by_account_id: AccountId | null;
}

const VACATION_COLUMNS = `vacation.id, vacation.owner_account_id, vacation.first_day, vacation.last_day, vacation.note,
  vacation.pacts_summary, vacation.filed_at, vacation.decision, vacation.decided_by_account_id`;

/**
 * The owner's vacations waiting for approval (or on their reply), and those
 * approved whose last day hasn't passed, soonest first.
 */
export function vacationCards(ctx: CoreContext, ownerId: AccountId): VacationCard[] {
  const today = localDateOf(ctx.clock.now(), accountRow(ctx, ownerId).timezone);
  const rows = ctx.all<VacationRow>(
    `SELECT ${VACATION_COLUMNS} FROM vacation
     WHERE owner_account_id = ? AND withdrawn_at IS NULL
       AND (decision IS NULL OR (decision = 'approved' AND last_day >= ?))
     ORDER BY first_day, filed_at, id`,
    ownerId,
    today,
  );
  return rows.map((row) => ({
    ...vacationSummary(ctx, row),
    state: vacationState(ctx, row, today),
    ...heldTotal(coveredPenalties(ctx, row.id), true),
  }));
}

/** The owner's approved vacation whose last day passed most recently, or null when none has. */
export function lastVacation(ctx: CoreContext, ownerId: AccountId): LastVacation | null {
  const today = localDateOf(ctx.clock.now(), accountRow(ctx, ownerId).timezone);
  const row = ctx.one<{ first_day: LocalDate; last_day: LocalDate }>(
    `SELECT first_day, last_day FROM vacation
     WHERE owner_account_id = ? AND decision = 'approved' AND last_day < ?
     ORDER BY last_day DESC, filed_at DESC, id
     LIMIT 1`,
    ownerId,
    today,
  );
  return row ? { from: row.first_day, to: row.last_day } : null;
}

/** The owner's approved vacations whose days include `today`, soonest first, as Today's banner shows them. */
export function vacationsOnNow(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
  today: LocalDate,
): TodayVacation[] {
  const rows = ctx.all<VacationRow>(
    `SELECT ${VACATION_COLUMNS} FROM vacation
     WHERE owner_account_id = ? AND decision = 'approved' AND first_day <= ? AND last_day >= ?
     ORDER BY first_day, filed_at, id`,
    ownerId,
    today,
    today,
  );
  return rows.map((row) => ({ ...vacationBasics(ctx, row), covers: vacationCovers(ctx, row.id, timezone, []) }));
}

/** What a vacation's Profile card and review item both show: its dates, note, pacts and who decides it now. */
function vacationSummary(
  ctx: CoreContext,
  row: VacationRow,
): Pick<VacationCard, "id" | "from" | "to" | "days" | "note" | "pacts" | "reviewerNames"> {
  return {
    ...vacationBasics(ctx, row),
    days: dayCount(row.first_day, row.last_day),
    reviewerNames: friendsSortedByName(ctx, vacationDeciders(ctx, row.id)).map((reviewer) => reviewer.name),
  };
}

/** A vacation's dates, note and pacts, as Today's banner and its Profile card show them. */
function vacationBasics(
  ctx: CoreContext,
  row: VacationRow,
): Pick<VacationCard, "id" | "from" | "to" | "note" | "pacts"> {
  const names = ctx
    .all<{ name: string }>(
      `SELECT pact.name FROM vacation_pact JOIN pact ON pact.id = vacation_pact.pact_id
       WHERE vacation_pact.vacation_id = ? ORDER BY pact.created_at, pact.id`,
      row.id,
    )
    .map((pact) => pact.name);
  return {
    id: row.id,
    from: row.first_day,
    to: row.last_day,
    note: row.note,
    pacts: row.pacts_summary === "some" ? { kind: "some", names } : { kind: row.pacts_summary },
  };
}

/**
 * Where a vacation not withdrawn stands for its owner on `today`: waiting,
 * waiting on their reply, approved ahead, or on now.
 */
function vacationState(ctx: CoreContext, row: VacationRow, today: LocalDate): VacationState {
  if (row.decision === "approved") {
    return row.first_day <= today
      ? { kind: "on-now" }
      : { kind: "approved", reviewerName: accountName(ctx, row.decided_by_account_id!) };
  }
  const { comments, waitingOnReply } = thread(ctx, row.id, row.decision === null);
  const asked = comments.at(-1);
  return waitingOnReply && asked
    ? { kind: "waiting-on-reply", askedBy: asked.authorName, question: asked.text }
    : { kind: "waiting" };
}

/**
 * Who may decide the vacation (rule R5): the reviewers picked at filing who
 * still review at least one of its pacts, or with none left, every current
 * reviewer of one of them.
 */
export function vacationDeciders(ctx: CoreContext, vacationId: string): AccountId[] {
  const pactIds = ctx
    .all<{ pact_id: string }>(`SELECT pact_id FROM vacation_pact WHERE vacation_id = ?`, vacationId)
    .map((row) => row.pact_id);
  const current = new Set(pactIds.flatMap((pactId) => reviewersOf(ctx, pactId)));
  const stillPicked = pickedReviewers(ctx, vacationId).filter((id) => current.has(id));
  return stillPicked.length > 0 ? stillPicked : [...current].sort();
}

/**
 * Runs `removeReviewers`, which takes reviewers off `pactId`, and tells each
 * account it makes a decider of a waiting vacation covering the pact about
 * that vacation, as filing told the picked reviewers: the last picked
 * reviewer gone, a current reviewer decides it (rule R5).
 */
export function tellNewVacationDeciders(ctx: CoreContext, pactId: string, removeReviewers: () => void): void {
  const waiting = ctx.all<{ id: string; owner_account_id: AccountId; first_day: LocalDate; last_day: LocalDate }>(
    `SELECT vacation.id, vacation.owner_account_id, vacation.first_day, vacation.last_day FROM vacation
     JOIN vacation_pact ON vacation_pact.vacation_id = vacation.id AND vacation_pact.pact_id = ?
     WHERE vacation.decision IS NULL AND vacation.withdrawn_at IS NULL
     ORDER BY vacation.filed_at, vacation.id`,
    pactId,
  );
  const before = new Map(waiting.map((row) => [row.id, vacationDeciders(ctx, row.id)]));
  removeReviewers();
  for (const row of waiting) {
    const added = vacationDeciders(ctx, row.id).filter((id) => !before.get(row.id)!.includes(id));
    tellVacationFiled(ctx, added, row);
  }
}

/** Tells `reviewerIds` the vacation waits for their decision. */
function tellVacationFiled(
  ctx: CoreContext,
  reviewerIds: AccountId[],
  vacation: { id: string; owner_account_id: AccountId; first_day: LocalDate; last_day: LocalDate },
): void {
  tellAll(ctx, reviewerIds, "review-item", {
    itemKind: "vacation",
    itemId: vacation.id,
    title: `${accountName(ctx, vacation.owner_account_id)} asked for a vacation`,
    body: dateSpan(vacation.first_day, vacation.last_day),
    url: APP_PATHS.review,
  });
}

/** The reviewers the owner picked for the vacation when filing it. */
export function pickedReviewers(ctx: CoreContext, vacationId: string): AccountId[] {
  return ctx
    .all<{ reviewer_account_id: AccountId }>(
      `SELECT reviewer_account_id FROM vacation_reviewer WHERE vacation_id = ?`,
      vacationId,
    )
    .map((reviewer) => reviewer.reviewer_account_id);
}

/**
 * The ticked pacts with something covered, oldest pact first, each with its
 * covered occurrences as they stand now: a day an approved change took off
 * the schedule isn't one any more.
 */
function vacationCovers(
  ctx: CoreContext,
  vacationId: string,
  timezone: string,
  held: CoveredPenalty[],
): VacationCover[] {
  const pacts = ctx.all<PactRow>(
    `SELECT pact.* FROM vacation_pact JOIN pact ON pact.id = vacation_pact.pact_id
     WHERE vacation_pact.vacation_id = ? ORDER BY pact.created_at, pact.id`,
    vacationId,
  );
  const days = ctx.all<{ pact_id: string; date: LocalDate }>(
    `SELECT pact_id, date FROM vacation_day WHERE vacation_id = ? ORDER BY date`,
    vacationId,
  );
  return pacts.flatMap((pact): VacationCover[] => {
    const { covering } = occurrencesOf(ctx, pact.id, timezone);
    const covered = days
      .filter((day) => day.pact_id === pact.id)
      .flatMap(({ date }) => {
        const occurrence = covering(date);
        return occurrence ? [occurrenceSpan(ctx, pact.id, occurrence)] : [];
      });
    if (covered.length === 0) return [];
    // A held penalty's date is a covered occurrence's, so it shows as that occurrence: a Weekly count one as its week.
    const mine = held
      .filter((penalty) => penalty.pact_id === pact.id)
      .flatMap(({ date, amount_cents: penaltyCents }) =>
        covered.filter((span) => span.date === date).map((span) => ({ ...span, penaltyCents })),
      );
    return [
      {
        pactId: pact.id,
        name: pact.name,
        evidenceKind: pact.evidence_kind,
        schedule: scheduleOf(pact.schedule),
        covered,
        ...(mine.length > 0 && { held: mine }),
      },
    ];
  });
}

/**
 * The penalties of the vacation's covered occurrences Missed so far, oldest
 * first: held while it waits for approval. Approving removes them, and
 * rejecting or withdrawing it makes them owed.
 */
function coveredPenalties(ctx: CoreContext, vacationId: string): CoveredPenalty[] {
  return ctx.all(
    `SELECT vacation_day.pact_id, vacation_day.date, penalty.amount_cents, penalty.added_at FROM vacation_day
     JOIN penalty ON penalty.pact_id = vacation_day.pact_id AND penalty.occurrence_date = vacation_day.date
     WHERE vacation_day.vacation_id = ? ORDER BY vacation_day.date, vacation_day.pact_id`,
    vacationId,
  );
}

interface CoveredPenalty {
  pact_id: string;
  date: LocalDate;
  amount_cents: number;
  added_at: string;
}

/**
 * The total of the vacation's held penalties, as `heldCents`, and with
 * `dates`, their first and last day; left out when none are held.
 */
function heldTotal(held: CoveredPenalty[], dates = false): Pick<VacationCard, "heldCents" | "heldDates"> {
  const cents = held.reduce((sum, penalty) => sum + penalty.amount_cents, 0);
  if (cents === 0) return {};
  const days = held.map((penalty) => penalty.date).toSorted();
  return {
    heldCents: cents,
    ...(dates && { heldDates: { firstDate: days[0]!, lastDate: days.at(-1)! } }),
  };
}

/** Vacations waiting for approval that `reviewerId` may decide (`vacationDeciders`), oldest first. */
function vacationsToReview(ctx: CoreContext, reviewerId: AccountId): QueuedItem[] {
  const rows = ctx.all<VacationRow & { owner_name: string; timezone: string }>(
    `SELECT ${VACATION_COLUMNS}, owner.name AS owner_name, owner.timezone
     FROM vacation
     JOIN account AS owner ON owner.id = vacation.owner_account_id
     WHERE vacation.decision IS NULL AND vacation.withdrawn_at IS NULL
       AND EXISTS (SELECT 1 FROM vacation_pact JOIN pact_reviewer ON pact_reviewer.pact_id = vacation_pact.pact_id
                   WHERE vacation_pact.vacation_id = vacation.id AND pact_reviewer.reviewer_account_id = ?)
     ORDER BY vacation.filed_at, vacation.id`,
    reviewerId,
  );
  return rows
    .filter((row) => vacationDeciders(ctx, row.id).includes(reviewerId))
    .map((row) => {
      const held = coveredPenalties(ctx, row.id);
      const filedAt = new Date(row.filed_at);
      return {
        item: {
          kind: "vacation",
          ...vacationSummary(ctx, row),
          ownerName: row.owner_name,
          covers: vacationCovers(ctx, row.id, row.timezone, held),
          ...heldTotal(held),
          filedAt,
          thread: thread(ctx, row.id, true),
        },
        since: filedAt,
      };
    });
}

/** A vacation a reviewer is deciding on, as `decide` reads it. */
export interface VacationToDecide {
  id: string;
  kind: "vacation";
  decision: ReviewOutcome | null;
  withdrawn_at: string | null;
  withdrawn_reason: WithdrawnReason | null;
  owner_account_id: AccountId;
  first_day: LocalDate;
  last_day: LocalDate;
}

/**
 * The owner's vacations waiting for a decision (or those covering a day of
 * `pactId`), newest first.
 */
function waitingVacations(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
  const rows = ctx.all<{ id: string; first_day: LocalDate; last_day: LocalDate; filed_at: string }>(
    `SELECT id, first_day, last_day, filed_at FROM vacation
     WHERE owner_account_id = ? AND decision IS NULL AND withdrawn_at IS NULL
       AND (? IS NULL OR EXISTS (SELECT 1 FROM vacation_day
                                 WHERE vacation_day.vacation_id = vacation.id AND vacation_day.pact_id = ?))
     ORDER BY filed_at DESC, id`,
    ownerId,
    pactId ?? null,
    pactId ?? null,
  );
  return rows.map((row) => ({
    kind: "vacation",
    id: row.id,
    firstDate: row.first_day,
    lastDate: row.last_day,
    filedAt: new Date(row.filed_at),
  }));
}

/**
 * Vacations as review items: decided by the picked reviewers who still
 * review a covered pact, else any current reviewer of one (rule R5). The owner's waiting list has it, and the page of each pact it
 * covers a day of.
 */
export const vacationKind: RequestKindHandler<VacationToDecide> = {
  kind: "vacation",
  load: (ctx, id) =>
    ctx.one<VacationToDecide>(
      `SELECT id, 'vacation' AS kind, decision, withdrawn_at, withdrawn_reason, owner_account_id, first_day, last_day
         FROM vacation WHERE id = ?`,
      id,
    ),
  deciders: (ctx, vacation) => vacationDeciders(ctx, vacation.id),
  apply: decideVacation,
  describe: () => ({ what: "vacation", ownerPath: APP_PATHS.profile }),
  queue: vacationsToReview,
  waiting: waitingVacations,
  pactNames: (ctx, vacation) =>
    ctx
      .all<{ name: string }>(
        `SELECT pact.name FROM vacation_pact JOIN pact ON pact.id = vacation_pact.pact_id
         WHERE vacation_pact.vacation_id = ? ORDER BY pact.created_at, pact.id`,
        vacation.id,
      )
      .map((pact) => pact.name),
  moot: {
    waitingIds: (ctx) =>
      ctx
        .all<{ id: string }>(
          `SELECT id FROM vacation WHERE decision IS NULL AND withdrawn_at IS NULL ORDER BY filed_at, id`,
        )
        .map((row) => row.id),
    // Only when no covered day left on any pact could still be excused by it.
    reason: (ctx, vacation, now) => mootReason(ctx, vacation.id, vacationOccurrences(ctx, vacation.id), now),
    withdraw: (ctx, vacation, reason, now) => {
      assertHoldsNoPenalty(ctx, vacation.id, vacationOccurrences(ctx, vacation.id));
      ctx.db
        .prepare(`UPDATE vacation SET withdrawn_at = ?, withdrawn_reason = ? WHERE id = ?`)
        .run(now.toISOString(), reason, vacation.id);
    },
  },
};

/** The occurrences a vacation covers on every pact, by date. */
function vacationOccurrences(ctx: CoreContext, vacationId: string): TouchedOccurrence[] {
  return ctx.all<TouchedOccurrence>(
    `SELECT pact_id, date FROM vacation_day WHERE vacation_id = ? ORDER BY pact_id, date`,
    vacationId,
  );
}

/**
 * Records a decider's decision on a vacation waiting for approval
 * and tells the owner, and settles every covered day of every pact
 * (`settleCoverDays`). Approved: they're excused at once, as an approved
 * excuse's are, and every other reviewer of a pact with a covered day is
 * told (`tellOtherReviewers`). Rejected: its held penalties are owed by no
 * longer waiting, its days are judged as usual, and Today raises an alert
 * (`rejectedVacationAlerts`).
 */
export function decideVacation(
  ctx: CoreContext,
  vacation: VacationToDecide,
  decided: Decided,
  reviewerId: AccountId,
): void {
  const now = ctx.clock.now();
  recordDecision(ctx, "vacation", vacation.id, decided, reviewerId, now);
  settleVacationDays(ctx, vacation.id, now);
  const { first_day: from, last_day: to } = vacation;
  const released = decided.outcome === "rejected" ? releasedDays(ctx, vacation.id, now.toISOString(), now) : null;
  const { timezone } = accountRow(ctx, vacation.owner_account_id);
  ctx.enqueue({
    recipient: vacation.owner_account_id,
    kind: "vacation-decided",
    payload: {
      itemKind: "vacation",
      itemId: vacation.id,
      ...decisionDetails(decided),
      title: `${accountName(ctx, reviewerId)} ${decided.outcome} your vacation`,
      body:
        decided.reason === null
          ? dateSpan(from, to)
          : released === null
            ? `“${decided.reason}”`
            : `“${decided.reason}” You can file an excuse for ${daysText(released.firstDate, released.lastDate)} until ${formatDayTime(released.until.toISOString(), timezone)}.`,
      // A rejection shows as an alert on Today; an approval on the vacation's Profile card.
      url: decided.outcome === "approved" ? APP_PATHS.profile : APP_PATHS.today,
    },
  });
  if (decided.outcome === "approved") tellOtherReviewers(ctx, vacation, reviewerId);
}

/**
 * Tells each current reviewer of a pact with a day of `vacation` that it was
 * approved, but the approver: once, naming only the pacts they review, so
 * no reviewer learns of a pact they don't review.
 */
function tellOtherReviewers(ctx: CoreContext, vacation: VacationToDecide, approverId: AccountId): void {
  const pacts = ctx.all<{ id: string; name: string }>(
    `SELECT pact.id, pact.name FROM pact
     WHERE EXISTS (SELECT 1 FROM vacation_day WHERE vacation_day.vacation_id = ? AND vacation_day.pact_id = pact.id)
     ORDER BY pact.created_at, pact.id`,
    vacation.id,
  );
  const named = new Map<AccountId, { id: string; name: string }[]>();
  for (const pact of pacts) {
    for (const reviewerId of reviewersOf(ctx, pact.id)) {
      if (reviewerId !== approverId) named.set(reviewerId, [...(named.get(reviewerId) ?? []), pact]);
    }
  }
  const title = `${accountName(ctx, vacation.owner_account_id)}'s vacation was approved`;
  const span = dateSpan(vacation.first_day, vacation.last_day);
  const approver = accountName(ctx, approverId);
  for (const [recipient, theirs] of named) {
    ctx.enqueue({
      recipient,
      kind: "vacation-approved",
      payload: {
        vacationId: vacation.id,
        pactIds: theirs.map((pact) => pact.id),
        title,
        body: `${approver} approved it. It covers ${pactNamesText(theirs.map((pact) => pact.name))}, ${span}.`,
        url: APP_PATHS.review,
      },
    });
  }
}

/** The owner withdraws their vacation `vacationId` while it waits for approval. */
export function withdrawVacation(ctx: CoreContext, ownerId: AccountId, vacationId: string): WithdrawVacationResult {
  const row = ctx.one<{ decision: string | null; withdrawn_at: string | null }>(
    `SELECT decision, withdrawn_at FROM vacation WHERE id = ? AND owner_account_id = ?`,
    vacationId,
    ownerId,
  );
  if (!row) return { ok: false, reason: "vacation-not-found" };
  if (row.decision !== null || row.withdrawn_at !== null) return { ok: false, reason: "not-waiting" };
  const now = ctx.clock.now();
  ctx.db
    .prepare(`UPDATE vacation SET withdrawn_at = ?, withdrawn_reason = 'owner' WHERE id = ?`)
    .run(now.toISOString(), vacationId);
  settleVacationDays(ctx, vacationId, now);
  return { ok: true };
}

/** Settles every day the vacation covers, pact by pact (`settleCoverDays`). */
function settleVacationDays(ctx: CoreContext, vacationId: string, now: Date): void {
  const days = ctx.all<{ pact_id: string; date: LocalDate }>(
    `SELECT pact_id, date FROM vacation_day WHERE vacation_id = ? ORDER BY pact_id, date`,
    vacationId,
  );
  for (const pactId of new Set(days.map((day) => day.pact_id))) {
    const dates = days.filter((day) => day.pact_id === pactId).map((day) => day.date);
    settleCoverDays(ctx, pactId, dates, now);
  }
}

/**
 * SQL: no vacation or excuse filed after the vacation `alias` covers any of
 * its days. A rejected vacation's alert stands only while this holds.
 */
export function noLaterFilingSql(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM cover_day_v AS mine
    JOIN cover_day_v AS later ON later.pact_id = mine.pact_id AND later.date = mine.date
    WHERE mine.kind = 'vacation' AND mine.id = ${alias}.id AND later.filed_at > ${alias}.filed_at)`;
}

/**
 * One alert per rejected vacation of the owner's, newest rejection first,
 * until the owner takes the L on it or files a new vacation or an excuse
 * covering any of its days. With when it was rejected, for ordering among
 * the alerts.
 */
export function rejectedVacationAlerts(ctx: CoreContext, ownerId: AccountId): { at: Date; alert: TodayAlert }[] {
  const now = ctx.clock.now();
  const rows = ctx.all<{
    id: string;
    first_day: LocalDate;
    last_day: LocalDate;
    reject_reason: string;
    decided_at: string;
    reviewer_name: string;
  }>(
    `SELECT vacation.id, vacation.first_day, vacation.last_day, vacation.reject_reason, vacation.decided_at,
            reviewer.name AS reviewer_name
     FROM vacation
     JOIN account AS reviewer ON reviewer.id = vacation.decided_by_account_id
     WHERE vacation.owner_account_id = ? AND vacation.decision = 'rejected' AND vacation.rejection_accepted_at IS NULL
       AND ${noLaterFilingSql("vacation")}
     ORDER BY vacation.decided_at DESC, vacation.id`,
    ownerId,
  );
  return rows.map((row) => ({
    at: new Date(row.decided_at),
    alert: {
      kind: "vacation-rejected",
      vacationId: row.id,
      reviewerName: row.reviewer_name,
      reason: row.reject_reason,
      firstDate: row.first_day,
      lastDate: row.last_day,
      // The penalties it held when it was rejected: owed again since.
      owedAgainCents: coveredPenalties(ctx, row.id)
        .filter((penalty) => penalty.added_at <= row.decided_at)
        .reduce((sum, penalty) => sum + penalty.amount_cents, 0),
      excusable: releasedDays(ctx, row.id, row.decided_at, now),
    },
  }));
}

/**
 * The vacation's covered days already Missed when it was rejected or
 * withdrawn at `releasedAt` whose excuse window, reopened then, is still
 * open at `now` and that no other excuse or vacation waits over, and when
 * the first of those windows closes (R3); null when there are none. Days
 * judged later have their own windows and cards.
 */
function releasedDays(ctx: CoreContext, vacationId: string, releasedAt: string, now: Date): ExcusableDays | null {
  const rows = ctx.all<{ date: LocalDate; excuse_window_opens: string }>(
    `SELECT occurrence.date,
            ${excuseWindowOpensSql("occurrence.pact_id", "occurrence.date", "occurrence.judged_at")} AS excuse_window_opens
     FROM vacation_day
     JOIN occurrence ON occurrence.pact_id = vacation_day.pact_id AND occurrence.date = vacation_day.date
     WHERE vacation_day.vacation_id = ? AND occurrence.outcome = 'missed' AND occurrence.judged_at <= ?
       AND NOT ${coveredSql("occurrence.pact_id", "occurrence.date", "waiting")}
     ORDER BY occurrence.date`,
    vacationId,
    releasedAt,
  );
  const open = rows
    .map((row) => ({ date: row.date, until: excusableUntil(row.excuse_window_opens) }))
    .filter((day) => day.until.getTime() > now.getTime());
  if (open.length === 0) return null;
  return {
    firstDate: open[0]!.date,
    lastDate: open.at(-1)!.date,
    until: new Date(Math.min(...open.map((day) => day.until.getTime()))),
  };
}

/**
 * The owner takes the L on their rejected vacation `vacationId`: its alert
 * goes, and so do the covered occurrences already Missed when it was
 * rejected, from Today's Missed. Days judged later keep their own card.
 */
export function acceptVacationRejection(
  ctx: CoreContext,
  ownerId: AccountId,
  vacationId: string,
): AcceptVacationRejectionResult {
  const row = ctx.one(`SELECT 1 FROM vacation WHERE id = ? AND owner_account_id = ?`, vacationId, ownerId);
  if (!row) return { ok: false, reason: "vacation-not-found" };
  const now = ctx.clock.now().toISOString();
  const accepted = ctx.db
    .prepare(
      `UPDATE vacation SET rejection_accepted_at = ?
       WHERE id = ? AND decision = 'rejected' AND rejection_accepted_at IS NULL`,
    )
    .run(now, vacationId);
  if (accepted.changes !== 1) return { ok: false, reason: "nothing-to-accept" };
  ctx.db
    .prepare(
      `UPDATE occurrence SET miss_accepted_at = ?
       WHERE outcome = 'missed' AND miss_accepted_at IS NULL
         AND judged_at <= (SELECT decided_at FROM vacation WHERE id = ?)
         AND (pact_id, date) IN (SELECT pact_id, date FROM vacation_day WHERE vacation_id = ?)`,
    )
    .run(now, vacationId, vacationId);
  return { ok: true };
}
