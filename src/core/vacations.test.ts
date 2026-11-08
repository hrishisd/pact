// Vacations: the owner asks once, ahead of time, for a date range off from
// the pacts they pick, and sends it to the reviewers they pick. Ticket 01:
// what a vacation would cover, filing it, the owner's waiting vacations, and
// withdrawing one. Ticket 02: the picked reviewers' review item, questions,
// the decision, and Excused days once it's approved.

import { describe, expect, test } from "vitest";
import type { NewVacation, Schedule } from "../shared/types.ts";
import { ownerWithAnki } from "./testing/anki-pact.ts";
import { bedtimePact, sleep } from "./testing/bedtime-pact.ts";
import { fifteenOwed, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { changed, ok, owed, pactOf, penalties, penaltyDays, statusOn } from "./testing/queries.ts";
import { changeRequestIdOf, scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

const THREE_A_WEEK: Schedule = { kind: "weekly-count", target: 3 };

/**
 * The owner with three pacts made Mon 09:00: Gym (Camera, Mon/Wed/Fri, both
 * friends review it), Bed (Oura, every night, the reviewer) and Piano
 * (Camera, 3× per week, the second friend). The clock is then at `at`.
 */
async function ownerWithThreePacts(s: Scenario, at = "Wed 12:00") {
  const setup = await ownerWithReviewers(s);
  const { owner, reviewer, second, sam, createPact } = setup;
  await owner.connectOura();
  const gym = await createPact("Gym", MON_WED_FRI);
  const bed = ok(await owner.createPact({ ...bedtimePact(sam.id, reviewer), name: "Bed" })).pactId;
  const piano = await createPact("Piano", THREE_A_WEEK, { reviewers: [second] });
  s.setClockTo(at);
  return { ...setup, gym, bed, piano };
}

describe("what the Pacts and Reviewers steps offer", () => {
  test("Active pacts past their edit window, recurring and One-time apart, each with its reviewers", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact, gym, bed, piano } = await ownerWithThreePacts(s);
    const visa = await createPact(
      "Visa",
      { kind: "one-time", deadline: s.date("Wed+2"), submitAnytime: false },
      {
        reviewers: [second],
      },
    );
    const forms = await createPact("Forms", { kind: "one-time", deadline: s.date("Fri+2"), submitAnytime: true });
    s.setClockTo("Wed 12:20");
    // Still in its edit window: not offered.
    await createPact("Read", MON_WED_FRI);

    expect(owner.vacationOptions()).toEqual({
      today: s.date("Wed"),
      recurring: [
        expect.objectContaining({
          id: gym,
          name: "Gym",
          reviewers: [reviewer, second].map(({ id, name }) => ({ id, name })),
        }),
        expect.objectContaining({ id: bed, name: "Bed", evidenceKind: "oura", alreadyOpen: false }),
        expect.objectContaining({ id: piano, schedule: THREE_A_WEEK, penaltyCents: 500 }),
      ],
      oneTime: [
        expect.objectContaining({ id: visa, alreadyOpen: false }),
        expect.objectContaining({ id: forms, alreadyOpen: true }),
      ],
      inEditWindow: true,
    });
  });
});

/** The preview of a vacation from `from` to `to` with `pactIds` ticked; throws if it's refused. */
function preview(owner: AccountHandle, from: string, to: string, pactIds: string[]) {
  return ok(owner.vacationPreview({ from, to, pactIds })).preview;
}

/** What the preview says for `pactId`. */
function forPact(owner: AccountHandle, from: string, to: string, pactIds: string[], pactId: string) {
  const found = preview(owner, from, to, pactIds).pacts.find((pact) => pact.pactId === pactId);
  if (!found) throw new Error(`${pactId} isn't offered`);
  return found;
}

describe("what a vacation covers", () => {
  test("filed on Wed for Mon+1 to Sun+1: Gym's Mon, Wed and Fri, Bed's seven nights and Piano's week", async () => {
    const s = scenario();
    const { owner, gym, bed, piano } = await ownerWithThreePacts(s);
    const all = [gym, bed, piano];

    const result = preview(owner, s.date("Mon+1"), s.date("Sun+1"), all);

    expect(result.days).toBe(7);
    expect(result.coversNothing).toBe(false);
    expect(result.pacts).toEqual([
      {
        pactId: gym,
        ticked: true,
        covered: ["Mon+1", "Wed+1", "Fri+1"].map((day) => ({ date: s.date(day) })),
        skipped: [],
        notCovered: [],
      },
      {
        pactId: bed,
        ticked: true,
        covered: ["Mon+1", "Tue+1", "Wed+1", "Thu+1", "Fri+1", "Sat+1", "Sun+1"].map((day) => ({ date: s.date(day) })),
        skipped: [],
        notCovered: [],
      },
      {
        pactId: piano,
        ticked: true,
        covered: [{ date: s.date("Mon+1"), through: s.date("Sun+1") }],
        skipped: [],
        notCovered: [],
      },
    ]);
  });

  test("an unticked pact lists what it keeps", async () => {
    const s = scenario();
    const { owner, gym, bed } = await ownerWithThreePacts(s);

    expect(forPact(owner, s.date("Mon+1"), s.date("Tue+1"), [bed], gym)).toEqual({
      pactId: gym,
      ticked: false,
      covered: [{ date: s.date("Mon+1") }],
      skipped: [],
      notCovered: [],
    });
  });

  describe("a Weekly count week is covered whole only when its Thursday is inside", () => {
    test("Sun+1 to Sat+2 covers the week of Mon+2, Sun+2 included, and not the week of Mon+1", async () => {
      const s = scenario();
      const { owner, piano } = await ownerWithThreePacts(s, "Mon 12:00");

      expect(forPact(owner, s.date("Sun+1"), s.date("Sat+2"), [piano], piano)).toMatchObject({
        covered: [{ date: s.date("Mon+2"), through: s.date("Sun+2") }],
        notCovered: [{ date: s.date("Mon+1"), through: s.date("Sun+1") }],
      });
    });

    test("Fri+1 to Wed+2 covers no week, and both are listed as not covered", async () => {
      const s = scenario();
      const { owner, piano } = await ownerWithThreePacts(s, "Mon 12:00");

      const result = preview(owner, s.date("Fri+1"), s.date("Wed+2"), [piano]);

      expect(result.pacts[2]).toMatchObject({
        covered: [],
        notCovered: [
          { date: s.date("Mon+1"), through: s.date("Sun+1") },
          { date: s.date("Mon+2"), through: s.date("Sun+2") },
        ],
      });
      expect(result.coversNothing).toBe(true);
    });

    test("Thu+1 alone covers the week of Mon+1", async () => {
      const s = scenario();
      const { owner, piano } = await ownerWithThreePacts(s, "Mon 12:00");

      expect(forPact(owner, s.date("Thu+1"), s.date("Thu+1"), [piano], piano)).toMatchObject({
        covered: [{ date: s.date("Mon+1"), through: s.date("Sun+1") }],
        notCovered: [],
      });
    });
  });

  test("filed on Tue+1 for Wed+1 to Sun+1: the week's Thursday is inside, but it opened Monday, so it's skipped", async () => {
    const s = scenario();
    const { owner, piano } = await ownerWithThreePacts(s, "Tue+1 12:00");

    expect(forPact(owner, s.date("Wed+1"), s.date("Sun+1"), [piano], piano)).toEqual({
      pactId: piano,
      ticked: true,
      covered: [],
      skipped: [{ date: s.date("Mon+1"), through: s.date("Sun+1"), reason: "already-open" }],
      notCovered: [],
    });
  });

  describe("One-time pacts", () => {
    async function withOneTimePacts(s: Scenario) {
      const setup = await ownerWithThreePacts(s);
      const oneTime = (deadline: string, submitAnytime = false) =>
        setup.createPact(`Due ${deadline}`, { kind: "one-time", deadline: s.date(deadline), submitAnytime });
      const inside = await oneTime("Wed+1");
      const outside = await oneTime("Wed+3");
      const anytime = await oneTime("Thu+1", true);
      s.setClockTo("Wed 12:20");
      return { ...setup, inside, outside, anytime };
    }

    test("a deadline inside is covered; one outside covers nothing", async () => {
      const s = scenario();
      const { owner, inside, outside } = await withOneTimePacts(s);
      const ticked = [inside, outside];

      expect(forPact(owner, s.date("Mon+1"), s.date("Sun+1"), ticked, inside)).toMatchObject({
        covered: [{ date: s.date("Wed+1") }],
        skipped: [],
      });
      expect(forPact(owner, s.date("Mon+1"), s.date("Sun+1"), ticked, outside)).toMatchObject({
        covered: [],
        skipped: [],
      });
    });

    test("with Submit anytime it's already open: the options mark it, and ticking it is refused", async () => {
      const s = scenario();
      const { owner, anytime } = await withOneTimePacts(s);

      expect(owner.vacationOptions().oneTime.find((pact) => pact.id === anytime)).toMatchObject({ alreadyOpen: true });
      expect(forPact(owner, s.date("Mon+1"), s.date("Sun+1"), [], anytime)).toMatchObject({
        ticked: false,
        covered: [],
        skipped: [{ date: s.date("Thu+1"), reason: "already-open" }],
      });
      expect(owner.vacationPreview({ from: s.date("Mon+1"), to: s.date("Sun+1"), pactIds: [anytime] })).toEqual({
        ok: false,
        reason: "pact-not-offered",
      });
    });
  });

  describe("dates", () => {
    test("a first day of today, a last day before the first, and 63 days are refused; 62 days are accepted", async () => {
      const s = scenario();
      const { owner, gym } = await ownerWithThreePacts(s);
      const attempt = (from: string, to: string) => owner.vacationPreview({ from, to, pactIds: [gym] });

      expect(attempt(s.date("Wed"), s.date("Fri"))).toEqual({ ok: false, reason: "not-after-today" });
      expect(attempt(s.date("Fri"), s.date("Thu"))).toEqual({ ok: false, reason: "invalid-dates" });
      expect(attempt("Thursday", s.date("Fri"))).toEqual({ ok: false, reason: "invalid-dates" });
      expect(attempt(s.date("Thu"), "2026-03-11")).toEqual({ ok: false, reason: "too-many-days" });
      expect(attempt(s.date("Thu"), "2026-03-10")).toMatchObject({ ok: true, preview: { days: 62 } });
    });
  });
});

/** A vacation from `from` to `to` with `pactIds` ticked, sent to `reviewers`. */
function vacation(from: string, to: string, pactIds: string[], reviewers: AccountHandle[]): NewVacation {
  return { from, to, pactIds, reviewerIds: reviewers.map((r) => r.id) };
}

/** Files `request` as `owner`; returns its id, or throws if it's refused. */
async function file(owner: AccountHandle, request: NewVacation): Promise<string> {
  return ok(await owner.fileVacation(request)).vacationId;
}

describe("filing a vacation", () => {
  test("it records what the preview showed: the same request afterwards finds every one of them on a vacation", async () => {
    const s = scenario();
    const { owner, reviewer, gym, bed, piano } = await ownerWithThreePacts(s);
    const request = vacation(s.date("Mon+1"), s.date("Sun+1"), [gym, bed, piano], [reviewer]);
    const before = preview(owner, request.from, request.to, request.pactIds);

    await file(owner, request);

    const after = preview(owner, request.from, request.to, request.pactIds);
    expect(after.coversNothing).toBe(true);
    expect(after.pacts.map((pact) => pact.skipped)).toEqual(
      before.pacts.map((pact) => pact.covered.map((occurrence) => ({ ...occurrence, reason: "on-vacation" }))),
    );
    expect(await owner.fileVacation(request)).toEqual({ ok: false, reason: "nothing-to-cover" });
  });

  test("a pact created after filing isn't covered", async () => {
    const s = scenario();
    const { owner, reviewer, gym, createPact } = await ownerWithThreePacts(s);
    await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));
    const read = await createPact("Read", MON_WED_FRI);
    s.setClockTo("Wed 12:20");

    expect(forPact(owner, s.date("Mon+1"), s.date("Sun+1"), [read], read)).toMatchObject({
      covered: ["Mon+1", "Wed+1", "Fri+1"].map((day) => ({ date: s.date(day) })),
      skipped: [],
    });
  });

  describe("refused", () => {
    test("with no pact ticked, no reviewer picked, or a picked reviewer who reviews none of the ticked pacts", async () => {
      const s = scenario();
      const { owner, reviewer, second, bed } = await ownerWithThreePacts(s);
      const [from, to] = [s.date("Mon+1"), s.date("Sun+1")];

      expect(await owner.fileVacation(vacation(from, to, [], [reviewer]))).toEqual({ ok: false, reason: "no-pacts" });
      expect(await owner.fileVacation(vacation(from, to, [bed], []))).toEqual({ ok: false, reason: "no-reviewers" });
      expect(await owner.fileVacation(vacation(from, to, [bed], [reviewer, second]))).toEqual({
        ok: false,
        reason: "reviewer-not-offered",
      });
      expect(owner.vacations()).toEqual([]);
    });

    test("with a pact still in its edit window, or another owner's pact", async () => {
      const s = scenario();
      const { owner, reviewer, second, gym, createPact } = await ownerWithThreePacts(s);
      const fresh = await createPact("Read", MON_WED_FRI);
      await reviewer.setTimezone("America/New_York");
      const kim = ok(await reviewer.addRecipient({ name: "Kim" })).recipient;
      const theirs = await createPact("Their gym", MON_WED_FRI, {
        by: reviewer,
        reviewers: [owner],
        recipientId: kim.id,
      });
      s.setClockTo("Wed 12:05");
      const attempt = (pactId: string) =>
        owner.fileVacation(vacation(s.date("Mon+1"), s.date("Sun+1"), [gym, pactId], [second]));

      expect(await attempt(fresh)).toEqual({ ok: false, reason: "pact-not-offered" });
      expect(await attempt(theirs)).toEqual({ ok: false, reason: "pact-not-offered" });
    });

    test("with dates the preview refuses", async () => {
      const s = scenario();
      const { owner, reviewer, gym } = await ownerWithThreePacts(s);

      expect(await owner.fileVacation(vacation(s.date("Wed"), s.date("Fri"), [gym], [reviewer]))).toEqual({
        ok: false,
        reason: "not-after-today",
      });
    });
  });

  describe("overlaps are skipped, not refused", () => {
    test("days already Excused ahead, on a waiting excuse, or on a waiting vacation", async () => {
      const s = scenario();
      const { owner, reviewer, gym } = await ownerWithThreePacts(s);
      const approved = ok(
        await owner.fileExcuse(gym, { from: s.date("Mon+1"), to: s.date("Mon+1"), reason: "Dentist" }, []),
      ).excuseId;
      ok(await reviewer.decide(approved, { kind: "approve" }));
      ok(await owner.fileExcuse(gym, { from: s.date("Wed+1"), to: s.date("Wed+1"), reason: "Wedding" }, []));
      await file(owner, vacation(s.date("Fri+1"), s.date("Fri+1"), [gym], [reviewer]));

      expect(forPact(owner, s.date("Mon+1"), s.date("Mon+2"), [gym], gym)).toEqual({
        pactId: gym,
        ticked: true,
        covered: [{ date: s.date("Mon+2") }],
        skipped: [
          { date: s.date("Mon+1"), reason: "excused" },
          { date: s.date("Wed+1"), reason: "on-waiting-excuse" },
          { date: s.date("Fri+1"), reason: "on-vacation" },
        ],
        notCovered: [],
      });
    });

    test("with nothing left to cover in any ticked pact, it's refused", async () => {
      const s = scenario();
      const { owner, reviewer, gym, bed } = await ownerWithThreePacts(s);
      await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));

      expect(await owner.fileVacation(vacation(s.date("Mon+1"), s.date("Wed+1"), [gym], [reviewer]))).toEqual({
        ok: false,
        reason: "nothing-to-cover",
      });
      // Another ticked pact with days left is enough.
      expect(
        await owner.fileVacation(vacation(s.date("Mon+1"), s.date("Wed+1"), [gym, bed], [reviewer])),
      ).toMatchObject({
        ok: true,
      });
    });
  });
});

describe("excuses and a waiting vacation", () => {
  test("an excuse skips a day on a waiting vacation; once the vacation is withdrawn, it covers it", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));
    const dates = { from: s.date("Fri"), to: s.date("Mon+1") };

    expect(ok(owner.excusePreview(gym, dates)).preview).toMatchObject({
      covered: [{ date: s.date("Fri") }],
      skipped: [{ date: s.date("Mon+1"), reason: "on-waiting-vacation" }],
    });

    ok(await owner.withdrawVacation(vacationId));

    expect(ok(owner.excusePreview(gym, dates)).preview).toMatchObject({
      covered: [{ date: s.date("Fri") }, { date: s.date("Mon+1") }],
      skipped: [],
    });
  });
});

describe("the owner's vacations on Profile", () => {
  test("each waiting one, soonest first, with its dates, note, pacts, day count and who it went to", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, bed, piano } = await ownerWithThreePacts(s);
    const later = await file(owner, {
      ...vacation(s.date("Mon+3"), s.date("Wed+3"), [gym, bed, piano], [reviewer, second]),
      note: "  Going to Portugal ",
    });
    const sooner = await file(owner, { ...vacation(s.date("Sat+1"), s.date("Sat+1"), [bed], [reviewer]), note: "  " });

    expect(owner.vacations()).toEqual([
      {
        id: sooner,
        from: s.date("Sat+1"),
        to: s.date("Sat+1"),
        days: 1,
        note: null,
        pacts: { kind: "some", names: ["Bed"] },
        reviewerNames: ["reviewer"],
        state: { kind: "waiting" },
      },
      {
        id: later,
        from: s.date("Mon+3"),
        to: s.date("Wed+3"),
        days: 3,
        note: "Going to Portugal",
        pacts: { kind: "all" },
        reviewerNames: ["reviewer", "second"],
        state: { kind: "waiting" },
      },
    ]);
  });

  test('every recurring pact and no One-time one is "All recurring pacts"', async () => {
    const s = scenario();
    const { owner, second, gym, bed, piano, createPact } = await ownerWithThreePacts(s);
    await createPact("Visa", { kind: "one-time", deadline: s.date("Wed+2"), submitAnytime: false });
    s.setClockTo("Wed 12:20");

    await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym, bed, piano], [second]));

    expect(owner.vacations()).toMatchObject([{ pacts: { kind: "all-recurring" } }]);
  });

  test('"All pacts" stays as filed when a pact made later becomes one Plan a vacation offers', async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, bed, piano, createPact } = await ownerWithThreePacts(s);
    await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym, bed, piano], [reviewer, second]));

    await createPact("Read", MON_WED_FRI);
    s.setClockTo("Wed 12:20");

    expect(owner.vacations()).toMatchObject([{ pacts: { kind: "all" } }]);
  });
});

describe("withdrawing a vacation", () => {
  test("works while it waits, and leaves Profile; a second time is refused", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));

    expect(await owner.withdrawVacation(vacationId)).toEqual({ ok: true });
    expect(owner.vacations()).toEqual([]);
    expect(await owner.withdrawVacation(vacationId)).toEqual({ ok: false, reason: "not-waiting" });
    // Its days are free again.
    expect(forPact(owner, s.date("Mon+1"), s.date("Sun+1"), [gym], gym).covered).toHaveLength(3);
  });

  test("is refused for another owner's vacation", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));

    expect(await reviewer.withdrawVacation(vacationId)).toEqual({ ok: false, reason: "vacation-not-found" });
    expect(await reviewer.withdrawVacation("no-such-vacation")).toEqual({ ok: false, reason: "vacation-not-found" });
    expect(owner.vacations()).toHaveLength(1);
  });
});

// Ticket 02: the picked reviewers review it, and once approved its
// occurrences are judged Excused at their due times.

/** How a One-time pact's one occurrence stands. */
function oneTimeStatus(owner: AccountHandle, pactId: string) {
  const { history } = pactOf(owner, pactId);
  if (history.kind !== "one-time") throw new Error(`a ${history.kind} heat map`);
  return history.day.occurrence?.status.kind;
}

/** Every hour from `from` to `to` (scenario time strings), as scheduler ticks, so reminders and judging run as in production. */
async function tickHourly(s: Scenario, from: string, to: string) {
  const end = s.at(to).getTime();
  for (let t = s.at(from).getTime(); t <= end; t += 3600_000) await s.advanceTo(new Date(t).toISOString());
}

describe("the spec's example", () => {
  test("filed Wed for Mon+1 to Sun+1 and approved Thu: Mon+1, Wed+1 and Fri+1 are Excused at their due times, with no reminders and no penalties", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, {
      reminders: ["18:00"],
      dates: { startDate: s.date("Mon+1") },
    });
    await s.advanceTo("Wed 12:00");
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer]));
    await s.advanceTo("Thu 10:00");

    expect(await reviewer.decide(vacationId, { kind: "approve" })).toEqual({ ok: true });
    await tickHourly(s, "Thu 11:00", "Mon+2 18:00");

    for (const day of ["Mon+1", "Wed+1", "Fri+1"]) expect(statusOn(owner, gym, s.date(day))).toBe("excused");
    expect(s.notifier.sentTo(owner, "reminder").map((n) => n.payload.occurrenceDate)).toEqual([s.date("Mon+2")]);
    expect(penaltyDays(owner)).toEqual([]);
    expect(owed(owner)).toBe(0);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });
});

/** The owner's Gym pact that `reviewer`, `second` and `third` review, and a vacation for Mon+1 to Sun+1 sent to `reviewer` and `second`, filed Wed 12:00. */
async function sentToTwoOfThree(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const { owner, reviewer, second, createPact } = setup;
  const third = await s.befriend(owner, "third");
  const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [reviewer, second, third] });
  s.setClockTo("Wed 12:00");
  const vacationId = await file(owner, {
    ...vacation(s.date("Mon+1"), s.date("Sun+1"), [gym], [reviewer, second]),
    note: "Going to Portugal",
  });
  return { ...setup, third, gym, vacationId };
}

describe("the review item", () => {
  test("goes only to the picked reviewers, with its dates, note, pacts and what each pact gives up", async () => {
    const s = scenario();
    const { owner, reviewer, second, third, gym, vacationId } = await sentToTwoOfThree(s);

    const pushes = s.notifier.sent.filter((n) => n.kind === "review-item");
    expect(pushes.map((n) => n.recipient).toSorted()).toEqual([reviewer.id, second.id].toSorted());
    expect(pushes[0]!.payload).toEqual({
      itemKind: "vacation",
      itemId: vacationId,
      title: "owner asked for a vacation",
      body: "Jan 12 – 18",
      url: "/review",
    });
    const item = {
      kind: "vacation",
      id: vacationId,
      ownerName: "owner",
      from: s.date("Mon+1"),
      to: s.date("Sun+1"),
      days: 7,
      note: "Going to Portugal",
      pacts: { kind: "all" },
      reviewerNames: ["reviewer", "second"],
      covers: [
        {
          pactId: gym,
          name: "Gym",
          evidenceKind: "camera",
          schedule: { kind: "fixed-days", days: MON_WED_FRI },
          covered: ["Mon+1", "Wed+1", "Fri+1"].map((day) => ({ date: s.date(day) })),
        },
      ],
      filedAt: s.at("Wed 12:00"),
      thread: { comments: [], waitingOnReply: false },
    };
    expect(reviewer.reviewQueue()).toEqual([item]);
    expect(second.reviewQueue()).toEqual([item]);
    expect(third.reviewQueue()).toEqual([]);
    expect(owner.reviewQueue()).toEqual([]);
  });

  test("sits after change requests, among the other items oldest first", async () => {
    const s = scenario();
    const { owner, reviewer, gym, vacationId } = await sentToTwoOfThree(s);
    s.setClockTo("Wed 12:30");
    const excuseId = ok(
      await owner.fileExcuse(gym, { from: s.date("Wed"), to: s.date("Wed"), reason: "Sick" }, []),
    ).excuseId;
    const changeId = changeRequestIdOf(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 100 })));

    expect(reviewer.reviewQueue().map((item) => item.id)).toEqual([changeId, vacationId, excuseId]);
  });

  test("a reviewer of a covered pact who wasn't picked can't decide or ask about it", async () => {
    const s = scenario();
    const { third, vacationId } = await sentToTwoOfThree(s);

    expect(await third.decide(vacationId, { kind: "approve" })).toEqual({ ok: false, reason: "item-not-found" });
    expect(await third.askOwner(vacationId, "Where to?")).toEqual({ ok: false, reason: "item-not-found" });
    expect(s.notifier.sentTo(third, "review-item")).toEqual([]);
  });

  test("either picked reviewer can decide; the first decision is final and the item leaves both queues", async () => {
    const s = scenario();
    const { owner, reviewer, second, vacationId } = await sentToTwoOfThree(s);

    expect(await second.decide(vacationId, { kind: "approve" })).toEqual({ ok: true });

    expect(await reviewer.decide(vacationId, { kind: "reject", reason: "No" })).toEqual({
      ok: false,
      reason: "already-decided",
    });
    expect(await second.decide(vacationId, { kind: "approve" })).toEqual({ ok: false, reason: "already-decided" });
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
    expect(await owner.withdrawVacation(vacationId)).toEqual({ ok: false, reason: "not-waiting" });
  });

  test("the owner can't decide their own vacation, and a rejection needs a reason", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);

    expect(await owner.decide(vacationId, { kind: "approve" })).toEqual({ ok: false, reason: "item-not-found" });
    expect(await reviewer.decide(vacationId, { kind: "reject", reason: " " })).toEqual({
      ok: false,
      reason: "blank-reason",
    });
  });

  test("a withdrawn vacation leaves the queues and can't be decided", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);
    ok(await owner.withdrawVacation(vacationId));

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(await reviewer.decide(vacationId, { kind: "approve" })).toEqual({ ok: false, reason: "item-not-found" });
  });
});

describe("a question about a vacation", () => {
  test("leaves both picked queues and shows on its Profile card, not Today; the reply brings it back to both", async () => {
    const s = scenario();
    const { owner, reviewer, second, vacationId } = await sentToTwoOfThree(s);
    s.setClockTo("Wed 13:00");

    expect(await reviewer.askOwner(vacationId, "When does your flight leave?")).toEqual({ ok: true });

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
    expect(second.waitingOnReply()).toEqual([expect.objectContaining({ kind: "vacation", id: vacationId })]);
    expect(s.notifier.sentTo(owner, "reviewer-question")).toEqual([
      expect.objectContaining({
        payload: {
          itemKind: "vacation",
          itemId: vacationId,
          title: "reviewer asked about your vacation",
          body: "“When does your flight leave?”",
          url: "/profile",
        },
      }),
    ]);
    expect(owner.today().alerts).toEqual([]);
    expect(owner.today().waiting).toEqual([]);
    expect(owner.vacations()).toMatchObject([
      {
        id: vacationId,
        state: { kind: "waiting-on-reply", askedBy: "reviewer", question: "When does your flight leave?" },
      },
    ]);

    s.setClockTo("Wed 14:00");
    expect(await owner.reply(vacationId, "Sun at 7am")).toEqual({ ok: true });

    const replies = s.notifier.sent.filter((n) => n.kind === "owner-replied");
    expect(replies.map((n) => n.recipient).toSorted()).toEqual([reviewer.id, second.id].toSorted());
    expect(replies[0]!.payload.title).toBe("owner replied about their vacation");
    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ id: vacationId })]);
    expect(second.reviewQueue()).toEqual([expect.objectContaining({ id: vacationId })]);
    expect(owner.vacations()).toMatchObject([{ state: { kind: "waiting" } }]);
  });

  test("the other picked reviewer can approve it while it waits on the reply", async () => {
    const s = scenario();
    const { owner, reviewer, second, vacationId } = await sentToTwoOfThree(s);
    ok(await reviewer.askOwner(vacationId, "When does your flight leave?"));

    expect(await second.decide(vacationId, { kind: "approve" })).toEqual({ ok: true });
    expect(second.waitingOnReply()).toEqual([]);
    expect(await owner.reply(vacationId, "Sun")).toEqual({ ok: false, reason: "not-waiting" });
  });

  test("the owner can withdraw it while it waits on their reply", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);
    ok(await reviewer.askOwner(vacationId, "When does your flight leave?"));

    expect(await owner.withdrawVacation(vacationId)).toEqual({ ok: true });
    expect(reviewer.waitingOnReply()).toEqual([]);
  });
});

describe("the owner hears the decision", () => {
  test("approved: one Decision push that opens Profile, and the card says who approved it", async () => {
    const s = scenario();
    const { owner, second, vacationId } = await sentToTwoOfThree(s);
    s.setClockTo("Thu 10:00");
    ok(await second.decide(vacationId, { kind: "approve" }));

    expect(s.notifier.sentTo(owner, "vacation-decided")).toEqual([
      expect.objectContaining({
        payload: {
          itemKind: "vacation",
          itemId: vacationId,
          decision: "approved",
          title: "second approved your vacation",
          body: "Jan 12 – 18",
          url: "/profile",
        },
      }),
    ]);
    expect(owner.vacations()).toMatchObject([{ id: vacationId, state: { kind: "approved", reviewerName: "second" } }]);
  });

  test("rejected: the push quotes the reason and opens Today, and the vacation leaves Profile", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);
    ok(await reviewer.decide(vacationId, { kind: "reject", reason: "Not that week" }));

    expect(s.notifier.sentTo(owner, "vacation-decided")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          decision: "rejected",
          reason: "Not that week",
          title: "reviewer rejected your vacation",
          body: "“Not that week”",
          url: "/",
        }),
      }),
    ]);
    expect(owner.vacations()).toEqual([]);
  });

  test("with the Decision setting off, approving sends nothing", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);
    await owner.setNotificationSetting("decision", false);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    expect(s.notifier.sentTo(owner, "vacation-decided")).toEqual([]);
  });

  test("an approved vacation stays on Profile until its last day has passed", async () => {
    const s = scenario();
    const { owner, reviewer, vacationId } = await sentToTwoOfThree(s);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    await s.advanceTo("Sun+1 23:00");
    expect(owner.vacations()).toMatchObject([{ id: vacationId }]);
    await s.advanceTo("Mon+2 00:00");
    expect(owner.vacations()).toEqual([]);
  });
});

describe("once approved, covered occurrences are Excused", () => {
  test("a covered Weekly count week is Excused at the end of its Sunday; an uncovered partial week keeps its full target", async () => {
    const s = scenario();
    const { owner, second, piano } = await ownerWithThreePacts(s, "Mon 12:00");
    const vacationId = await file(owner, vacation(s.date("Sun+1"), s.date("Sat+2"), [piano], [second]));
    ok(await second.decide(vacationId, { kind: "approve" }));

    await s.advanceTo("Mon+3 00:00");

    // The week of Mon+1, whose Thursday is outside, is three days short; the week of Mon+2 adds nothing.
    expect(penalties(owner).filter((penalty) => penalty.pactName === "Piano")).toEqual([
      expect.objectContaining({ date: s.date("Mon+1"), cents: 1500 }),
    ]);
    const { history } = pactOf(owner, piano);
    if (history.kind !== "weekly-count") throw new Error("not a week heat map");
    expect(history.weeks.find((week) => week.date === s.date("Mon+2"))?.occurrence?.status.kind).toBe("excused");
  });

  test("a covered One-time deadline is Excused at the deadline and the pact Ends", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const visa = await createPact("Visa", { kind: "one-time", deadline: s.date("Wed+1"), submitAnytime: false });
    s.setClockTo("Wed 12:00");
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [visa], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    await s.advanceTo("Thu+1 00:00");

    expect(oneTimeStatus(owner, visa)).toBe("excused");
    expect(pactOf(owner, visa).stage).toBe("ended");
    expect(owed(owner)).toBe(0);
  });

  test("a covered bedtime night with no Oura data is Excused when it closes; one with an on-time bedtime is Satisfied", async () => {
    const s = scenario();
    const { owner, reviewer, bed } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Tue+1"), [bed], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));
    s.ouraSource.addSleep(owner.id, sleep("Mon+1 23:30"));

    await s.advanceTo("Wed+1 17:59");
    expect(statusOn(owner, bed, s.date("Mon+1"))).toBe("satisfied");
    expect(statusOn(owner, bed, s.date("Tue+1"))).toBe("not-judged");
    await s.advanceTo("Wed+1 18:00");
    expect(statusOn(owner, bed, s.date("Tue+1"))).toBe("excused");
    expect(penaltyDays(owner, "Bed")).not.toContain(s.date("Tue+1"));
  });

  test("Pact doesn't check AnkiWeb for an Anki day the approved vacation covers", async () => {
    const s = scenario();
    const { owner, reviewer, createPact, deckShows } = await ownerWithAnki(s);
    const spanish = await createPact({ days: ["tue"] });
    await s.advanceTo("Wed 12:00");
    const vacationId = await file(owner, vacation(s.date("Tue+1"), s.date("Tue+1"), [spanish], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));
    const callsBefore = s.ankiSource.countCalls.length;

    deckShows({}, s.date("Tue+1"), "Tue+1 04:00");
    await s.advanceTo("Tue+1 04:00");
    await s.advanceTo("Tue+1 12:00");
    await owner.checkAnki();
    await s.advanceTo("Wed+1 00:00");

    expect(s.ankiSource.countCalls.length).toBe(callsBefore);
    expect(statusOn(owner, spanish, s.date("Tue+1"))).toBe("excused");
  });

  test("an excuse filed for a covered day skips it as Excused", async () => {
    const s = scenario();
    const { owner, gym, vacationId, reviewer } = await sentToTwoOfThree(s);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    expect(ok(owner.excusePreview(gym, { from: s.date("Fri"), to: s.date("Mon+1") })).preview).toMatchObject({
      covered: [{ date: s.date("Fri") }],
      skipped: [{ date: s.date("Mon+1"), reason: "excused" }],
    });
  });

  test("a new vacation skips days already on an approved one", async () => {
    const s = scenario();
    const { owner, gym, vacationId, reviewer } = await sentToTwoOfThree(s);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    expect(forPact(owner, s.date("Mon+1"), s.date("Mon+2"), [gym], gym)).toMatchObject({
      covered: [{ date: s.date("Mon+2") }],
      skipped: ["Mon+1", "Wed+1", "Fri+1"].map((day) => ({ date: s.date(day), reason: "on-vacation" })),
    });
  });

  test("evidence rejected on a covered day leaves it for its due time, which makes it Excused, not Missed", async () => {
    const s = scenario();
    const { owner, gym, vacationId, reviewer } = await sentToTwoOfThree(s);
    ok(await reviewer.decide(vacationId, { kind: "approve" }));
    s.setClockTo("Mon+1 10:00");
    const evidenceId = ok(await owner.submitEvidence(gym, [photo()])).evidenceId;

    ok(await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" }));
    expect(statusOn(owner, gym, s.date("Mon+1"))).toBe("not-judged");
    await s.advanceTo("Tue+1 00:00");

    expect(statusOn(owner, gym, s.date("Mon+1"))).toBe("excused");
    expect(penaltyDays(owner)).not.toContain(s.date("Mon+1"));
  });

  test("a covered One-time deadline moved outside the vacation isn't covered any more; moved within it, it still is", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const inside = await createPact("Visa", { kind: "one-time", deadline: s.date("Wed+1"), submitAnytime: false });
    const outside = await createPact("Forms", { kind: "one-time", deadline: s.date("Thu+1"), submitAnytime: false });
    s.setClockTo("Wed 12:00");
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Thu+1"), [inside, outside], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    const move = async (pactId: string, deadline: string) => {
      const change = changed(owner, pactId, { schedule: { kind: "one-time", deadline, submitAnytime: false } });
      ok(await reviewer.decide(changeRequestIdOf(await owner.changePact(pactId, change)), { kind: "approve" }));
    };
    await move(inside, s.date("Tue+1"));
    await move(outside, s.date("Fri"));
    await s.advanceTo("Sat 00:00");
    await s.advanceTo("Wed+1 00:00");

    expect(oneTimeStatus(owner, inside)).toBe("excused");
    expect(oneTimeStatus(owner, outside)).toBe("missed");
  });
});

describe("what the owner isn't bothered with on covered days", () => {
  test("a rejected day in a covered Weekly count week raises no alert, as under an approved excuse", async () => {
    const s = scenario();
    const { owner, second, piano } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+1"), [piano], [second]));
    ok(await second.decide(vacationId, { kind: "approve" }));
    s.setClockTo("Tue+1 10:00");
    const evidenceId = ok(await owner.submitEvidence(piano, [photo()])).evidenceId;

    ok(await second.decide(evidenceId, { kind: "reject", reason: "That's last week's log" }));

    expect(owner.today().alerts).toEqual([]);
  });

  test("a covered night with no Oura data by 15:00 sends no push, as under an approved excuse", async () => {
    const s = scenario();
    const { owner, reviewer, bed } = await ownerWithThreePacts(s);
    const vacationId = await file(owner, vacation(s.date("Tue+1"), s.date("Tue+1"), [bed], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));
    await s.advanceTo("Wed+1 14:00");
    const before = s.notifier.sentTo(owner, "connection-problem").length;

    await s.advanceTo("Wed+1 15:00");

    expect(s.notifier.sentTo(owner, "connection-problem")).toHaveLength(before);
  });
});

describe("the ledger carries on during an approved vacation", () => {
  test("a pact not on it still adds penalties that go on the Wednesday bill, and Overdue reminders keep running", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await fifteenOwed(s);
    const read = await createPact("Read", MON_WED_FRI);
    s.setClockTo("Sat 00:20");
    const vacationId = await file(owner, vacation(s.date("Mon+1"), s.date("Sun+2"), [read], [reviewer]));
    ok(await reviewer.decide(vacationId, { kind: "approve" }));

    await tickHourly(s, "Sat 01:00", "Thu+2 18:00");

    expect(penaltyDays(owner, "Read")).toEqual([]);
    expect(penaltyDays(owner, "Gym")).toEqual(
      ["Mon", "Wed", "Fri", "Mon+1", "Wed+1", "Fri+1", "Mon+2", "Wed+2"].map((day) => s.date(day)),
    );
    expect(s.notifier.sentTo(owner, "new-bill")).toHaveLength(2);
    expect(s.notifier.sentTo(owner, "overdue-bill")).toHaveLength(2);
  });
});
