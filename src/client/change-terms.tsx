// How a change to a pact's terms reads: each term's label and value, what a
// change to it needs, the before/after list a change request shows, and the
// terms it leaves alone. The core decides what each change needs; this only
// words it.

import { Fragment } from "react";
import type { Json } from "../shared/api.ts";
import { periodKindOfSchedule } from "../shared/schedules.ts";
import type {
  ApprovalReason,
  AtOnceChangeRefusal,
  ChangeRequestView,
  CurrentTerms,
  EndTiming,
  EvidenceKind,
  Schedule,
  TermChange,
} from "../shared/types.ts";
import {
  clockText,
  EDIT_WINDOW_TEXT,
  formatDate,
  listNames,
  money,
  periodWord,
  remindersText,
  scheduleText,
  TERM_LABELS,
  termLabel,
  thisPeriod,
} from "./format.ts";

export type Term = TermChange["term"];

/** Why any change to a pact past its edit window is refused, whatever it changes: Request change and the pact page's own. */
export const AT_ONCE_REFUSAL_TEXT: Record<AtOnceChangeRefusal, string> = {
  "pact-not-found": "This pact wasn't found.",
  "edit-window-open": `You can still edit this pact freely for ${EDIT_WINDOW_TEXT}. Use Edit instead.`,
  "pact-ended": "This pact has ended.",
};
type Change = Json<TermChange>;
type Current = Json<CurrentTerms>;
/** A change request that changes terms rather than ending the pact. */
type TermsChangeRequestView = Extract<ChangeRequestView, { endsPact: false }>;

/**
 * When an approved end takes effect, for a pact of this evidence kind and
 * kind of schedule: "after Sun Jan 18, once this week is judged", or "now".
 */
export function endsWhenText(
  terms: { evidenceKind: EvidenceKind; schedule: Pick<Schedule, "kind"> },
  ending: EndTiming,
): string {
  if (ending.kind === "at-once") return "now";
  const kind = periodKindOfSchedule(terms.schedule);
  const open = kind ? thisPeriod(kind) : terms.evidenceKind === "oura" ? "that night" : "that day";
  return `after ${formatDate(ending.lastDay)}, once ${open} ${kind === "every-2-weeks" ? "have" : "has"} been judged`;
}

/** Whose penalty stays, in "Today's penalty stays $5": This week's, This month's or These 2 weeks' on a period schedule. */
export function openOccurrenceText(schedule: Pick<Schedule, "kind">): string {
  switch (schedule.kind) {
    case "weekly-count":
      return "This week's";
    case "every-2-weeks":
      return "These 2 weeks'";
    case "once-a-month":
      return "This month's";
    case "fixed-days":
    case "one-time":
      return "Today's";
  }
}

/**
 * The terms a pact of this evidence kind and kind of schedule has, in the
 * Request change order. A One-time pact has no start or end date; an Oura
 * Ring pact has no due-by time.
 */
export function termsOfKind(current: { evidenceKind: EvidenceKind; schedule: Pick<Schedule, "kind"> }): Term[] {
  if (current.schedule.kind === "one-time") {
    return ["name", "description", "schedule", "due-by", "penalty", "recipient", "reviewers", "reminders"];
  }
  if (current.evidenceKind === "anki") {
    return [
      "name",
      "deck",
      "schedule",
      "due-by",
      "start-date",
      "end-date",
      "penalty",
      "recipient",
      "reviewers",
      "reminders",
    ];
  }
  return current.evidenceKind === "oura"
    ? ["name", "in-bed-by", "schedule", "start-date", "end-date", "penalty", "recipient", "reviewers", "reminders"]
    : [
        "name",
        "description",
        "schedule",
        "due-by",
        "start-date",
        "end-date",
        "penalty",
        "recipient",
        "reviewers",
        "reminders",
      ];
}

/** A term's value in the pact as it stands. Reminders aren't terms: the pact's own page shows them. */
export function currentValue(term: Exclude<Term, "reminders">, current: Current): string {
  switch (term) {
    case "name":
      return current.name;
    case "deck":
      return deckText(current.evidenceKind === "anki" ? current.anki.deckName : null);
    case "description":
      return current.description;
    case "in-bed-by":
      return current.evidenceKind === "oura" ? clockText(current.inBedBy) : "—";
    case "schedule":
      return scheduleText(current.schedule);
    case "due-by":
      return dueByText(current.evidenceKind === "oura" ? null : current.dueBy);
    case "start-date":
      return dateText(current.startDate, "No start date");
    case "end-date":
      return dateText(current.endDate, "No end date");
    case "penalty":
      return `${money(current.penaltyCents)} per miss`;
    case "recipient":
      return current.recipient.name;
    case "reviewers":
      return names(current.reviewers);
  }
}

/** A deck's full name, or what to say when Pact never had it. */
function deckText(name: string | null): string {
  return name ?? "Unknown deck";
}

/** A due-by time, "9:00pm", or "Midnight" without one. */
function dueByText(dueBy: string | null): string {
  return dueBy === null ? "Midnight" : clockText(dueBy);
}

function dateText(date: string | null, none: string): string {
  return date === null ? none : formatDate(date);
}

/** A changed term's old or new value. */
export function changeValue(change: Change, side: "before" | "after"): string {
  switch (change.term) {
    case "name":
    case "description":
      return change[side];
    case "deck":
      return deckText(change[side].name);
    case "in-bed-by":
      return clockText(change[side]);
    case "schedule":
      return scheduleText(change[side]);
    case "due-by":
      return dueByText(change[side]);
    case "start-date":
      return dateText(change[side], "No start date");
    case "end-date":
      return dateText(change[side], "No end date");
    case "penalty":
      return `${money(change[side])} per miss`;
    case "recipient":
      return change[side].name;
    case "reviewers":
      return names(change[side]);
    case "reminders":
      return remindersText(change[side]);
  }
}

/** What a changed term needs, as its tag says: "Needs approval: a lower penalty", "Stricter", "Applies now". */
export function effectText(change: Change): string {
  switch (change.effect) {
    case "stricter":
      return "Stricter";
    case "at-once":
      if (change.term !== "reviewers") return "Applies now";
      return "Applies now";
    case "needs-approval": {
      const needs = `Needs approval: ${APPROVAL_REASONS[change.reason]}`;
      if (change.term !== "reviewers") return needs;
      const removing = `${needs} ${listNames(change.removed.map((r) => r.name))}`;
      if (change.added.length === 0) return removing;
      return `${removing}. ${addedNames(change)} ${change.added.length === 1 ? "joins" : "join"} now`;
    }
  }
}

/** Why a changed term needs approval, as its tag says after "Needs approval: ". */
const APPROVAL_REASONS: Record<ApprovalReason, string> = {
  "defines-photo": "it defines what a photo must show",
  "deck-changed": "any change of deck",
  "later-time": "a later time",
  "due-at-midnight": "due at midnight instead",
  "fewer-days": "fewer days",
  "lower-target": "a lower target",
  "submit-anytime-on": "Submit anytime",
  "later-deadline": "a later deadline",
  "date-moved": "any change of date",
  "start-added": "adding a start date",
  "later-start": "a later start",
  "end-added": "adding an end date",
  "earlier-end": "an earlier end",
  "lower-penalty": "a lower penalty",
  "recipient-changed": "any change of recipient",
  // Followed by who: "removing Sam".
  "reviewers-removed": "removing",
};

function addedNames(change: Extract<Change, { term: "reviewers" }>): string {
  return listNames(change.added.map((r) => r.name));
}

/** A change request's changed terms: old struck out, new in bold. */
export function DiffList({ changes }: { changes: Change[] }) {
  return (
    <dl className="diff">
      {changes.map((change) => (
        <div key={change.term}>
          <dt>{change.term === "schedule" ? termLabel(change.term, change.before) : TERM_LABELS[change.term]}</dt>
          <dd>
            <s>{changeValue(change, "before")}</s>
            <b>{changeValue(change, "after")}</b>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The terms a change request leaves alone, folded away. Reminders are the owner's own, so reviewers don't see them. */
export function EverythingElse({ request }: { request: Json<TermsChangeRequestView> }) {
  const changed = new Set(request.changes.map((change) => change.term));
  const rest = termsOfKind(request.current).filter(
    (term): term is Exclude<Term, "reminders"> => !changed.has(term) && term !== "reminders",
  );
  return (
    <details className="folded">
      <summary className="small">Everything else stays</summary>
      <dl className="kv">
        {rest.map((term) => (
          <Fragment key={term}>
            <dt>{termLabel(term, request.current.schedule)}</dt>
            <dd>{currentValue(term, request.current)}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

/**
 * When an approved change would start, as a change request says it: "Approving
 * applies from Wed Nov 4, the first day of this pact that hasn't started yet. Today's penalty stays $5." A Weekly count
 * pact's applies from a period, and this period keeps its penalty.
 */
export function startsText(request: Json<TermsChangeRequestView>, lead: string): string {
  const { start } = request;
  if (start === null) return "";
  const { schedule } = request.current;
  // A One-time pact's one occurrence takes a change even once it's open.
  if (schedule.kind === "one-time") return `${lead} right away, even if the deadline day has started.`;
  const kind = periodKindOfSchedule(schedule);
  const unit = request.current.evidenceKind === "oura" ? "night" : kind ? periodWord(kind) : "day";
  const today =
    start.todayKeepsCents === null
      ? ""
      : ` ${openOccurrenceText(schedule)} penalty stays ${money(start.todayKeepsCents)}.`;
  return `${lead} from ${formatDate(start.appliesFrom)}, the first ${unit} of this pact that ${kind === "every-2-weeks" ? "haven't" : "hasn't"} started yet.${today}`;
}

function names(reviewers: { name: string }[]): string {
  return reviewers.map((r) => r.name).join(", ");
}
