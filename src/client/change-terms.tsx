// How a change to a pact's terms reads: each term's label and value, what a
// change to it needs, the before/after list a change request shows, and the
// terms it leaves alone. The core decides what each change needs; this only
// words it.

import { Fragment } from "react";
import type { Json } from "../shared/api.ts";
import type { ChangeRequestView, CurrentTerms, EvidenceKind, Schedule, TermChange } from "../shared/types.ts";
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
  if (change.effect === "stricter") return "Stricter";
  if (change.term === "reviewers") {
    const joins = change.added.length > 0 ? listNames(change.added.map((r) => r.name)) : null;
    if (change.removed.length === 0)
      return `Applies now. ${joins} ${change.added.length === 1 ? "hears" : "hear"} about it`;
    const removing = `Needs approval: removing ${listNames(change.removed.map((r) => r.name))}`;
    return joins ? `${removing}. ${joins} ${change.added.length === 1 ? "joins" : "join"} now` : removing;
  }
  if (change.effect === "at-once") return "Applies now";
  switch (change.term) {
    case "description":
      return "Needs approval: it defines what a photo must show";
    case "deck":
      return "Needs approval: any change of deck";
    case "in-bed-by":
      return "Needs approval: a later time";
    case "schedule":
      return scheduleNeeds(change.before, change.after);
    case "due-by":
      return change.after === null ? "Needs approval: due at midnight instead" : "Needs approval: a later time";
    case "start-date":
      return change.before === null ? "Needs approval: adding a start date" : "Needs approval: a later start";
    case "end-date":
      return change.before === null ? "Needs approval: adding an end date" : "Needs approval: an earlier end";
    case "penalty":
      return "Needs approval: a lower penalty";
    case "recipient":
      return "Needs approval: any change of recipient";
    case "name":
    case "reminders":
      return "Applies now";
  }
}

/** Why a changed schedule needs approval, as its tag says after "Needs approval: ". */
function scheduleNeeds(before: Schedule, after: Schedule): string {
  if (before.kind === "weekly-count") return "Needs approval: a lower target";
  if (before.kind !== "one-time" || after.kind !== "one-time") return "Needs approval: fewer days";
  if (after.submitAnytime && !before.submitAnytime) return "Needs approval: Submit anytime";
  return after.submitAnytime ? "Needs approval: a later deadline" : "Needs approval: any change of date";
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
