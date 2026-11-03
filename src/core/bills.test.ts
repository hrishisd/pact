// Weekly bills: every Wednesday at 18:00 in the owner's timezone, each
// recipient gets one bill for the owed penalties that can no longer be
// excused, due 7 days later. An unpaid bill past its due time is Overdue:
// an alert, a daily reminder to the owner, and word to the reviewers.

import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";

/** Gym on Mon/Wed/Fri at $5, every day Missed in the first week: $15 to Sam, the last judged Sat 00:00. */
async function missedWeek(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  await s.advanceTo("Sat 00:00");
  return { ...setup, gym };
}

const bills = (s: Scenario, ownerId: string) =>
  s.notifier.sent.filter((n) => n.kind === "new-bill" && n.recipient === ownerId);

describe("Wednesday bills", () => {
  test("a week's penalties all go on the next Wednesday's bill, due a week later, and the owner is told", async () => {
    const s = scenario();
    const { owner, sam } = await missedWeek(s);

    // This Wednesday the penalties were still excusable: no bill.
    await s.advanceTo("Wed+1 17:59");
    expect(bills(s, owner.id)).toEqual([]);
    expect(owner.ledgers()[0]!.billDue).toBeNull();

    await s.advanceTo("Wed+1 18:00");
    expect(bills(s, owner.id)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ title: "New bill: $15 to Sam", body: "Due Wed Jan 21 at 6:00pm" }),
      }),
    ]);
    expect(owner.ledgers()[0]).toMatchObject({
      overdueCents: 0,
      billDue: { amountCents: 1500, dueAt: s.at("Wed+2 18:00") },
    });
    const ledger = owner.ledger(sam.id);
    if (!ledger.ok) throw new Error(ledger.reason);
    expect(ledger.ledger.history.map((entry) => entry.kind === "penalty" && entry.bill)).toEqual([
      { kind: "on-bill", billedOn: "2026-01-14", dueAt: s.at("Wed+2 18:00") },
      { kind: "on-bill", billedOn: "2026-01-14", dueAt: s.at("Wed+2 18:00") },
      { kind: "on-bill", billedOn: "2026-01-14", dueAt: s.at("Wed+2 18:00") },
    ]);
  });

  test("before its bill, a penalty says which Wednesday's bill it goes on", async () => {
    const s = scenario();
    const { owner, sam } = await missedWeek(s);
    const ledger = owner.ledger(sam.id);
    if (!ledger.ok) throw new Error(ledger.reason);
    expect(ledger.ledger.history.map((entry) => entry.kind === "penalty" && entry.bill)).toEqual([
      { kind: "next-bill", billedOn: "2026-01-14" },
      { kind: "next-bill", billedOn: "2026-01-14" },
      { kind: "next-bill", billedOn: "2026-01-14" },
    ]);
  });

  test("a penalty judged Tuesday is still excusable at Wednesday 18:00, so it waits for the Wednesday after", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Run", ["mon"]);
    // Monday+1 is judged Tuesday+1 00:00; its 48 hours run to Thursday+1.
    await s.advanceTo("Tue+1 00:00");
    await s.advanceTo("Wed+1 18:00");
    // Only the first Monday's $5 is billed.
    expect(owner.ledgers()[0]!.billDue).toEqual({ amountCents: 500, dueAt: s.at("Wed+2 18:00") });
    await s.advanceTo("Wed+2 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $5 to Sam", "New bill: $10 to Sam"]);
  });

  test("a held penalty released by a rejected excuse goes on the next bill; the earlier bill doesn't change", async () => {
    const s = scenario();
    const { owner, reviewer, gym, sam } = await missedWeek(s);
    // Friday's miss (judged Sat 00:00) gets an excuse Sunday, so it's held at Wednesday+1's bill.
    s.setClockTo("Sun 10:00");
    const filed = await owner.fileExcuse(gym, { from: "2026-01-09", to: "2026-01-09", reason: "Sick" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    await s.advanceTo("Wed+1 18:00");
    expect(owner.ledgers()[0]!.billDue).toEqual({ amountCents: 1000, dueAt: s.at("Wed+2 18:00") });

    s.setClockTo("Thu+1 09:00");
    await reviewer.decide(filed.excuseId, { kind: "reject", reason: "You were at the gym's party" });
    const ledger = owner.ledger(sam.id);
    if (!ledger.ok) throw new Error(ledger.reason);
    const friday = ledger.ledger.history.find((e) => e.kind === "penalty" && e.occurrenceDate === "2026-01-09");
    expect(friday).toMatchObject({ bill: { kind: "next-bill", billedOn: "2026-01-21" } });

    await s.advanceTo("Wed+2 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $10 to Sam", "New bill: $5 to Sam"]);
  });

  test("no penalties, no bill and no notification", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", ["sun"]);
    await s.advanceTo("Sun 12:00");
    await owner.submitEvidence(owner.pacts()[0]!.id, [photo()]);
    await s.advanceTo("Wed+2 18:00");
    expect(bills(s, owner.id)).toEqual([]);
  });

  test("catching up after downtime in one advance makes the bills and overdue states it missed", async () => {
    const s = scenario();
    const { owner, reviewer } = await missedWeek(s);
    await s.advanceTo("Thu+2 09:00");
    expect(bills(s, owner.id)).toHaveLength(1);
    expect(owner.ledgers()[0]).toMatchObject({ overdueCents: 1500, billDue: null });
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
    expect(s.notifier.sentTo(reviewer).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
  });

  test("a payment made before the bill pays it at once", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await missedWeek(s);
    const paid = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    await reviewer.decide(paid, { kind: "approve" });
    await s.advanceTo("Wed+2 18:00");
    expect(owner.ledgers()[0]).toMatchObject({ overdueCents: 0, billDue: null });
    expect(owner.today().alerts).toEqual([]);
  });
});

describe("Today and the bill", () => {
  test("no money on Today before a bill exists; then a To do card to pay it", async () => {
    const s = scenario();
    const { owner, sam } = await missedWeek(s);
    await s.advanceTo("Wed+1 17:00");
    const cardsOf = () => owner.today().sections.flatMap((section) => (section.kind === "to-do" ? section.cards : []));
    expect(cardsOf().filter((card) => card.kind === "bill")).toEqual([]);

    await s.advanceTo("Wed+1 18:00");
    expect(cardsOf().filter((card) => card.kind === "bill")).toEqual([
      {
        kind: "bill",
        recipientId: sam.id,
        recipientName: "Sam",
        amountCents: 1500,
        dueAt: s.at("Wed+2 18:00"),
        billedOn: "2026-01-14",
      },
    ]);
  });

  test("the card goes once a payment covering the bill is waiting for approval", async () => {
    const s = scenario();
    const { owner, sam } = await missedWeek(s);
    await s.advanceTo("Wed+1 18:00");
    await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    const today = owner.today();
    expect(today.sections.flatMap((section) => (section.kind === "to-do" ? section.cards : []))).toEqual([]);
    expect(owner.ledgers()[0]!.billDue).toBeNull();
  });
});

describe("Overdue", () => {
  test("unpaid at its due time: an alert and a daily reminder; a pending payment covering it removes both; rejected, the alert returns", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await missedWeek(s);
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill");
    await s.advanceTo("Wed+2 17:59");
    expect(owner.today().alerts).toEqual([]);

    await s.advanceTo("Wed+2 18:00");
    expect(owner.today().alerts).toEqual([
      {
        kind: "bill-overdue",
        recipientId: sam.id,
        recipientName: "Sam",
        overdueCents: 1500,
        billedOn: "2026-01-14",
        dueAt: s.at("Wed+2 18:00"),
        reviewerNames: ["reviewer", "second"],
      },
    ]);
    expect(reminders().map((n) => n.payload.title)).toEqual(["$15 overdue to Sam"]);
    await s.advanceTo("Thu+2 17:00");
    expect(reminders()).toHaveLength(1);
    await s.advanceTo("Thu+2 18:00");
    expect(reminders()).toHaveLength(2);

    s.setClockTo("Thu+2 19:00");
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    expect(owner.today().alerts).toEqual([]);
    expect(owner.ledgers()[0]!.overdueCents).toBe(0);
    await s.advanceTo("Fri+2 18:00");
    expect(reminders()).toHaveLength(2);

    s.setClockTo("Fri+2 19:00");
    await reviewer.decide(paymentId, { kind: "reject", reason: "That's a different account" });
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", overdueCents: 1500 }]);
    await s.advanceTo("Fri+2 19:01");
    expect(reminders()).toHaveLength(3);
  });

  test("part of an overdue bill covered by a pending payment: the alert is for the rest", async () => {
    const s = scenario();
    const { owner, sam } = await missedWeek(s);
    await s.advanceTo("Wed+2 18:00");
    await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 });
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", overdueCents: 500 }]);
  });

  test("reviewers are told when the owner first goes overdue, not again for six days, and again on day seven", async () => {
    const s = scenario();
    const { reviewer, second } = await missedWeek(s);
    const told = () => s.notifier.sentTo(reviewer).filter((n) => n.kind === "overdue-bill");
    await s.advanceTo("Wed+2 18:00");
    expect(told().map((n) => n.payload)).toEqual([
      expect.objectContaining({ title: "owner is overdue", body: "$15 to Sam, due Wed Jan 21" }),
    ]);
    expect(s.notifier.sentTo(second).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
    for (const day of ["Thu+2", "Fri+2", "Sat+2", "Sun+2", "Mon+3", "Tue+3"]) await s.advanceTo(`${day} 18:00`);
    expect(told()).toHaveLength(1);
    await s.advanceTo("Wed+3 18:00");
    expect(told()).toHaveLength(2);
  });

  test("overdue state survives a restart: no second reminder the same day", async () => {
    const s = scenario();
    const { owner } = await missedWeek(s);
    await s.advanceTo("Wed+2 18:00");
    await s.restart();
    await s.advanceTo("Wed+2 20:00");
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
  });
});
