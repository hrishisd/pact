// An owner's ledgers: one per recipient across every pact naming it, each
// with a history of the penalties Missed occurrences added to it and the
// payments recorded against it, and which penalties those payments have paid.

import { describe, expect, test } from "vitest";
import { fifteenOwed, MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle } from "./testing/scenario.ts";
import { ledgerHistory, ok } from "./testing/queries.ts";

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
        summary: {
          recipientId: summary!.recipientId,
          name: "Sam",
          owedCents: 1500,
          payableCents: 1500,
          awaitingCents: 0,
          awaitingCount: 0,
          paidCents: 0,
          suggestedPaymentCents: 1500,
          creditCents: 0,
          creditWaitsOn: [],
          overdueCents: 0,
          billDue: null,
        },
        history: [
          {
            kind: "penalty",
            penaltyId: expect.any(String),
            pactId: gym,
            pactName: "Gym",
            occurrenceDate: s.date("Wed"),
            amountCents: 500,
            addedAt: s.at("Thu 00:00"),
            paidCents: 0,
            held: false,
            bill: { kind: "next-bill", billedOn: s.date("Wed+1") },
          },
          {
            kind: "penalty",
            penaltyId: expect.any(String),
            pactId: gym,
            pactName: "Gym",
            occurrenceDate: s.date("Mon"),
            amountCents: 500,
            addedAt: s.at("Tue 00:00"),
            paidCents: 0,
            held: false,
            bill: { kind: "next-bill", billedOn: s.date("Wed+1") },
          },
          {
            kind: "penalty",
            penaltyId: expect.any(String),
            pactId: run,
            pactName: "Run",
            occurrenceDate: s.date("Mon"),
            amountCents: 500,
            addedAt: s.at("Tue 00:00"),
            paidCents: 0,
            held: false,
            bill: { kind: "next-bill", billedOn: s.date("Wed+1") },
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
      const submitted = ok(await owner.submitEvidence(gym, [photo()]));
      s.setClockTo(when);
      await by.decide(submitted.evidenceId, { kind: "reject", reason });
    };
    // Monday: rejected while the day is open.
    s.setClockTo("Mon 13:00");
    await reject("Mon 15:00", reviewer, "Blurry");
    // Wednesday: rejected after the day ended, and the owner takes the L.
    s.setClockTo("Wed 09:00");
    await reject("Thu 10:00", second, "That's last week's photo");
    s.setClockTo("Thu 11:00");
    await owner.acceptMiss(gym, s.date("Wed"));
    // Friday: no evidence.

    await s.advanceTo("Sat 00:00");

    const [summary] = owner.ledgers();
    const ledger = owner.ledger(summary!.recipientId);
    expect(ledger.ok && ledger.ledger.history).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Fri"), addedAt: s.at("Sat 00:00") }),
      expect.objectContaining({
        occurrenceDate: s.date("Wed"),
        addedAt: s.at("Thu 10:00"),
        rejection: { reviewerName: "second", reason: "That's last week's photo" },
      }),
      expect.objectContaining({
        occurrenceDate: s.date("Mon"),
        addedAt: s.at("Mon 15:00"),
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
      ledger: {
        summary: {
          recipientId: summary!.recipientId,
          name: "Sam",
          owedCents: 0,
          payableCents: 0,
          awaitingCents: 0,
          awaitingCount: 0,
          paidCents: 0,
          suggestedPaymentCents: 0,
          creditCents: 0,
          creditWaitsOn: [],
          overdueCents: 0,
          billDue: null,
        },
        history: [],
      },
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

/** How much of each penalty on the owner's ledger for Sam is paid, oldest penalty first. */
function paidOldestFirst(owner: AccountHandle, recipientId: string) {
  const ledger = ok(owner.ledger(recipientId));
  return ledger.ledger.history
    .flatMap((entry) => (entry.kind === "penalty" ? [[entry.occurrenceDate, entry.paidCents]] : []))
    .reverse();
}

describe("paying off a ledger's penalties", () => {
  test("an approved $7 payment against three $5 penalties pays the oldest, part of the second, and none of the third", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);

    await reviewer.decide(await recordPayment(owner, { recipientId: sam.id, amountCents: 700 }), { kind: "approve" });

    expect(paidOldestFirst(owner, sam.id)).toEqual([
      [s.date("Mon"), 500],
      [s.date("Wed"), 200],
      [s.date("Fri"), 0],
    ]);
  });

  test("a payment awaiting approval and a rejected one pay nothing", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);

    const rejected = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 });
    await reviewer.decide(rejected, { kind: "reject", reason: "Wrong account" });
    await recordPayment(owner, { recipientId: sam.id, amountCents: 500 });

    expect(paidOldestFirst(owner, sam.id)).toEqual([
      [s.date("Mon"), 0],
      [s.date("Wed"), 0],
      [s.date("Fri"), 0],
    ]);
  });

  test("two approved payments of $3 and $4 pay the same as one of $7", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);

    for (const amountCents of [300, 400]) {
      await reviewer.decide(await recordPayment(owner, { recipientId: sam.id, amountCents }), { kind: "approve" });
    }

    expect(paidOldestFirst(owner, sam.id)).toEqual([
      [s.date("Mon"), 500],
      [s.date("Wed"), 200],
      [s.date("Fri"), 0],
    ]);
  });
});

describe("payments in a ledger's history", () => {
  test("are listed newest first among the penalties, each awaiting approval, approved with who approved it, or rejected with who rejected it and why", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Thu 00:00");
    s.setClockTo("Thu 09:00");
    const approved = await recordPayment(owner, { recipientId: sam.id, amountCents: 300, note: "Venmo" });
    s.setClockTo("Thu 10:00");
    const rejected = await recordPayment(owner, { recipientId: sam.id, amountCents: 200 });
    s.setClockTo("Thu 11:00");
    await reviewer.decide(approved, { kind: "approve" });
    s.setClockTo("Thu 12:00");
    await second.decide(rejected, { kind: "reject", reason: "That's not Sam's account" });
    s.setClockTo("Fri 09:00");
    const awaiting = await recordPayment(owner, { recipientId: sam.id, amountCents: 400 });
    await s.advanceTo("Sat 00:00");

    const penalty = (occurrenceDate: string, addedAt: string, paidCents: number) => ({
      kind: "penalty",
      penaltyId: expect.any(String),
      pactId: gym,
      pactName: "Gym",
      occurrenceDate,
      amountCents: 500,
      addedAt: s.at(addedAt),
      paidCents,
      held: false,
      bill: { kind: "next-bill", billedOn: s.date("Wed+1") },
    });
    expect(owner.ledger(sam.id)).toEqual({
      ok: true,
      ledger: {
        summary: {
          recipientId: sam.id,
          name: "Sam",
          owedCents: 1200,
          payableCents: 800,
          awaitingCents: 400,
          awaitingCount: 1,
          paidCents: 300,
          suggestedPaymentCents: 800,
          creditCents: 0,
          creditWaitsOn: [],
          overdueCents: 0,
          billDue: null,
        },
        history: [
          penalty(s.date("Fri"), "Sat 00:00", 0),
          {
            kind: "payment",
            paymentId: awaiting,
            amountCents: 400,
            note: null,
            recordedAt: s.at("Fri 09:00"),
            state: { kind: "waiting" },
          },
          {
            kind: "payment",
            paymentId: rejected,
            amountCents: 200,
            note: null,
            recordedAt: s.at("Thu 10:00"),
            state: {
              kind: "rejected",
              reviewerName: "second",
              decidedAt: s.at("Thu 12:00"),
              reason: "That's not Sam's account",
            },
          },
          {
            kind: "payment",
            paymentId: approved,
            amountCents: 300,
            note: "Venmo",
            recordedAt: s.at("Thu 09:00"),
            state: { kind: "approved", reviewerName: "reviewer", decidedAt: s.at("Thu 11:00") },
          },
          penalty(s.date("Wed"), "Thu 00:00", 0),
          penalty(s.date("Mon"), "Tue 00:00", 300),
        ],
      },
    });
  });

  test("never include another owner's payments", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", ["mon"]);
    // The reviewer owes their own Sam, and pays it, with the owner approving.
    const theirSam = ok(await reviewer.addRecipient({ name: "Sam" }));
    await reviewer.setTimezone("America/New_York");
    await createPact("Run", ["mon"], { by: reviewer, reviewers: [owner], recipientId: theirSam.recipient.id });
    await s.advanceTo("Tue 00:00");
    const theirs = await recordPayment(reviewer, { recipientId: theirSam.recipient.id, amountCents: 500 });
    await owner.decide(theirs, { kind: "approve" });

    const ledger = owner.ledger(sam.id);
    expect(ledger.ok && ledger.ledger.history).toEqual([
      expect.objectContaining({ kind: "penalty", pactName: "Gym", paidCents: 0 }),
    ]);
  });
});

describe("a ledger's credit (R12)", () => {
  /** Gym, Mon/Wed/Fri at $5: Monday Missed, paid $5 and approved, then excused at Tue 09:00. */
  async function mondayPaidThenExcused() {
    const s = scenario();
    const setup = await ownerWithReviewers(s);
    const gym = await setup.createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Tue 00:00");
    s.setClockTo("Tue 08:00");
    const payment = await recordPayment(setup.owner, { recipientId: setup.sam.id, amountCents: 500 });
    await setup.reviewer.decide(payment, { kind: "approve" });
    s.setClockTo("Tue 09:00");
    const excuseId = ok(
      await setup.owner.fileExcuse(gym, { from: s.date("Mon"), to: s.date("Mon"), reason: "Sick" }, [photo()]),
    ).excuseId;
    return { s, ...setup, gym, excuseId };
  }

  test("a paid penalty excused leaves a credit, provisional while the excuse waits, that pays the next penalty", async () => {
    const { s, owner, reviewer, excuseId } = await mondayPaidThenExcused();
    expect(owner.ledgers()).toEqual([
      expect.objectContaining({ owedCents: 0, creditCents: 500, creditWaitsOn: ["excuse"] }),
    ]);

    await reviewer.decide(excuseId, { kind: "approve" });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, creditCents: 500, creditWaitsOn: [] })]);

    // Wednesday's miss takes the credit.
    await s.advanceTo("Thu 00:00");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, creditCents: 0, creditWaitsOn: [] })]);
    expect(ledgerHistory(owner).filter((entry) => entry.kind === "penalty")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Wed"), paidCents: 500 }),
    ]);
  });

  test("the excuse rejected instead: the credit is gone and the payment pays its penalty again", async () => {
    const { s, owner, reviewer, excuseId } = await mondayPaidThenExcused();
    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, creditCents: 0, creditWaitsOn: [] })]);
    expect(ledgerHistory(owner).filter((entry) => entry.kind === "penalty")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Mon"), held: false, paidCents: 500 }),
    ]);
  });
});
