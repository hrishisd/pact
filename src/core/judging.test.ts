// Judging Camera pacts: at the end of each scheduled day (advance to T), or
// on a decision that comes after it, and the penalty a Missed occurrence adds
// to the owner's ledger for the pact's recipient.

import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers, submit } from "./testing/camera-pact.ts";
import { referenceDate, scenario, type AccountHandle } from "./testing/scenario.ts";
import type { Today } from "../shared/types.ts";
import { cards, ledgerHistory } from "./testing/queries.ts";

describe("judging at the end of a scheduled day", () => {
  test("Mon/Wed/Fri $5 pact: Monday ends with no evidence, so it's Missed and the ledger shows $5 owed to the recipient", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Tue 00:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 500, paidCents: 0 })]);
    expect(cards(owner, "missed")).toEqual([
      {
        pactId: gym,
        name: "Gym",
        penaltyCents: 500,
        occurrenceDate: s.date("Mon"),
        missedAt: s.at("Tue 00:00"),
        excusableUntil: s.at("Thu 00:00"),
        detail: null,
      },
    ]);
  });

  test("evidence submitted Monday, approved Tuesday: Satisfied, nothing owed", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);
    await s.advanceTo("Tue 00:00");

    s.setClockTo("Tue 08:00");
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Tue 08:01");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 0 })]);
    expect(owner.today()).toEqual({
      ...nothingOnToday,
      yesterday: gymMonday({ kind: "satisfied", approvedBy: "reviewer" }),
    });
  });

  test("evidence submitted Monday, still waiting at midnight: not judged yet; rejected Tuesday: Missed as of the rejection, $5 owed", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);

    await s.advanceTo("Tue 00:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(owner.today()).toEqual({
      ...nothingOnToday,
      waiting: [expect.objectContaining({ id: evidenceId })],
      yesterday: gymMonday(expect.objectContaining({ kind: "not-judged", evidenceWaiting: true })),
    });

    s.setClockTo("Tue 08:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(addedAt(owner)).toEqual([s.at("Tue 08:00")]);
    expect(owner.today()).toEqual({
      ...nothingOnToday,
      alerts: [
        expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Mon"), reason: "That's last week's photo" }),
      ],
      yesterday: gymMonday(expect.objectContaining({ kind: "missed" })),
    });
    // The next tick doesn't judge it again.
    await s.advanceTo("Tue 08:01");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(addedAt(owner)).toEqual([s.at("Tue 08:00")]);
  });

  test("a decision after midnight that comes before the next tick judges there and then, and the tick doesn't judge again", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);
    s.setClockTo("Tue 08:00");

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    await s.advanceTo("Tue 08:01");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(addedAt(owner)).toEqual([s.at("Tue 08:00")]);
    expect(owner.today().alerts).toEqual([expect.objectContaining({ pactId: gym })]);
  });

  test("evidence waiting when Monday ends in the owner's new timezone, rejected before Monday would have ended in the old one: Missed as of the rejection", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);
    // In Kiritimati (UTC+14) Monday ended at Mon 05:00 New York time.
    await owner.setTimezone("Pacific/Kiritimati");
    await s.advanceTo("Mon 19:00");

    s.setClockTo("Mon 20:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    await s.advanceTo("Mon 20:01");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(addedAt(owner)).toEqual([s.at("Mon 20:00")]);
    expect(owner.today().alerts).toEqual([expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Mon") })]);
  });

  test("evidence approved while Monday is open is judged Satisfied when Monday ends", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);
    s.setClockTo("Mon 19:00");
    await reviewer.decide(evidenceId, { kind: "approve" });

    await s.advanceTo("Wed 12:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(cards(owner, "missed")).toEqual([]);
  });

  test("two pacts with the same recipient share one ledger", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", ["mon"]);

    await s.advanceTo("Tue 00:00");

    expect(owner.ledgers()).toEqual([
      {
        recipientId: expect.any(String),
        name: "Sam",
        owedCents: 1000,
        payableCents: 1000,
        awaitingCents: 0,
        awaitingCount: 0,
        paidCents: 0,
        overdueCents: 0,
        billDue: null,
      },
    ]);
    expect(cards(owner, "missed").map((card) => card.pactId)).toEqual([gym, run]);
  });

  test("a restart between submission and the day ending changes nothing", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const evidenceId = await submit(owner, gym);

    await s.restart();
    await s.advanceTo("Tue 00:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(owner.today()).toEqual({
      ...nothingOnToday,
      waiting: [expect.objectContaining({ id: evidenceId })],
      yesterday: gymMonday(expect.objectContaining({ kind: "not-judged", evidenceWaiting: true })),
    });

    s.setClockTo("Tue 08:00");
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.restart();
    await s.advanceTo("Tue 23:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(owner.today()).toEqual({
      ...nothingOnToday,
      yesterday: gymMonday({ kind: "satisfied", approvedBy: "reviewer" }),
    });
  });
});

describe("judging over a week", () => {
  test("a scheduler stopped from Monday to Thursday catches up in one tick: Monday and Wednesday Missed, one penalty each, as of their due times", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Thu 10:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
    // Monday was Missed at Tue 00:00, over 48 hours ago, so only Wednesday is on Today.
    expect(cards(owner, "missed")).toEqual([
      {
        pactId: gym,
        name: "Gym",
        penaltyCents: 500,
        occurrenceDate: s.date("Wed"),
        missedAt: s.at("Thu 00:00"),
        excusableUntil: s.at("Sat 00:00"),
        detail: null,
      },
    ]);
  });

  test("advancing to the same time twice, or with a restart mid-week, judges each occurrence once", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Tue 00:00");
    await s.advanceTo("Tue 00:00");
    await s.restart();
    await s.advanceTo("Tue 12:00");
    await s.advanceTo("Thu 00:00");
    await s.advanceTo("Thu 00:00");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
  });

  test("days the schedule skips, and days before the first occurrence, are never judged", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    // Made Mon 09:00 for Tuesdays only: its first occurrence is Tue 6 Jan.
    s.setClockTo("Mon 09:00");
    await createPact("Swim", ["tue"]);
    // Made Mon 23:30 for Mon/Wed/Fri: Monday is due within the hour, so it starts Wednesday.
    s.setClockTo("Mon 23:30");
    await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Tue 23:59");

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);

    await s.advanceTo("Thu 00:00");

    expect(cards(owner, "missed").map((card) => [card.name, card.occurrenceDate])).toEqual([
      ["Gym", s.date("Wed")],
      ["Swim", s.date("Tue")],
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
  });

  test("a Missed occurrence leaves Today 48 hours after it's judged, and stays on the ledger", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", ["mon"]);
    await s.advanceTo("Tue 00:00");

    s.setClockTo("Wed 23:59");
    expect(cards(owner, "missed")).toHaveLength(1);

    s.setClockTo("Thu 00:00");
    expect(cards(owner, "missed")).toEqual([]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });
});

describe("Today's order", () => {
  test("To do, then Missed, then Coming up, with Waiting for approval last", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", ["mon", "tue"]);
    const run = await createPact("Run", ["mon", "tue"]);
    const swim = await createPact("Swim", ["sun"]);
    s.setClockTo("Tue 09:00");
    await submit(owner, run);

    await s.advanceTo("Tue 10:00");

    const today = owner.today();
    expect(today.sections.map((section) => section.kind)).toEqual(["to-do", "missed", "coming-up"]);
    expect(
      today.sections.flatMap((section) => section.cards.map((card) => ("pactId" in card ? card.pactId : null))),
    ).toEqual([gym, gym, run, swim]);
    expect(today.waiting).toEqual([expect.objectContaining({ pactId: run })]);
  });
});

const nothingOnToday: Today = { hasPacts: true, alerts: [], sections: [], waiting: [], yesterday: [] };

/** Today's Yesterday on Tuesday: Gym's Monday, with `status`. */
function gymMonday(status: unknown) {
  return [
    expect.objectContaining({
      name: "Gym",
      occurrenceDate: referenceDate("Mon"),
      occurrence: expect.objectContaining({ status }),
    }),
  ];
}

/** When each penalty on the owner's only ledger was added, newest first. */
function addedAt(owner: AccountHandle): Date[] {
  return ledgerHistory(owner).flatMap((entry) => (entry.kind === "penalty" ? [entry.addedAt] : []));
}
