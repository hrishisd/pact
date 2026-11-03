// Set-up shared by the scenarios about Camera pacts: their evidence, its
// review, and judging.

import type { NewPact, NewPayment, Schedule, Weekday } from "../../shared/types.ts";
import type { Photo } from "../ports.ts";
import type { AccountHandle, Scenario } from "./scenario.ts";

export const MON_WED_FRI: Weekday[] = ["mon", "wed", "fri"];

/** A photo as the browser sends it, told apart by `n`. */
export function photo(n = 1): Photo {
  return { bytes: new Uint8Array([0xff, 0xd8, n]), contentType: "image/jpeg" };
}

/**
 * An owner in New York with friends "reviewer" and "second", and a recipient
 * "Sam". `createPact` makes a Camera pact on the weekdays `days` (or on any
 * schedule) with Sam (or `recipientId`) that
 * both friends review (or just `reviewers`), described as "A photo of <name>",
 * with the optional due-by time, start date and end date in `dates`, and the
 * reminders in `reminders` ("HH:MM" each).
 */
export async function ownerWithReviewers(s: Scenario) {
  const owner = await s.signIn("owner");
  await owner.setTimezone("America/New_York");
  const reviewer = await s.befriend(owner, "reviewer");
  const second = await s.befriend(owner, "second");
  const added = await owner.addRecipient({ name: "Sam" });
  if (!added.ok) throw new Error(added.reason);
  const createPact = async (
    name: string,
    days: Weekday[] | Schedule,
    {
      by = owner,
      reviewers = [reviewer, second],
      recipientId = added.recipient.id,
      dates = {},
      reminders,
    }: {
      by?: AccountHandle;
      reviewers?: AccountHandle[];
      recipientId?: string;
      dates?: Pick<NewPact, "dueBy" | "startDate" | "endDate">;
      reminders?: string[];
    } = {},
  ) => {
    const pact: NewPact = {
      evidenceKind: "camera",
      name,
      description: `A photo of ${name}`,
      schedule: Array.isArray(days) ? { kind: "fixed-days", days } : days,
      penaltyCents: 500,
      recipientId,
      reviewerIds: reviewers.map((r) => r.id),
      ...dates,
      ...(reminders && { reminders }),
    };
    const created = await by.createPact(pact);
    if (!created.ok) throw new Error(created.reason);
    return created.pactId;
  };
  return { owner, reviewer, second, sam: added.recipient, createPact };
}

/** The owner with $15 owed to Sam: three $5 penalties from a Mon/Wed/Fri pact, every day of it Missed. */
export async function fifteenOwed(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  await s.advanceTo("Sat 00:00");
  return { ...setup, gym };
}

/** Records `payment` as `by`, with `screenshot`; returns its id, or throws if it's refused. */
export async function recordPayment(by: AccountHandle, payment: NewPayment, screenshot = photo()): Promise<string> {
  const recorded = await by.recordPayment(payment, screenshot);
  if (!recorded.ok) throw new Error(recorded.reason);
  return recorded.paymentId;
}
