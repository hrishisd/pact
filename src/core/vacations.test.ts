// Vacations: the owner asks once, ahead of time, for a date range off from
// the pacts they pick, and sends it to the reviewers they pick. Ticket 01:
// what a vacation would cover, filing it, the owner's waiting vacations, and
// withdrawing one. Approval and its effects on judging come later.

import { describe, expect, test } from "vitest";
import type { NewVacation, Schedule } from "../shared/types.ts";
import { bedtimePact } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, ownerWithReviewers } from "./testing/camera-pact.ts";
import { ok } from "./testing/queries.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

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
