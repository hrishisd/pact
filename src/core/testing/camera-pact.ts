// Set-up shared by the scenarios about Camera pacts: their evidence, its
// review, and judging.

import type { NewPact, Weekday } from "../../shared/types.ts";
import type { Photo } from "../ports.ts";
import type { AccountHandle, Scenario } from "./scenario.ts";

export const MON_WED_FRI: Weekday[] = ["mon", "wed", "fri"];

/** A photo as the browser sends it, told apart by `n`. */
export function photo(n = 1): Photo {
  return { bytes: new Uint8Array([0xff, 0xd8, n]), contentType: "image/jpeg" };
}

/**
 * An owner in New York with friends "reviewer" and "second", and a recipient
 * "Sam". `createPact` makes a Camera pact both friends review, described as
 * "A photo of <name>".
 */
export async function ownerWithReviewers(s: Scenario) {
  const owner = await s.signIn("owner");
  await owner.setTimezone("America/New_York");
  const reviewer = await s.befriend(owner, "reviewer");
  const second = await s.befriend(owner, "second");
  const added = await owner.addRecipient({ name: "Sam" });
  if (!added.ok) throw new Error(added.reason);
  const createPact = async (name: string, days: Weekday[], by: AccountHandle = owner) => {
    const pact: NewPact = {
      evidenceKind: "camera",
      name,
      description: `A photo of ${name}`,
      schedule: { kind: "fixed-days", days },
      penaltyCents: 500,
      recipientId: added.recipient.id,
      reviewerIds: [reviewer.id, second.id],
    };
    const created = await by.createPact(pact);
    if (!created.ok) throw new Error(created.reason);
    return created.pactId;
  };
  return { owner, reviewer, second, createPact };
}
