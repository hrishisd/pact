// What a change to a pact after its edit window does, term by term: relaxes
// it (a change request, waiting for a reviewer), only makes it stricter
// (applies without approval to occurrences not open yet), or doesn't change
// what counts (applies at once), like the name and the reminders.

import type { AccountId, ChangeEffect, Schedule, TermChange } from "../shared/types.ts";
import { ankiDueByOrder } from "./occurrences.ts";

/** A pact's terms an owner can change: everything but its evidence kind. */
export interface ChangeableTerms {
  name: string;
  description: string;
  /** Oura Ring only, "HH:MM"; null for Camera. */
  inBedBy: string | null;
  /** Camera and Anki, "HH:MM", or null for midnight. */
  dueBy: string | null;
  /** "YYYY-MM-DD", or null. */
  startDate: string | null;
  /** "YYYY-MM-DD", or null. */
  endDate: string | null;
  schedule: Schedule;
  penaltyCents: number;
  recipientId: string;
  /** Sorted, no repeats. */
  reviewerIds: AccountId[];
  /** "HH:MM" each, in the order they go off, no repeats. */
  reminders: string[];
  /** Anki only, the deck's id; null for any other pact (and in change requests sent before decks could change). */
  ankiDeckId: string | null;
}

/**
 * One changed term, with its effect, in the Request change form's order. The
 * deck and the in-bed-by time differ only when both are set, so they carry both.
 */
export type TermDiff =
  | { term: "deck" | "in-bed-by"; before: string; after: string; effect: ChangeEffect }
  | { term: Exclude<TermChange["term"], "deck" | "in-bed-by">; effect: ChangeEffect };

/**
 * Each term that differs between `before` and `after`, and what changing it
 * does. `ankiRollover` is an Anki pact's rollover hour, null for any other
 * pact: an Anki pact's due-by times are ordered by where they fall in its Anki day.
 */
export function termDiffs(before: ChangeableTerms, after: ChangeableTerms, ankiRollover: number | null): TermDiff[] {
  const diffs: TermDiff[] = [];
  const add = (term: Exclude<TermDiff["term"], "deck" | "in-bed-by">, effect: ChangeEffect) =>
    diffs.push({ term, effect });
  // The name doesn't change what counts.
  if (after.name !== before.name) add("name", "at-once");
  // It defines what a photo must show; only a reviewer can judge a new one.
  if (after.description !== before.description) add("description", "needs-approval");
  // Pact can't tell whether another deck is easier: only a reviewer can judge it.
  if (after.ankiDeckId !== before.ankiDeckId && before.ankiDeckId !== null && after.ankiDeckId !== null) {
    diffs.push({ term: "deck", before: before.ankiDeckId, after: after.ankiDeckId, effect: "needs-approval" });
  }
  if (after.inBedBy !== before.inBedBy && before.inBedBy !== null && after.inBedBy !== null) {
    const effect = lateness(after.inBedBy) > lateness(before.inBedBy) ? "needs-approval" : "stricter";
    diffs.push({ term: "in-bed-by", before: before.inBedBy, after: after.inBedBy, effect });
  }
  const schedule = scheduleEffect(before.schedule, after.schedule);
  if (schedule !== null) add("schedule", schedule);
  if (after.dueBy !== before.dueBy) {
    const later = dueByOrder(after.dueBy, ankiRollover) > dueByOrder(before.dueBy, ankiRollover);
    add("due-by", later ? "needs-approval" : "stricter");
  }
  // No start date is the earliest start, and no end date the latest end.
  if (after.startDate !== before.startDate) {
    add("start-date", (after.startDate ?? "") > (before.startDate ?? "") ? "needs-approval" : "stricter");
  }
  if (after.endDate !== before.endDate) {
    add("end-date", (after.endDate ?? "9999-12-31") < (before.endDate ?? "9999-12-31") ? "needs-approval" : "stricter");
  }
  if (after.penaltyCents !== before.penaltyCents) {
    add("penalty", after.penaltyCents < before.penaltyCents ? "needs-approval" : "stricter");
  }
  // Only a reviewer can judge which recipient hurts more.
  if (after.recipientId !== before.recipientId) add("recipient", "needs-approval");
  const removed = before.reviewerIds.filter((id) => !after.reviewerIds.includes(id));
  const added = after.reviewerIds.filter((id) => !before.reviewerIds.includes(id));
  if (removed.length > 0) add("reviewers", "needs-approval");
  else if (added.length > 0) add("reviewers", "at-once");
  // Reminders only nudge the owner; they don't change what counts.
  if (after.reminders.join() !== before.reminders.join()) add("reminders", "at-once");
  return diffs;
}

/**
 * What changing the schedule from `before` to `after` does: fewer days, or a
 * lower Weekly count target, relaxes it; only more days, or a higher target,
 * is stricter. On One-time, turning Submit anytime on relaxes it, and so does
 * a later deadline with it on, or any other date with it off; turning it off,
 * or an earlier deadline with it on, is stricter. Swapping one kind for the other is refused before this, after
 * the edit window; a reviewer would have to judge it. Null when it's the same.
 */
function scheduleEffect(before: Schedule, after: Schedule): ChangeEffect | null {
  if (before.kind === "fixed-days" && after.kind === "fixed-days") {
    if (before.days.some((day) => !after.days.includes(day))) return "needs-approval";
    return after.days.some((day) => !before.days.includes(day)) ? "stricter" : null;
  }
  if (before.kind === "weekly-count" && after.kind === "weekly-count") {
    if (after.target === before.target) return null;
    return after.target < before.target ? "needs-approval" : "stricter";
  }
  if (before.kind === "one-time" && after.kind === "one-time") {
    const moved = after.deadline !== before.deadline;
    if (!moved && after.submitAnytime === before.submitAnytime) return null;
    // Turning Submit anytime on relaxes. Without it on both sides, only a
    // reviewer can judge whether another day is easier.
    if (after.submitAnytime && !before.submitAnytime) return "needs-approval";
    if (moved && !(before.submitAnytime && after.submitAnytime)) return "needs-approval";
    return after.deadline > before.deadline ? "needs-approval" : "stricter";
  }
  return "needs-approval";
}

/**
 * How late a due-by time (null for midnight) is in its day, in minutes. A
 * Camera day ends at midnight, so no due-by time is the latest. An Anki day
 * runs from its rollover hour, so a time the morning after is later than midnight.
 */
function dueByOrder(dueBy: string | null, ankiRollover: number | null): number {
  if (ankiRollover !== null) {
    // Both sides passed ankiDueByFits before this.
    return ankiDueByOrder(dueBy ?? "00:00", ankiRollover);
  }
  const [hour, minute] = (dueBy ?? "24:00").split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}

/**
 * How late an in-bed-by time is in its night: minutes after 18:00, when the
 * night starts, so 23:00 comes before 00:30.
 */
function lateness(inBedBy: string): number {
  const [hour, minute] = inBedBy.split(":").map(Number) as [number, number];
  return (hour * 60 + minute - 18 * 60 + 24 * 60) % (24 * 60);
}
