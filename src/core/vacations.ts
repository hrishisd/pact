// Vacations: what one would cover, filing it, the owner's vacations,
// withdrawing one while it waits, and its review by the reviewers picked.

import { APP_PATHS } from "../shared/api.ts";
import { addDays, dayCount } from "../shared/calendar.ts";
import { dateSpan } from "../shared/format.ts";
import {
  MAX_EXCUSE_SPAN_DAYS,
  type AccountId,
  type ReviewItem,
  type VacationCover,
  type VacationState,
  type FileVacationResult,
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
} from "../shared/types.ts";
import { localDateOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { excuseApprovedDays } from "./excuses.ts";
import { dueAfterEnd, excuseOn, occurrenceSpan, vacationOn } from "./occurrence-state.ts";
import type { Occurrence } from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import { isLocalDate } from "./pact-rules.ts";
import {
  accountName,
  decisionDetails,
  editWindowCutoff,
  friendsSortedByName,
  occurrencesOf,
  recordDecision,
  timezoneOf,
  reviewersOf,
  scheduleOf,
  thread,
  type Decided,
  type PactRow,
  type ReviewOutcome,
} from "./rows.ts";

export function vacationOptions(ctx: CoreContext, ownerId: AccountId): VacationOptions {
  const now = ctx.clock.now();
  const timezone = timezoneOf(ctx, ownerId);
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
  const timezone = timezoneOf(ctx, ownerId);
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
 * would cover or skip: each one dated inside, or a Weekly count week whose
 * Thursday is inside (the weeks it touches with the Thursday outside are
 * `notCovered`). An Ended pact has no occurrences after its end.
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
  for (const occurrence of occurrencesOf(ctx, pactId, timezone).overlapping(from, to)) {
    if (dueAfterEnd(ctx, pactId, occurrence)) continue;
    const entry: VacationOccurrence = occurrenceSpan(ctx, pactId, occurrence);
    const weekly = entry.through !== undefined;
    // A week is covered by its Thursday, the middle of its Mon–Sun, so a vacation starting on a Sunday doesn't take the week before.
    const coveringDay = weekly ? addDays(occurrence.date, 3) : occurrence.date;
    if (coveringDay < from || coveringDay > to) {
      if (weekly) result.notCovered.push(entry);
      continue;
    }
    const reason = vacationSkipReason(ctx, pactId, occurrence, now);
    if (reason === null) result.covered.push(entry);
    else result.skipped.push({ ...entry, reason });
  }
  return result;
}

/** Why a vacation filed at `now` can't cover the pact's `occurrence`, or null if it can. */
function vacationSkipReason(
  ctx: CoreContext,
  pactId: string,
  occurrence: Occurrence,
  now: Date,
): VacationSkipReason | null {
  if (occurrence.opensAt.getTime() <= now.getTime()) return "already-open";
  // Before excuseOn, which counts an approved vacation as an approved excuse.
  if (vacationOn(ctx, pactId, occurrence.date) !== null) return "on-vacation";
  const excuse = excuseOn(ctx, pactId, occurrence.date);
  if (excuse === "waiting") return "on-waiting-excuse";
  return excuse === "approved" ? "excused" : null;
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
  const timezone = timezoneOf(ctx, ownerId);
  const pactIds = [...new Set(vacation.pactIds)];
  const reviewerIds = [...new Set(vacation.reviewerIds)];
  if (pactIds.length === 0) return { ok: false, reason: "no-pacts" };
  const checked = vacationPreview(ctx, ownerId, timezone, { ...vacation, pactIds }, now);
  if (!checked.ok) return checked;
  if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
  const offered = new Set(pactIds.flatMap((pactId) => reviewersOf(ctx, pactId)));
  if (reviewerIds.some((id) => !offered.has(id))) return { ok: false, reason: "reviewer-not-offered" };
  if (checked.preview.coversNothing) return { ok: false, reason: "nothing-to-cover" };
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
  tellAll(ctx, reviewerIds, "review-item", {
    itemKind: "vacation",
    itemId: vacationId,
    title: `${accountName(ctx, ownerId)} asked for a vacation`,
    body: dateSpan(vacation.from, vacation.to),
    url: APP_PATHS.review,
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
  const today = localDateOf(ctx.clock.now(), timezoneOf(ctx, ownerId));
  const rows = ctx.all<VacationRow>(
    `SELECT ${VACATION_COLUMNS} FROM vacation
     WHERE owner_account_id = ? AND withdrawn_at IS NULL
       AND (decision IS NULL OR (decision = 'approved' AND last_day >= ?))
     ORDER BY first_day, filed_at, id`,
    ownerId,
    today,
  );
  return rows.map((row) => ({ ...vacationSummary(ctx, row), state: vacationState(ctx, row) }));
}

/** What a vacation's Profile card and review item both show: its dates, note, pacts and who it went to. */
function vacationSummary(
  ctx: CoreContext,
  row: VacationRow,
): Pick<VacationCard, "id" | "from" | "to" | "days" | "note" | "pacts" | "reviewerNames"> {
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
    days: dayCount(row.first_day, row.last_day),
    note: row.note,
    pacts: row.pacts_summary === "some" ? { kind: "some", names } : { kind: row.pacts_summary },
    reviewerNames: friendsSortedByName(ctx, pickedReviewers(ctx, row.id)).map((reviewer) => reviewer.name),
  };
}

/** Where a vacation not withdrawn stands for its owner: waiting, waiting on their reply, or approved. */
function vacationState(ctx: CoreContext, row: VacationRow): VacationState {
  if (row.decision === "approved")
    return { kind: "approved", reviewerName: accountName(ctx, row.decided_by_account_id!) };
  const { comments, waitingOnReply } = thread(ctx, row.id, row.decision === null);
  const asked = comments.at(-1);
  return waitingOnReply && asked
    ? { kind: "waiting-on-reply", askedBy: asked.authorName, question: asked.text }
    : { kind: "waiting" };
}

/** The reviewers the owner picked for the vacation: only they may decide it. */
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
function vacationCovers(ctx: CoreContext, vacationId: string, timezone: string): VacationCover[] {
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
    return [
      {
        pactId: pact.id,
        name: pact.name,
        evidenceKind: pact.evidence_kind,
        schedule: scheduleOf(pact.schedule),
        covered,
      },
    ];
  });
}

/** Vacations waiting for approval that `reviewerId` was picked for, oldest first. */
export function vacationsToReview(ctx: CoreContext, reviewerId: AccountId): ReviewItem[] {
  const rows = ctx.all<VacationRow & { owner_name: string; timezone: string }>(
    `SELECT ${VACATION_COLUMNS}, owner.name AS owner_name, owner.timezone
     FROM vacation
     JOIN vacation_reviewer ON vacation_reviewer.vacation_id = vacation.id
                           AND vacation_reviewer.reviewer_account_id = ?
     JOIN account AS owner ON owner.id = vacation.owner_account_id
     WHERE vacation.decision IS NULL AND vacation.withdrawn_at IS NULL
     ORDER BY vacation.filed_at, vacation.id`,
    reviewerId,
  );
  return rows.map((row): ReviewItem => ({
    kind: "vacation",
    ...vacationSummary(ctx, row),
    ownerName: row.owner_name,
    covers: vacationCovers(ctx, row.id, row.timezone),
    filedAt: new Date(row.filed_at),
    thread: thread(ctx, row.id, true),
  }));
}

/** A vacation a reviewer is deciding on, as `decide` reads it. */
export interface VacationToDecide {
  id: string;
  decision: ReviewOutcome | null;
  owner_account_id: AccountId;
  first_day: LocalDate;
  last_day: LocalDate;
}

/**
 * The owner's vacation `vacationId`, for a reply to a question about it:
 * whether it still waits for a decision, and its picked reviewers.
 */
export function ownVacation(
  ctx: CoreContext,
  ownerId: AccountId,
  vacationId: string,
): { waiting: boolean; reviewerIds: AccountId[] } | undefined {
  const vacation = ctx.one<{ decision: ReviewOutcome | null; withdrawn_at: string | null }>(
    `SELECT decision, withdrawn_at FROM vacation WHERE id = ? AND owner_account_id = ?`,
    vacationId,
    ownerId,
  );
  return (
    vacation && {
      waiting: vacation.decision === null && vacation.withdrawn_at === null,
      reviewerIds: pickedReviewers(ctx, vacationId),
    }
  );
}

/** The vacation `vacationId`, decided or not, if `reviewerId` was picked for it and it wasn't withdrawn. */
export function vacationToDecide(
  ctx: CoreContext,
  reviewerId: AccountId,
  vacationId: string,
): VacationToDecide | undefined {
  return ctx.one<VacationToDecide>(
    `SELECT vacation.id, vacation.decision, vacation.owner_account_id, vacation.first_day, vacation.last_day
     FROM vacation
     JOIN vacation_reviewer ON vacation_reviewer.vacation_id = vacation.id
                           AND vacation_reviewer.reviewer_account_id = ?
     WHERE vacation.id = ? AND vacation.withdrawn_at IS NULL`,
    reviewerId,
    vacationId,
  );
}

/**
 * Records a picked reviewer's decision on a vacation waiting for approval
 * and tells the owner. Approved: every covered day of every pact is
 * excused at once, as an approved excuse's are (`excuseApprovedDays`).
 * Rejected: its days are judged as usual.
 */
export function decideVacation(
  ctx: CoreContext,
  vacation: VacationToDecide,
  decided: Decided,
  reviewerId: AccountId,
): void {
  const now = ctx.clock.now();
  recordDecision(ctx, "vacation", vacation.id, decided, reviewerId, now);
  if (decided.outcome === "approved") {
    const days = ctx.all<{ pact_id: string; date: LocalDate }>(
      `SELECT pact_id, date FROM vacation_day WHERE vacation_id = ? ORDER BY pact_id, date`,
      vacation.id,
    );
    for (const pactId of new Set(days.map((day) => day.pact_id))) {
      const dates = days.filter((day) => day.pact_id === pactId).map((day) => day.date);
      excuseApprovedDays(ctx, pactId, dates, now);
    }
  }
  const { first_day: from, last_day: to } = vacation;
  ctx.enqueue({
    recipient: vacation.owner_account_id,
    kind: "vacation-decided",
    payload: {
      itemKind: "vacation",
      itemId: vacation.id,
      ...decisionDetails(decided),
      title: `${accountName(ctx, reviewerId)} ${decided.outcome} your vacation`,
      body: decided.reason === null ? dateSpan(from, to) : `“${decided.reason}”`,
      // A rejection shows as an alert on Today; an approval on the vacation's Profile card.
      url: decided.outcome === "approved" ? APP_PATHS.profile : APP_PATHS.today,
    },
  });
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
  ctx.db.prepare(`UPDATE vacation SET withdrawn_at = ? WHERE id = ?`).run(ctx.clock.now().toISOString(), vacationId);
  return { ok: true };
}
