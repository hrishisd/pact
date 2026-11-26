// What a change to a pact after its edit window does, term by term: relaxes
// it (a change request, waiting for a reviewer), only makes it stricter
// (applies without approval to occurrences not open yet), or doesn't change
// what counts (applies at once), like the name and the reminders.

import { isOncePerPeriod, isPeriodSchedule } from "../shared/schedules.ts";
import type {
  AccountId,
  AppliesNow,
  ApprovalReason,
  ClockTime,
  DatedReminder,
  LocalDate,
  Schedule,
  TermChange,
  TermEffect,
} from "../shared/types.ts";
import { ankiDueByOrder, minutesFrom, NIGHT_STARTS_HOUR, type DayClock } from "./occurrences.ts";

/** A pact's terms an owner can change: everything but its evidence kind. */
export interface ChangeableTerms {
  name: string;
  description: string;
  /** Bedtime pacts only; null for Camera and Anki. */
  inBedBy: ClockTime | null;
  /** Camera and Anki, or null for midnight. */
  dueBy: ClockTime | null;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  schedule: Schedule;
  penaltyCents: number;
  recipientId: string;
  /** Sorted, no repeats. */
  reviewerIds: AccountId[];
  /** In the order they go off, no repeats. */
  reminders: (ClockTime | DatedReminder)[];
  /** Anki only, the deck's id; null for any other pact (and in change requests sent before decks could change). */
  ankiDeckId: string | null;
}

/**
 * One changed term, with its effect, in the Request change form's order. The
 * deck and the in-bed-by time differ only when both are set, so they carry both.
 */
export type TermDiff = (
  | { term: "deck" | "in-bed-by"; before: string; after: string }
  | { term: Exclude<TermChange["term"], "deck" | "in-bed-by"> }
) &
  TermEffect;

const STRICTER: TermEffect = { effect: "stricter" };
const AT_ONCE: TermEffect = { effect: "at-once" };

function needs(reason: ApprovalReason): TermEffect {
  return { effect: "needs-approval", reason };
}

/** Just the effect of `diff`, and why it needs approval when it does. */
export function effectOf(diff: TermDiff): TermEffect {
  return diff.effect === "needs-approval" ? needs(diff.reason) : { effect: diff.effect };
}

/**
 * Each term that differs between `before` and `after`, and what changing it
 * does. `day` is the pact's day clock as it stands: an Anki pact's due-by
 * times are ordered by where they fall in its Anki day.
 */
export function termDiffs(before: ChangeableTerms, after: ChangeableTerms, day: DayClock): TermDiff[] {
  const diffs: TermDiff[] = [];
  const add = (term: Exclude<TermDiff["term"], "deck" | "in-bed-by">, effect: TermEffect) =>
    diffs.push({ term, ...effect });
  // The name doesn't change what counts.
  if (after.name !== before.name) add("name", AT_ONCE);
  // It defines what a photo must show; only a reviewer can judge a new one.
  if (after.description !== before.description) add("description", needs("defines-photo"));
  // Pact can't tell whether another deck is easier: only a reviewer can judge it.
  if (after.ankiDeckId !== before.ankiDeckId && before.ankiDeckId !== null && after.ankiDeckId !== null) {
    diffs.push({ term: "deck", before: before.ankiDeckId, after: after.ankiDeckId, ...needs("deck-changed") });
  }
  if (after.inBedBy !== before.inBedBy && before.inBedBy !== null && after.inBedBy !== null) {
    // A night starts at 18:00, so 23:00 is earlier in it than 00:30.
    const later = minutesFrom(after.inBedBy, NIGHT_STARTS_HOUR) > minutesFrom(before.inBedBy, NIGHT_STARTS_HOUR);
    const effect = later ? needs("later-time") : STRICTER;
    diffs.push({ term: "in-bed-by", before: before.inBedBy, after: after.inBedBy, ...effect });
  }
  const schedule = scheduleEffect(before.schedule, after.schedule);
  if (schedule !== null) add("schedule", schedule);
  if (after.dueBy !== before.dueBy) {
    const later = dueByOrder(after.dueBy, day) > dueByOrder(before.dueBy, day);
    add("due-by", later ? needs(after.dueBy === null ? "due-at-midnight" : "later-time") : STRICTER);
  }
  // No start date is the earliest start, and no end date the latest end.
  if (after.startDate !== before.startDate) {
    const later = (after.startDate ?? "") > (before.startDate ?? "");
    add("start-date", later ? needs(before.startDate === null ? "start-added" : "later-start") : STRICTER);
  }
  if (after.endDate !== before.endDate) {
    const earlier = (after.endDate ?? "9999-12-31") < (before.endDate ?? "9999-12-31");
    add("end-date", earlier ? needs(before.endDate === null ? "end-added" : "earlier-end") : STRICTER);
  }
  if (after.penaltyCents !== before.penaltyCents) {
    add("penalty", after.penaltyCents < before.penaltyCents ? needs("lower-penalty") : STRICTER);
  }
  // Only a reviewer can judge which recipient hurts more.
  if (after.recipientId !== before.recipientId) add("recipient", needs("recipient-changed"));
  const removed = before.reviewerIds.filter((id) => !after.reviewerIds.includes(id));
  if (removed.length > 0) add("reviewers", needs("reviewers-removed"));
  else if (addedReviewerIds(before, after).length > 0) add("reviewers", AT_ONCE);
  // Reminders only nudge the owner; they don't change what counts.
  if (after.reminders.join() !== before.reminders.join()) add("reminders", AT_ONCE);
  return diffs;
}

/**
 * What applies at once inside a change with these `diffs`, even one that
 * waits for approval: the name, the reminders, and the reviewers added.
 */
export function appliesNow(before: ChangeableTerms, after: ChangeableTerms, diffs: TermDiff[]): AppliesNow[] {
  const added = addedReviewerIds(before, after).length;
  return [
    ...(diffs.some((diff) => diff.term === "name") ? (["name"] as const) : []),
    ...(diffs.some((diff) => diff.term === "reminders") ? (["reminders"] as const) : []),
    ...(added === 0 ? [] : added === 1 ? (["new-reviewer"] as const) : (["new-reviewers"] as const)),
  ];
}

function addedReviewerIds(before: ChangeableTerms, after: ChangeableTerms): AccountId[] {
  return after.reviewerIds.filter((id) => !before.reviewerIds.includes(id));
}

/**
 * What changing the schedule from `before` to `after` does: fewer days, or a
 * lower Weekly count target, relaxes it; only more days, or a higher target,
 * is stricter. On One-time, turning Submit anytime on relaxes it, and so does
 * a later deadline with it on, or any other date with it off; turning it off,
 * or an earlier deadline with it on, is stricter. Null when it's the same.
 */
function scheduleEffect(before: Schedule, after: Schedule): TermEffect | null {
  if (before.kind === "fixed-days" && after.kind === "fixed-days") {
    if (before.days.some((day) => !after.days.includes(day))) return needs("fewer-days");
    return after.days.some((day) => !before.days.includes(day)) ? STRICTER : null;
  }
  if (before.kind === "weekly-count" && after.kind === "weekly-count") {
    if (after.target === before.target) return null;
    return after.target < before.target ? needs("lower-target") : STRICTER;
  }
  // Every 2 weeks and Once a month have nothing else to change.
  if (isOncePerPeriod(before) && after.kind === before.kind) return null;
  if (before.kind === "one-time" && after.kind === "one-time") {
    const moved = after.deadline !== before.deadline;
    if (!moved && after.submitAnytime === before.submitAnytime) return null;
    // Turning Submit anytime on relaxes. Without it on both sides, only a
    // reviewer can judge whether another day is easier.
    if (after.submitAnytime && !before.submitAnytime) return needs("submit-anytime-on");
    if (moved && !(before.submitAnytime && after.submitAnytime)) return needs("date-moved");
    return after.deadline > before.deadline ? needs("later-deadline") : STRICTER;
  }
  // Swapping one kind for the other is refused before this, after the edit
  // window; a reviewer would have to judge it. Should one get here, it reads
  // as a lower target from a period schedule, and as fewer days otherwise.
  return needs(isPeriodSchedule(before) ? "lower-target" : "fewer-days");
}

/**
 * How late a due-by time (null for midnight) is in a day on the clock `day`,
 * in minutes. A Camera day ends at midnight, so no due-by time is the latest.
 * An Anki day runs from its rollover hour, so a time the morning after is
 * later than midnight. A bedtime night has its in-bed-by time instead.
 */
function dueByOrder(dueBy: ClockTime | null, day: DayClock): number {
  switch (day.kind) {
    case "day":
      return dueBy === null ? 24 * 60 : minutesFrom(dueBy, 0);
    case "night":
      throw new Error("a bedtime night has no due-by time");
    case "anki":
      // Both sides passed ankiDueByFits before this.
      return ankiDueByOrder(dueBy, day.rollover);
  }
}
