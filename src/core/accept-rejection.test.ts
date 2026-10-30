// Taking the miss: while an occurrence is still open and its latest evidence
// was rejected, the owner can accept the rejection instead of resubmitting.
// The occurrence is Missed as of then, with its penalty.

import { describe, expect, test } from "vitest";
import type { Today } from "../shared/types.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

/** An owner whose Monday evidence for a Mon/Wed/Fri $5 pact was rejected at Mon 15:00 as "Blurry". */
async function rejectedOnMonday() {
  const s = scenario();
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  s.setClockTo("Mon 13:00");
  const submitted = await setup.owner.submitEvidence(gym, [photo()]);
  if (!submitted.ok) throw new Error(submitted.reason);
  s.setClockTo("Mon 15:00");
  await setup.reviewer.decide(submitted.evidenceId, { kind: "reject", reason: "Blurry" });
  return { s, ...setup, gym, evidenceId: submitted.evidenceId };
}

describe("taking the miss after a rejection", () => {
  test("Missed as of now, with its penalty: the alert goes, the pact leaves To do, and Missed shows who rejected it", async () => {
    const { s, owner, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");

    expect(await owner.acceptRejection(gym)).toEqual({ ok: true });

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [
        {
          kind: "missed",
          cards: [
            {
              pactId: gym,
              name: "Gym",
              penaltyCents: 500,
              occurrenceDate: "2026-01-05",
              missedAt: s.at("Mon 16:00"),
              rejection: { reviewerName: "reviewer", reason: "Blurry" },
            },
          ],
        },
      ],
      waiting: [],
      yesterday: [],
    } satisfies Today);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 500 })]);
  });
});

describe("taking the miss is refused", () => {
  test("for someone else's pact, or none: not found, and nothing changes", async () => {
    const { s, owner, reviewer, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");
    const before = owner.today();

    const notFound = { ok: false, reason: "pact-not-found" };
    expect(await reviewer.acceptRejection(gym)).toEqual(notFound);
    expect(await owner.acceptRejection("no-such-pact")).toEqual(notFound);

    expect(owner.today()).toEqual(before);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("with nothing to accept: no evidence yet, or a day the schedule skips", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const nothing = { ok: false, reason: "nothing-to-accept" };

    s.setClockTo("Mon 16:00");
    expect(await owner.acceptRejection(gym)).toEqual(nothing);
    await s.advanceTo("Tue 12:00");
    expect(await owner.acceptRejection(gym)).toEqual(nothing);

    // Only Monday's miss, judged when it ended.
    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: { history: [{ occurrenceDate: "2026-01-05", addedAt: s.at("Tue 00:00") }] },
    });
  });

  test("with nothing to accept: new evidence waiting after the rejection, then approved", async () => {
    const { s, owner, second, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 20:00");
    const again = await owner.submitEvidence(gym, [photo(2)]);
    if (!again.ok) throw new Error(again.reason);
    const nothing = { ok: false, reason: "nothing-to-accept" };

    expect(await owner.acceptRejection(gym)).toEqual(nothing);
    s.setClockTo("Mon 21:00");
    await second.decide(again.evidenceId, { kind: "approve" });
    expect(await owner.acceptRejection(gym)).toEqual(nothing);

    await s.advanceTo("Tue 00:00");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("once taken: a second time has nothing to accept, and owes nothing more", async () => {
    const { s, owner, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");
    await owner.acceptRejection(gym);

    s.setClockTo("Mon 17:00");
    expect(await owner.acceptRejection(gym)).toEqual({ ok: false, reason: "nothing-to-accept" });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });

  test("submitting evidence for it afterwards is refused, and Today stays as it was", async () => {
    const { s, owner, reviewer, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");
    await owner.acceptRejection(gym);
    const after = owner.today();

    s.setClockTo("Mon 18:00");
    expect(await owner.submitEvidence(gym, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });

    expect(owner.today()).toEqual(after);
    expect(reviewer.reviewQueue()).toEqual([]);
  });

  test("when the day ends it isn't judged again: still one penalty, as of when the miss was taken", async () => {
    const { s, owner, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");
    await owner.acceptRejection(gym);

    await s.advanceTo("Tue 00:00");

    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: {
        summary: { owedCents: 500 },
        history: [{ pactId: gym, occurrenceDate: "2026-01-05", addedAt: s.at("Mon 16:00") }],
      },
    });
    expect(owner.today().sections).toEqual([
      { kind: "missed", cards: [expect.objectContaining({ pactId: gym, missedAt: s.at("Mon 16:00") })] },
    ]);
  });

  test("a restart afterwards changes nothing", async () => {
    const { s, owner, gym } = await rejectedOnMonday();
    s.setClockTo("Mon 16:00");
    await owner.acceptRejection(gym);
    const today = owner.today();
    const ledgers = owner.ledgers();

    await s.restart();

    expect(owner.today()).toEqual(today);
    expect(owner.ledgers()).toEqual(ledgers);
    expect(await owner.submitEvidence(gym, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });
    expect(await owner.acceptRejection(gym)).toEqual({ ok: false, reason: "nothing-to-accept" });
  });
});
