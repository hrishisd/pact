// Pacts: creating, editing and deleting one in its edit window, the Pacts tab
// and the pact page, and the checks creating and changing a pact share.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { money, scheduleText } from "../shared/format.ts";
import type {
  AccountId,
  ClockTime,
  ConnectionService,
  CreatePactRefusal,
  CreatePactResult,
  CurrentTerms,
  DeletePactResult,
  EditPactResult,
  EvidenceKind,
  FirstOccurrenceResult,
  LocalDate,
  NewPact,
  PactResult,
  PactSummary,
  PactTerms,
  PactTiming,
  PactWaitingItem,
  Schedule,
  TermsByKind,
  TodayWaitingItem,
} from "../shared/types.ts";
import { laterDate, localDateOf } from "./calendar.ts";
import type { CoreContext } from "./context.ts";
import { moveCovers } from "./covers.ts";
import { enqueueEvidenceReviewItems, waitingEvidence } from "./evidence.ts";
import { waitingExcuses } from "./excuses.ts";
import { pactHistory } from "./history.ts";
import {
  ankiDueByFits,
  hasSchedule,
  newOccurrenceTerms,
  occurrences,
  type DayClock,
  type OccurrenceTerms,
} from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import {
  checkedTerms,
  editWindowClosesAt,
  editWindowEnd,
  isClockTime,
  isDueBy,
  isLocalDate,
  newTermsOf,
  type CheckedTerms,
} from "./pact-rules.ts";
import {
  accountName,
  accountRow,
  ankiDeckList,
  ankiTerms,
  areFriends,
  connectionProblem,
  editWindowCutoff,
  friendsSortedByName,
  hasConnection,
  mergeByTime,
  occurrencesOf,
  occurrenceTermsOf,
  ownPact,
  remindersOf,
  reviewersOf,
  scheduleOf,
  selectRecipients,
  todayKeeps,
  waitingChangeRequests,
  type PactRow,
} from "./rows.ts";

export function createPact(ctx: CoreContext, accountId: AccountId, pact: NewPact): CreatePactResult {
  const { timezone } = accountRow(ctx, accountId);
  const now = ctx.clock.now();
  const checked = checkedPact(ctx, accountId, timezone, pact, now);
  if (!checked.ok) return checked;

  const id = ctx.newId();
  const times = timesOf(checked.terms);
  ctx.db
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
  setReviewers(ctx, id, checked.reviewerIds);
  return { ok: true, pactId: id };
}

export function editPact(ctx: CoreContext, accountId: AccountId, pactId: string, pact: NewPact): EditPactResult {
  const { timezone } = accountRow(ctx, accountId);
  const row = ownPact(ctx, accountId, pactId);
  if (!row) return { ok: false, reason: "pact-not-found" };
  if (editWindowClosesAt(row, ctx.clock.now()) === null) return { ok: false, reason: "edit-window-closed" };
  if (pact.evidenceKind !== row.evidence_kind) return { ok: false, reason: "evidence-kind-fixed" };
  const checked = checkedPact(ctx, accountId, timezone, pact, new Date(row.created_at), row);
  if (!checked.ok) return checked;

  const times = timesOf(checked.terms);
  ctx.db
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
  ctx.db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ?`).run(pactId);
  setReviewers(ctx, pactId, checked.reviewerIds);
  // A One-time pact's evidence is for its one occurrence, wherever its deadline goes.
  if (scheduleOf(row.schedule).kind === "one-time" && checked.terms.schedule.kind === "one-time") {
    moveOneTimeOccurrence(ctx, pactId, row.first_occurrence, checked.terms.firstOccurrence);
    return { ok: true };
  }
  const { includes } = occurrences(checked.terms, checked.timezone);
  removeEvidence(ctx, pactId, (date) => !includes(date));
  return { ok: true };
}

export function deletePact(ctx: CoreContext, accountId: AccountId, pactId: string): DeletePactResult {
  accountRow(ctx, accountId);
  const row = ownPact(ctx, accountId, pactId);
  if (!row) return { ok: false, reason: "pact-not-found" };
  if (editWindowClosesAt(row, ctx.clock.now()) === null) return { ok: false, reason: "edit-window-closed" };
  // In its window a pact has nothing judged, so no penalties: evidence is all it can have.
  removeEvidence(ctx, pactId, () => true);
  ctx.db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ?`).run(pactId);
  ctx.db.prepare(`DELETE FROM pact WHERE id = ?`).run(pactId);
  return { ok: true };
}

export function firstOccurrence(
  ctx: CoreContext,
  accountId: AccountId,
  { schedule, evidenceKind, inBedBy, dueBy, startDate }: PactTiming,
  editing?: string,
): FirstOccurrenceResult {
  const { timezone } = accountRow(ctx, accountId);
  const pact = editing === undefined ? undefined : ownPact(ctx, accountId, editing);
  if (editing !== undefined && !pact) return { ok: false, reason: "pact-not-found" };
  // An Anki pact keeps the rollover hour it was made with; a new one takes the deck list's.
  const ankiRollover = pact
    ? pact.anki_rollover_hour
    : evidenceKind === "anki"
      ? (ankiDeckList(ctx, accountId)?.rolloverHour ?? null)
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
    pact ? new Date(pact.created_at) : ctx.clock.now(),
    timezone,
    startDate !== undefined && isLocalDate(startDate) ? startDate : null,
  );
  if (!timing.ok) return timing;
  return { ok: true, firstOccurrence: { date: timing.first.date, dueAt: timing.first.dueAt } };
}

export function pactList(ctx: CoreContext, accountId: AccountId): PactSummary[] {
  accountRow(ctx, accountId);
  const pacts = activePacts(ctx, accountId).map(
    ({ id, name, terms, penaltyCents, editWindowClosesAt }): PactSummary => ({
      id,
      name,
      schedule: terms.schedule,
      penaltyCents,
      stage: "active",
      editWindowClosesAt,
    }),
  );
  const ended = ctx
    .all<Pick<PactRow, "id" | "name" | "schedule" | "penalty_cents">>(
      `SELECT id, name, schedule, penalty_cents FROM pact
         WHERE owner_account_id = ? AND stage = 'ended'
         ORDER BY name, created_at, id`,
      accountId,
    )
    .map((row): PactSummary => ({
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
}

export function pactPage(ctx: CoreContext, accountId: AccountId, pactId: string): PactResult {
  const { timezone } = accountRow(ctx, accountId);
  const row = ownPact(ctx, accountId, pactId);
  if (!row) return { ok: false, reason: "pact-not-found" };
  const now = ctx.clock.now();
  const { first } = occurrencesOf(ctx, pactId, timezone);
  const service = SERVICE_OF_KIND[row.evidence_kind];
  const pact: PactTerms = {
    id: row.id,
    ...currentTerms(ctx, row),
    ...stageOf(row),
    firstOccurrence: { date: first.date, dueAt: first.dueAt },
    editWindowClosesAt: editWindowClosesAt(row, now),
    newTerms: newTerms(ctx, row, timezone, now),
    waiting: mergeByTime(
      waitingSince,
      "newest-first",
      waitingChangeRequests(ctx, accountId, pactId),
      waitingEvidence(ctx, accountId, pactId),
      waitingExcuses(ctx, accountId, pactId),
    ) as PactWaitingItem[],
    history: pactHistory(ctx, row, timezone, first, now),
    connectionProblem: row.stage === "active" && service !== null ? connectionProblem(ctx, accountId, service) : null,
  };
  return { ok: true, pact };
}

/** The service a pact of each evidence kind is judged from; Camera has none. */
export const SERVICE_OF_KIND: Record<EvidenceKind, ConnectionService | null> = {
  camera: null,
  oura: "oura",
  anki: "anki",
};

/** An Active pact as Today and the Pacts tab read it. */
export interface ActivePact {
  id: string;
  name: string;
  evidenceKind: EvidenceKind;
  penaltyCents: number;
  terms: OccurrenceTerms;
  startDate: LocalDate | null;
  editWindowClosesAt: Date | null;
}

/** A pact checked for creating or editing. */
export interface CheckedPact extends CheckedTerms {
  reviewerIds: AccountId[];
  ankiDeckId: string | null;
}

/**
 * The day clock a pact form's times give as far as it has them: an Anki
 * day's with a rollover hour, else a night's with an in-bed-by time, else a
 * Camera day's.
 */
export function formDayClock(times: ClockTimes): DayClock {
  if (times.ankiRollover !== null) return { kind: "anki", rollover: times.ankiRollover, dueBy: times.dueBy };
  if (times.inBedBy !== null) return { kind: "night", inBedBy: times.inBedBy };
  return { kind: "day", dueBy: times.dueBy };
}

/** A pact's times as its columns store them: each null where its terms have none. */
export interface ClockTimes {
  inBedBy: ClockTime | null;
  dueBy: ClockTime | null;
  ankiRollover: number | null;
}

/** `terms`' times as the pact's columns store them. */
export function timesOf(terms: OccurrenceTerms): ClockTimes {
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

/** A pact's stage, and when it ended. Ending a pact sets both columns at once. */
export function stageOf(
  row: Pick<PactRow, "id" | "stage" | "ended_at">,
): { stage: "active" } | { stage: "ended"; endedAt: Date } {
  if (row.stage === "active") return { stage: "active" };
  if (row.ended_at === null) throw new Error(`pact ${row.id} ended with no ended_at`);
  return { stage: "ended", endedAt: new Date(row.ended_at) };
}

/** When a waiting item was sent for a decision: for ordering them. */
export function waitingSince(item: TodayWaitingItem): Date {
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

/**
 * What creating and editing share: `pact` checked as a pact made at
 * `createdAt`, or why it's refused. `existing` is the pact being edited or
 * changed: an Anki pact keeps its rollover hour, and its own deck counts as
 * known even once it's gone from the deck list. The evidence source is
 * checked first, then the terms, then the recipient and reviewers.
 */
export function checkedPact(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
  pact: NewPact,
  createdAt: Date,
  existing?: Pick<PactRow, "anki_deck_id" | "anki_rollover_hour">,
): CheckedPact | { ok: false; reason: CreatePactRefusal } {
  const source = evidenceSource(ctx, ownerId, pact, existing);
  if (!source.ok) return source;
  const terms = checkedTerms(pact, source.ankiRollover, timezone, createdAt);
  if (!terms.ok) return terms;
  const people = checkedPeople(ctx, ownerId, pact);
  if (!people.ok) return people;
  return { ...terms, reviewerIds: people.reviewerIds, ankiDeckId: source.ankiDeckId };
}

/**
 * Where `pact`'s evidence comes from, or why it can't: Oura Ring and Anki
 * need their connection, and an Anki pact a deck from the owner's deck list
 * (or `existing`'s own deck). An Anki pact's day turns at the collection's
 * rollover hour; `existing` keeps the one it has.
 */
export function evidenceSource(
  ctx: CoreContext,
  ownerId: AccountId,
  pact: NewPact,
  existing: Pick<PactRow, "anki_deck_id" | "anki_rollover_hour"> | undefined,
): { ok: true; ankiDeckId: string | null; ankiRollover: number | null } | { ok: false; reason: CreatePactRefusal } {
  switch (pact.evidenceKind) {
    case "camera":
      return { ok: true, ankiDeckId: null, ankiRollover: null };
    case "oura":
      if (!hasConnection(ctx, ownerId, "oura")) return { ok: false, reason: "oura-not-connected" };
      return { ok: true, ankiDeckId: null, ankiRollover: null };
    case "anki": {
      if (!hasConnection(ctx, ownerId, "anki")) return { ok: false, reason: "anki-not-connected" };
      const list = ankiDeckList(ctx, ownerId);
      const deckId = pact.ankiDeckId ?? "";
      const ownDeck = existing?.anki_deck_id === deckId && existing.anki_rollover_hour !== null;
      if (!ownDeck && !list?.decks.some((deck) => deck.id === deckId)) return { ok: false, reason: "unknown-deck" };
      return { ok: true, ankiDeckId: deckId, ankiRollover: existing?.anki_rollover_hour ?? list!.rolloverHour };
    }
  }
}

/** `pact`'s recipient and reviewers, or why they're refused: the owner's own recipient, and friends. */
export function checkedPeople(
  ctx: CoreContext,
  ownerId: AccountId,
  pact: NewPact,
): { ok: true; reviewerIds: AccountId[] } | { ok: false; reason: CreatePactRefusal } {
  const isOwnRecipient = ctx.db
    .prepare(`SELECT 1 FROM recipient WHERE id = ? AND owner_account_id = ?`)
    .get(pact.recipientId, ownerId);
  if (!isOwnRecipient) return { ok: false, reason: "unknown-recipient" };
  const reviewerIds = [...new Set(pact.reviewerIds)];
  if (reviewerIds.length === 0) return { ok: false, reason: "no-reviewers" };
  if (!reviewerIds.every((id) => areFriends(ctx, ownerId, id))) return { ok: false, reason: "not-a-friend" };
  return { ok: true, reviewerIds };
}

export function setReviewers(ctx: CoreContext, pactId: string, reviewerIds: AccountId[]): void {
  for (const reviewerId of reviewerIds) {
    ctx.db.prepare(`INSERT INTO pact_reviewer (pact_id, reviewer_account_id) VALUES (?, ?)`).run(pactId, reviewerId);
  }
}

/** Removes the pact's evidence on the dates `removed` picks, and those occurrences, none of them judged. */
export function removeEvidence(ctx: CoreContext, pactId: string, removed: (date: LocalDate) => boolean): void {
  const rows = ctx.all<{
    id: string;
    occurrence_date: LocalDate;
  }>(`SELECT id, occurrence_date FROM evidence WHERE pact_id = ?`, pactId);
  for (const { id, occurrence_date } of rows.filter((row) => removed(row.occurrence_date))) {
    ctx.db.prepare(`DELETE FROM evidence_photo WHERE evidence_id = ?`).run(id);
    ctx.db.prepare(`DELETE FROM evidence WHERE id = ?`).run(id);
    ctx.db.prepare(`DELETE FROM occurrence WHERE pact_id = ? AND date = ?`).run(pactId, occurrence_date);
  }
}

/** `ownerId`'s Active pacts, sorted by name. */
export function activePacts(ctx: CoreContext, ownerId: AccountId): ActivePact[] {
  const now = ctx.clock.now();
  const rows = ctx.all<
    Pick<
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
    >
  >(
    `SELECT pact.id, pact.name, pact.schedule, pact.in_bed_by, pact.due_by, pact.start_date, pact.end_date,
              pact.penalty_cents, pact.first_occurrence, pact.created_at, pact.evidence_kind,
              pact.anki_rollover_hour
       FROM pact
       WHERE pact.owner_account_id = ? AND pact.stage = 'active'
       ORDER BY pact.name, pact.created_at, pact.id`,
    ownerId,
  );
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

/** The pact's terms as the pact page and a change request show them. */
export function currentTerms(ctx: CoreContext, pact: PactRow): CurrentTerms & Pick<PactTerms, "reminders"> {
  const [recipient] = selectRecipients(ctx, `id = ?`, pact.recipient_id);
  if (!recipient) throw new Error(`pact ${pact.id} has no recipient ${pact.recipient_id}`);
  return {
    ...termsByKind(ctx, pact),
    name: pact.name,
    description: pact.description,
    startDate: pact.start_date,
    endDate: pact.end_date,
    penaltyCents: pact.penalty_cents,
    recipient,
    reviewers: friendsSortedByName(ctx, reviewersOf(ctx, pact.id)),
    reminders: remindersOf(pact.reminders),
  };
}

/** The terms that depend on the pact's evidence kind. */
export function termsByKind(ctx: CoreContext, pact: PactRow): TermsByKind {
  const schedule = scheduleOf(pact.schedule);
  if (pact.evidence_kind === "camera") return { evidenceKind: "camera", schedule, dueBy: pact.due_by };
  if (schedule.kind !== "fixed-days") throw new Error(`${pact.evidence_kind} pact ${pact.id} isn't on Fixed days`);
  if (pact.evidence_kind === "oura") {
    if (pact.in_bed_by === null) throw new Error(`Oura Ring pact ${pact.id} has no in-bed-by time`);
    return { evidenceKind: "oura", schedule, inBedBy: pact.in_bed_by };
  }
  const anki = ankiTerms(ctx, pact);
  if (!anki) throw new Error(`Anki pact ${pact.id} has no deck`);
  return { evidenceKind: "anki", schedule, dueBy: pact.due_by, anki };
}

/** As the pact page puts it: when the newest terms start, while their first occurrence hasn't opened. */
export function newTerms(ctx: CoreContext, pact: PactRow, timezone: string, now: Date): PactTerms["newTerms"] {
  if (pact.stage === "ended") return null;
  const latest = ctx.one<{ until: LocalDate }>(
    `SELECT until FROM pact_earlier_terms WHERE pact_id = ? ORDER BY until DESC LIMIT 1`,
    pact.id,
  );
  if (!latest) return null;
  const occurrences = occurrencesOf(ctx, pact.id, timezone);
  // A start date may put the first occurrence further off than a week.
  const from = laterDate(pact.first_occurrence, latest.until);
  const [start] = occurrences.between(from, addDays(from, 7));
  const today = localDateOf(now, timezone);
  if (!start || start.date <= today) return null;
  const todayKeepsCents = todayKeeps(ctx, pact.id, occurrences, today, { penaltyCents: pact.penalty_cents });
  return { appliesFrom: start.date, todayKeepsCents };
}

/**
 * Re-dates a One-time pact's occurrence, not judged yet, from `from` to
 * `to`: its row, its evidence, the excuses that cover it, and the vacations
 * whose dates take in `to`. A vacation whose dates don't covers it no more.
 */
export function moveOneTimeOccurrence(ctx: CoreContext, pactId: string, from: LocalDate, to: LocalDate): void {
  if (from === to) return;
  ctx.db
    .prepare(
      `INSERT INTO occurrence (pact_id, date, outcome, judged_at, bedtime_start, miss_accepted_at)
       SELECT pact_id, ?, outcome, judged_at, bedtime_start, miss_accepted_at FROM occurrence
       WHERE pact_id = ? AND date = ?`,
    )
    .run(to, pactId, from);
  ctx.db
    .prepare(`UPDATE evidence SET occurrence_date = ?, day = ? WHERE pact_id = ? AND occurrence_date = ?`)
    .run(to, to, pactId, from);
  moveCovers(ctx, pactId, from, to);
  ctx.db.prepare(`DELETE FROM occurrence WHERE pact_id = ? AND date = ?`).run(pactId, from);
}

/** Tells each of `reviewerIds` they now review the pact, and what it asks. */
export function tellPickedAsReviewer(
  ctx: CoreContext,
  reviewerIds: readonly AccountId[],
  title: string,
  pact: { id: string; name: string; schedule: Schedule; penaltyCents: number },
): void {
  tellAll(ctx, reviewerIds, "picked-as-reviewer", {
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
export function closeEditWindows(ctx: CoreContext, t: Date): void {
  const pacts = ctx.all<PactRow>(
    `SELECT * FROM pact WHERE reviewers_notified_at IS NULL AND created_at <= ? ORDER BY created_at, id`,
    editWindowCutoff(ctx, t),
  );
  for (const pact of pacts) {
    const ownerName = accountName(ctx, pact.owner_account_id);
    tellPickedAsReviewer(ctx, reviewersOf(ctx, pact.id), `${ownerName} picked you as a reviewer`, {
      id: pact.id,
      name: pact.name,
      schedule: scheduleOf(pact.schedule),
      penaltyCents: pact.penalty_cents,
    });
    const closedAt = editWindowEnd(pact).toISOString();
    const held = ctx.all<{ id: string; day: LocalDate }>(
      `SELECT id, day FROM evidence
         WHERE pact_id = ? AND decision IS NULL AND submitted_at < ?
         ORDER BY submitted_at, id`,
      pact.id,
      closedAt,
    );
    for (const { id, day } of held) {
      enqueueEvidenceReviewItems(ctx, pact.id, id, day, ownerName);
    }
    ctx.db.prepare(`UPDATE pact SET reviewers_notified_at = ? WHERE id = ?`).run(t.toISOString(), pact.id);
  }
}
