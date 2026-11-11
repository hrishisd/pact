// Weekly count: a Camera pact with a target per Mon–Sun week (e.g. 3× per
// week), the owner choosing which days. The week is one occurrence, from the
// week starting the Monday after creation. Evidence counts on any day of it,
// at most one day a day; the week is judged at the end of Sunday, with one
// penalty per day short of the target. A rejected photo just doesn't count:
// the owner can make it up another day that week. An approved excuse for any
// day excuses the whole week.

import { describe, expect, test } from "vitest";
import type { NewPact, Schedule, TodayToDoCard } from "../shared/types.ts";
import { bedtimePact, ownerWithOura } from "./testing/bedtime-pact.ts";
import { cameraPact, MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import type { AccountHandle, Scenario } from "./testing/scenario.ts";
import { scenario } from "./testing/scenario.ts";
import { cards, changed, ledgerHistory, ok, owed, pactOf, penalties } from "./testing/queries.ts";

// The pact is made in the reference week; its first week is the next one,
// "Mon+1".

const DAY_MS = 24 * 3600_000;

const weekly = (target: number): Schedule => ({ kind: "weekly-count", target });

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

/** At `when`, the owner submits a photo and `reviewer` approves it. */
async function sessionAt(s: Scenario, when: string, owner: AccountHandle, reviewer: AccountHandle, pactId: string) {
  s.setClockTo(when);
  await reviewer.decide(await submit(owner, pactId), { kind: "approve" });
}

function reminderDays(s: Scenario, owner: AccountHandle) {
  return s.notifier.sentTo(owner, "reminder").map((n) => n.payload.occurrenceDate);
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

    expect(weekOf(owner, piano, s.date("Mon+1"))).toEqual({
      date: s.date("Mon+1"),
      progress: { sessions: 2, waiting: 0, target: 3 },
      occurrence: {
        status: {
          kind: "missed",
          penaltyCents: 500,
          cover: null,
          phase: "past-due",
          excusableUntil: new Date(s.at("Mon+2 00:00").getTime() + 2 * DAY_MS),
          recipientName: "Sam",
          rejection: null,
        },
        detail: null,
      },
    });
    expect(owed(owner)).toBe(500);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          occurrenceDate: s.date("Mon+1"),
          body: "Week of Mon Jan 12 · 1 short · $5 to Sam",
        }),
      }),
    ]);

    await s.advanceTo("Mon+3 00:00");

    expect(weekOf(owner, piano, s.date("Mon+2"))).toMatchObject({
      progress: { sessions: 0, waiting: 0, target: 3 },
      occurrence: { status: { kind: "missed", penaltyCents: 1500 } },
    });
    expect(owed(owner)).toBe(2000);
    expect(ledgerHistory(owner)).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Mon+2"),
        amountCents: 1500,
        week: { sessions: 0, waiting: 0, target: 3 },
      }),
      expect.objectContaining({
        occurrenceDate: s.date("Mon+1"),
        amountCents: 500,
        week: { sessions: 2, waiting: 0, target: 3 },
      }),
    ]);
    // A short week isn't Missed through its rejected photo: it's the week's own miss.
    expect(ledgerHistory(owner)[1]).not.toHaveProperty("rejection");
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
      changes: [
        { term: "schedule", before: weekly(3), after: weekly(2), effect: "needs-approval", reason: "lower-target" },
      ],
      start: { appliesFrom: s.date("Mon+2") },
    });
    await reviewer.decide(item!.id, { kind: "approve" });

    expect(pactOf(owner, piano)).toMatchObject({ schedule: weekly(2), newTerms: { appliesFrom: s.date("Mon+2") } });
    expect(s.notifier.sentTo(owner, "change-request-decided")[0]?.payload.body).toBe(
      "Piano · New terms start Mon Jan 19",
    );

    await s.advanceTo("Mon+2 00:00");
    expect(weekOf(owner, piano, s.date("Mon+1"))).toMatchObject({
      progress: { sessions: 2, target: 3 },
      occurrence: { status: { kind: "missed", penaltyCents: 500 } },
    });
    await sessionAt(s, "Mon+2 10:00", owner, reviewer, piano);
    await sessionAt(s, "Fri+2 10:00", owner, reviewer, piano);
    await s.advanceTo("Mon+3 00:00");
    expect(weekOf(owner, piano, s.date("Mon+2"))).toMatchObject({
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

    expect(pactOf(owner, piano).firstOccurrence).toEqual({ date: s.date("Mon+1"), dueAt: s.at("Mon+2 00:00") });
    expect(owner.firstOccurrence({ schedule: weekly(3) })).toEqual({
      ok: true,
      firstOccurrence: { date: s.date("Mon+1"), dueAt: s.at("Mon+2 00:00") },
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
            opensOn: s.date("Mon+1"),
            startDate: null,
          },
        ],
      },
    ]);
    await s.advanceTo("Mon+1 00:00");
    expect(owed(owner)).toBe(0);
    expect(weeksOf(owner, piano).map((w) => w.date)).toEqual([s.date("Mon+1")]);
  });

  test("made on a Monday, it's still the week starting the Monday after", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const piano = await createPact("Piano", weekly(1));

    expect(pactOf(owner, piano).firstOccurrence.date).toBe(s.date("Mon+1"));
  });

  test("a start date pushes it to the first week starting on or after it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const piano = await createPact("Piano", weekly(2), { dates: { startDate: s.date("Wed+1") } });

    expect(pactOf(owner, piano).firstOccurrence.date).toBe(s.date("Mon+2"));
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

    const edited = await owner.editPact(
      gym,
      cameraPact("Gym", weekly(2), { recipientId: sam.id, reviewers: [reviewer] }),
    );

    expect(edited).toEqual({ ok: true });
    expect(pactOf(owner, gym)).toMatchObject({ schedule: weekly(2), firstOccurrence: { date: s.date("Mon+1") } });
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

    expect(weekOf(owner, piano, s.date("Mon+1"))).toMatchObject({
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
      expect.objectContaining({ kind: "evidence", id: evidenceId, occurrenceDate: s.date("Thu+1") }),
    ]);
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({
        kind: "evidence",
        id: evidenceId,
        occurrenceDate: s.date("Thu+1"),
        week: { sessions: 0, waiting: 1, target: 2 },
      }),
    ]);
    expect(owner.evidence(evidenceId)).toMatchObject({ ok: true, evidence: { occurrenceDate: s.date("Thu+1") } });
  });

  test("a due-by time limits each day's evidence, but the week is still judged at the end of Sunday", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { dueBy: "21:00" } });

    s.setClockTo("Tue+1 21:00");
    expect(await owner.submitEvidence(piano, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(cards(owner, "to-do")).toEqual([]);
    await s.advanceTo("Sun+1 20:00");
    await sessionAt(s, "Sun+1 20:59", owner, reviewer, piano);
    await s.advanceTo("Sun+1 21:00");
    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status.kind).toBe("not-judged");
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status).toEqual({
      kind: "satisfied",
      cover: null,
      phase: "past-due",
      approvedBy: null,
    });
  });

  test("evidence waiting for a decision at the end of Sunday holds the outcome until it's decided", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);

    await s.advanceTo("Tue+2 10:00");
    expect(weekOf(owner, piano, s.date("Mon+1"))).toMatchObject({
      progress: { sessions: 1, waiting: 1, target: 2 },
      occurrence: { status: { kind: "not-judged", evidenceWaiting: true } },
    });
    expect(owed(owner)).toBe(0);
    await reviewer.decide(late, { kind: "reject", reason: "Blurry" });

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status).toEqual({
      kind: "missed",
      penaltyCents: 500,
      cover: null,
      phase: "past-due",
      excusableUntil: new Date(s.at("Tue+2 10:00").getTime() + 2 * DAY_MS),
      recipientName: "Sam",
      rejection: null,
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

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status).toEqual({
      kind: "satisfied",
      cover: null,
      phase: "past-due",
      approvedBy: null,
    });
    expect(owed(owner)).toBe(0);
  });
});

describe("a week judged by a late decision", () => {
  /** The owner's pushes about Piano, as kind and title, in delivery order. */
  const pushes = (s: Scenario, owner: AccountHandle) =>
    s.notifier.sentTo(owner).map((n) => [n.kind, n.payload.title] as const);

  test("a 3× week whose third session is approved after Sunday is Satisfied, with no Missed push", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3), { penaltyCents: 1000 });
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    await sessionAt(s, "Tue+1 10:00", owner, reviewer, piano);
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);
    await s.advanceTo("Mon+2 10:00");

    ok(await reviewer.decide(late, { kind: "approve" }));

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status.kind).toBe("satisfied");
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
    expect(owed(owner)).toBe(0);
  });

  test("with two sessions in all, a late approval of the second leaves the week Missed and says so after the decision", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3), { penaltyCents: 1000 });
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);
    await s.advanceTo("Mon+2 10:00");
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);

    ok(await reviewer.decide(late, { kind: "approve" }));

    expect(pushes(s, owner).slice(-2)).toEqual([
      ["evidence-decided", "reviewer approved your evidence"],
      ["missed-occurrence", "Piano is Missed"],
    ]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toHaveLength(1);
    expect(penalties(owner).map((p) => [p.date, p.cents])).toEqual([[s.date("Mon+1"), 1000]]);
    await s.advanceTo("Tue+2 10:00");
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toHaveLength(1);
  });

  test("a late rejection that leaves the week short says it's Missed", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(2));
    await sessionAt(s, "Mon+1 10:00", owner, reviewer, piano);
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);
    await s.advanceTo("Mon+2 10:00");

    ok(await reviewer.decide(late, { kind: "reject", reason: "Blurry" }));

    expect(pushes(s, owner).slice(-2)).toEqual([
      ["evidence-decided", "reviewer rejected your evidence"],
      ["missed-occurrence", "Piano is Missed"],
    ]);
    expect(owed(owner)).toBe(500);
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
    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status.kind).toBe("not-judged");
    const today = owner.today();
    expect(today.alerts).toEqual([
      {
        kind: "evidence-rejected",
        pactId: piano,
        name: "Piano",
        reviewerName: "reviewer",
        reason: "That's last week's log",
        occurrenceDate: s.date("Tue+1"),
        penaltyCents: 500,
        recipientName: "Sam",
        excusableUntil: null,
        week: true,
      },
    ]);
    expect(today.sections.find((section) => section.kind === "missed")).toBeUndefined();
    // Tuesday is done: the week is made up on another day.
    expect(cards(owner, "to-do")).toEqual([]);
    expect(await owner.submitEvidence(piano, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });

    expect(await owner.acceptMiss(piano, s.date("Tue+1"))).toEqual({ ok: true });
    expect(owner.today().alerts).toEqual([]);
    expect(await owner.acceptMiss(piano, s.date("Tue+1"))).toEqual({ ok: false, reason: "nothing-to-accept" });

    await sessionAt(s, "Wed+1 10:00", owner, reviewer, piano);
    await s.advanceTo("Mon+2 00:00");
    expect(weekOf(owner, piano, s.date("Mon+1"))).toMatchObject({
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
          occurrenceDate: s.date("Mon+1"),
          missedAt: s.at("Mon+2 00:00"),
          excusableUntil: new Date(s.at("Mon+2 00:00").getTime() + 2 * DAY_MS),
          detail: { kind: "week", progress: { sessions: 0, waiting: 0, target: 1 } },
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

    const preview = owner.excusePreview(piano, { from: s.date("Thu+1"), to: s.date("Thu+1") });
    expect(preview).toEqual({
      ok: true,
      preview: {
        covered: [
          {
            date: s.date("Mon+1"),
            through: s.date("Sun+1"),
            status: {
              kind: "not-judged",
              opensAt: s.at("Mon+1 00:00"),
              dueAt: s.at("Mon+2 00:00"),
              evidenceWaiting: false,
              cover: null,
              phase: "open",
            },
          },
        ],
        skipped: [],
        heldCents: 0,
      },
    });
    const filed = ok(
      await owner.fileExcuse(piano, { from: s.date("Thu+1"), to: s.date("Thu+1"), reason: "Recital" }, []),
    );
    expect(cards(owner, "to-do")).toEqual([]);
    await reviewer.decide(filed.excuseId, { kind: "approve" });
    await s.advanceTo("Mon+2 00:00");

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence).toEqual({
      status: {
        kind: "excused",
        cover: { kind: "excuse", state: "approved" },
        phase: "past-due",
        excuseApproval: { reviewerName: "reviewer", reason: "Recital" },
      },
      detail: null,
    });
    expect(owed(owner)).toBe(0);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });

  test("a week an excuse can't cover is skipped by its Monday, through its Sunday", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    s.setClockTo("Tue+1 10:00");
    await owner.fileExcuse(piano, { from: s.date("Wed+1"), to: s.date("Wed+1"), reason: "Recital" }, []);

    expect(owner.excusePreview(piano, { from: s.date("Thu+1"), to: s.date("Thu+1") })).toEqual({
      ok: true,
      preview: {
        covered: [],
        skipped: [{ date: s.date("Mon+1"), through: s.date("Sun+1"), reason: "on-waiting-excuse" }],
        heldCents: 0,
      },
    });
  });

  test("a short week can be excused within 48 hours, which removes all its penalties", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(3));
    await s.advanceTo("Mon+2 00:00");
    expect(owed(owner)).toBe(1500);

    s.setClockTo("Tue+2 10:00");
    const filed = ok(
      await owner.fileExcuse(piano, { from: s.date("Fri+1"), to: s.date("Fri+1"), reason: "Sick all week" }, []),
    );
    expect(owed(owner)).toBe(0);
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    expect(weekOf(owner, piano, s.date("Mon+1")).occurrence?.status).toEqual({
      kind: "excused",
      cover: { kind: "excuse", state: "approved" },
      phase: "past-due",
      excuseApproval: { reviewerName: "reviewer", reason: "Sick all week" },
    });
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
    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ pactId: gym, dueAt: s.at("Thu+1 00:00") }),
      {
        kind: "evidence",
        pactId: piano,
        name: "Piano",
        penaltyCents: 500,
        editWindowClosesAt: null,
        occurrenceDate: s.date("Mon+1"),
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
    expect(cards(owner, "to-do")).toEqual([]);
    s.setClockTo("Tue+1 10:00");
    expect(cards(owner, "to-do").map((card) => card.kind === "evidence" && card.week)).toEqual([
      { sessions: 0, waiting: 1, target: 2 },
    ]);
    await submit(owner, piano);
    await reviewer.decide(monday, { kind: "approve" });
    s.setClockTo("Wed+1 10:00");
    expect(cards(owner, "to-do")).toEqual([]);
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

    expect(reminderDays(s, owner)).toEqual([s.date("Tue+1")]);
    expect(s.notifier.sentTo(owner, "reminder")[0]?.payload.body).toBe(
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
        outcome: { kind: "stricter", appliesFrom: s.date("Mon+2"), todayKeepsCents: null, appliesNow: [] },
      },
    });
    await owner.changePact(piano, changed(owner, piano, { schedule: weekly(4) }));

    await s.advanceTo("Mon+3 00:00");
    expect(weekOf(owner, piano, s.date("Mon+1")).progress.target).toBe(2);
    expect(weekOf(owner, piano, s.date("Mon+2")).progress.target).toBe(4);
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
      preview: { outcome: { kind: "stricter", appliesFrom: s.date("Mon+2"), todayKeepsCents: 500, appliesNow: [] } },
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

describe("changing the due-by time", () => {
  test("an earlier one is stricter and applies from next Monday: this week's days keep the old time", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { dueBy: "21:00" } });
    s.setClockTo("Wed+1 09:00");

    expect(owner.changePreview(piano, changed(owner, piano, { dueBy: "20:00" }))).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "due-by", before: "21:00", after: "20:00", effect: "stricter" }],
        outcome: { kind: "stricter", appliesFrom: s.date("Mon+2"), todayKeepsCents: null, appliesNow: [] },
      },
    });
    ok(await owner.changePact(piano, changed(owner, piano, { dueBy: "20:00" })));

    s.setClockTo("Thu+1 20:30");
    ok(await owner.submitEvidence(piano, [photo()]));
    s.setClockTo("Tue+2 20:30");
    expect(await owner.submitEvidence(piano, [photo()])).toEqual({ ok: false, reason: "not-open" });
  });

  test("a later one, or none, needs approval", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { dueBy: "21:00" } });
    s.setClockTo("Wed+1 09:00");
    const effects = (dueBy: string | undefined) => {
      const preview = ok(owner.changePreview(piano, changed(owner, piano, { dueBy }))).preview;
      return [preview.outcome.kind, ...preview.changes.map((change) => `${change.term}: ${change.effect}`)];
    };

    expect(effects("22:00")).toEqual(["needs-approval", "due-by: needs-approval"]);
    expect(effects(undefined)).toEqual(["needs-approval", "due-by: needs-approval"]);
  });
});

describe("dates, bills and the heat map", () => {
  test("an end date ends the pact after the last whole week before it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", weekly(1), { dates: { endDate: s.date("Wed+3") } });

    await s.advanceTo("Thu+3 00:00");

    expect(pactOf(owner, piano)).toMatchObject({ stage: "ended", endedAt: s.at("Thu+3 00:00") });
    expect(weeksOf(owner, piano).map((w) => [w.date, w.occurrence?.status.kind ?? null])).toEqual([
      [s.date("Mon+1"), "missed"],
      [s.date("Mon+2"), "missed"],
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
      endDate: s.date("Sat+1"),
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

    expect(ledgerHistory(owner)).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Mon+1"),
        amountCents: 1000,
        bill: { kind: "on-bill", billedOn: s.date("Wed+2"), dueAt: s.at("Wed+3 18:00") },
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
        date: s.date("Mon+1"),
        progress: { sessions: 2, waiting: 0, target: 2 },
        occurrence: { status: { kind: "satisfied", cover: null, phase: "past-due", approvedBy: null }, detail: null },
      },
      {
        date: s.date("Mon+2"),
        progress: { sessions: 1, waiting: 0, target: 2 },
        occurrence: {
          status: {
            kind: "not-judged",
            opensAt: s.at("Mon+2 00:00"),
            dueAt: s.at("Mon+3 00:00"),
            evidenceWaiting: false,
            cover: null,
            phase: "open",
            excuseApproval: null,
          },
          detail: null,
        },
      },
    ]);
    expect(weeksOf(owner, piano).map((w) => w.date)).not.toContain(s.date("Mon+3"));
  });
});
