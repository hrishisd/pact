// Every 2 weeks and Once a month: Camera pacts whose occurrence is a period of
// two Mon–Sun weeks, or a calendar month, Satisfied by one approved photo on
// any day of it and due at the end of its last day. The first period is the
// one that has the day the pact is made, unless it's due within the hour, or
// the first from the start date. The pact is quiet (Today's Later section, no
// reminders) until the period's last 7 days, or the 7 days before a trip ahead.

import { describe, expect, test } from "vitest";
import type { NewPact, Schedule } from "../shared/types.ts";
import { bedtimePact, ownerWithOura } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import { cards, changed, ok, owed, pactOf, penalties } from "./testing/queries.ts";
import type { AccountHandle, Scenario } from "./testing/scenario.ts";
import { scenario } from "./testing/scenario.ts";

// The reference week starts Mon Jan 5 2026, the day the pacts are made, so
// January is "this month" and runs to Sat Jan 31 ("Sat+3"); February runs
// from Sun Feb 1 ("Sun+3") to Sat Feb 28 ("Sat+7").

const MONTHLY: Schedule = { kind: "once-a-month" };
const FORTNIGHTLY: Schedule = { kind: "every-2-weeks" };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The scenario day `n` days after Mon Jan 5: "Tue" for 1, "Mon+1" for 7. */
function dayAfterStart(n: number): string {
  return `${DAYS[n % 7]}+${Math.floor(n / 7)}`;
}

function periodsOf(owner: AccountHandle, pactId: string) {
  const { history } = pactOf(owner, pactId);
  if (history.kind !== "periods") throw new Error(`a ${history.kind} heat map`);
  return history.periods;
}

function statusOf(owner: AccountHandle, pactId: string, date: string) {
  return periodsOf(owner, pactId).find((period) => period.date === date)?.occurrence?.status.kind;
}

/** Moves the clock across each day's 18:00 from Tue Jan 6 through the `days`th day after Mon Jan 5. */
async function throughDays(s: Scenario, days: number, onDay?: (day: string) => Promise<void>) {
  for (let n = 1; n <= days; n++) {
    const day = dayAfterStart(n);
    await onDay?.(day);
    await s.advanceTo(`${day} 17:55`);
    await s.advanceTo(`${day} 18:05`);
  }
}

function reminderDays(s: Scenario, owner: AccountHandle) {
  return s.notifier.sentTo(owner, "reminder").map((n) => n.payload.occurrenceDate);
}

describe("the first period", () => {
  test("Once a month made Mon Jan 5 is January; from a start date in the month, the next month", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const call = await createPact("Call Grandma", MONTHLY);
    const later = await createPact("Clean the fridge", MONTHLY, { dates: { startDate: "2026-01-20" } });

    expect(pactOf(owner, call).firstOccurrence).toEqual({ date: "2026-01-01", dueAt: s.at("Sun+3 00:00") });
    expect(pactOf(owner, later).firstOccurrence).toEqual({ date: "2026-02-01", dueAt: s.at("2026-03-01T05:00:00Z") });
    expect(owner.firstOccurrence({ schedule: MONTHLY })).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-01", dueAt: s.at("Sun+3 00:00") },
      offered: {
        current: { date: "2026-01-01", dueAt: s.at("Sun+3 00:00"), daysLeft: 27 },
        next: { date: "2026-02-01", dueAt: s.at("2026-03-01T05:00:00Z") },
      },
    });
  });

  test("the days left count calendar days in the owner's timezone, across the clocks going back too", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewers(s);
    // 00:30 on Sun Nov 1 in New York, before the clocks go back at 02:00: November has a 25-hour day.
    s.setClockTo("2026-11-01T04:30:00Z");

    expect(ok(owner.firstOccurrence({ schedule: MONTHLY })).offered?.current).toMatchObject({
      date: "2026-11-01",
      daysLeft: 30,
    });
  });

  test("made at 23:30 on the month's last day, it's the next month, and this one isn't offered", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Sat+3 23:30");

    const call = await createPact("Call Grandma", MONTHLY);

    expect(pactOf(owner, call).firstOccurrence.date).toBe("2026-02-01");
    expect(owner.firstOccurrence({ schedule: MONTHLY })).toMatchObject({
      offered: { current: null, next: { date: "2026-02-01" } },
    });
  });

  test("Every 2 weeks made Tue starts this Monday, and the periods follow with no gap; from a start date, the first Monday on or after it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Tue 09:00");
    expect(ok(owner.firstOccurrence({ schedule: FORTNIGHTLY })).offered).toEqual({
      current: { date: s.date("Mon"), dueAt: s.at("Mon+2 00:00"), daysLeft: 13 },
      next: { date: s.date("Mon+1"), dueAt: s.at("Mon+3 00:00") },
    });

    const fridge = await createPact("Fridge", FORTNIGHTLY);
    const later = await createPact("Car", FORTNIGHTLY, { dates: { startDate: s.date("Wed+1") } });

    expect(pactOf(owner, fridge).firstOccurrence).toEqual({ date: s.date("Mon"), dueAt: s.at("Mon+2 00:00") });
    expect(pactOf(owner, later).firstOccurrence).toEqual({ date: s.date("Mon+2"), dueAt: s.at("Mon+4 00:00") });
    // A start date of today that isn't a Monday is the first Monday after it.
    const today = await createPact("Bins", FORTNIGHTLY, { dates: { startDate: s.date("Tue") } });
    expect(pactOf(owner, today).firstOccurrence.date).toBe(s.date("Mon+1"));
    await s.advanceTo("Tue+4 09:00");
    expect(periodsOf(owner, fridge).map((period) => period.date)).toEqual([
      s.date("Mon"),
      s.date("Mon+2"),
      s.date("Mon+4"),
    ]);
  });
});

describe("judging a period", () => {
  test("one approved photo on any day Satisfies the month; a month with none is Missed with one penalty, named by the month", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Wed+2 10:00");
    await reviewer.decide(await submit(owner, call), { kind: "approve" });
    await s.advanceTo("Mon+8 09:00");

    expect(statusOf(owner, call, "2026-01-01")).toBe("satisfied");
    expect(statusOf(owner, call, "2026-02-01")).toBe("missed");
    expect(penalties(owner)).toEqual([expect.objectContaining({ date: "2026-02-01", cents: 500 })]);
    expect(s.notifier.sentTo(owner, "missed-occurrence").map((n) => n.payload.body)).toEqual([
      "February · $5 penalty to Sam",
    ]);
  });

  test("a rejected photo can be made up on another day of the month", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Tue+1 10:00");
    await reviewer.decide(await submit(owner, call), { kind: "reject", reason: "Blurry" });
    expect(owed(owner)).toBe(0);
    s.setClockTo("Thu+1 10:00");
    await reviewer.decide(await submit(owner, call), { kind: "approve" });
    await s.advanceTo("Mon+4 09:00");

    expect(statusOf(owner, call, "2026-01-01")).toBe("satisfied");
    expect(owed(owner)).toBe(0);
  });

  test("an approved excuse for one day excuses the whole month", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Tue+1 10:00");
    ok(await owner.fileExcuse(call, { from: s.date("Wed+1"), to: s.date("Wed+1"), reason: "Hospital" }, []));
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });
    await s.advanceTo("Mon+4 09:00");

    expect(statusOf(owner, call, "2026-01-01")).toBe("excused");
    expect(owed(owner)).toBe(0);
  });

  test("Oura Ring and Anki pacts can't have them", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);
    const ring: NewPact = { ...bedtimePact(sam.id, reviewer), schedule: MONTHLY };

    expect(await owner.createPact(ring)).toEqual({ ok: false, reason: "invalid-schedule" });
    expect(await owner.createPact({ ...ring, schedule: FORTNIGHTLY })).toEqual({
      ok: false,
      reason: "invalid-schedule",
    });
  });
});

describe("vacations", () => {
  test("a vacation covers February only from the 15th to its end, and only filed before February opens", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY, { dates: { startDate: "2026-02-01" } });
    s.setClockTo("Mon 10:00");
    const preview = (from: string, to: string) => ok(owner.vacationPreview({ from, to, pactIds: [call] })).preview;

    expect(preview("2026-02-15", "2026-03-01").pacts[0]).toMatchObject({
      covered: [{ date: "2026-02-01", through: "2026-02-28" }],
      notCovered: [{ date: "2026-03-01", through: "2026-03-31" }],
    });
    expect(preview("2026-02-16", "2026-03-01").pacts[0]).toMatchObject({
      covered: [],
      notCovered: [
        { date: "2026-02-01", through: "2026-02-28", doItBy: "2026-02-15" },
        { date: "2026-03-01", through: "2026-03-31" },
      ],
    });

    s.setClockTo("Tue+4 10:00");
    expect(preview("2026-02-14", "2026-03-01").pacts[0]).toMatchObject({
      covered: [],
      skipped: [{ date: "2026-02-01", reason: "already-open", doItBy: "2026-02-13" }],
    });
  });

  test("an approved vacation that covers February Excuses it, with no penalty", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY, { dates: { startDate: "2026-02-01" } });
    s.setClockTo("Mon 10:00");
    const { vacationId } = ok(
      await owner.fileVacation({ from: "2026-02-15", to: "2026-03-01", pactIds: [call], reviewerIds: [reviewer.id] }),
    );
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    await s.advanceTo("Mon+8 09:00");
    expect(statusOf(owner, call, "2026-02-01")).toBe("excused");
    expect(owed(owner)).toBe(0);
  });

  test("a vacation covers two weeks only if it covers their whole second week", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const fridge = await createPact("Fridge", FORTNIGHTLY, { dates: { startDate: s.date("Mon+1") } });
    s.setClockTo("Mon 10:00");
    const preview = (from: string, to: string) => ok(owner.vacationPreview({ from, to, pactIds: [fridge] })).preview;

    expect(preview(s.date("Mon+2"), s.date("Sun+2")).pacts[0]).toMatchObject({
      covered: [{ date: s.date("Mon+1"), through: s.date("Sun+2") }],
    });
    expect(preview(s.date("Tue+2"), s.date("Sun+2")).pacts[0]).toMatchObject({
      covered: [],
      notCovered: [{ date: s.date("Mon+1"), doItBy: s.date("Mon+2") }],
    });
  });
});

describe("the reminder window", () => {
  test("reminders go off only in the month's last 7 days, until a photo is in", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY, { reminders: ["18:00"] });

    await throughDays(s, 26, async (day) => {
      if (day === "Thu+3") {
        s.setClockTo("Thu+3 09:00");
        await submit(owner, call);
      }
    });

    expect(reminderDays(s, owner)).toEqual(["2026-01-25", "2026-01-26", "2026-01-27", "2026-01-28"]);
    expect(s.notifier.sentTo(owner, "reminder")[0]?.payload.body).toBe("Due Sat Jan 31. 7 days left.");
  });

  test("Today shows the month under Later until its last 7 days, then under To do", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Sat+2 10:00");
    expect(cards(owner, "later")).toEqual([
      expect.objectContaining({
        pactId: call,
        occurrenceDate: "2026-01-01",
        dueAt: s.at("Sun+3 00:00"),
        period: { scheduleKind: "once-a-month", sessions: 0, waiting: 0, target: 1 },
      }),
    ]);
    expect(cards(owner, "to-do")).toEqual([]);

    s.setClockTo("Sun+2 10:00");
    expect(cards(owner, "later")).toEqual([]);
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId: call })]);

    await submit(owner, call);
    expect(cards(owner, "to-do")).toEqual([]);
  });

  test("a photo in before the last 7 days takes the month off Today", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Tue 10:00");
    await submit(owner, call);
    expect(cards(owner, "later")).toEqual([]);
    s.setClockTo("Sun+2 10:00");
    expect(cards(owner, "to-do")).toEqual([]);
  });

  /**
   * Call Grandma, monthly with an 18:00 reminder, and a waiting trip that
   * doesn't cover January, by default from Wed Jan 28 to Thu Feb 5.
   */
  async function withTrip(s: Scenario, from = "Wed+3", to = "Thu+4") {
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY, { reminders: ["18:00"] });
    // A trip that covers none of the pacts ticked can't be filed.
    const gym = await createPact("Gym", MON_WED_FRI);
    const vacation = { from: s.date(from), to: s.date(to), pactIds: [call, gym], reviewerIds: [reviewer.id] };
    s.setClockTo("Mon 10:00");
    const { vacationId } = ok(await owner.fileVacation(vacation));
    return { owner, reviewer, call, vacationId };
  }

  const LAST_7_DAYS = [
    "2026-01-25",
    "2026-01-26",
    "2026-01-27",
    "2026-01-28",
    "2026-01-29",
    "2026-01-30",
    "2026-01-31",
  ];
  const BEFORE_TRIP = [
    "2026-01-21",
    "2026-01-22",
    "2026-01-23",
    "2026-01-24",
    "2026-01-25",
    "2026-01-26",
    "2026-01-27",
  ];

  test("a trip ahead that doesn't cover the month moves the To do card to the 7 days before it", async () => {
    const s = scenario();
    const { owner, call } = await withTrip(s);
    const trip = { period: "2026-01-01", firstDay: s.date("Wed+3"), lastDay: s.date("Thu+4"), doItBy: s.date("Tue+3") };

    s.setClockTo("Tue+2 10:00");
    expect(cards(owner, "later").map((card) => card.pactId)).toEqual([call]);
    s.setClockTo("Wed+2 10:00");
    expect(cards(owner, "to-do").find((card) => "pactId" in card && card.pactId === call)).toMatchObject({
      tripAhead: trip,
    });
    expect(pactOf(owner, call).tripAhead).toEqual(trip);

    // Once it starts, the advice is gone, and the month is due as ever.
    s.setClockTo("Wed+3 10:00");
    expect(pactOf(owner, call).tripAhead).toBeNull();
    const card = cards(owner, "to-do").find((c) => "pactId" in c && c.pactId === call);
    expect(card).toBeDefined();
    expect(card).not.toHaveProperty("tripAhead");
  });

  test("a trip ahead moves the reminders to the 7 days before it, and none go off once it starts", async () => {
    const s = scenario();
    const { owner } = await withTrip(s);

    await throughDays(s, 26);
    expect(reminderDays(s, owner)).toEqual(BEFORE_TRIP);
    expect(s.notifier.sentTo(owner, "reminder")[0]?.payload.body).toBe("Do it before your trip: by Tue Jan 27.");
  });

  test("a trip that ends before the month does: reminders before it, and again once the owner is back", async () => {
    const s = scenario();
    const { owner } = await withTrip(s, "Tue+2", "Mon+3");

    await throughDays(s, 26);
    expect(reminderDays(s, owner)).toEqual([
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
      "2026-01-19",
      "2026-01-27",
      "2026-01-28",
      "2026-01-29",
      "2026-01-30",
      "2026-01-31",
    ]);
  });

  test("an approved trip moves them too", async () => {
    const s = scenario();
    const { owner, reviewer, call, vacationId } = await withTrip(s);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    expect(pactOf(owner, call).tripAhead).toMatchObject({ doItBy: s.date("Tue+3") });
    await throughDays(s, 26);
    expect(reminderDays(s, owner)).toEqual(BEFORE_TRIP);
  });

  test("a withdrawn trip, a rejected one, and one that misses the month's last 7 days leave them where they were", async () => {
    for (const [how, from, to] of [
      ["withdrawn", "Wed+3", "Thu+4"],
      ["rejected", "Wed+3", "Thu+4"],
      ["waiting", "Mon+1", "Fri+1"],
    ] as const) {
      const s = scenario();
      const { owner, reviewer, call, vacationId } = await withTrip(s, from, to);
      if (how === "withdrawn") ok(await owner.withdrawVacation(vacationId));
      if (how === "rejected") ok(await reviewer.decide(vacationId, { kind: "reject", reason: "No" }));

      expect(pactOf(owner, call).tripAhead, how).toBeNull();
      await throughDays(s, 26);
      expect(reminderDays(s, owner), how).toEqual(LAST_7_DAYS);
    }
  });

  test("Every 2 weeks reminds through the whole second week", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Fridge", FORTNIGHTLY, { reminders: ["18:00"] });

    await throughDays(s, 13);

    expect(reminderDays(s, owner)).toEqual([
      s.date("Mon+1"),
      s.date("Tue+1"),
      s.date("Wed+1"),
      s.date("Thu+1"),
      s.date("Fri+1"),
      s.date("Sat+1"),
      s.date("Sun+1"),
    ]);
  });
});

describe("changing and ending", () => {
  test("a lower penalty approved mid-month applies from the next month", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Wed+1 09:00");
    const sent = await owner.changePact(call, changed(owner, call, { penaltyCents: 200 }));
    expect(sent).toMatchObject({ ok: true, outcome: { kind: "needs-approval" } });
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });

    expect(pactOf(owner, call).newTerms).toMatchObject({ appliesFrom: "2026-02-01" });
  });

  test("an end request takes effect when the month closes", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Wed+1 09:00");
    ok(await owner.requestEnd(call));
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });

    expect(pactOf(owner, call)).toMatchObject({ stage: "active", endDate: "2026-01-31" });
    await s.advanceTo("Sun+3 00:05");
    expect(pactOf(owner, call).stage).toBe("ended");
  });

  test("an end request ends the pact once the month closes, after the owner moves east too", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);
    s.setClockTo("Wed+1 09:00");
    ok(await owner.requestEnd(call));
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });
    s.setClockTo("Thu+1 09:00");
    await owner.setTimezone("Europe/London");

    // 01:00 on Feb 1 in London, but January was worked out in New York, where it's still open.
    await s.advanceTo("Sat+3 20:00");
    expect(pactOf(owner, call).stage).toBe("active");
    await s.advanceTo("Sun+3 00:05");
    expect(pactOf(owner, call).stage).toBe("ended");
    expect(penalties(owner).map((penalty) => penalty.date)).toEqual(["2026-01-01"]);
  });

  test("on Every 2 weeks, a change applies from the next two weeks, and an end request ends the pact when these close", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const fridge = await createPact("Fridge", FORTNIGHTLY);

    s.setClockTo("Wed+1 09:00");
    ok(await owner.changePact(fridge, changed(owner, fridge, { penaltyCents: 200 })));
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });
    expect(pactOf(owner, fridge).newTerms).toMatchObject({ appliesFrom: s.date("Mon+2") });

    ok(await owner.requestEnd(fridge));
    await reviewer.decide(reviewer.reviewQueue()[0]!.id, { kind: "approve" });
    expect(pactOf(owner, fridge)).toMatchObject({ stage: "active", endDate: s.date("Sun+1") });
    await s.advanceTo("Mon+2 00:05");
    expect(pactOf(owner, fridge).stage).toBe("ended");
  });

  test("an end date counts only whole months", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY, { dates: { endDate: "2026-02-20" } });

    await s.advanceTo("Mon+8 09:00");

    expect(periodsOf(owner, call).map((period) => period.date)).toEqual(["2026-01-01"]);
  });
});

describe("photos", () => {
  test("a photo is taken any day of the period, at most one counting a day", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const call = await createPact("Call Grandma", MONTHLY);

    s.setClockTo("Tue 10:00");
    await submit(owner, call);
    expect(await owner.submitEvidence(call, [photo()])).toEqual({ ok: false, reason: "evidence-waiting" });
  });
});
