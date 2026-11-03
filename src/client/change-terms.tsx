// How a change to a pact's terms reads: each term's label and value, what a
// change to it needs, the before/after list a change request shows, and the
// terms it leaves alone. The core decides what each change needs; this only
// words it.

import { Fragment } from "react";
import type { Json } from "../shared/api.ts";
import type { ChangeRequestView, CurrentTerms, TermChange } from "../shared/types.ts";
import { clockText, formatDate, money, scheduleText } from "./format.ts";

export type Term = TermChange["term"];
type Change = Json<TermChange>;
type Current = Json<CurrentTerms>;

export const TERM_LABELS: Record<Term, string> = {
  name: "Name",
  description: "Photo shows",
  "in-bed-by": "In bed by",
  schedule: "Days",
  penalty: "Penalty",
  recipient: "Recipient",
  reviewers: "Reviewers",
};

/** The terms a pact of this kind lists, in the Request change order. */
export function termsOfKind(current: Pick<Current, "evidenceKind">): Term[] {
  return current.evidenceKind === "oura"
    ? ["name", "in-bed-by", "schedule", "penalty", "recipient", "reviewers"]
    : ["name", "description", "schedule", "penalty", "recipient", "reviewers"];
}

/** A term's value in the pact as it stands. */
export function currentValue(term: Term, current: Current): string {
  switch (term) {
    case "name":
      return current.name;
    case "description":
      return current.description;
    case "in-bed-by":
      return current.inBedBy === null ? "—" : clockText(current.inBedBy);
    case "schedule":
      return scheduleText(current.schedule);
    case "penalty":
      return `${money(current.penaltyCents)} per miss`;
    case "recipient":
      return current.recipient.name;
    case "reviewers":
      return names(current.reviewers);
  }
}

/** A changed term's old or new value. */
export function changeValue(change: Change, side: "before" | "after"): string {
  switch (change.term) {
    case "name":
    case "description":
      return change[side];
    case "in-bed-by":
      return clockText(change[side]);
    case "schedule":
      return scheduleText(change[side]);
    case "penalty":
      return `${money(change[side])} per miss`;
    case "recipient":
      return change[side].name;
    case "reviewers":
      return names(change[side]);
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
    case "in-bed-by":
      return "Needs approval: a later time";
    case "schedule":
      return "Needs approval: fewer days";
    case "penalty":
      return "Needs approval: a lower penalty";
    case "recipient":
      return "Needs approval: any change of recipient";
    case "name":
      return "Applies now";
  }
}

/** A change request's changed terms: old struck out, new in bold. */
export function DiffList({ changes }: { changes: Change[] }) {
  return (
    <dl className="diff">
      {changes.map((change) => (
        <div key={change.term}>
          <dt>{TERM_LABELS[change.term]}</dt>
          <dd>
            <s>{changeValue(change, "before")}</s>
            <b>{changeValue(change, "after")}</b>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The terms a change request leaves alone, folded away. */
export function EverythingElse({ request }: { request: Json<ChangeRequestView> }) {
  const changed = new Set(request.changes.map((change) => change.term));
  const rest = termsOfKind(request.current).filter((term) => !changed.has(term));
  return (
    <details className="folded">
      <summary className="small">Everything else stays</summary>
      <dl className="kv">
        {rest.map((term) => (
          <Fragment key={term}>
            <dt>{TERM_LABELS[term]}</dt>
            <dd>{currentValue(term, request.current)}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

/**
 * When an approved change would start, as a change request says it: "Approving
 * applies from Wed Nov 4, the first Gym day not open yet. Today keeps $5 per miss."
 */
export function startsText(request: Json<ChangeRequestView>, lead: string): string {
  if (request.appliesFrom === null) return "";
  const unit = request.current.evidenceKind === "oura" ? "night" : "day";
  const today = request.todayKeepsCents === null ? "" : ` Today keeps ${money(request.todayKeepsCents)} per miss.`;
  return `${lead} from ${formatDate(request.appliesFrom)}, the first ${request.pactName} ${unit} not open yet.${today}`;
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export function listNames(list: string[], last = "and"): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${last} ${list.at(-1)}`;
}

function names(reviewers: { name: string }[]): string {
  return reviewers.map((r) => r.name).join(", ");
}
