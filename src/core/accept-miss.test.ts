// Accepting a miss (Take the L): the owner takes a Missed occurrence off
// Today, whether it shows as a Missed card or a rejected-evidence alert. It
// changes nothing else: the ledger stays as it was.

import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

const MONDAY = "2026-01-05";

describe("accepting a miss", () => {
  test("a day Missed with no evidence leaves Today's Missed section; owed is unchanged", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", ["mon"]);
    await s.advanceTo("Tue 08:00");

    expect(await owner.acceptMiss(gym, MONDAY)).toEqual({ ok: true });

    expect(owner.today().sections).toEqual([
      { kind: "missed", cards: [expect.objectContaining({ pactId: run, occurrenceDate: MONDAY })] },
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
  });
});

describe("accepting a miss is refused", () => {
  test("for someone else's pact, or none: not found, and nothing changes", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Tue 08:00");
    const today = owner.today();

    const notFound = { ok: false, reason: "pact-not-found" };
    expect(await reviewer.acceptMiss(gym, MONDAY)).toEqual(notFound);
    expect(await owner.acceptMiss("no-such-pact", MONDAY)).toEqual(notFound);

    expect(owner.today()).toEqual(today);
    expect(today.sections).toEqual([{ kind: "missed", cards: [expect.objectContaining({ pactId: gym })] }]);
  });

  test("with nothing to accept: an occurrence not judged yet, Satisfied, or off the schedule", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const nothing = { ok: false, reason: "nothing-to-accept" };

    // Monday, still open; then Monday with evidence waiting.
    s.setClockTo("Mon 12:00");
    expect(await owner.acceptMiss(gym, MONDAY)).toEqual(nothing);
    const submitted = await owner.submitEvidence(gym, [photo()]);
    if (!submitted.ok) throw new Error(submitted.reason);
    expect(await owner.acceptMiss(gym, MONDAY)).toEqual(nothing);
    // Monday, Satisfied.
    await reviewer.decide(submitted.evidenceId, { kind: "approve" });
    await s.advanceTo("Tue 08:00");
    expect(await owner.acceptMiss(gym, MONDAY)).toEqual(nothing);
    // Tuesday isn't on the schedule; Wednesday hasn't come yet.
    expect(await owner.acceptMiss(gym, "2026-01-06")).toEqual(nothing);
    expect(await owner.acceptMiss(gym, "2026-01-07")).toEqual(nothing);

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("a second time: nothing to accept, and owed is unchanged", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Tue 08:00");
    await owner.acceptMiss(gym, MONDAY);

    expect(await owner.acceptMiss(gym, MONDAY)).toEqual({ ok: false, reason: "nothing-to-accept" });
    expect(owner.today().sections).toEqual([]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });
});
