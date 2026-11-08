// A pact's terms as a change sends them.

import type { CurrentTerms, PactChange, PactTerms } from "./types.ts";

/**
 * Every term of `pact` as it stands, and its reminders, as the Request change
 * form starts out. Sent as it is, it changes nothing: a change sends all the
 * terms, and an optional one left out is none.
 */
export function termsOf(pact: CurrentTerms & Pick<PactTerms, "reminders">): PactChange {
  const terms = {
    name: pact.name,
    description: pact.description,
    ...(pact.startDate !== null && { startDate: pact.startDate }),
    ...(pact.endDate !== null && { endDate: pact.endDate }),
    penaltyCents: pact.penaltyCents,
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((r) => r.id),
    reminders: pact.reminders,
  };
  switch (pact.evidenceKind) {
    case "camera":
      return { ...terms, schedule: pact.schedule, ...(pact.dueBy !== null && { dueBy: pact.dueBy }) };
    case "oura":
      return { ...terms, schedule: pact.schedule, inBedBy: pact.inBedBy };
    case "anki":
      return {
        ...terms,
        schedule: pact.schedule,
        ...(pact.dueBy !== null && { dueBy: pact.dueBy }),
        ankiDeckId: pact.anki.deckId,
      };
  }
}
