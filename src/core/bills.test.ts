// Weekly bills: every Wednesday at 18:00 in the owner's timezone, each
// recipient gets one bill for the owed penalties that can no longer be
// excused, due 7 days later. An unpaid bill past its due time is Overdue:
// an alert, a daily reminder to the owner, and word to the reviewers.

import { describe, expect, test } from "vitest";
import { ownerWithOura } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

/**
 * Gym on Mon/Wed/Fri at $5, every day Missed in the first week: $15 to Sam,
 * the last judged Sat 00:00. It goes on being Missed after that: each week
 * adds $15 more.
 */
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
      // Monday+1's, judged Tuesday+1, can still be excused.
      { kind: "next-bill", billedOn: "2026-01-21" },
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
    // Monday+1's goes on the next one; Monday+2's, judged Tuesday+2, waits again.
    await s.advanceTo("Tue+2 00:00");
    await s.advanceTo("Wed+2 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $5 to Sam", "New bill: $5 to Sam"]);
  });

  test("a held penalty says which bill it goes on if its excuse is rejected, and moves on while the excuse waits", async () => {
    const s = scenario();
    const { owner, gym, sam } = await missedWeek(s);
    // Friday's miss, judged Sat 00:00, can be excused until Mon 00:00.
    s.setClockTo("Sun 10:00");
    const filed = await owner.fileExcuse(gym, { from: "2026-01-09", to: "2026-01-09", reason: "Sick" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    const fridayBill = () => {
      const ledger = owner.ledger(sam.id);
      if (!ledger.ok) throw new Error(ledger.reason);
      const friday = ledger.ledger.history.find((e) => e.kind === "penalty" && e.occurrenceDate === "2026-01-09");
      return friday?.kind === "penalty" ? friday.bill : undefined;
    };

    expect(fridayBill()).toEqual({ kind: "if-excuse-rejected", billedOn: "2026-01-14" });

    // Still waiting when Wednesday's bill is made, so it would go on the next one.
    await s.advanceTo("Wed+1 18:00");
    expect(fridayBill()).toEqual({ kind: "if-excuse-rejected", billedOn: "2026-01-21" });
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

    // Friday's $5 joins the second week's $15.
    await s.advanceTo("Wed+2 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $10 to Sam", "New bill: $20 to Sam"]);
    const after = owner.ledger(sam.id);
    if (!after.ok) throw new Error(after.reason);
    const billedOn = (date: string) => {
      const entry = after.ledger.history.find((e) => e.kind === "penalty" && e.occurrenceDate === date);
      return entry?.kind === "penalty" && entry.bill?.kind === "on-bill" ? entry.bill.billedOn : null;
    };
    expect([billedOn("2026-01-05"), billedOn("2026-01-07"), billedOn("2026-01-09")]).toEqual([
      "2026-01-14",
      "2026-01-14",
      "2026-01-21",
    ]);
  });

  test("a payment that paid a bill stays on it when an older held penalty is released afterwards", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { dates: { endDate: "2026-01-09" } });
    await s.advanceTo("Tue 10:00");
    // Monday's miss, the oldest penalty, is held by an excuse while Wednesday's and Friday's are billed.
    const filed = await owner.fileExcuse(gym, { from: "2026-01-05", to: "2026-01-05", reason: "Sick" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    await s.advanceTo("Wed+1 18:00");
    expect(owner.ledgers()[0]!.billDue).toEqual({ amountCents: 1000, dueAt: s.at("Wed+2 18:00") });
    const paid = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000 });
    await reviewer.decide(paid, { kind: "approve" });

    s.setClockTo("Thu+1 09:00");
    await reviewer.decide(filed.excuseId, { kind: "reject", reason: "You were at the gym's party" });
    await s.advanceTo("Wed+2 18:00");

    // The bill stays paid; Monday's $5 is the new bill's.
    expect(owner.ledgers()[0]).toMatchObject({
      owedCents: 500,
      overdueCents: 0,
      billDue: { amountCents: 500, dueAt: s.at("Wed+3 18:00") },
    });
    expect(owner.today().alerts.filter((alert) => alert.kind === "bill-overdue")).toEqual([]);
    expect(s.notifier.sentTo(reviewer).filter((n) => n.kind === "overdue-bill")).toEqual([]);
  });

  test("a Sunday night with no Oura data, Missed at Monday 18:00, goes on Wednesday's bill; a night judged at Wednesday 18:00 waits a week", async () => {
    const s = scenario();
    const { owner, sam, createPact } = await ownerWithOura(s);
    // Sunday's night closes Monday+1 18:00; Tuesday+1's closes Wednesday+1 18:00, the moment of the bill.
    s.setClockTo("Sun 12:00");
    await createPact("00:00", ["sun", "tue"]);
    const penaltyBills = () => {
      const ledger = owner.ledger(sam.id);
      if (!ledger.ok) throw new Error(ledger.reason);
      return ledger.ledger.history.map((entry) => entry.kind === "penalty" && [entry.occurrenceDate, entry.bill]);
    };

    await s.advanceTo("Mon+1 17:59");
    expect(penaltyBills()).toEqual([]);
    await s.advanceTo("Mon+1 18:00");
    // Its 48 hours close exactly at Wednesday+1 18:00, so that Wednesday's bill takes it.
    expect(penaltyBills()).toEqual([["2026-01-11", { kind: "next-bill", billedOn: "2026-01-14" }]]);

    await s.advanceTo("Wed+1 17:59");
    expect(bills(s, owner.id)).toEqual([]);
    await s.advanceTo("Wed+1 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $5 to Sam"]);
    expect(owner.ledgers()[0]!.billDue).toEqual({ amountCents: 500, dueAt: s.at("Wed+2 18:00") });
    // Tuesday+1's night, Missed at Wednesday+1 18:00, can be excused until Friday+1: the next bill's.
    expect(penaltyBills()).toEqual([
      ["2026-01-13", { kind: "next-bill", billedOn: "2026-01-21" }],
      ["2026-01-11", { kind: "on-bill", billedOn: "2026-01-14", dueAt: s.at("Wed+2 18:00") }],
    ]);
  });

  test("a Sunday night judged late, in the tick that makes Wednesday's bill, is still on it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00", ["sun"]);
    await s.advanceTo("Mon+1 17:00");
    // Down from before the night closed until the bill.
    await s.advanceTo("Wed+1 18:00");
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $5 to Sam"]);
  });

  test("no penalties, no bill and no notification", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", ["sun"]);
    await s.advanceTo("Sun 12:00");
    await owner.submitEvidence(owner.pacts()[0]!.id, [photo()]);
    await s.advanceTo("Wed+1 18:00");
    expect(bills(s, owner.id)).toEqual([]);
  });

  test("catching up after downtime in one advance makes the bills and overdue states it missed", async () => {
    const s = scenario();
    const { owner, reviewer } = await missedWeek(s);
    await s.advanceTo("Thu+2 09:00");
    // Wednesday+1's bill, now overdue, and Wednesday+2's for the second week.
    expect(bills(s, owner.id)).toHaveLength(2);
    expect(owner.ledgers()[0]).toMatchObject({
      overdueCents: 1500,
      billDue: { amountCents: 1500, dueAt: s.at("Wed+3 18:00") },
    });
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
    expect(s.notifier.sentTo(reviewer).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
  });

  test("a payment made before the bill pays it at once", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await missedWeek(s);
    const paid = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    await reviewer.decide(paid, { kind: "approve" });
    await s.advanceTo("Wed+2 18:00");
    // Nothing to pay on Wednesday+1's bill, so only the second week's is announced.
    expect(bills(s, owner.id).map((n) => n.payload.title)).toEqual(["New bill: $15 to Sam"]);
    expect(owner.ledgers()[0]).toMatchObject({
      overdueCents: 0,
      billDue: { amountCents: 1500, dueAt: s.at("Wed+3 18:00") },
    });
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
    const cards = today.sections.flatMap((section) => (section.kind === "to-do" ? section.cards : []));
    expect(cards.filter((card) => card.kind === "bill")).toEqual([]);
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

  test("the alert names the reviewers only once the core has told them", async () => {
    const s = scenario();
    const { owner } = await missedWeek(s);
    await s.advanceTo("Wed+2 17:59");
    // Past the due time, before the scheduler's next tick has told anyone.
    s.setClockTo("Wed+2 18:00");
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", overdueCents: 1500, reviewerNames: [] }]);

    await s.advanceTo("Wed+2 18:00");
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", reviewerNames: ["reviewer", "second"] }]);
    // Still named between the weekly notices.
    await s.advanceTo("Sat+2 18:00");
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", reviewerNames: ["reviewer", "second"] }]);
  });

  test("a reviewer with overdue notifications off isn't named: the core never tells them", async () => {
    const s = scenario();
    const { owner, second } = await missedWeek(s);
    await second.setNotificationSetting("overdue-bill", false);
    await s.advanceTo("Wed+2 18:00");
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", reviewerNames: ["reviewer"] }]);
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

  test("a new Overdue spell after the last was paid off reminds the owner and tells the reviewers at once", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam } = await missedWeek(s);
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill");
    const told = (account: AccountHandle) => s.notifier.sentTo(account).filter((n) => n.kind === "overdue-bill");
    // Wednesday+1's $15 is covered by a payment at its due time; rejected Thursday+2 20:00, it goes Overdue.
    s.setClockTo("Wed+2 17:00");
    const rejected = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    await s.advanceTo("Wed+2 18:00");
    s.setClockTo("Thu+2 20:00");
    await reviewer.decide(rejected, { kind: "reject", reason: "That's a different account" });
    for (const day of ["Thu+2", "Fri+2", "Sat+2", "Sun+2", "Mon+3", "Tue+3"]) await s.advanceTo(`${day} 20:00`);
    expect(reminders()).toHaveLength(6);
    expect(told(reviewer)).toHaveLength(1);

    // Paid off Tuesday+3 21:00: the spell is over.
    s.setClockTo("Tue+3 21:00");
    const paid = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    await reviewer.decide(paid, { kind: "approve" });
    await s.advanceTo("Tue+3 21:00");
    expect(owner.today().alerts).toEqual([]);

    // Wednesday+2's bill falls due 21 hours later: a new spell. Until the core tells them, the alert names nobody.
    await s.advanceTo("Wed+3 17:59");
    s.setClockTo("Wed+3 18:00");
    expect(owner.today().alerts).toMatchObject([{ kind: "bill-overdue", billedOn: "2026-01-21", reviewerNames: [] }]);
    await s.advanceTo("Wed+3 18:00");
    expect(owner.today().alerts).toMatchObject([
      { kind: "bill-overdue", overdueCents: 1500, billedOn: "2026-01-21", reviewerNames: ["reviewer", "second"] },
    ]);
    expect(reminders()).toHaveLength(7);
    expect(told(reviewer)).toHaveLength(2);
    expect(told(second)).toHaveLength(2);
    // Then daily and weekly from the new spell.
    await s.advanceTo("Thu+3 17:59");
    expect(reminders()).toHaveLength(7);
    await s.advanceTo("Thu+3 18:00");
    expect(reminders()).toHaveLength(8);
    expect(told(reviewer)).toHaveLength(2);
  });

  test("a payment covering an Overdue bill pauses the spell; rejected, it resumes and the reviewers aren't told again", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await missedWeek(s);
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill");
    const told = () => s.notifier.sentTo(reviewer).filter((n) => n.kind === "overdue-bill");
    await s.advanceTo("Wed+2 18:00");
    expect([reminders().length, told().length]).toEqual([1, 1]);

    s.setClockTo("Thu+2 10:00");
    const payment = await recordPayment(owner, { recipientId: sam.id, amountCents: 1500 });
    await s.advanceTo("Thu+2 11:00");
    s.setClockTo("Thu+2 12:00");
    await reviewer.decide(payment, { kind: "reject", reason: "That's a different account" });
    await s.advanceTo("Thu+2 12:00");
    // Today's reminder went at Wednesday+2 18:00, and the reviewers were told then.
    expect([reminders().length, told().length]).toEqual([1, 1]);
    await s.advanceTo("Thu+2 18:00");
    expect([reminders().length, told().length]).toEqual([2, 1]);
  });

  test("overdue state survives a restart: no second reminder the same day", async () => {
    const s = scenario();
    const { owner } = await missedWeek(s);
    await s.advanceTo("Wed+2 18:00");
    await s.restart();
    await s.advanceTo("Wed+2 20:00");
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "overdue-bill")).toHaveLength(1);
  });

  test('alerts, bill cards and the reviewers they name go by name as everywhere: "alice" before "Bob"', async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const bob = await s.befriend(owner, "Bob");
    const alice = await s.befriend(owner, "alice");
    const toBob = await owner.addRecipient({ name: "Bob" });
    const toAlice = await owner.addRecipient({ name: "alice" });
    if (!toBob.ok || !toAlice.ok) throw new Error("recipient refused");
    await createPact("Gym", MON_WED_FRI, { reviewers: [bob, alice], recipientId: toBob.recipient.id });
    await createPact("Run", MON_WED_FRI, { reviewers: [bob, alice], recipientId: toAlice.recipient.id });
    await s.advanceTo("Wed+2 18:00");

    const today = owner.today();
    const cards = today.sections.flatMap((section) => (section.kind === "to-do" ? section.cards : []));
    expect(cards.flatMap((card) => (card.kind === "bill" ? [card.recipientName] : []))).toEqual(["alice", "Bob"]);
    expect(today.alerts).toEqual([
      expect.objectContaining({ kind: "bill-overdue", recipientName: "alice", reviewerNames: ["alice", "Bob"] }),
      expect.objectContaining({ kind: "bill-overdue", recipientName: "Bob", reviewerNames: ["alice", "Bob"] }),
    ]);
  });
});
