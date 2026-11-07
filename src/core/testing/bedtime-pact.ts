// Set-up shared by the scenarios about Oura Ring bedtime pacts: an owner with
// Oura connected, and sleep periods shaped like Oura's `sleep` collection.

import { WEEKDAYS, type NewPact, type Weekday } from "../../shared/types.ts";
import type { OuraSleepPeriod } from "../ports.ts";
import type { AccountHandle, Scenario } from "./scenario.ts";
import { ok } from "./queries.ts";

/**
 * An owner in New York (the operator "owner", or `signedIn`) with Oura connected, a friend "reviewer" and a
 * recipient "Sam". `createPact` makes a $5 bedtime pact with Sam that the
 * reviewer reviews: in bed by `inBedBy` ("HH:MM"), every night unless `days` says otherwise.
 */
export async function ownerWithOura(s: Scenario, signedIn?: AccountHandle) {
  const owner = signedIn ?? (await s.signIn("owner"));
  await owner.setTimezone("America/New_York");
  const reviewer = await s.befriend(owner, `${owner.name}-reviewer`);
  const added = ok(await owner.addRecipient({ name: "Sam" }));
  await owner.connectOura();
  const createPact = async (inBedBy = "00:00", days: Weekday[] = [...WEEKDAYS]) => {
    const created = ok(await owner.createPact(bedtimePact(added.recipient.id, reviewer, inBedBy, days)));
    return created.pactId;
  };
  return { owner, reviewer, sam: added.recipient, createPact };
}

export function bedtimePact(
  recipientId: string,
  reviewer: AccountHandle,
  inBedBy = "00:00",
  days: Weekday[] = [...WEEKDAYS],
): NewPact {
  return {
    evidenceKind: "oura",
    name: "In bed by midnight",
    description: "",
    inBedBy,
    schedule: { kind: "fixed-days", days },
    penaltyCents: 500,
    recipientId,
    reviewerIds: [reviewer.id],
  };
}

const REFERENCE_DATES = { Mon: 5, Tue: 6, Wed: 7, Thu: 8, Fri: 9, Sat: 10, Sun: 11 } as const;

/**
 * A sleep period as Oura reports it, starting at `start` and lasting 7 hours.
 * `start` is "Tue 23:40" (New York, the scenario's reference week, written as
 * Oura writes it, with "-05:00") or a full ISO 8601 string with Oura's offset.
 */
export function sleep(start: string, type: OuraSleepPeriod["type"] = "long_sleep"): OuraSleepPeriod {
  const bedtimeStart = isoWithOffset(start);
  const offset = bedtimeStart.slice(19);
  const startWall = new Date(bedtimeStart.slice(0, 19) + "Z");
  const endWall = new Date(startWall.getTime() + 7 * 60 * 60 * 1000);
  const bedtimeEnd = endWall.toISOString().slice(0, 19) + offset;
  return {
    // From the period itself, so it doesn't depend on which tests ran first.
    id: `sleep-${type}-${bedtimeStart}`,
    // Oura puts a period on the day it ends: a night's sleep on the morning after.
    day: bedtimeEnd.slice(0, 10),
    bedtime_start: bedtimeStart,
    bedtime_end: bedtimeEnd,
    type,
    time_in_bed: 7 * 60 * 60,
    total_sleep_duration: 6 * 60 * 60,
  };
}

function isoWithOffset(start: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(start)) return start;
  const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{2}):(\d{2})$/.exec(start);
  if (!match) throw new Error(`unreadable sleep start "${start}"`);
  const [, day, hh, mm] = match as unknown as [string, keyof typeof REFERENCE_DATES, string, string];
  return `2026-01-${String(REFERENCE_DATES[day]).padStart(2, "0")}T${hh}:${mm}:00-05:00`;
}
