// Set-up shared by the scenarios about Anki pacts: an owner with AnkiWeb
// connected and a deck list, and a way to say what the next check finds.

import { WEEKDAYS, type NewPact, type Weekday } from "../../shared/types.ts";
import type { AccountHandle, Scenario } from "./scenario.ts";
import { ok } from "./queries.ts";

/** The deck every scenario's pact is on, unless it says otherwise. */
export const SPANISH = "1700000000001";

/**
 * An owner in New York (the operator "owner", or `signedIn`) with AnkiWeb
 * connected (rollover 4am) and a deck "Spanish" in its list, a friend
 * "reviewer" and a recipient "Sam". `createPact` makes a $5 Anki pact on
 * Spanish with Sam that the reviewer reviews, every day unless `days` says
 * otherwise, due at midnight unless `dueBy` is set.
 */
export async function ownerWithAnki(s: Scenario, signedIn?: AccountHandle) {
  const owner = signedIn ?? (await s.signIn("owner"));
  await owner.setTimezone("America/New_York");
  const reviewer = await s.befriend(owner, `${owner.name}-reviewer`);
  const added = ok(await owner.addRecipient({ name: "Sam" }));
  await owner.connectAnki();
  s.ankiSource.setDeck(owner.id, { id: SPANISH, name: "Spanish", review: 42 });
  ok(await owner.ankiDecks());
  const createPact = async (
    options: Partial<Pick<NewPact, "dueBy" | "ankiDeckId" | "name">> & { days?: Weekday[] } = {},
  ) => {
    const created = ok(await owner.createPact(ankiPact(added.recipient.id, reviewer, options)));
    return created.pactId;
  };
  /** What the next check of `deck` finds: the counts, for Anki day `ankiDate`, evaluated at `asOf`. */
  const deckShows = (
    counts: { new?: number; learn?: number; review?: number },
    ankiDate: string,
    asOf: string,
    deck = SPANISH,
  ) => {
    s.ankiSource.setDeck(owner.id, { id: deck, name: deck === SPANISH ? "Spanish" : deck, ...counts });
    s.ankiSource.setAnkiDay(owner.id, ankiDate, s.at(asOf));
  };
  return { owner, reviewer, sam: added.recipient, createPact, deckShows };
}

export function ankiPact(
  recipientId: string,
  reviewer: AccountHandle,
  {
    days = [...WEEKDAYS],
    dueBy,
    ankiDeckId = SPANISH,
    name = "Spanish",
  }: Partial<Pick<NewPact, "dueBy" | "ankiDeckId" | "name">> & { days?: Weekday[] } = {},
): NewPact {
  return {
    evidenceKind: "anki",
    name,
    description: "",
    ankiDeckId,
    ...(dueBy !== undefined && { dueBy }),
    schedule: { kind: "fixed-days", days },
    penaltyCents: 500,
    recipientId,
    reviewerIds: [reviewer.id],
  };
}
