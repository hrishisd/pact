// An owner's ledgers: one per recipient across every pact naming it, each
// with the history of the penalties Missed occurrences added to it.

import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers } from "./testing/camera-pact.ts";
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
