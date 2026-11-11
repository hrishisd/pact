// History: the pact page's heat map, one square per day since the first
// occurrence with how it went, and Today's Yesterday, how each pact due
// yesterday did.

import { describe, expect, test } from "vitest";
import type { EvidenceRejection, OccurrenceDetail, OccurrenceRecord } from "../shared/types.ts";
import { ownerWithOura, sleep } from "./testing/bedtime-pact.ts";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, submit } from "./testing/camera-pact.ts";
import type { AccountHandle, Scenario } from "./testing/scenario.ts";
import { scenario } from "./testing/scenario.ts";
import { changed, heatMapDays, ok } from "./testing/queries.ts";

/** Files an excuse for `date` on `pactId` as `owner`, and has `reviewer` approve it. */
async function excused(owner: AccountHandle, reviewer: AccountHandle, pactId: string, date: string, reason: string) {
  const filed = ok(await owner.fileExcuse(pactId, { from: date, to: date, reason }, []));
  await reviewer.decide(filed.excuseId, { kind: "approve" });
}

const satisfied = (approvedBy: string | null, detail: OccurrenceDetail | null = null): OccurrenceRecord => ({
  status: { kind: "satisfied", cover: null, phase: "past-due", approvedBy },
  detail,
});

const missed = (
  s: Scenario,
  judgedAt: string,
  rejection: EvidenceRejection | null = null,
  detail: OccurrenceDetail | null = null,
): OccurrenceRecord => ({
  status: {
    kind: "missed",
    penaltyCents: 500,
    cover: null,
    phase: "past-due",
    excusableUntil: new Date(s.at(judgedAt).getTime() + 48 * 3600_000),
    recipientName: "Sam",
    rejection,
  },
  detail,
});

const excusedBy = (reviewerName: string, reason: string): OccurrenceRecord => ({
  status: {
    kind: "excused",
    cover: { kind: "excuse", state: "approved" },
    phase: "past-due",
    excuseApproval: { reviewerName, reason },
  },
  detail: null,
});

const notJudged = (
  s: Scenario,
  day: string,
  next: string,
  evidenceWaiting = false,
  phase: "ahead" | "past-due" = "past-due",
): OccurrenceRecord => ({
  status: {
    kind: "not-judged",
    opensAt: s.at(`${day} 00:00`),
    dueAt: s.at(`${next} 00:00`),
    evidenceWaiting,
    cover: null,
    phase,
    excuseApproval: null,
  },
  detail: null,
});

describe("the heat map", () => {
  test("has every day since the first occurrence through this week's Sunday, each occurrence with its outcome, Excused and not judged yet included", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    s.setClockTo("Mon 18:00");
    await reviewer.decide(await submit(owner, gym), { kind: "approve" });
    s.setClockTo("Wed 18:00");
    await reviewer.decide(await submit(owner, gym), { kind: "reject", reason: "That's Monday's photo" });
    // Friday: no photo.
    await s.advanceTo("Sun 10:00");
    await excused(owner, reviewer, gym, s.date("Mon+1"), "Away at a wedding");
    s.setClockTo("Wed+1 18:00");
    await submit(owner, gym);
    await s.advanceTo("Thu+1 10:00");

    expect(heatMapDays(owner, gym)).toEqual([
      { date: s.date("Mon"), occurrence: satisfied("reviewer") },
      { date: s.date("Tue"), occurrence: null },
      {
        date: s.date("Wed"),
        occurrence: missed(s, "Wed 18:00", { reviewerName: "reviewer", reason: "That's Monday's photo" }),
      },
      { date: s.date("Thu"), occurrence: null },
      { date: s.date("Fri"), occurrence: missed(s, "Sat 00:00") },
      { date: s.date("Sat"), occurrence: null },
      { date: s.date("Sun"), occurrence: null },
      {
        date: s.date("Mon+1"),
        occurrence: excusedBy("reviewer", "Away at a wedding"),
      },
      { date: s.date("Tue+1"), occurrence: null },
      // Its photo is still waiting for a reviewer, past its due time.
      { date: s.date("Wed+1"), occurrence: notJudged(s, "Wed+1", "Thu+1", true) },
      { date: s.date("Thu+1"), occurrence: null },
      // Ahead.
      { date: s.date("Fri+1"), occurrence: notJudged(s, "Fri+1", "Sat+1", false, "ahead") },
      { date: s.date("Sat+1"), occurrence: null },
      { date: s.date("Sun+1"), occurrence: null },
    ]);
  });

  test("starts at the first occurrence, not the day the pact was made", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Wed 10:00");
    const gym = await createPact("Gym", ["fri"]);

    expect(heatMapDays(owner, gym)).toEqual([
      { date: s.date("Fri"), occurrence: notJudged(s, "Fri", "Sat", false, "ahead") },
      { date: s.date("Sat"), occurrence: null },
      { date: s.date("Sun"), occurrence: null },
    ]);
  });

  test("a coming-up pact shows its first occurrence's week", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    // Monday is under an hour from its end, so Gym starts next Monday.
    s.setClockTo("Sun 23:30");
    const gym = await createPact("Gym", ["mon"]);

    expect(heatMapDays(owner, gym).map((day) => day.date)).toEqual([
      s.date("Mon+1"),
      s.date("Tue+1"),
      s.date("Wed+1"),
      s.date("Thu+1"),
      s.date("Fri+1"),
      s.date("Sat+1"),
      s.date("Sun+1"),
    ]);
  });

  test("days ahead follow the terms they'll open with", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", ["mon"]);
    // A stricter change applies from the first day not open yet.
    s.setClockTo("Wed 10:00");
    const result = await owner.changePact(
      gym,
      changed(owner, gym, { schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] } }),
    );
    expect(result).toMatchObject({ ok: true, outcome: { kind: "stricter" } });

    expect(heatMapDays(owner, gym).map((day) => [day.date, day.occurrence?.status.kind ?? null])).toEqual([
      [s.date("Mon"), "not-judged"],
      [s.date("Tue"), null],
      // Today was open before the change: it keeps Monday only.
      [s.date("Wed"), null],
      [s.date("Thu"), null],
      [s.date("Fri"), "not-judged"],
      [s.date("Sat"), null],
      [s.date("Sun"), null],
    ]);
  });

  test("an Ended pact stops at the week it Ended, with no days from then on", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Tue 10:00");
    const end = ok(await owner.requestEnd(gym));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    await s.advanceTo("Wed+1 10:00");

    expect(heatMapDays(owner, gym).map((day) => [day.date, day.occurrence?.status.kind ?? null])).toEqual([
      [s.date("Mon"), "missed"],
      [s.date("Tue"), null],
      [s.date("Wed"), null],
      [s.date("Thu"), null],
      [s.date("Fri"), null],
      [s.date("Sat"), null],
      [s.date("Sun"), null],
    ]);
  });

  test("a bedtime night says when the owner got into bed, or that Oura reported no sleep", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const bed = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:40"), sleep("Wed 01:10"));
    // Wednesday's night: nothing from Oura by 18:00 Thursday.
    await s.advanceTo("Thu 18:00");

    expect(heatMapDays(owner, bed).slice(0, 3)).toEqual([
      { date: s.date("Mon"), occurrence: satisfied(null, { kind: "night", inBedAt: "23:40" }) },
      { date: s.date("Tue"), occurrence: missed(s, "Thu 18:00", null, { kind: "night", inBedAt: "01:10" }) },
      { date: s.date("Wed"), occurrence: missed(s, "Thu 18:00", null, { kind: "night", inBedAt: null }) },
    ]);
  });
});

describe("Yesterday on Today", () => {
  test("lists yesterday's Satisfied, Missed and Excused occurrences by pact name, and leaves out pacts not due yesterday", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const read = await createPact("Read", ["mon"]);
    const gym = await createPact("Gym", ["mon"]);
    const piano = await createPact("Piano", ["mon"]);
    await createPact("Run", ["tue", "wed"]);
    s.setClockTo("Mon 18:00");
    await reviewer.decide(await submit(owner, gym), { kind: "approve" });
    await excused(owner, reviewer, piano, s.date("Mon"), "Sick with the flu");
    await s.advanceTo("Tue 10:00");

    expect(owner.today().yesterday).toEqual([
      {
        pactId: gym,
        name: "Gym",
        evidenceKind: "camera",
        occurrenceDate: s.date("Mon"),
        occurrence: satisfied("reviewer"),
      },
      {
        pactId: piano,
        name: "Piano",
        evidenceKind: "camera",
        occurrenceDate: s.date("Mon"),
        occurrence: excusedBy("reviewer", "Sick with the flu"),
      },
      {
        pactId: read,
        name: "Read",
        evidenceKind: "camera",
        occurrenceDate: s.date("Mon"),
        occurrence: missed(s, "Tue 00:00"),
      },
    ]);
  });

  test("an occurrence still waiting for a reviewer says so", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", ["mon"]);
    s.setClockTo("Mon 18:00");
    await submit(owner, gym);
    await s.advanceTo("Tue 10:00");

    expect(owner.today().yesterday).toEqual([
      {
        pactId: gym,
        name: "Gym",
        evidenceKind: "camera",
        occurrenceDate: s.date("Mon"),
        occurrence: notJudged(s, "Mon", "Tue", true),
      },
    ]);
  });

  test("a bedtime pact shows last night", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const bed = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:40"));
    await s.advanceTo("Tue 09:00");

    expect(owner.today().yesterday).toEqual([
      {
        pactId: bed,
        name: "In bed by midnight",
        evidenceKind: "oura",
        occurrenceDate: s.date("Mon"),
        occurrence: satisfied(null, { kind: "night", inBedAt: "23:40" }),
      },
    ]);
  });

  test("is empty the day a pact starts, and leaves out a pact Ended before yesterday", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    expect(owner.today().yesterday).toEqual([]);

    await s.advanceTo("Tue 10:00");
    const end = ok(await owner.requestEnd(gym));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    // Ended Tuesday: Monday's day is still yesterday's on Tuesday, but there's no Tuesday on Wednesday.
    expect(owner.today().yesterday.map((entry) => entry.occurrenceDate)).toEqual([s.date("Mon")]);
    await s.advanceTo("Wed 10:00");
    expect(owner.today().yesterday).toEqual([]);
  });
});
