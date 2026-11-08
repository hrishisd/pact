// Vacations: what one would cover, filing it, the owner's vacations, and
// withdrawing one while it waits.

import { addDays, dayCount } from "../shared/calendar.ts";
import {
  MAX_EXCUSE_SPAN_DAYS,
  type AccountId,
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
import { dueAfterEnd, excuseOn, vacationOn } from "./occurrence-state.ts";
import { lastDayOf, type Occurrence } from "./occurrences.ts";
import { isLocalDate } from "./pact-rules.ts";
import {
  accountRow,
  editWindowCutoff,
  friendsSortedByName,
  occurrencesOf,
  ownerZone,
  reviewersOf,
  scheduleOf,
  termsOn,
  type PactRow,
} from "./rows.ts";

export function vacationOptions(ctx: CoreContext, ownerId: AccountId): VacationOptions {
  const now = ctx.clock.now();
  const timezone = ownerZone(accountRow(ctx, ownerId).timezone, ownerId);
  const offered = offeredPacts(ctx, ownerId, timezone, now);
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
function offeredPacts(ctx: CoreContext, ownerId: AccountId, timezone: string, now: Date): VacationPactOption[] {
  const rows = ctx.all<PactRow>(
    `SELECT * FROM pact WHERE owner_account_id = ? AND stage = 'active' AND created_at <= ?
     ORDER BY created_at, id`,
    ownerId,
    editWindowCutoff(ctx, now),
  );
  const offered = rows.map((row): VacationPactOption => {
    const schedule = scheduleOf(row.schedule);
    return {
      id: row.id,
      name: row.name,
      evidenceKind: row.evidence_kind,
      schedule,
      penaltyCents: row.penalty_cents,
      reviewers: friendsSortedByName(ctx, reviewersOf(ctx, row.id)),
      alreadyOpen:
        schedule.kind === "one-time" && occurrencesOf(ctx, row.id, timezone).first.opensAt.getTime() <= now.getTime(),
    };
  });
  return offered.toSorted((a, b) => Number(a.schedule.kind === "one-time") - Number(b.schedule.kind === "one-time"));
}

export function previewVacation(ctx: CoreContext, ownerId: AccountId, request: VacationRequest): VacationPreviewResult {
  const timezone = ownerZone(accountRow(ctx, ownerId).timezone, ownerId);
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
  from: string,
  to: string,
  now: Date,
): Pick<VacationPactPreview, "covered" | "skipped" | "notCovered"> {
  const result: Pick<VacationPactPreview, "covered" | "skipped" | "notCovered"> = {
    covered: [],
    skipped: [],
    notCovered: [],
  };
  for (const occurrence of occurrencesOf(ctx, pactId, timezone).overlapping(from, to)) {
    if (dueAfterEnd(ctx, pactId, occurrence)) continue;
    const schedule = scheduleOf(termsOn(ctx, pactId, occurrence.date).schedule);
    const weekly = schedule.kind === "weekly-count";
    const entry: VacationOccurrence = {
      date: occurrence.date,
      ...(weekly && { through: lastDayOf(schedule, occurrence.date) }),
    };
    // A week is covered by its Thursday, the middle of its Mon–Sun, so a vacation starting on a Sunday doesn't take the week before.
    const day = weekly ? addDays(occurrence.date, 3) : occurrence.date;
    if (day < from || day > to) {
      if (weekly) result.notCovered.push(entry);
      continue;
    }
    const reason = skipReason(ctx, pactId, occurrence, now);
    if (reason === null) result.covered.push(entry);
    else result.skipped.push({ ...entry, reason });
  }
  return result;
}

/** Why a vacation filed at `now` can't cover the pact's `occurrence`, or null if it can. */
function skipReason(ctx: CoreContext, pactId: string, occurrence: Occurrence, now: Date): VacationSkipReason | null {
  if (occurrence.opensAt.getTime() <= now.getTime()) return "already-open";
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
  const timezone = ownerZone(accountRow(ctx, ownerId).timezone, ownerId);
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
      `INSERT INTO vacation (id, owner_account_id, first_day, last_day, note, filed_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(vacationId, ownerId, vacation.from, vacation.to, note, now.toISOString());
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
  return { ok: true, vacationId };
}

/** The owner's vacations waiting for approval, soonest first. */
export function vacationCards(ctx: CoreContext, ownerId: AccountId): VacationCard[] {
  const now = ctx.clock.now();
  const timezone = ownerZone(accountRow(ctx, ownerId).timezone, ownerId);
  const offered = offeredPacts(ctx, ownerId, timezone, now);
  const rows = ctx.all<{ id: string; first_day: LocalDate; last_day: LocalDate; note: string | null }>(
    `SELECT id, first_day, last_day, note FROM vacation
     WHERE owner_account_id = ? AND decision IS NULL AND withdrawn_at IS NULL
     ORDER BY first_day, filed_at, id`,
    ownerId,
  );
  return rows.map((row) => {
    const ticked = ctx
      .all<{ id: string; name: string; schedule: string }>(
        `SELECT pact.id, pact.name, pact.schedule FROM vacation_pact JOIN pact ON pact.id = vacation_pact.pact_id
         WHERE vacation_pact.vacation_id = ? ORDER BY pact.created_at, pact.id`,
        row.id,
      )
      .map((pact) => ({ ...pact, schedule: scheduleOf(pact.schedule) }));
    const reviewerIds = ctx
      .all<{ reviewer_account_id: AccountId }>(
        `SELECT reviewer_account_id FROM vacation_reviewer WHERE vacation_id = ?`,
        row.id,
      )
      .map((reviewer) => reviewer.reviewer_account_id);
    return {
      id: row.id,
      from: row.first_day,
      to: row.last_day,
      days: dayCount(row.first_day, row.last_day),
      note: row.note,
      pacts: summaryOf(offered, ticked),
      reviewerNames: friendsSortedByName(ctx, reviewerIds).map((reviewer) => reviewer.name),
      state: { kind: "waiting" },
    };
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
