// A rejection is final straight away: rejected evidence makes the occurrence
// Missed as of the rejection, with its penalty, whether the day is still open
// or already past its due time, and the day takes no more evidence. Today
// shows it only as a rejected-evidence alert, until the owner takes the L.

import { describe, expect, test } from "vitest";
import type { Today } from "../shared/types.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

const MONDAY = "2026-01-05";

/** An owner with a Mon/Wed/Fri $5 "Gym" pact, and Monday's evidence submitted at Mon 13:00. */
async function evidenceOnMonday() {
  const s = scenario();
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  s.setClockTo("Mon 13:00");
  const submitted = ok(await setup.owner.submitEvidence(gym, [photo()]));
  return { s, ...setup, gym, evidenceId: submitted.evidenceId };
}

describe("a rejection is final straight away", () => {
  test("rejected Monday afternoon, while the day is still open: Missed at once, $5 owed; the pact leaves To do; Today shows only the alert", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [
        {
          kind: "evidence-rejected",
          pactId: gym,
          name: "Gym",
          reviewerName: "reviewer",
          reason: "Blurry",
          occurrenceDate: MONDAY,
          penaltyCents: 500,
          recipientName: "Sam",
          excusableUntil: s.at("Wed 15:00"),
        },
      ],
      sections: [],
      waiting: [],
      yesterday: [],
    } satisfies Today);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 500 })]);
    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: { history: [{ pactId: gym, occurrenceDate: MONDAY, addedAt: s.at("Mon 15:00") }] },
    });
  });

  test("rejected Tuesday, after Monday's due time: the same alert, and Monday isn't in the Missed section", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    await s.advanceTo("Tue 00:00");
    s.setClockTo("Tue 08:00");

    await reviewer.decide(evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [
        {
          kind: "evidence-rejected",
          pactId: gym,
          name: "Gym",
          reviewerName: "reviewer",
          reason: "That's last week's photo",
          occurrenceDate: MONDAY,
          penaltyCents: 500,
          recipientName: "Sam",
          excusableUntil: s.at("Thu 08:00"),
        },
      ],
      sections: [],
      waiting: [],
      yesterday: [
        expect.objectContaining({
          occurrenceDate: MONDAY,
          occurrence: expect.objectContaining({
            status: expect.objectContaining({
              kind: "missed",
              rejection: { reviewerName: "reviewer", reason: "That's last week's photo" },
            }),
          }),
        }),
      ],
    } satisfies Today);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });

  test("when the day ends it isn't judged again: still one penalty, as of the rejection", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    await s.advanceTo("Tue 00:00");

    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: {
        summary: { owedCents: 500 },
        history: [{ pactId: gym, occurrenceDate: MONDAY, addedAt: s.at("Mon 15:00") }],
      },
    });
    expect(owner.today()).toMatchObject({ alerts: [{ pactId: gym, occurrenceDate: MONDAY }], sections: [] });
  });

  test("evidence for a day whose evidence was rejected is refused, and nothing reaches the reviewers", async () => {
    const { s, owner, reviewer, second, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    const today = owner.today();

    s.setClockTo("Mon 20:00");
    expect(await owner.submitEvidence(gym, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });

    expect(owner.today()).toEqual(today);
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
    // Wednesday is a new day: its evidence is accepted.
    s.setClockTo("Wed 09:00");
    expect(await owner.submitEvidence(gym, [photo(3)])).toEqual({ ok: true, evidenceId: expect.any(String) });
  });
});

describe("the rejected-evidence alert", () => {
  test("Take the L clears it; owed and the ledger's history are unchanged", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    const [summary] = owner.ledgers();
    const ledger = owner.ledger(summary!.recipientId);

    s.setClockTo("Mon 16:00");
    expect(await owner.acceptMiss(gym, MONDAY)).toEqual({ ok: true });

    expect(owner.today()).toEqual({ hasPacts: true, alerts: [], sections: [], waiting: [], yesterday: [] });
    expect(owner.ledgers()).toEqual([summary]);
    expect(owner.ledger(summary!.recipientId)).toEqual(ledger);
    expect(ledger).toMatchObject({
      ledger: { history: [{ occurrenceDate: MONDAY, rejection: { reviewerName: "reviewer", reason: "Blurry" } }] },
    });
  });

  test("is still there after 48 hours, and after a restart, if Take the L wasn't tapped", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    await s.advanceTo("Fri 12:00");
    await s.restart();

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ kind: "evidence-rejected", pactId: gym, occurrenceDate: MONDAY, reason: "Blurry" }),
    ]);
  });

  test("one per rejected occurrence, newest rejection first; Take the L clears only its own", async () => {
    const { s, owner, reviewer, second, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    s.setClockTo("Wed 09:00");
    const wednesday = ok(await owner.submitEvidence(gym, [photo(2)]));
    s.setClockTo("Wed 10:00");
    await second.decide(wednesday.evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ occurrenceDate: "2026-01-07", reviewerName: "second" }),
      expect.objectContaining({ occurrenceDate: MONDAY, reviewerName: "reviewer" }),
    ]);

    await owner.acceptMiss(gym, "2026-01-07");

    expect(owner.today().alerts).toEqual([expect.objectContaining({ occurrenceDate: MONDAY })]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
  });

  test("Take the L survives a restart", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceOnMonday();
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    await owner.acceptMiss(gym, MONDAY);

    await s.restart();

    expect(owner.today().alerts).toEqual([]);
    expect(await owner.acceptMiss(gym, MONDAY)).toEqual({ ok: false, reason: "nothing-to-accept" });
  });
});
