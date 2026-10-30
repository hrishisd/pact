// An owner's ledgers: one per recipient across every pact naming it, each
// with the history of the penalties Missed occurrences added to it.

import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

describe("a ledger's history", () => {
  test("lists each penalty from every pact naming the recipient, newest first, under the ledger's summary", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", ["mon"]);

    await s.advanceTo("Thu 00:00");

    const [summary] = owner.ledgers();
    expect(owner.ledger(summary!.recipientId)).toEqual({
      ok: true,
      ledger: {
        summary: { recipientId: summary!.recipientId, name: "Sam", owedCents: 1500, paidCents: 0 },
        history: [
          {
            penaltyId: expect.any(String),
            pactId: gym,
            pactName: "Gym",
            occurrenceDate: "2026-01-07",
            amountCents: 500,
            addedAt: s.at("Thu 00:00"),
          },
          {
            penaltyId: expect.any(String),
            pactId: gym,
            pactName: "Gym",
            occurrenceDate: "2026-01-05",
            amountCents: 500,
            addedAt: s.at("Tue 00:00"),
          },
          {
            penaltyId: expect.any(String),
            pactId: run,
            pactName: "Run",
            occurrenceDate: "2026-01-05",
            amountCents: 500,
            addedAt: s.at("Tue 00:00"),
          },
        ],
      },
    });
  });

  test("a penalty Missed because its evidence was rejected says who rejected it and why; one with no evidence doesn't", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const reject = async (when: string, by: typeof reviewer, reason: string) => {
      const submitted = await owner.submitEvidence(gym, [photo()]);
      if (!submitted.ok) throw new Error(submitted.reason);
      s.setClockTo(when);
      await by.decide(submitted.evidenceId, { kind: "reject", reason });
    };
    // Monday: rejected, not resubmitted, Missed when the day ends.
    s.setClockTo("Mon 13:00");
    await reject("Mon 15:00", reviewer, "Blurry");
    // Wednesday: rejected, and the owner takes the miss.
    s.setClockTo("Wed 09:00");
    await reject("Wed 10:00", second, "That's last week's photo");
    s.setClockTo("Wed 11:00");
    await owner.acceptRejection(gym);
    // Friday: no evidence.

    await s.advanceTo("Sat 00:00");

    const [summary] = owner.ledgers();
    const ledger = owner.ledger(summary!.recipientId);
    expect(ledger.ok && ledger.ledger.history).toEqual([
      expect.objectContaining({ occurrenceDate: "2026-01-09", addedAt: s.at("Sat 00:00") }),
      expect.objectContaining({
        occurrenceDate: "2026-01-07",
        addedAt: s.at("Wed 11:00"),
        rejection: { reviewerName: "second", reason: "That's last week's photo" },
      }),
      expect.objectContaining({
        occurrenceDate: "2026-01-05",
        addedAt: s.at("Tue 00:00"),
        rejection: { reviewerName: "reviewer", reason: "Blurry" },
      }),
    ]);
    expect(ledger.ok && ledger.ledger.history[0]).not.toHaveProperty("rejection");
  });

  test("is empty for a recipient whose pacts have no Missed occurrence yet", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);

    const [summary] = owner.ledgers();

    expect(owner.ledger(summary!.recipientId)).toEqual({
      ok: true,
      ledger: { summary: { recipientId: summary!.recipientId, name: "Sam", owedCents: 0, paidCents: 0 }, history: [] },
    });
  });
});

describe("whose ledger", () => {
  test("another owner's recipient, or none, is not found", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Tue 00:00");
    const [summary] = owner.ledgers();

    const notFound = { ok: false, reason: "recipient-not-found" };
    expect(reviewer.ledger(summary!.recipientId)).toEqual(notFound);
    expect(owner.ledger("no-such-recipient")).toEqual(notFound);
  });
});
