// How a change to a pact's terms reads: each term's label and value, what a
// change to it needs, the before/after list a change request shows, and the
// terms it leaves alone. The core decides what each change needs; this only
// words it.

import { Fragment } from "react";
import type { Json } from "../shared/api.ts";
import type {
  ApprovalReason,
  ChangeRequestView,
  CurrentTerms,
  EvidenceKind,
  Schedule,
  TermChange,
} from "../shared/types.ts";
import { clockText, formatDate, money, remindersText, scheduleText } from "./format.ts";

export type Term = TermChange["term"];
type Change = Json<TermChange>;
type Current = Json<CurrentTerms>;
/** A change request that changes terms rather than ending the pact. */
type TermsChangeRequestView = Extract<ChangeRequestView, { endsPact: false }>;

export const TERM_LABELS: Record<Term, string> = {
  name: "Name",
  description: "Photo shows",
  deck: "Deck",
  "in-bed-by": "In bed by",
  schedule: "Days",
  "due-by": "Due by",
  "start-date": "Starts",
  "end-date": "Ends",
  penalty: "Penalty",
  recipient: "Recipient",
  reviewers: "Reviewers",
  reminders: "Reminders",
};

/** A term's label on a pact with `schedule`: a Weekly count pact's schedule is its Target, a One-time pact's its Deadline. */
export function termLabel(term: Term, schedule: Pick<Schedule, "kind">): string {
  if (term === "schedule" && schedule.kind === "weekly-count") return "Target";
  return term === "schedule" && schedule.kind === "one-time" ? "Deadline" : TERM_LABELS[term];
}

/** What a pact's open occurrence is called in "Today keeps $5 per miss": This week, for Weekly count. */
export function openOccurrenceText(schedule: Pick<Schedule, "kind">): string {
  return schedule.kind === "weekly-count" ? "This week" : "Today";
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
      return `Applies now. ${addedNames(change)} ${change.added.length === 1 ? "hears" : "hear"} about it`;
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
 * applies from Wed Nov 4, the first Gym day not open yet. Today keeps $5 per miss." A Weekly count
 * pact's applies from a week, and this week keeps its penalty.
 */
export function startsText(request: Json<TermsChangeRequestView>, lead: string): string {
  const { start } = request;
  if (start === null) return "";
  const { schedule } = request.current;
  // A One-time pact's one occurrence takes a change even once it's open.
  if (schedule.kind === "one-time") return `${lead} at once, to its one deadline, even if it's open.`;
  const unit = request.current.evidenceKind === "oura" ? "night" : schedule.kind === "weekly-count" ? "week" : "day";
  const today =
    start.todayKeepsCents === null
      ? ""
      : ` ${openOccurrenceText(schedule)} keeps ${money(start.todayKeepsCents)} per miss.`;
  return `${lead} from ${formatDate(start.appliesFrom)}, the first ${request.pactName} ${unit} not open yet.${today}`;
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export function listNames(list: string[], last = "and"): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${last} ${list.at(-1)}`;
}

function names(reviewers: { name: string }[]): string {
  return reviewers.map((r) => r.name).join(", ");
}
