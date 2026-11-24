// Change requests: changing or ending a pact once its edit window has closed,
// what a change would do, and deciding one. The rules for each term are in
// `changes.ts`.

import { APP_PATHS } from "../shared/api.ts";
import { addDays } from "../shared/calendar.ts";
import { formatDate, listNames, termLabel } from "../shared/format.ts";
import type {
  AccountId,
  AddReviewersResult,
  AtOnceChangeRefusal,
  ChangeOutcome,
  ChangePactRefusal,
  ChangePactResult,
  ChangePreview,
  ChangePreviewResult,
  ChangeRequestResult,
  ChangeRequestView,
  ChangeStart,
  CurrentTerms,
  LocalDate,
  PactChange,
  PactTerms,
  RenamePactResult,
  RequestEndResult,
  SetRemindersResult,
  TermChange,
  TodayWaitingItem,
  WithdrawChangeRequestResult,
} from "../shared/types.ts";
import { laterDate, localDateOf, weekdayOf } from "./calendar.ts";
import { appliesNow, effectOf, termDiffs, type ChangeableTerms, type TermDiff } from "./changes.ts";
import type { CoreContext } from "./context.ts";
import { uncoverRemovedDays } from "./covers.ts";
import { endAfter, endPact, endTiming } from "./ending.ts";
import {
  dueSoonEnough,
  hasSchedule,
  lastDayOf,
  occurrencesOverTime,
  type Occurrence,
  type Occurrences,
  type OccurrenceTerms,
} from "./occurrences.ts";
import { tellAll } from "./outbox.ts";
import {
  checkedName,
  dayClockOf,
  editWindowClosesAt,
  firstDayNotOpen,
  firstOccurrenceAfterChange,
  remindersGoOffInTime,
  remindersInTime,
  storedTerms,
  wellFormedReminders,
} from "./pact-rules.ts";
import {
  checkedPact,
  currentTerms,
  mayReview,
  moveOneTimeOccurrence,
  setReviewers,
  tellPickedAsReviewer,
  timesOf,
  type CheckedPact,
} from "./pacts.ts";
import {
  accountName,
  accountRow,
  ankiDeckName,
  earlierTermsOf,
  earlierTimezonesOf,
  friendsSortedByName,
  lastDayOpened,
  occurrencesOf,
  occurrenceTermsOf,
  ownPact,
  pactName,
  recipientName,
  remindersOf,
  reviewersOf,
  scheduleOf,
  scheduleTermsOf,
  termsOn,
  type PactRow,
} from "./rows.ts";
import {
  decisionDetails,
  itemStateOf,
  recordDecision,
  thread,
  withdrawalOf,
  type Decided,
  type QueuedItem,
  type RequestKindHandler,
  type ReviewStateRow,
} from "./requests.ts";
import { pactsToJudge } from "./occurrence-state.ts";
import { settlePactDueBy } from "./settle.ts";
import { textTooLong } from "./text-limits.ts";
import { tellNewVacationDeciders } from "./vacations.ts";

export function changePreview(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  change: PactChange,
): ChangePreviewResult {
  const { timezone } = accountRow(ctx, accountId);
  const checked = checkedChange(ctx, accountId, timezone, pactId, change, ctx.clock.now());
  if (!checked.ok) return checked;
  const { before, after, diffs, outcome } = checked;
  const preview: ChangePreview = { changes: termChanges(ctx, accountId, before, after, diffs), outcome };
  return { ok: true, preview } satisfies ChangePreviewResult;
}

export function changePact(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  change: PactChange,
): ChangePactResult {
  const { timezone, name: ownerName } = accountRow(ctx, accountId);
  const now = ctx.clock.now();
  const checked = checkedChange(ctx, accountId, timezone, pactId, change, now);
  if (!checked.ok) return checked;
  const { pact, before, after, outcome } = checked;
  if (outcome.kind === "nothing") return { ok: false, reason: "nothing-changed" };
  // The name, the reminders and added reviewers apply at once, even inside a change that waits.
  if (after.name !== before.name) rename(ctx, pactId, after.name);
  saveReminders(ctx, pact, after.reminders);
  const added = after.reviewerIds.filter((id) => !before.reviewerIds.includes(id));
  addReviewersNow(ctx, { ...pact, name: after.name }, ownerName, added);
  if (outcome.kind === "needs-approval") {
    const sent = {
      ...before,
      name: after.name,
      reviewerIds: [...before.reviewerIds, ...added].sort(),
      reminders: after.reminders,
    };
    const id = sendChangeRequest(ctx, { ...pact, name: after.name }, ownerName, sent, after, change.note);
    return { ok: true, outcome: { ...outcome, changeRequestId: id } };
  }
  if (outcome.kind === "stricter") applyTerms(ctx, pact, after, now, checked.timezone);
  return { ok: true, outcome };
}

/** The owner renames a pact past its edit window: it applies at once, to the terms as they stand. */
export function renamePact(ctx: CoreContext, accountId: AccountId, pactId: string, name: string): RenamePactResult {
  const changeable = changeablePact(ctx, accountId, pactId, ctx.clock.now());
  if (!changeable.ok) return changeable;
  const named = checkedName(name);
  if (!named.ok) return named;
  rename(ctx, pactId, named.name);
  return { ok: true };
}

/**
 * The owner adds reviewers to a pact past its edit window: they join at
 * once, and each is told. Those who already review it are left as they are.
 */
export function addReviewers(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  reviewerIds: AccountId[],
): AddReviewersResult {
  const changeable = changeablePact(ctx, accountId, pactId, ctx.clock.now());
  if (!changeable.ok) return changeable;
  const { pact } = changeable;
  const current = reviewersOf(ctx, pactId);
  const added = [...new Set(reviewerIds)].filter((id) => !current.includes(id));
  if (!mayReview(ctx, accountId, added)) return { ok: false, reason: "not-a-friend" };
  addReviewersNow(ctx, pact, accountRow(ctx, accountId).name, added);
  return { ok: true };
}

/** The owner sets a pact's reminders past its edit window: the whole list, applied at once. */
export function setReminders(
  ctx: CoreContext,
  accountId: AccountId,
  pactId: string,
  reminders: string[],
): SetRemindersResult {
  const changeable = changeablePact(ctx, accountId, pactId, ctx.clock.now());
  if (!changeable.ok) return changeable;
  const { pact } = changeable;
  const unique = wellFormedReminders(reminders, scheduleOf(pact.schedule).kind === "one-time");
  if (unique === null) return { ok: false, reason: "invalid-reminders" };
  const inTime = remindersInTimeNow(ctx, pact, accountRow(ctx, accountId).timezone, unique);
  if (inTime === null) return { ok: false, reason: "reminder-after-due-time" };
  saveReminders(ctx, pact, inTime);
  return { ok: true };
}

/**
 * The owner's pact, if a change may be sent to it at `now`: Active and past
 * its edit window. A change that applies at once is refused for no other reason.
 */
function changeablePact(
  ctx: CoreContext,
  ownerId: AccountId,
  pactId: string,
  now: Date,
): { ok: true; pact: PactRow } | { ok: false; reason: AtOnceChangeRefusal } {
  const pact = ownPact(ctx, ownerId, pactId);
  if (!pact) return { ok: false, reason: "pact-not-found" };
  if (pact.stage === "ended") return { ok: false, reason: "pact-ended" };
  if (editWindowClosesAt(pact, now) !== null) return { ok: false, reason: "edit-window-open" };
  return { ok: true, pact };
}

/**
 * Well-formed `reminders` in the order they go off, or null when one goes off
 * at or after the due time in force now, or the one a waiting change request
 * asks for: reminders apply at once, and approving the request changes the
 * due time but not them.
 */
function remindersInTimeNow(ctx: CoreContext, pact: PactRow, timezone: string, reminders: string[]): string[] | null {
  const currentDueAt = occurrencesOf(ctx, pact.id, timezone).first.dueAt;
  const sorted = remindersInTime(reminders, occurrenceTermsOf(pact), currentDueAt, timezone);
  if (sorted === null) return null;
  const waiting = waitingChangeRequestId(ctx, pact.id);
  const request = waiting === null ? undefined : changeRequestRow(ctx, waiting)?.request;
  if (request?.kind !== "change") return sorted;
  const requested = firstOccurrenceUnder(ctx, pact, timezone, request.after);
  return remindersGoOffInTime(sorted, requested.terms, requested.first.dueAt, timezone) ? sorted : null;
}

function rename(ctx: CoreContext, pactId: string, name: string): void {
  ctx.db.prepare(`UPDATE pact SET name = ? WHERE id = ?`).run(name, pactId);
}

/** Stores the pact's reminders, when they differ from those it has. */
function saveReminders(ctx: CoreContext, pact: PactRow, reminders: string[]): void {
  const json = JSON.stringify(reminders);
  if (json !== pact.reminders) ctx.db.prepare(`UPDATE pact SET reminders = ? WHERE id = ?`).run(json, pact.id);
}

/**
 * Adds `added` to the pact's reviewers, and tells each about the pact (named
 * `pact.name`) as it stands. Each reviewer the pact had already is told who
 * was added, unless the reviewers haven't been told of the pact yet: they
 * then learn of it with every reviewer in place.
 */
function addReviewersNow(ctx: CoreContext, pact: PactRow, ownerName: string, added: AccountId[]): void {
  if (added.length === 0) return;
  const earlier = reviewersOf(ctx, pact.id);
  setReviewers(ctx, pact.id, added);
  tellPickedAsReviewer(ctx, added, `${ownerName} added you as a reviewer`, {
    id: pact.id,
    name: pact.name,
    schedule: scheduleOf(pact.schedule),
    penaltyCents: pact.penalty_cents,
  });
  if (pact.reviewers_notified_at === null) return;
  const newcomers = friendsSortedByName(ctx, added);
  const names = newcomers.map((friend) => friend.name);
  tellAll(ctx, earlier, "reviewer-added", {
    pactId: pact.id,
    added: newcomers.map((friend) => friend.id),
    title: `${ownerName} added ${listNames(names)} as ${names.length === 1 ? "a reviewer" : "reviewers"}`,
    body: `${pact.name} · ${names.length === 1 ? names[0] : "They"} can now review it too.`,
    url: APP_PATHS.review,
  });
}

export function requestEnd(ctx: CoreContext, accountId: AccountId, pactId: string, note?: string): RequestEndResult {
  const { name: ownerName } = accountRow(ctx, accountId);
  const pact = ownPact(ctx, accountId, pactId);
  if (!pact) return { ok: false, reason: "pact-not-found" };
  if (pact.stage === "ended") return { ok: false, reason: "pact-ended" };
  if (editWindowClosesAt(pact, ctx.clock.now()) !== null) return { ok: false, reason: "edit-window-open" };
  if (pact.end_approved_at !== null) return { ok: false, reason: "end-approved" };
  if (waitingChangeRequestId(ctx, pactId) !== null) return { ok: false, reason: "change-request-waiting" };
  if (textTooLong(note)) return { ok: false, reason: "text-too-long" };
  const id = sendChangeRequest(ctx, pact, ownerName, changeableTerms(ctx, pact), null, note);
  return { ok: true, changeRequestId: id };
}

export function changeRequestPage(
  ctx: CoreContext,
  accountId: AccountId,
  changeRequestId: string,
): ChangeRequestResult {
  const row = changeRequestRow(ctx, changeRequestId);
  if (!row || row.owner_account_id !== accountId) return { ok: false, reason: "change-request-not-found" };
  const state = itemStateOf(
    row,
    withdrawalOf(row, () => [pactName(ctx, row.pact_id)]),
  );
  const changeRequest = {
    ...changeRequestView(ctx, row),
    state,
    reviewerNames: friendsSortedByName(ctx, reviewersOf(ctx, row.pact_id)).map((friend) => friend.name),
    thread: thread(ctx, row.id, state.kind === "waiting"),
  };
  return { ok: true, changeRequest } satisfies ChangeRequestResult;
}

export function withdrawChangeRequest(
  ctx: CoreContext,
  accountId: AccountId,
  changeRequestId: string,
): WithdrawChangeRequestResult {
  const row = changeRequestRow(ctx, changeRequestId);
  if (!row || row.owner_account_id !== accountId) return { ok: false, reason: "change-request-not-found" };
  if (row.decision !== null || row.withdrawn_at !== null) return { ok: false, reason: "not-waiting" };
  ctx.db
    .prepare(`UPDATE change_request SET withdrawn_at = ?, withdrawn_reason = 'owner' WHERE id = ?`)
    .run(ctx.clock.now().toISOString(), changeRequestId);
  return { ok: true };
}

export function withoutReminders({
  reminders: _reminders,
  ...terms
}: CurrentTerms & Pick<PactTerms, "reminders">): CurrentTerms {
  return terms;
}

/** A change request as stored, with its pact's owner, their name and timezone, and its deciding reviewer's name. */
export interface ChangeRequestRow extends ReviewStateRow {
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
  withdrawn_reason: "owner" | "pact-ended" | null;
  owner_account_id: AccountId;
  owner_name: string;
  timezone: string;
}

/**
 * What a change request asks: to end the pact, or to change its terms.
 * `ends_pact` is set exactly when `after_terms` is null (a CHECK holds it).
 */
export type RequestedChange = { kind: "end" } | { kind: "change"; before: ChangeableTerms; after: ChangeableTerms };

/** A change request as `changeRequestRow` reads it, with what it asks parsed. */
export type StoredChangeRequest = Omit<ChangeRequestRow, "ends_pact" | "before_terms" | "after_terms"> & {
  kind: "change-request";
  request: RequestedChange;
};

export function storedChangeRequestOf({
  ends_pact: _endsPact,
  before_terms: before,
  after_terms: after,
  ...row
}: ChangeRequestRow): StoredChangeRequest {
  return {
    ...row,
    kind: "change-request",
    request:
      after === null ? { kind: "end" } : { kind: "change", before: storedTerms(before), after: storedTerms(after) },
  };
}

/** The terms a change would give a pact: `checked`, from `change`, with the penalty and recipient it names. */
export function changeableTermsOf(checked: CheckedPact, change: PactChange): ChangeableTerms {
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
export function openOccurrencesRefusal(
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

/** The pact's terms an owner can change, as they stand. */
export function changeableTerms(ctx: CoreContext, pact: PactRow): ChangeableTerms {
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
    reviewerIds: reviewersOf(ctx, pact.id),
    reminders: remindersOf(pact.reminders),
    ankiDeckId: pact.anki_deck_id,
  };
}

/** The id of the pact's change request waiting for a decision, or null. */
export function waitingChangeRequestId(ctx: CoreContext, pactId: string): string | null {
  const row = ctx.one<{ id: string }>(
    `SELECT id FROM change_request WHERE pact_id = ? AND decision IS NULL AND withdrawn_at IS NULL`,
    pactId,
  );
  return row?.id ?? null;
}

/**
 * What sending `change` to the owner's pact would do at `now`: the pact,
 * its terms before and after, what each changed term does, and the whole
 * change's outcome; or why it's refused.
 */
export function checkedChange(
  ctx: CoreContext,
  ownerId: AccountId,
  timezone: string,
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
  const changeable = changeablePact(ctx, ownerId, pactId, now);
  if (!changeable.ok) return changeable;
  const { pact } = changeable;
  if (textTooLong(change.note)) return { ok: false, reason: "text-too-long" };
  const { note: _note, ankiDeckId: newDeckId, ...terms } = change;
  // An Anki pact keeps its deck unless the change names another.
  const ankiDeckId = pact.anki_deck_id === null ? undefined : (newDeckId ?? pact.anki_deck_id);
  const checked = checkedPact(
    ctx,
    ownerId,
    timezone,
    { ...terms, evidenceKind: pact.evidence_kind, ...(ankiDeckId !== undefined && { ankiDeckId }) },
    new Date(pact.created_at),
    pact,
    true,
  );
  if (!checked.ok) return checked;
  const zone = checked.timezone;
  const before = changeableTerms(ctx, pact);
  // Only a new pact can swap a week's count for its days, or back.
  if (checked.terms.schedule.kind !== before.schedule.kind) return { ok: false, reason: "schedule-kind-fixed" };
  const after = changeableTermsOf(checked, change);
  // A Weekly count week starts on a Monday. A start date stored before that rule may stay.
  if (
    after.schedule.kind === "weekly-count" &&
    after.startDate !== null &&
    after.startDate !== before.startDate &&
    weekdayOf(after.startDate) !== "mon"
  ) {
    return { ok: false, reason: "start-not-monday" };
  }
  // Reminders apply at once, so they go off before the due time in force now as well as the new one.
  if (remindersInTimeNow(ctx, pact, zone, after.reminders) === null) {
    return { ok: false, reason: "reminder-after-due-time" };
  }
  const diffs = termDiffs(before, after, dayClockOf(pact, pact.in_bed_by, pact.due_by));
  if (waitingChangeRequestId(ctx, pactId) !== null && diffs.some((diff) => diff.effect !== "at-once")) {
    return { ok: false, reason: "change-request-waiting" };
  }
  // An approved end waits for the open occurrence: nothing after it will be judged, and a later end date would undo it.
  if (pact.end_approved_at !== null && diffs.some((diff) => diff.effect !== "at-once")) {
    return { ok: false, reason: "end-approved" };
  }
  // A One-time change applies to its occurrence even once it's open, given an hour to the new deadline.
  if (checked.terms.schedule.kind === "one-time" && !deadlineFarEnough(ctx, pact, zone, after, now)) {
    return { ok: false, reason: "deadline-too-soon" };
  }
  const reason = openOccurrencesRefusal(pact.first_occurrence, before, after, lastDayOpened(ctx, pact.id, zone, now));
  if (reason !== null) return { ok: false, reason };
  return {
    ok: true,
    pact,
    timezone: zone,
    before,
    after,
    diffs,
    outcome: changeOutcome(ctx, pact, zone, before, after, diffs, now),
  };
}

export function changeOutcome(
  ctx: CoreContext,
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
      reviewerNames: friendsSortedByName(ctx, deciders).map((friend) => friend.name),
      bundlesStricter: diffs.some((diff) => diff.effect === "stricter"),
      appliesNow: appliesNow(before, after, diffs),
    };
  }
  if (diffs.some((diff) => diff.effect === "stricter")) {
    return {
      kind: "stricter",
      ...startOfNewTerms(ctx, pact, timezone, after, now),
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
export function startOfNewTerms(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  after: Pick<ChangeableTerms, "schedule" | "inBedBy" | "dueBy" | "startDate" | "endDate" | "penaltyCents">,
  at: Date,
): ChangeStart {
  // One-time: the change applies to its one occurrence, open or not.
  if (after.schedule.kind === "one-time") return { appliesFrom: after.schedule.deadline, todayKeepsCents: null };
  const today = lastDayOpened(ctx, pact.id, timezone, at);
  const from = firstDayNotOpen(after.schedule, today);
  const current = occurrenceTermsOf(pact);
  const earlier = earlierTermsOf(ctx, pact);
  const zones = earlierTimezonesOf(ctx, pact);
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
    null,
    zones,
  ).between(from, addDays(start, 7));
  const scheduled = occurrencesOverTime(current, earlier, timezone, null, zones);
  return {
    appliesFrom: first?.date ?? from,
    todayKeepsCents: todayKeeps(ctx, pact.id, scheduled, today, after),
  };
}

/**
 * Puts `after` in force for the pact's occurrences not open at `at`, those
 * dated from tomorrow (for Weekly count, next Monday) in the owner's
 * timezone; the terms it had stay with those dated before. A pact whose first occurrence hasn't come gets the
 * first day of the new schedule from tomorrow. The name and reviewers are
 * left as they are.
 */
export function applyTerms(ctx: CoreContext, pact: PactRow, after: ChangeableTerms, at: Date, timezone: string): void {
  if (after.schedule.kind === "one-time") return applyOneTimeTerms(ctx, pact, after);
  const from = firstDayNotOpen(after.schedule, lastDayOpened(ctx, pact.id, timezone, at));
  // A change already made today put the terms today keeps there first.
  ctx.db
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
  ctx.db
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
  // A day the new terms don't have is covered no more, so a later change that adds it back finds it uncovered.
  const scheduled = occurrencesOf(ctx, pact.id, timezone);
  uncoverRemovedDays(ctx, pact.id, from, (date) => scheduled.includes(date));
}

/**
 * Puts `after` in force for a One-time pact's one occurrence, open or not:
 * its evidence and any excuse for it move with the deadline's date. An
 * occurrence already judged has Ended the pact, and keeps its terms.
 */
export function applyOneTimeTerms(ctx: CoreContext, pact: PactRow, after: ChangeableTerms): void {
  if (after.schedule.kind !== "one-time" || pact.stage === "ended") return;
  ctx.db
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
  moveOneTimeOccurrence(ctx, pact.id, pact.first_occurrence, after.schedule.deadline);
}

/**
 * Whether a One-time pact changed to `after` at `at` is due at least an
 * hour later, or keeps the deadline it has.
 */
export function deadlineFarEnough(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  after: Pick<ChangeableTerms, "schedule" | "dueBy">,
  at: Date,
): boolean {
  const current = occurrencesOf(ctx, pact.id, timezone).first;
  const changed = firstOccurrenceUnder(ctx, pact, timezone, { ...after, inBedBy: pact.in_bed_by }).first;
  return changed.dueAt.getTime() === current.dueAt.getTime() || dueSoonEnough(changed, at);
}

/**
 * The terms `pact` would have under `after`'s schedule and times, and their
 * first occurrence: on a One-time pact, its one, due at the deadline `after` asks for.
 */
function firstOccurrenceUnder(
  ctx: CoreContext,
  pact: PactRow,
  timezone: string,
  after: Pick<ChangeableTerms, "schedule" | "inBedBy" | "dueBy">,
): { terms: OccurrenceTerms; first: Occurrence } {
  const terms = {
    ...scheduleTermsOf(pact, after.schedule, after.inBedBy, after.dueBy),
    firstOccurrence: pact.first_occurrence,
    endDate: pact.end_date,
  };
  const { first } = occurrencesOverTime(terms, [], timezone, null, earlierTimezonesOf(ctx, pact));
  return { terms, first };
}

/** The changed terms, old and new, with names for the recipient and reviewers. */
export function termChanges(
  ctx: CoreContext,
  ownerId: AccountId,
  before: ChangeableTerms,
  after: ChangeableTerms,
  diffs: TermDiff[],
): TermChange[] {
  const deck = (id: string) => ({ id, name: ankiDeckName(ctx, ownerId, id) });
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
          before: { id: before.recipientId, name: recipientName(ctx, before.recipientId) },
          after: { id: after.recipientId, name: recipientName(ctx, after.recipientId) },
          ...effect,
        };
      case "reviewers":
        return {
          term: diff.term,
          before: friendsSortedByName(ctx, before.reviewerIds),
          after: friendsSortedByName(ctx, after.reviewerIds),
          added: friendsSortedByName(
            ctx,
            after.reviewerIds.filter((id) => !before.reviewerIds.includes(id)),
          ),
          removed: friendsSortedByName(
            ctx,
            before.reviewerIds.filter((id) => !after.reviewerIds.includes(id)),
          ),
          ...effect,
        };
      case "reminders":
        return { term: diff.term, before: before.reminders, after: after.reminders, ...effect };
    }
  });
}

/** Records a change request for the pact, and gives its reviewers a review item. */
export function sendChangeRequest(
  ctx: CoreContext,
  pact: PactRow,
  ownerName: string,
  before: ChangeableTerms,
  after: ChangeableTerms | null,
  note: string | undefined,
): string {
  const id = ctx.newId();
  const trimmed = note?.trim() ?? "";
  ctx.db
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
      ctx.clock.now().toISOString(),
    );
  const what =
    after === null
      ? []
      : termDiffs(before, after, dayClockOf(pact, pact.in_bed_by, pact.due_by)).map(({ term }) =>
          termLabel(term, after.schedule),
        );
  const body = [...what, ...(trimmed === "" ? [] : [`“${trimmed}”`])].join(" · ");
  tellAll(ctx, reviewersOf(ctx, pact.id), "review-item", {
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
export function changeRequestRow(ctx: CoreContext, id: string): StoredChangeRequest | undefined {
  const row = ctx.one<ChangeRequestRow>(
    `SELECT change_request.*, pact.owner_account_id, owner.name AS owner_name, owner.timezone,
              reviewer.name AS reviewer_name
       FROM change_request
       JOIN pact ON pact.id = change_request.pact_id
       JOIN account AS owner ON owner.id = pact.owner_account_id
       LEFT JOIN account AS reviewer ON reviewer.id = change_request.decided_by_account_id
       WHERE change_request.id = ?`,
    id,
  );
  return row && storedChangeRequestOf(row);
}

export function changeRequestView(ctx: CoreContext, row: StoredChangeRequest): ChangeRequestView {
  const pact = ctx.db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
  const { request } = row;
  const waiting = row.decision === null && row.withdrawn_at === null;
  const base = {
    id: row.id,
    pactId: row.pact_id,
    pactName: pact.name,
    note: row.note,
    requestedAt: new Date(row.requested_at),
    // Reminders are the owner's own: reviewers don't see them.
    current: withoutReminders(currentTerms(ctx, pact)),
  };
  if (request.kind === "end") {
    return { ...base, endsPact: true, ending: waiting ? endTiming(ctx, pact.id, ctx.clock.now()) : null };
  }
  return {
    ...base,
    endsPact: false,
    changes: termChanges(
      ctx,
      pact.owner_account_id,
      request.before,
      request.after,
      termDiffs(request.before, request.after, dayClockOf(pact, pact.in_bed_by, pact.due_by)),
    ),
    start: waiting ? startOfNewTerms(ctx, pact, row.timezone, request.after, ctx.clock.now()) : null,
  };
}

/** Change requests waiting for a decision that `reviewerId` may make: those for pacts they review, oldest first. */
function changeRequestsToReview(ctx: CoreContext, reviewerId: AccountId): QueuedItem[] {
  const ids = ctx.all<{ id: string }>(
    `SELECT change_request.id FROM change_request
       JOIN pact_reviewer ON pact_reviewer.pact_id = change_request.pact_id
                         AND pact_reviewer.reviewer_account_id = ?
       WHERE change_request.decision IS NULL AND change_request.withdrawn_at IS NULL
       ORDER BY change_request.requested_at, change_request.id`,
    reviewerId,
  );
  return ids.map(({ id }) => {
    const row = changeRequestRow(ctx, id)!;
    return {
      item: {
        kind: "change-request",
        ownerName: row.owner_name,
        thread: thread(ctx, id, true),
        ...changeRequestView(ctx, row),
      },
      since: new Date(row.requested_at),
    };
  });
}

/** The owner's change requests waiting for a decision (or just that for `pactId`), newest first. */
function waitingChangeRequests(ctx: CoreContext, ownerId: AccountId, pactId?: string): TodayWaitingItem[] {
  const rows = ctx.all<{
    id: string;
    pact_id: string;
    name: string;
    ends_pact: 0 | 1;
    requested_at: string;
  }>(
    `SELECT change_request.id, change_request.pact_id, pact.name, change_request.ends_pact,
              change_request.requested_at
       FROM change_request JOIN pact ON pact.id = change_request.pact_id
       WHERE pact.owner_account_id = ? AND change_request.decision IS NULL AND change_request.withdrawn_at IS NULL
         AND (? IS NULL OR pact.id = ?)
       ORDER BY change_request.requested_at DESC, change_request.id`,
    ownerId,
    pactId ?? null,
    pactId ?? null,
  );
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
 * Change requests as review items: decided by the pact's reviewers while
 * it's Active, and first in the Review Queue, as one waiting holds up any
 * other change to its pact.
 */
export const changeRequestKind: RequestKindHandler<StoredChangeRequest> = {
  kind: "change-request",
  load: (ctx, id) => changeRequestRow(ctx, id),
  deciders: (ctx, row) => reviewersOf(ctx, row.pact_id),
  reviewable: (ctx, row) =>
    (ctx.db.prepare(`SELECT stage FROM pact WHERE id = ?`).get(row.pact_id) as Pick<PactRow, "stage">).stage ===
    "active",
  checkDecision(ctx, row, decided) {
    if (decided.outcome === "rejected") return null;
    // Judging catches up on the pact first, as the scheduler would have: a change never
    // rescues an occurrence already due, and an end approved with nothing open leaves none
    // unjudged. Judging may End it, which withdraws the request.
    const [pact] = pactsToJudge(ctx, row.pact_id);
    settlePactDueBy(ctx, pact!, ctx.clock.now());
    if (waitingChangeRequestId(ctx, row.pact_id) !== row.id) return "item-not-found";
    return approvableNow(ctx, row) ? null : "deadline-too-soon";
  },
  apply: (ctx, row, decided, reviewerId) => decideChangeRequest(ctx, row, decided, reviewerId),
  describe(ctx, row) {
    const name = pactName(ctx, row.pact_id);
    return {
      what: row.request.kind === "end" ? `request to end ${name}` : `change to ${name}`,
      ownerPath: APP_PATHS.changeRequest(row.id),
    };
  },
  queue: changeRequestsToReview,
  queueFirst: true,
  waiting: waitingChangeRequests,
  pactNames: (ctx, row) => [pactName(ctx, row.pact_id)],
  // Ending a pact withdraws its waiting change request (`endPact`); this is the same rule, read.
  moot: {
    waitingIds: (ctx) =>
      ctx
        .all<{
          id: string;
        }>(`SELECT id FROM change_request WHERE decision IS NULL AND withdrawn_at IS NULL ORDER BY requested_at, id`)
        .map((row) => row.id),
    reason: (ctx, row) =>
      ctx.one(`SELECT 1 FROM pact WHERE id = ? AND stage = 'ended'`, row.pact_id) ? "pact-ended" : null,
    withdraw: (ctx, row, reason, now) => {
      ctx.db
        .prepare(`UPDATE change_request SET withdrawn_at = ?, withdrawn_reason = ? WHERE id = ?`)
        .run(now.toISOString(), reason, row.id);
    },
  },
};

/**
 * Records a reviewer's decision on a change request and tells the owner.
 * Approved, an end makes the pact Ended once the occurrence (or week) open
 * now closes, after it's judged as usual, or at once with none open (`decide`
 * has caught judging up first); a change applies its terms from the first
 * occurrence not open yet, and takes off the reviewers it removes. Rejected,
 * nothing changes.
 */
export function decideChangeRequest(
  ctx: CoreContext,
  row: StoredChangeRequest,
  decided: Decided,
  reviewerId: AccountId,
): void {
  const { outcome } = decided;
  const now = ctx.clock.now();
  recordDecision(ctx, "change_request", row.id, decided, reviewerId, now);
  const { request } = row;
  const pact = ctx.db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
  const reviewerName = accountName(ctx, reviewerId);
  const title = `${reviewerName} ${outcome} ${request.kind === "end" ? `ending ${pact.name}` : "your change"}`;
  let body: string;
  if (decided.outcome === "rejected") {
    body = `${pact.name} · “${decided.reason}”`;
  } else if (request.kind === "end") {
    const timing = endTiming(ctx, pact.id, now);
    if (timing.kind === "after") {
      endAfter(ctx, pact.id, timing.lastDay, now);
      body = `${pact.name} ends after ${formatDate(timing.lastDay)}`;
    } else {
      endPact(ctx, pact.id, "end-request", now);
      body = `${pact.name} has ended`;
    }
  } else {
    const { before, after } = request;
    tellNewVacationDeciders(ctx, pact.id, () => {
      for (const removed of before.reviewerIds.filter((id) => !after.reviewerIds.includes(id))) {
        ctx.db.prepare(`DELETE FROM pact_reviewer WHERE pact_id = ? AND reviewer_account_id = ?`).run(pact.id, removed);
      }
    });
    const { timezone } = row;
    const { appliesFrom } = startOfNewTerms(ctx, pact, timezone, after, now);
    applyTerms(ctx, pact, after, now, timezone);
    body = `${pact.name} · New terms start ${formatDate(appliesFrom)}`;
  }
  ctx.enqueue({
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
export function approvableNow(ctx: CoreContext, row: StoredChangeRequest): boolean {
  const { request } = row;
  if (request.kind === "end" || request.after.schedule.kind !== "one-time") return true;
  const pact = ctx.db.prepare(`SELECT * FROM pact WHERE id = ?`).get(row.pact_id) as PactRow;
  if (pact.stage === "ended") return true;
  return deadlineFarEnough(ctx, pact, row.timezone, request.after, ctx.clock.now());
}

/** The penalty the occurrence of `occurrences` open `today` keeps, when it differs from `after`'s; else null. */
export function todayKeeps(
  ctx: CoreContext,
  pactId: string,
  occurrences: Occurrences,
  today: LocalDate,
  after: Pick<ChangeableTerms, "penaltyCents">,
): number | null {
  const open = occurrences.covering(today);
  if (!open) return null;
  const { penalty_cents: penalty } = termsOn(ctx, pactId, open.date);
  return penalty !== after.penaltyCents ? penalty : null;
}
