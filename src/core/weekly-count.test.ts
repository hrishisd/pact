// Weekly count: a Camera pact with a target per Mon–Sun week (e.g. 3× per
// week), the owner choosing which days. The week is one occurrence, from the
// week starting the Monday after creation. Evidence counts on any day of it,
// at most one day a day; the week is judged at the end of Sunday, with one
// penalty per day short of the target. A rejected photo just doesn't count:
// the owner can make it up another day that week. An approved excuse for any
// day excuses the whole week.

import { describe, expect, test } from "vitest";
import type { NewPact, PactChange, Schedule, TodayToDoCard } from "../shared/types.ts";
import { bedtimePact, ownerWithOura } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import type { AccountHandle, Scenario } from "./testing/scenario.ts";
import { scenario } from "./testing/scenario.ts";

// The pact is made in the reference week; its first week is the next one.
const WEEK_1 = "2026-01-12";
const TUESDAY_1 = "2026-01-13";
const THURSDAY_1 = "2026-01-15";
const FRIDAY_1 = "2026-01-16";
const SUNDAY_1 = "2026-01-18";
const WEEK_2 = "2026-01-19";
const WEEK_3 = "2026-01-26";
const DAY_MS = 24 * 3600_000;

const weekly = (target: number): Schedule => ({ kind: "weekly-count", target });

function pactOf(owner: AccountHandle, pactId: string) {
  const result = owner.pact(pactId);
  if (!result.ok) throw new Error(result.reason);
  return result.pact;
}

function weeksOf(owner: AccountHandle, pactId: string) {
  const { history } = pactOf(owner, pactId);
  if (history.kind !== "weekly-count") throw new Error(`a ${history.kind} heat map`);
  return history.weeks;
}

function weekOf(owner: AccountHandle, pactId: string, monday: string) {
  const week = weeksOf(owner, pactId).find((w) => w.date === monday);
  if (!week) throw new Error(`no week ${monday}`);
  return week;
}

function owed(owner: AccountHandle): number {
  return owner.ledgers()[0]?.owedCents ?? 0;
}

/** Submits a photo now as `owner`; returns the evidence's id, or throws if it's refused. */
async function submit(owner: AccountHandle, pactId: string): Promise<string> {
  const submitted = await owner.submitEvidence(pactId, [photo()]);
  if (!submitted.ok) throw new Error(submitted.reason);
  return submitted.evidenceId;
}

/** At `when`, the owner submits a photo and `reviewer` approves it. */
async function sessionAt(s: Scenario, when: string, owner: AccountHandle, reviewer: AccountHandle, pactId: string) {
  s.setClockTo(when);
  await reviewer.decide(await submit(owner, pactId), { kind: "approve" });
}

function toDoCards(owner: AccountHandle) {
  return owner.today().sections.find((section) => section.kind === "to-do")?.cards ?? [];
}

function reminderDays(s: Scenario, owner: AccountHandle) {
  return s.notifier
    .sentTo(owner)
    .filter((n) => n.kind === "reminder")
    .map((n) => n.payload.occurrenceDate);
}

/** The pact's terms as they stand, with `change` made, as the Request change form sends them. */
function changed(owner: AccountHandle, pactId: string, change: Partial<PactChange>): PactChange {
  const pact = pactOf(owner, pactId);
  return {
    name: pact.name,
    description: pact.description,
    ...(pact.evidenceKind !== "oura" && pact.dueBy !== null && { dueBy: pact.dueBy }),
    schedule: pact.schedule,
    penaltyCents: pact.penaltyCents,
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((r) => r.id),
    ...change,
  };
}

describe("the spec's examples", () => {
  test("a 3× week with three photos submitted and one rejected adds one penalty; a week with no photos adds three", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));

    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    await sessionAt(s, "Tue+1 10:00", owner, reviewer, piano);
    s.setClockTo("Wed+1 10:00");
    await reviewer.decide(await submit(owner, piano), { kind: "reject", reason: "That's Tuesday's photo" });
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, WEEK_1)).toEqual({
      date: WEEK_1,
      progress: { sessions: 2, waiting: 0, target: 3 },
      occurrence: {
        status: {
          kind: "missed",
          penaltyCents: 500,
          held: false,
          excusableUntil: new Date(s.at("Mon+2 00:00").getTime() + 2 * DAY_MS),
        },
        decidedBy: null,
        recipientName: "Sam",
      },
    });
    expect(owed(owner)).toBe(500);
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "missed-occurrence")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ occurrenceDate: WEEK_1, body: "Week of Mon Jan 12 · 1 short · $5 to Sam" }),
      }),
    ]);

    await s.advanceTo("Mon+3 00:00");

    expect(weekOf(owner, piano, WEEK_2)).toMatchObject({
      progress: { sessions: 0, waiting: 0, target: 3 },
      occurrence: { status: { kind: "missed", penaltyCents: 1500 } },
    });
    expect(owed(owner)).toBe(2000);
    const ledger = owner.ledger(owner.ledgers()[0]!.recipientId);
    if (!ledger.ok) throw new Error(ledger.reason);
    expect(ledger.ledger.history).toEqual([
      expect.objectContaining({
        occurrenceDate: WEEK_2,
        amountCents: 1500,
        week: { sessions: 0, waiting: 0, target: 3 },
      }),
      expect.objectContaining({
        occurrenceDate: WEEK_1,
        amountCents: 500,
        week: { sessions: 2, waiting: 0, target: 3 },
      }),
    ]);
    // A short week isn't Missed through its rejected photo: it's the week's own miss.
    expect(ledger.ledger.history[1]).not.toHaveProperty("rejection");
  });

  test("lowering the target, approved Wednesday, applies from next Monday; this week keeps its target", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    await sessionAt(s, "Tue+1 10:00", owner, reviewer, piano);

    s.setClockTo("Wed+1 09:00");
    const sent = await owner.changePact(piano, changed(owner, piano, { schedule: weekly(2) }));
    expect(sent).toMatchObject({ ok: true, outcome: { kind: "needs-approval" } });
    const [item] = reviewer.reviewQueue();
    expect(item).toMatchObject({
      kind: "change-request",
      changes: [{ term: "schedule", before: weekly(3), after: weekly(2), effect: "needs-approval" }],
      appliesFrom: WEEK_2,
    });
    await reviewer.decide(item!.id, { kind: "approve" });

    expect(pactOf(owner, piano)).toMatchObject({ schedule: weekly(2), newTerms: { startsOn: WEEK_2 } });
    expect(s.notifier.sentTo(owner).find((n) => n.kind === "change-request-decided")?.payload.body).toBe(
      "Piano · New terms start Mon Jan 19",
    );

    await s.advanceTo("Mon+2 00:00");
    expect(weekOf(owner, piano, WEEK_1)).toMatchObject({
      progress: { sessions: 2, target: 3 },
      occurrence: { status: { kind: "missed", penaltyCents: 500 } },
    });
    await sessionAt(s, "Mon+2 10:00", owner, reviewer, piano);
    await sessionAt(s, "Fri+2 10:00", owner, reviewer, piano);
    await s.advanceTo("Mon+3 00:00");
    expect(weekOf(owner, piano, WEEK_2)).toMatchObject({
      progress: { sessions: 2, target: 2 },
      occurrence: { status: { kind: "satisfied" } },
    });
    expect(owed(owner)).toBe(500);
  });
});

describe("the first occurrence", () => {
  test("made on Wednesday, the first occurrence is next Monday's week, due at the end of its Sunday; nothing is owed for this week", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Wed 10:00");

    const piano = await createPact("Piano", weekly(3));

    expect(pactOf(owner, piano).firstOccurrence).toEqual({ date: WEEK_1, dueAt: s.at("Mon+2 00:00") });
    expect(owner.firstOccurrence({ schedule: weekly(3) })).toEqual({
      ok: true,
      firstOccurrence: { date: WEEK_1, dueAt: s.at("Mon+2 00:00") },
    });
    s.setClockTo("Thu 10:00");
    expect(await owner.submitEvidence(piano, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(owner.today().sections).toEqual([
      {
        kind: "coming-up",
        cards: [
          {
            pactId: piano,
            name: "Piano",
            penaltyCents: 500,
            editWindowClosesAt: null,
            opensOn: WEEK_1,
            startDate: null,
          },
        ],
      },
    ]);
    await s.advanceTo("Mon+1 00:00");
    expect(owed(owner)).toBe(0);
    expect(weeksOf(owner, piano).map((w) => w.date)).toEqual([WEEK_1]);
  });

  test("made on a Monday, it's still the week starting the Monday after", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const piano = await createPact("Piano", weekly(1));

    expect(pactOf(owner, piano).firstOccurrence.date).toBe(WEEK_1);
  });

  test("a start date pushes it to the first week starting on or after it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const piano = await createPact("Piano", weekly(2), { dates: { startDate: "2026-01-14" } });

    expect(pactOf(owner, piano).firstOccurrence.date).toBe(WEEK_2);
  });
});

describe("making a Weekly count pact", () => {
  test("is Camera only, with a whole-number target from 1 to 7", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    const piano: NewPact = {
      evidenceKind: "camera",
      name: "Piano",
      description: "A photo of the practice log",
      schedule: weekly(3),
      penaltyCents: 300,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    };

    for (const target of [0, 8, 2.5]) {
      expect(await owner.createPact({ ...piano, schedule: weekly(target) })).toEqual({
        ok: false,
        reason: "invalid-schedule",
      });
    }
    expect(await owner.createPact({ ...piano, schedule: weekly(7) })).toMatchObject({ ok: true });
    const pact = pactOf(owner, await createPact("Gym", weekly(3)));
    expect(pact.schedule).toEqual(weekly(3));
    expect(owner.pacts().find((p) => p.name === "Gym")?.schedule).toEqual(weekly(3));
  });

  test("an Oura Ring pact can't have one", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);

    const created = await owner.createPact({ ...bedtimePact(sam.id, reviewer, "23:00", []), schedule: weekly(5) });

    expect(created).toEqual({ ok: false, reason: "invalid-schedule" });
  });

  test("in the edit window, Fixed days can become Weekly count", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const pact = pactOf(owner, gym);

    const edited = await owner.editPact(gym, {
      evidenceKind: "camera",
      name: pact.name,
      description: pact.description,
      schedule: weekly(2),
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    });

    expect(edited).toEqual({ ok: true });
    expect(pactOf(owner, gym)).toMatchObject({ schedule: weekly(2), firstOccurrence: { date: WEEK_1 } });
  });
});

describe("evidence", () => {
  test("counts on any day of the week; two photos on the same day count once", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));

    s.setClockTo("Sat+1 09:00");
    const first = await submit(owner, piano);
    expect(await owner.submitEvidence(piano, [photo(2)])).toEqual({ ok: false, reason: "evidence-waiting" });
    await reviewer.decide(first, { kind: "approve" });
    s.setClockTo("Sat+1 20:00");
    expect(await owner.submitEvidence(piano, [photo(3)])).toEqual({ ok: false, reason: "already-approved" });
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, WEEK_1)).toMatchObject({
      progress: { sessions: 1, waiting: 0, target: 2 },
      occurrence: { status: { kind: "missed", penaltyCents: 500 } },
    });
  });

  test("records the day it counts for", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));

    s.setClockTo("Thu+1 19:00");
    const evidenceId = await submit(owner, piano);

    expect(owner.today().waiting).toEqual([
      expect.objectContaining({ kind: "evidence", id: evidenceId, occurrenceDate: THURSDAY_1 }),
    ]);
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({
        kind: "evidence",
        id: evidenceId,
        occurrenceDate: THURSDAY_1,
        week: { sessions: 0, waiting: 1, target: 2 },
      }),
    ]);
    expect(owner.evidence(evidenceId)).toMatchObject({ ok: true, evidence: { occurrenceDate: THURSDAY_1 } });
  });

  test("a due-by time limits each day's evidence, but the week is still judged at the end of Sunday", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { dueBy: "21:00" } });

    s.setClockTo("Tue+1 21:00");
    expect(await owner.submitEvidence(piano, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(toDoCards(owner)).toEqual([]);
    await s.advanceTo("Sun+1 20:00");
    await sessionAt(s, "Sun+1 20:59", owner, reviewer, piano);
    await s.advanceTo("Sun+1 21:00");
    expect(weekOf(owner, piano, WEEK_1).occurrence?.status.kind).toBe("not-judged");
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, WEEK_1).occurrence?.status).toEqual({ kind: "satisfied" });
  });

  test("evidence waiting for a decision at the end of Sunday holds the outcome until it's decided", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);

    await s.advanceTo("Tue+2 10:00");
    expect(weekOf(owner, piano, WEEK_1)).toMatchObject({
      progress: { sessions: 1, waiting: 1, target: 2 },
      occurrence: { status: { kind: "not-judged", evidenceWaiting: true } },
    });
    expect(owed(owner)).toBe(0);
    await reviewer.decide(late, { kind: "reject", reason: "Blurry" });

    expect(weekOf(owner, piano, WEEK_1).occurrence?.status).toEqual({
      kind: "missed",
      penaltyCents: 500,
      held: false,
      excusableUntil: new Date(s.at("Tue+2 10:00").getTime() + 2 * DAY_MS),
    });
    expect(owed(owner)).toBe(500);
    // Judged by now, the week has its own Missed card instead of the rejection's alert.
    expect(owner.today().alerts).toEqual([]);
  });

  test("approved after Sunday, the late evidence makes the week Satisfied", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1));
    s.setClockTo("Sun+1 23:00");
    const late = await submit(owner, piano);
    await s.advanceTo("Mon+2 09:00");

    await reviewer.decide(late, { kind: "approve" });

    expect(weekOf(owner, piano, WEEK_1).occurrence?.status).toEqual({ kind: "satisfied" });
    expect(owed(owner)).toBe(0);
  });
});

describe("a rejected photo", () => {
  test("rejected Tuesday: nothing Missed or owed yet, an alert to make it up by Sunday, Take the L clears it, and Wednesday's photo still counts", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1));

    s.setClockTo("Tue+1 10:00");
    await reviewer.decide(await submit(owner, piano), { kind: "reject", reason: "That's last week's log" });

    expect(owed(owner)).toBe(0);
    expect(weekOf(owner, piano, WEEK_1).occurrence?.status.kind).toBe("not-judged");
    const today = owner.today();
    expect(today.alerts).toEqual([
      {
        kind: "evidence-rejected",
        pactId: piano,
        name: "Piano",
        reviewerName: "reviewer",
        reason: "That's last week's log",
        occurrenceDate: TUESDAY_1,
        penaltyCents: 500,
        recipientName: "Sam",
        excusableUntil: new Date(s.at("Mon+2 00:00").getTime() + 2 * DAY_MS),
        week: { dueAt: s.at("Mon+2 00:00") },
      },
    ]);
    expect(today.sections.find((section) => section.kind === "missed")).toBeUndefined();
    // Tuesday is done: the week is made up on another day.
    expect(toDoCards(owner)).toEqual([]);
    expect(await owner.submitEvidence(piano, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });

    expect(await owner.acceptMiss(piano, TUESDAY_1)).toEqual({ ok: true });
    expect(owner.today().alerts).toEqual([]);
    expect(await owner.acceptMiss(piano, TUESDAY_1)).toEqual({ ok: false, reason: "nothing-to-accept" });

    await sessionAt(s, "Wed+1 10:00", owner, reviewer, piano);
    await s.advanceTo("Mon+2 00:00");
    expect(weekOf(owner, piano, WEEK_1)).toMatchObject({
      progress: { sessions: 1, target: 1 },
      occurrence: { status: { kind: "satisfied" } },
    });
    expect(owed(owner)).toBe(0);
  });

  test("the alert goes once the week is judged", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1));
    s.setClockTo("Tue+1 10:00");
    await reviewer.decide(await submit(owner, piano), { kind: "reject", reason: "Blurry" });

    await s.advanceTo("Mon+2 00:00");

    const today = owner.today();
    expect(today.alerts).toEqual([]);
    expect(today.sections.find((section) => section.kind === "missed")).toEqual({
      kind: "missed",
      cards: [
        {
          pactId: piano,
          name: "Piano",
          penaltyCents: 500,
          occurrenceDate: WEEK_1,
          missedAt: s.at("Mon+2 00:00"),
          excusableUntil: new Date(s.at("Mon+2 00:00").getTime() + 2 * DAY_MS),
          week: { sessions: 0, waiting: 0, target: 1 },
        },
      ],
    });
  });

  test("the reviewer's reject form is told that it doesn't cost anything yet", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Tue+1 10:00");
    await submit(owner, piano);

    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({ kind: "evidence", week: { sessions: 1, waiting: 1, target: 3 } }),
    ]);
  });
});

describe("excuses", () => {
  test("an approved excuse for Thursday excuses the whole week, with no penalties", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    s.setClockTo("Tue+1 10:00");

    const preview = owner.excusePreview(piano, { from: THURSDAY_1, to: THURSDAY_1 });
    expect(preview).toEqual({
      ok: true,
      preview: {
        covered: [
          {
            date: WEEK_1,
            through: SUNDAY_1,
            status: {
              kind: "not-judged",
              opensAt: s.at("Mon+1 00:00"),
              dueAt: s.at("Mon+2 00:00"),
              evidenceWaiting: false,
              excuse: null,
            },
          },
        ],
        skipped: [],
        heldCents: 0,
      },
    });
    const filed = await owner.fileExcuse(piano, { from: THURSDAY_1, to: THURSDAY_1, reason: "Recital" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    expect(toDoCards(owner)).toEqual([]);
    await reviewer.decide(filed.excuseId, { kind: "approve" });
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, WEEK_1).occurrence).toEqual({
      status: { kind: "excused" },
      decidedBy: { kind: "excuse-approved", reviewerName: "reviewer", reason: "Recital" },
      recipientName: null,
    });
    expect(owed(owner)).toBe(0);
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "missed-occurrence")).toEqual([]);
  });

  test("a short week can be excused within 48 hours, which removes all its penalties", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    await s.advanceTo("Mon+2 00:00");
    expect(owed(owner)).toBe(1500);

    s.setClockTo("Tue+2 10:00");
    const filed = await owner.fileExcuse(piano, { from: FRIDAY_1, to: FRIDAY_1, reason: "Sick all week" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    expect(owed(owner)).toBe(0);
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    expect(weekOf(owner, piano, WEEK_1).occurrence?.status).toEqual({ kind: "excused" });
    expect(owed(owner)).toBe(0);
  });
});

describe("Today", () => {
  test("shows the week's progress, sorted by the end of Sunday below things due today", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    const gym = await createPact("Gym", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Tue+1 10:00");
    await submit(owner, piano);

    s.setClockTo("Wed+1 08:00");
    expect(toDoCards(owner)).toEqual([
      expect.objectContaining({ pactId: gym, dueAt: s.at("Thu+1 00:00") }),
      {
        kind: "evidence",
        pactId: piano,
        name: "Piano",
        penaltyCents: 500,
        editWindowClosesAt: null,
        occurrenceDate: WEEK_1,
        dueAt: s.at("Mon+2 00:00"),
        dueBy: null,
        week: { sessions: 1, waiting: 1, target: 3 },
      } satisfies TodayToDoCard,
    ]);
  });

  test("leaves To do for a day with evidence, and once the target is met or waiting for approval", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));

    s.setClockTo("Mon+1 10:00");
    const monday = await submit(owner, piano);
    expect(toDoCards(owner)).toEqual([]);
    s.setClockTo("Tue+1 10:00");
    expect(toDoCards(owner).map((card) => card.kind === "evidence" && card.week)).toEqual([
      { sessions: 0, waiting: 1, target: 2 },
    ]);
    await submit(owner, piano);
    await reviewer.decide(monday, { kind: "approve" });
    s.setClockTo("Wed+1 10:00");
    expect(toDoCards(owner)).toEqual([]);
  });

  test("Yesterday leaves Weekly count pacts out", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Piano", weekly(2));

    await s.advanceTo("Tue+2 10:00");

    expect(owner.today().yesterday).toEqual([]);
  });
});

describe("reminders", () => {
  test("fire only on days without evidence, and stop once the target is met", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3), { reminders: ["18:00"] });

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const day of days) {
      if (day === "Mon" || day === "Wed" || day === "Thu") await sessionAt(s, `${day}+1 09:00`, owner, reviewer, piano);
      await s.advanceTo(`${day}+1 17:55`);
      await s.advanceTo(`${day}+1 18:05`);
    }

    expect(reminderDays(s, owner)).toEqual([TUESDAY_1]);
    expect(s.notifier.sentTo(owner).find((n) => n.kind === "reminder")?.payload.body).toBe(
      "1 of 3 this week. Today's photo is due at midnight.",
    );
  });

  test("don't fire while the days waiting for approval would meet the target", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { reminders: ["18:00"] });
    s.setClockTo("Mon+1 09:00");
    await submit(owner, piano);

    await s.advanceTo("Tue+1 17:55");
    await s.advanceTo("Tue+1 18:05");

    expect(reminderDays(s, owner)).toEqual([]);
  });
});

describe("changing the target", () => {
  test("raising it is stricter and applies without approval from next Monday", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    s.setClockTo("Wed+1 09:00");

    const preview = owner.changePreview(piano, changed(owner, piano, { schedule: weekly(4) }));
    expect(preview).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "schedule", before: weekly(2), after: weekly(4), effect: "stricter" }],
        outcome: { kind: "stricter", appliesFrom: WEEK_2, todayKeepsCents: null },
      },
    });
    await owner.changePact(piano, changed(owner, piano, { schedule: weekly(4) }));

    await s.advanceTo("Mon+3 00:00");
    expect(weekOf(owner, piano, WEEK_1).progress.target).toBe(2);
    expect(weekOf(owner, piano, WEEK_2).progress.target).toBe(4);
    expect(owed(owner)).toBe(1000 + 2000);
  });

  test("a higher penalty this week says the week keeps the old one", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    s.setClockTo("Wed+1 09:00");

    const preview = owner.changePreview(piano, changed(owner, piano, { penaltyCents: 800 }));

    expect(preview).toMatchObject({
      ok: true,
      preview: { outcome: { kind: "stricter", appliesFrom: WEEK_2, todayKeepsCents: 500 } },
    });
  });

  test("Fixed days and Weekly count can't be swapped after the edit window", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Wed+1 09:00");

    expect(
      await owner.changePact(piano, changed(owner, piano, { schedule: { kind: "fixed-days", days: MON_WED_FRI } })),
    ).toEqual({ ok: false, reason: "schedule-kind-fixed" });
    expect(owner.changePreview(gym, changed(owner, gym, { schedule: weekly(3) }))).toEqual({
      ok: false,
      reason: "schedule-kind-fixed",
    });
  });
});

describe("dates, bills and the heat map", () => {
  test("an end date ends the pact after the last whole week before it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { endDate: "2026-01-28" } });

    await s.advanceTo("Thu+3 00:00");

    expect(pactOf(owner, piano)).toMatchObject({ stage: "ended", endedAt: s.at("Thu+3 00:00") });
    expect(weeksOf(owner, piano).map((w) => [w.date, w.occurrence?.status.kind ?? null])).toEqual([
      [WEEK_1, "missed"],
      [WEEK_2, "missed"],
    ]);
    expect(owed(owner)).toBe(1000);
  });

  test("an end date before the end of the first week is refused", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);

    const created = await owner.createPact({
      evidenceKind: "camera",
      name: "Piano",
      description: "A photo of the practice log",
      schedule: weekly(1),
      endDate: "2026-01-17",
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    });

    expect(created).toEqual({ ok: false, reason: "end-date-too-early" });
  });

  test("a short week's penalty goes on the Wednesday bill after it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Piano", weekly(2));

    await s.advanceTo("Wed+2 18:00");

    const ledger = owner.ledger(owner.ledgers()[0]!.recipientId);
    if (!ledger.ok) throw new Error(ledger.reason);
    expect(ledger.ledger.history).toEqual([
      expect.objectContaining({
        occurrenceDate: WEEK_1,
        amountCents: 1000,
        bill: { kind: "on-bill", billedOn: "2026-01-21", dueAt: s.at("Wed+3 18:00") },
      }),
    ]);
  });

  test("the heat map has one square per week through this week, each with the days that counted", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    await sessionAt(s, "Tue+1 10:00", owner, reviewer, piano);
    await sessionAt(s, "Thu+1 10:00", owner, reviewer, piano);
    await s.advanceTo("Mon+2 00:00");
    await sessionAt(s, "Tue+2 10:00", owner, reviewer, piano);
    s.setClockTo("Wed+2 10:00");

    expect(weeksOf(owner, piano)).toEqual([
      {
        date: WEEK_1,
        progress: { sessions: 2, waiting: 0, target: 2 },
        occurrence: { status: { kind: "satisfied" }, decidedBy: null, recipientName: null },
      },
      {
        date: WEEK_2,
        progress: { sessions: 1, waiting: 0, target: 2 },
        occurrence: {
          status: {
            kind: "not-judged",
            opensAt: s.at("Mon+2 00:00"),
            dueAt: s.at("Mon+3 00:00"),
            evidenceWaiting: false,
            excuse: null,
          },
          decidedBy: null,
          recipientName: null,
        },
      },
    ]);
    expect(weeksOf(owner, piano).map((w) => w.date)).not.toContain(WEEK_3);
  });
});
