// Recording a payment: the owner pays a recipient outside the app and records
// it with a screenshot. It waits for a reviewer's approval before it counts
// (ADR 0001), and meanwhile no payment may take the ledger below zero.

import { describe, expect, test } from "vitest";
import { fifteenOwed, MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

/** A friend of the owner's who reviews only a pact of theirs with another recipient, "Food bank". */
async function reviewerForAnotherRecipient(
  s: Scenario,
  { owner, createPact }: Pick<Awaited<ReturnType<typeof ownerWithReviewers>>, "owner" | "createPact">,
) {
  const friend = await s.befriend(owner, "friend");
  const added = await owner.addRecipient({ name: "Food bank" });
  if (!added.ok) throw new Error(added.reason);
  await createPact("Read", ["sun"], { reviewers: [friend], recipientId: added.recipient.id });
  return friend;
}

describe("recording a payment", () => {
  test("waits for approval: owed stays $15 with $10 awaiting, a further $10 is refused, and $5 is allowed", async () => {
    const s = scenario();
    const { owner, sam } = await fifteenOwed(s);

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1000 }, photo())).toEqual({
      ok: true,
      paymentId: expect.any(String),
    });
    expect(owner.ledgers()).toEqual([
      {
        recipientId: sam.id,
        name: "Sam",
        owedCents: 1500,
        awaitingCents: 1000,
        awaitingCount: 1,
        paidCents: 0,
        payableCents: 500,
      },
    ]);

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1000 }, photo(2))).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 500, note: "Venmo" }, photo(3))).toMatchObject(
      {
        ok: true,
      },
    );
    expect(owner.ledgers()).toEqual([
      {
        recipientId: sam.id,
        name: "Sam",
        owedCents: 1500,
        awaitingCents: 1500,
        awaitingCount: 2,
        paidCents: 0,
        payableCents: 0,
      },
    ]);
  });
});

describe("a refused payment", () => {
  test("an amount that isn't a positive whole number of cents", async () => {
    const s = scenario();
    const { owner, sam } = await fifteenOwed(s);

    for (const amountCents of [0, -500, 250.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await owner.recordPayment({ recipientId: sam.id, amountCents }, photo())).toEqual({
        ok: false,
        reason: "invalid-amount",
      });
    }
    expect(owner.ledgers()).toEqual([expect.objectContaining({ awaitingCents: 0 })]);
    expect(s.photoStore.photoIds).toEqual([]);
  });

  test("a recipient that isn't the owner's, or none", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);
    const theirs = await reviewer.addRecipient({ name: "Sam" });
    if (!theirs.ok) throw new Error(theirs.reason);

    const notFound = { ok: false, reason: "recipient-not-found" };
    expect(await owner.recordPayment({ recipientId: theirs.recipient.id, amountCents: 500 }, photo())).toEqual(
      notFound,
    );
    expect(await owner.recordPayment({ recipientId: "no-such-recipient", amountCents: 500 }, photo())).toEqual(
      notFound,
    );
    // The owner's recipient, recorded by someone else.
    expect(await reviewer.recordPayment({ recipientId: sam.id, amountCents: 500 }, photo())).toEqual(notFound);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ awaitingCents: 0 })]);
    expect(s.photoStore.photoIds).toEqual([]);
  });

  test("no screenshot", async () => {
    const s = scenario();
    const { owner, sam } = await fifteenOwed(s);

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 500 }, null)).toEqual({
      ok: false,
      reason: "no-screenshot",
    });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ awaitingCents: 0 })]);
  });

  test("more than what's payable: owed less payments awaiting approval, until a rejection frees it up again", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1500, payableCents: 1500 })]);

    const ten = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 }, photo(1));
    expect(owner.ledgers()).toEqual([expect.objectContaining({ payableCents: 500 })]);
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 501 }, photo(2))).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });

    await reviewer.decide(ten, { kind: "reject", reason: "Blurry" });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ payableCents: 1500 })]);
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1500 }, photo(3))).toMatchObject({ ok: true });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ payableCents: 0 })]);
  });

  test("more than owed, to a recipient with nothing owed yet", async () => {
    const s = scenario();
    const { owner, sam, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1 }, photo())).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });
  });

  test("two payments recorded at once can't together exceed what's owed", async () => {
    const s = scenario();
    const { owner, sam } = await fifteenOwed(s);

    const results = await Promise.all([
      owner.recordPayment({ recipientId: sam.id, amountCents: 1000 }, photo(1)),
      owner.recordPayment({ recipientId: sam.id, amountCents: 1000 }, photo(2)),
    ]);

    expect(results).toEqual([
      { ok: true, paymentId: expect.any(String) },
      { ok: false, reason: "payment-exceeds-owed" },
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1500, awaitingCents: 1000 })]);
  });
});

describe("a recorded payment", () => {
  test("is a review item for each reviewer of any of the owner's pacts with that recipient, once each", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await fifteenOwed(s);
    // A second pact with Sam that only the reviewer reviews.
    await createPact("Swim", ["sun"], { reviewers: [reviewer] });
    const friend = await reviewerForAnotherRecipient(s, { owner, createPact });

    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 });

    const reviewItem = {
      kind: "review-item",
      channel: "push",
      payload: {
        itemKind: "payment",
        itemId: paymentId,
        recipientId: sam.id,
        title: "owner recorded a payment",
        body: "$10 to Sam",
        url: "/review",
      },
    };
    const reviewItems = (account: AccountHandle) => s.notifier.sentTo(account).filter((n) => n.kind === "review-item");
    expect(reviewItems(reviewer)).toEqual([{ ...reviewItem, recipient: reviewer.id }]);
    expect(reviewItems(second)).toEqual([{ ...reviewItem, recipient: second.id }]);
    expect(s.notifier.sentTo(friend)).toEqual([]);
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "review-item")).toEqual([]);
  });

  test("survives a restart, still awaiting approval", async () => {
    const s = scenario();
    const { owner, sam } = await fifteenOwed(s);
    await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 });

    await s.restart();

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1500, awaitingCents: 1000, paidCents: 0 })]);
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1000 }, photo(2))).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });
  });
});

describe("a payment's screenshot", () => {
  test("is shown to the owner and to reviewers of any pact with that recipient, even one with no penalties, and to no one else", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await ownerWithReviewers(s);
    // The penalties come from Gym, which only `second` reviews. Swim, which
    // only `reviewer` reviews, has none yet.
    await createPact("Gym", MON_WED_FRI, { reviewers: [second] });
    await createPact("Swim", ["sun"], { reviewers: [reviewer] });
    const friend = await reviewerForAnotherRecipient(s, { owner, createPact });
    const stranger = await s.befriend(friend, "stranger");
    await s.advanceTo("Sat 00:00");

    await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 }, photo(9));
    const [photoId] = s.photoStore.photoIds;
    if (photoId === undefined) throw new Error("no photo stored");

    for (const viewer of [owner, reviewer, second]) {
      expect(await viewer.photo(photoId)).toEqual({ ok: true, photo: photo(9) });
    }
    for (const viewer of [friend, stranger]) {
      expect(await viewer.photo(photoId)).toEqual({ ok: false, reason: "photo-not-found" });
    }
  });
});

/** The owner with $15 owed to Sam and a $10 payment to Sam recorded at Sat 09:00. */
async function tenRecorded(s: Scenario) {
  const setup = await fifteenOwed(s);
  s.setClockTo("Sat 09:00");
  const paymentId = await recordPayment(
    setup.owner,
    { recipientId: setup.sam.id, amountCents: 1000, note: "Venmo" },
    photo(7),
  );
  s.setClockTo("Sat 10:00");
  return { ...setup, paymentId };
}

describe("deciding a payment", () => {
  test("approved: owed drops by the amount and lifetime paid rises", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);

    expect(await reviewer.decide(paymentId, { kind: "approve" })).toEqual({ ok: true });

    expect(owner.ledgers()).toEqual([
      {
        recipientId: sam.id,
        name: "Sam",
        owedCents: 500,
        awaitingCents: 0,
        awaitingCount: 0,
        paidCents: 1000,
        payableCents: 500,
      },
    ]);
  });

  test("rejected with a reason: owed stays, nothing awaits approval, nothing is paid", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);

    expect(await reviewer.decide(paymentId, { kind: "reject", reason: "That's not Sam's account" })).toEqual({
      ok: true,
    });

    expect(owner.ledgers()).toEqual([
      {
        recipientId: sam.id,
        name: "Sam",
        owedCents: 1500,
        awaitingCents: 0,
        awaitingCount: 0,
        paidCents: 0,
        payableCents: 1500,
      },
    ]);
  });

  test("any reviewer of any of the owner's pacts with the recipient may decide it, even when the penalties came from another pact", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await ownerWithReviewers(s);
    // The penalties come from Gym, which only `second` reviews; `reviewer` reviews only Swim.
    await createPact("Gym", MON_WED_FRI, { reviewers: [second] });
    await createPact("Swim", ["sun"], { reviewers: [reviewer] });
    await s.advanceTo("Sat 00:00");
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 });

    expect(await reviewer.decide(paymentId, { kind: "approve" })).toEqual({ ok: true });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500, paidCents: 1000 })]);
  });

  test("a friend who reviews no pact with the recipient can't decide it", async () => {
    const s = scenario();
    const { owner, createPact, paymentId } = await tenRecorded(s);
    const friend = await reviewerForAnotherRecipient(s, { owner, createPact });

    for (const decision of [{ kind: "approve" }, { kind: "reject", reason: "No" }] as const) {
      expect(await friend.decide(paymentId, decision)).toEqual({ ok: false, reason: "item-not-found" });
    }
    expect(owner.ledgers()).toContainEqual(
      expect.objectContaining({ name: "Sam", owedCents: 1500, awaitingCents: 1000, paidCents: 0 }),
    );
  });

  test("the owner can't decide their own payment", async () => {
    const s = scenario();
    const { owner, paymentId } = await tenRecorded(s);

    expect(await owner.decide(paymentId, { kind: "approve" })).toEqual({ ok: false, reason: "item-not-found" });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1500, awaitingCents: 1000, paidCents: 0 })]);
  });

  test("the first decision is final: a second reviewer's decision is refused and changes nothing", async () => {
    const s = scenario();
    const { owner, reviewer, second, paymentId } = await tenRecorded(s);
    await reviewer.decide(paymentId, { kind: "approve" });

    for (const decision of [{ kind: "reject", reason: "Wrong account" }, { kind: "approve" }] as const) {
      expect(await second.decide(paymentId, decision)).toEqual({ ok: false, reason: "already-decided" });
    }
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500, awaitingCents: 0, paidCents: 1000 })]);
  });

  test("rejecting needs a reason", async () => {
    const s = scenario();
    const { owner, reviewer, paymentId } = await tenRecorded(s);

    expect(await reviewer.decide(paymentId, { kind: "reject", reason: "  " })).toEqual({
      ok: false,
      reason: "blank-reason",
    });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1500, awaitingCents: 1000, paidCents: 0 })]);
  });

  test("after a rejection, the owner can record a new payment up to the full owed again", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);
    await reviewer.decide(paymentId, { kind: "reject", reason: "Blurry" });

    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1500 }, photo(8))).toMatchObject({ ok: true });
    expect(owner.ledgers()).toEqual([
      expect.objectContaining({ owedCents: 1500, awaitingCents: 1500, awaitingCount: 1, paidCents: 0 }),
    ]);
  });

  test("tells the owner, with the reason for a rejection", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);
    const second = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 }, photo(8));

    await reviewer.decide(paymentId, { kind: "approve" });
    await reviewer.decide(second, { kind: "reject", reason: "That's not Sam's account" });

    const decided = { recipient: owner.id, kind: "payment-decided", channel: "push" };
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "payment-decided")).toEqual([
      {
        ...decided,
        payload: {
          itemKind: "payment",
          itemId: paymentId,
          recipientId: sam.id,
          decision: "approved",
          title: "reviewer approved your payment",
          body: "$10 to Sam",
          url: `/ledgers/${sam.id}`,
        },
      },
      {
        ...decided,
        payload: {
          itemKind: "payment",
          itemId: second,
          recipientId: sam.id,
          decision: "rejected",
          reason: "That's not Sam's account",
          title: "reviewer rejected your payment",
          body: "$5 to Sam · “That's not Sam's account”",
          url: `/ledgers/${sam.id}`,
        },
      },
    ]);
  });
});

/**
 * Evidence for a Mon/Tue pact at Mon 20:00, a $5 payment to Sam at Tue 09:00
 * (owed from a Monday pact Missed), and evidence again at Tue 10:00: their ids.
 */
async function evidencePaymentEvidence(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const { owner, sam, createPact } = setup;
  await createPact("Gym", ["mon"]);
  const run = await createPact("Run", ["mon", "tue"]);
  s.setClockTo("Mon 20:00");
  const monday = await owner.submitEvidence(run, [photo(1)]);
  await s.advanceTo("Tue 09:00");
  const payment = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 }, photo(2));
  s.setClockTo("Tue 10:00");
  const tuesday = await owner.submitEvidence(run, [photo(3)]);
  if (!monday.ok || !tuesday.ok) throw new Error("refused");
  return { ...setup, monday: monday.evidenceId, payment, tuesday: tuesday.evidenceId };
}

describe("a payment in the Review Queue", () => {
  test("is in the queue of each account that may decide it, with what the Review screen needs", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact, paymentId } = await tenRecorded(s);
    const friend = await reviewerForAnotherRecipient(s, { owner, createPact });

    const item = {
      kind: "payment",
      id: paymentId,
      ownerName: "owner",
      recipientName: "Sam",
      amountCents: 1000,
      note: "Venmo",
      photoId: s.photoStore.photoIds[0],
      recordedAt: s.at("Sat 09:00"),
      owedCents: 1500,
      owedAfterApprovalCents: 500,
    };
    expect(reviewer.reviewQueue()).toEqual([item]);
    expect(second.reviewQueue()).toEqual([item]);
    expect(friend.reviewQueue()).toEqual([]);
    expect(owner.reviewQueue()).toEqual([]);
  });

  test("says what's owed after approving it, each payment on its own, until another is approved", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);
    const five = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 }, photo(8));

    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({ id: paymentId, owedCents: 1500, owedAfterApprovalCents: 500 }),
      expect.objectContaining({ id: five, owedCents: 1500, owedAfterApprovalCents: 1000 }),
    ]);

    await reviewer.decide(paymentId, { kind: "approve" });

    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({ id: five, owedCents: 500, owedAfterApprovalCents: 0 }),
    ]);
  });

  test("has no note when none was given", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await fifteenOwed(s);
    await recordPayment(owner, { recipientId: sam.id, amountCents: 1000, note: "  " });

    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ kind: "payment", note: null })]);
  });

  test("leaves every queue once decided", async () => {
    const s = scenario();
    const { reviewer, second, paymentId } = await tenRecorded(s);

    await second.decide(paymentId, { kind: "reject", reason: "Blurry" });

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
  });

  test("is listed with evidence, oldest first", async () => {
    const s = scenario();
    const { reviewer, monday, payment, tuesday } = await evidencePaymentEvidence(s);

    expect(reviewer.reviewQueue().map((item) => item.id)).toEqual([monday, payment, tuesday]);
  });
});

describe("Today's Waiting for approval", () => {
  test("shows the payment until a reviewer decides it", async () => {
    const s = scenario();
    const { owner, reviewer, sam, paymentId } = await tenRecorded(s);
    const second = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 }, photo(8));

    expect(owner.today().waiting).toEqual([
      {
        kind: "payment",
        id: second,
        recipientId: sam.id,
        recipientName: "Sam",
        amountCents: 500,
        recordedAt: s.at("Sat 10:00"),
      },
      {
        kind: "payment",
        id: paymentId,
        recipientId: sam.id,
        recipientName: "Sam",
        amountCents: 1000,
        recordedAt: s.at("Sat 09:00"),
      },
    ]);

    await reviewer.decide(paymentId, { kind: "approve" });
    await reviewer.decide(second, { kind: "reject", reason: "Blurry" });
    expect(owner.today().waiting).toEqual([]);
  });

  test("lists payments with evidence, newest first", async () => {
    const s = scenario();
    const { owner, monday, payment, tuesday } = await evidencePaymentEvidence(s);

    expect(owner.today().waiting.map((item) => item.id)).toEqual([tuesday, payment, monday]);
  });
});
