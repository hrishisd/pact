// A pact's terms as a list, on the pact's page and on the create form's
// Check step, with Change or Add on the rows that can change on their own.

import type { Json } from "../shared/api.ts";
import type { PactTerms } from "../shared/types.ts";
import { clockText, formatDate, money, remindersText, scheduleText } from "./format.ts";

type Pact = Json<PactTerms>;

/** A pact's terms as a list. The create form's Check step shows the same list before the pact exists. */
export function TermsList({
  terms,
  deckName,
  name,
  onRename,
  onAddReviewer,
  onChangeReminders,
}: {
  terms: Pick<
    Pact,
    "evidenceKind" | "startDate" | "endDate" | "schedule" | "penaltyCents" | "recipient" | "reminders"
  > & {
    /** Oura Ring only. */
    inBedBy?: string;
    /** Camera and Anki: null for midnight. */
    dueBy?: string | null;
    reviewers: { name: string }[];
  };
  /** Anki only: the deck's name, or null once it's gone from the deck list. */
  deckName?: string | null;
  /** The pact's name, as a row of its own: on the pact page, where it can change. */
  name?: string;
  /** Offers Change on the name, when it can change on its own. */
  onRename?: () => void;
  /** Offers Add on the reviewers, when one can be added on its own. */
  onAddReviewer?: () => void;
  /** Offers Change on the reminders, when they can change on their own. */
  onChangeReminders?: () => void;
}) {
  const { recipient, reviewers, inBedBy, dueBy = null } = terms;
  return (
    <dl className="kv">
      {name !== undefined && (
        <>
          <dt>Name</dt>
          <dd>
            {name}
            <RowAction label="Change" ariaLabel="Change name" onClick={onRename} />
          </dd>
        </>
      )}
      <dt>Evidence</dt>
      <dd>{EVIDENCE_TEXT[terms.evidenceKind]}</dd>
      {deckName !== undefined && (
        <>
          <dt>Deck</dt>
          <dd>{deckName ?? "Gone from your deck list"}</dd>
        </>
      )}
      {inBedBy !== undefined && (
        <>
          <dt>In bed by</dt>
          <dd>{clockText(inBedBy)}</dd>
        </>
      )}
      <dt>Schedule</dt>
      <dd>{scheduleText(terms.schedule)}</dd>
      {dueBy !== null && (
        <>
          <dt>Due by</dt>
          <dd>{clockText(dueBy)}</dd>
        </>
      )}
      {terms.startDate !== null && (
        <>
          <dt>Starts</dt>
          <dd>{formatDate(terms.startDate)}</dd>
        </>
      )}
      {terms.endDate !== null && (
        <>
          <dt>Ends</dt>
          <dd>{formatDate(terms.endDate)}</dd>
        </>
      )}
      <dt>Penalty</dt>
      <dd>{money(terms.penaltyCents)} per miss</dd>
      <dt>Recipient</dt>
      <dd>{recipient.name}</dd>
      <dt>{reviewers.length === 1 ? "Reviewer" : "Reviewers"}</dt>
      <dd>
        {reviewers.map((r) => r.name).join(", ")}
        <RowAction label="Add" ariaLabel="Add a reviewer" onClick={onAddReviewer} />
      </dd>
      <dt>Reminders</dt>
      <dd>
        {remindersText(terms.reminders)}
        <RowAction label="Change" ariaLabel="Change reminders" onClick={onChangeReminders} />
      </dd>
    </dl>
  );
}

const EVIDENCE_TEXT: Record<Pact["evidenceKind"], string> = {
  camera: "Camera photo, checked by a reviewer",
  oura: "Oura Ring",
  anki: "Anki, checked on AnkiWeb",
};

/** A term row's own Change or Add, after its value; nothing without `onClick`. */
function RowAction({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <>
      {" "}
      <button className="link" aria-label={ariaLabel} onClick={onClick}>
        {label}
      </button>
    </>
  );
}
