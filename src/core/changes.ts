// What a change to a pact after its edit window does, term by term: relaxes
// it (a change request, waiting for a reviewer), only makes it stricter
// (applies without approval to occurrences not open yet), or doesn't change
// what counts (applies at once), like the name and the reminders. Ticket 15
// adds its terms here.

import type { AccountId, ChangeEffect, Schedule } from "../shared/types.ts";

/** A pact's terms an owner can change: everything but its evidence kind. */
export interface ChangeableTerms {
  name: string;
  description: string;
  /** Oura Ring only, "HH:MM"; null for Camera. */
  inBedBy: string | null;
  /** Camera only, "HH:MM", or null for midnight. */
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
}

/** One changed term, with its effect, in the Request change form's order. */
export interface TermDiff {
  term:
    | "name"
    | "description"
    | "in-bed-by"
    | "schedule"
    | "due-by"
    | "start-date"
    | "end-date"
    | "penalty"
    | "recipient"
    | "reviewers"
    | "reminders";
  effect: ChangeEffect;
}

/** Each term that differs between `before` and `after`, and what changing it does. */
export function termDiffs(before: ChangeableTerms, after: ChangeableTerms): TermDiff[] {
  const diffs: TermDiff[] = [];
  const add = (term: TermDiff["term"], effect: ChangeEffect) => diffs.push({ term, effect });
  // The name doesn't change what counts.
  if (after.name !== before.name) add("name", "at-once");
  // It defines what a photo must show; only a reviewer can judge a new one.
  if (after.description !== before.description) add("description", "needs-approval");
  if (after.inBedBy !== before.inBedBy && before.inBedBy !== null && after.inBedBy !== null) {
    add("in-bed-by", lateness(after.inBedBy) > lateness(before.inBedBy) ? "needs-approval" : "stricter");
  }
  const schedule = scheduleEffect(before.schedule, after.schedule);
  if (schedule !== null) add("schedule", schedule);
  // Midnight is the latest a day can be due, so no due-by time is the latest.
  if (after.dueBy !== before.dueBy) {
    add("due-by", (after.dueBy ?? "24:00") > (before.dueBy ?? "24:00") ? "needs-approval" : "stricter");
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
 * is stricter. Swapping one kind for the other is refused before this, after
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
  return "needs-approval";
}

/**
 * How late an in-bed-by time is in its night: minutes after 18:00, when the
 * night starts, so 23:00 comes before 00:30.
 */
function lateness(inBedBy: string): number {
  const [hour, minute] = inBedBy.split(":").map(Number) as [number, number];
  return (hour * 60 + minute - 18 * 60 + 24 * 60) % (24 * 60);
}
