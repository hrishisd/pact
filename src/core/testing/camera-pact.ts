// Set-up shared by the scenarios about Camera pacts: their evidence, its
// review, and judging.

import { WEEKDAYS, type NewPact, type NewPayment, type Schedule, type Weekday } from "../../shared/types.ts";
import type { Photo } from "../ports.ts";
import type { AccountHandle, Scenario } from "./scenario.ts";
import { ok } from "./queries.ts";

export const MON_WED_FRI: Weekday[] = ["mon", "wed", "fri"];
export const EVERY_DAY: Weekday[] = [...WEEKDAYS];

/** A photo as the browser sends it, told apart by `n`. */
export function photo(n = 1): Photo {
  return { bytes: new Uint8Array([0xff, 0xd8, n]), contentType: "image/jpeg" };
}

/** What `cameraPact` takes beyond the name and days. */
interface CameraPactOptions {
  recipientId: string;
  reviewers: AccountHandle[];
  penaltyCents?: number;
  dates?: Pick<NewPact, "dueBy" | "startDate" | "endDate">;
  reminders?: string[];
}

/**
 * A Camera pact on the weekdays `days` (or on any schedule), $5 a day (or
 * `penaltyCents`) to `recipientId`, that `reviewers` review, described as
 * "A photo of <name>", with the optional due-by time, start date and end date
 * in `dates`, and the reminders in `reminders` ("HH:MM" each).
 */
export function cameraPact(
  name: string,
  days: Weekday[] | Schedule,
  { recipientId, reviewers, penaltyCents = 500, dates = {}, reminders }: CameraPactOptions,
): NewPact {
  return {
    evidenceKind: "camera",
    name,
    description: `A photo of ${name}`,
    schedule: Array.isArray(days) ? { kind: "fixed-days", days } : days,
    penaltyCents,
    recipientId,
    reviewerIds: reviewers.map((r) => r.id),
    ...dates,
    ...(reminders && { reminders }),
  };
}

/**
 * An owner in New York (or `timezone`) with friends "reviewer" and "second",
 * and a recipient "Sam". `createPact` makes a `cameraPact` with Sam (or
 * `recipientId`) that both friends review (or just `reviewers`), as the owner
 * (or `by`), and returns its id.
 */
export async function ownerWithReviewers(s: Scenario, { timezone = "America/New_York" } = {}) {
  const owner = await s.signIn("owner");
  await owner.setTimezone(timezone);
  const reviewer = await s.befriend(owner, "reviewer");
  const second = await s.befriend(owner, "second");
  const added = ok(await owner.addRecipient({ name: "Sam" }));
  const createPact = async (
    name: string,
    days: Weekday[] | Schedule,
    {
      by = owner,
      reviewers = [reviewer, second],
      recipientId = added.recipient.id,
      ...rest
    }: { by?: AccountHandle } & Partial<CameraPactOptions> = {},
  ) => {
    const created = ok(await by.createPact(cameraPact(name, days, { reviewers, recipientId, ...rest })));
    return created.pactId;
  };
  return { owner, reviewer, second, sam: added.recipient, createPact };
}

/**
 * The owner with $15 owed to Sam at Sat 00:00: three $5 penalties from Gym, a
 * Mon/Wed/Fri pact, every day of it Missed. Nothing is ever submitted, so
 * each later week adds $15 more.
 */
export async function fifteenOwed(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  await s.advanceTo("Sat 00:00");
  return { ...setup, gym };
}

/**
 * The owner with Gym, a Mon/Wed/Fri $5 pact both friends review, and Monday's
 * evidence submitted at `at`.
 */
export async function gymEvidenceWaiting(s: Scenario, at = "Mon 18:00") {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  s.setClockTo(at);
  const evidenceId = await submit(setup.owner, gym);
  return { ...setup, gym, evidenceId };
}

/** Records `payment` as `by`, with `screenshot`; returns its id, or throws if it's refused. */
export async function recordPayment(by: AccountHandle, payment: NewPayment, screenshot = photo()): Promise<string> {
  return ok(await by.recordPayment(payment, screenshot)).paymentId;
}

/** Submits a photo as `owner` for the occurrence of `pactId` open now; returns the evidence's id, or throws if it's refused. */
export async function submit(owner: AccountHandle, pactId: string): Promise<string> {
  return ok(await owner.submitEvidence(pactId, [photo()])).evidenceId;
}
