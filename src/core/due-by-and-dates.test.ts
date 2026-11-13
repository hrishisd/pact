// The optional time fields on a pact: a due-by time (Camera only) that
// evidence is due by instead of midnight, a start date that pushes the first
// occurrence later, and an end date after which the pact makes no more
// occurrences and is Ended. Each is a term: a change to it relaxes the pact or
// makes it stricter.

import { describe, expect, test } from "vitest";
import type { NewPact } from "../shared/types.ts";
import { bedtimePact, ownerWithOura } from "./testing/bedtime-pact.ts";
import { cameraPact, EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import type { AccountHandle } from "./testing/scenario.ts";
import { changeRequestIdOf, scenario } from "./testing/scenario.ts";
import { changed, heatMapDays, ok, pactOf, penaltyDays } from "./testing/queries.ts";

function stageOf(owner: AccountHandle, pactId: string) {
  const pact = pactOf(owner, pactId);
  return pact.stage === "ended" ? { stage: pact.stage, endedAt: pact.endedAt } : { stage: pact.stage };
}

describe("a due-by time", () => {
  test("due by 09:00: evidence at 08:59 is accepted, at 09:01 refused; with none, the day is Missed at 09:00", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "09:00" } });

    s.setClockTo("Tue 08:59");
    const evidenceId = await submit(owner, gym);
    s.setClockTo("Wed 09:01");
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Wed 09:01");

    const days = heatMapDays(owner, gym);
    expect(days.find((d) => d.date === s.date("Tue"))?.occurrence?.status).toEqual({
      kind: "satisfied",
      cover: null,
      phase: "past-due",
      approvedBy: "reviewer",
    });
    expect(days.find((d) => d.date === s.date("Wed"))?.occurrence?.status).toEqual({
      kind: "missed",
      penaltyCents: 500,
      cover: null,
      phase: "past-due",
      excusableUntil: new Date(s.at("Wed 09:00").getTime() + 48 * 3600_000),
      recipientName: "Sam",
      rejection: null,
    });
    expect(penaltyDays(owner)).toEqual([s.date("Wed")]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ occurrenceDate: s.date("Wed") }) }),
    ]);
  });

  test("the first occurrence is the first due at least an hour later, counting the due-by time: made Mon 08:30 due by 09:00 → Tuesday", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon+1 08:30");

    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "09:00" } });

    expect(pactOf(owner, gym)).toMatchObject({
      dueBy: "09:00",
      firstOccurrence: { date: s.date("Tue+1"), dueAt: s.at("Tue+1 09:00") },
    });
    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: EVERY_DAY }, dueBy: "09:00" })).toEqual({
      ok: true,
      firstOccurrence: { date: s.date("Tue+1"), dueAt: s.at("Tue+1 09:00") },
    });
    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: EVERY_DAY } })).toEqual({
      ok: true,
      firstOccurrence: { date: s.date("Mon+1"), dueAt: s.at("Tue+1 00:00") },
    });
  });

  test("Today: the To do card is due at the due-by time; past it, the day shows under Missed as Closed", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "21:00" } });

    await s.advanceTo("Mon 16:48");
    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        cards: [
          expect.objectContaining({
            pactId: gym,
            occurrenceDate: s.date("Mon"),
            dueAt: s.at("Mon 21:00"),
            dueBy: "21:00",
          }),
        ],
      },
    ]);

    // Past it, it's no longer To do, even before the scheduler's tick judges it.
    s.setClockTo("Mon 21:00");
    expect(owner.today().sections).toEqual([]);
    await s.advanceTo("Mon 21:00");
    expect(owner.today().sections).toEqual([
      {
        kind: "missed",
        cards: [
          expect.objectContaining({
            pactId: gym,
            occurrenceDate: s.date("Mon"),
            missedAt: s.at("Mon 21:00"),
            detail: { kind: "closed", dueBy: "21:00" },
          }),
        ],
      },
    ]);

    // The next day it's an ordinary miss, and today's card is To do again.
    await s.advanceTo("Tue 10:00");
    const [toDo, missed] = owner.today().sections;
    expect(toDo).toEqual({
      kind: "to-do",
      cards: [expect.objectContaining({ occurrenceDate: s.date("Tue"), dueBy: "21:00" })],
    });
    expect(missed).toEqual({ kind: "missed", cards: [expect.objectContaining({ detail: null })] });
  });

  test("without one, the To do card is due at midnight", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", EVERY_DAY);

    expect(owner.today().sections).toEqual([
      { kind: "to-do", cards: [expect.objectContaining({ dueAt: s.at("Tue 00:00"), dueBy: null })] },
    ]);
  });

  test("is refused on an Oura Ring pact, at midnight, or when it isn't a time", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);
    const oura: NewPact = { ...bedtimePact(sam.id, reviewer), dueBy: "09:00" };
    expect(await owner.createPact(oura)).toEqual({ ok: false, reason: "invalid-due-by" });
    const camera = cameraPact("Gym", EVERY_DAY, { recipientId: sam.id, reviewers: [reviewer] });
    expect(await owner.createPact({ ...camera, dueBy: "00:00" })).toEqual({ ok: false, reason: "invalid-due-by" });
    expect(await owner.createPact({ ...camera, dueBy: "9am" })).toEqual({ ok: false, reason: "invalid-due-by" });
    expect(owner.pacts()).toEqual([]);
  });
});

describe("a start date", () => {
  test("next Monday → nothing opens before then; Coming up says when it starts", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const gym = await createPact("Gym", EVERY_DAY, { dates: { startDate: s.date("Mon+1") } });

    expect(pactOf(owner, gym)).toMatchObject({
      startDate: s.date("Mon+1"),
      firstOccurrence: { date: s.date("Mon+1"), dueAt: s.at("Tue+1 00:00") },
    });
    expect(owner.today().sections).toEqual([
      {
        kind: "coming-up",
        cards: [expect.objectContaining({ pactId: gym, opensOn: s.date("Mon+1"), startDate: s.date("Mon+1") })],
      },
    ]);
    s.setClockTo("Wed 12:00");
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });

    await s.advanceTo("Mon+1 00:00");
    expect(penaltyDays(owner)).toEqual([]);
    expect(heatMapDays(owner, gym)[0]?.date).toBe(s.date("Mon+1"));
    await s.advanceTo("Tue+1 00:00");
    expect(penaltyDays(owner)).toEqual([s.date("Mon+1")]);
  });

  test("on a day the schedule skips → the first scheduled day after it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const gym = await createPact("Gym", MON_WED_FRI, { dates: { startDate: s.date("Tue+1") } });

    expect(pactOf(owner, gym).firstOccurrence.date).toBe(s.date("Wed+1"));
  });

  test("earlier than the first occurrence the pact would have anyway changes nothing", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const today = await createPact("Gym", EVERY_DAY, { dates: { startDate: s.date("Mon") } });
    const past = await createPact("Run", EVERY_DAY, { dates: { startDate: "2025-12-01", dueBy: "09:00" } });

    expect(pactOf(owner, today).firstOccurrence.date).toBe(s.date("Mon"));
    expect(pactOf(owner, past).firstOccurrence.date).toBe(s.date("Tue"));
  });

  test("that isn't a date is refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    await expect(createPact("Gym", EVERY_DAY, { dates: { startDate: "next week" } })).rejects.toThrow(
      "invalid-start-date",
    );
    await expect(createPact("Gym", EVERY_DAY, { dates: { startDate: "2026-02-30" } })).rejects.toThrow(
      "invalid-start-date",
    );
    expect(owner.pacts()).toEqual([]);
  });
});

describe("an end date", () => {
  test("Friday → Friday is judged, Saturday never opens, and the pact is Ended", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { endDate: s.date("Fri") } });
    expect(pactOf(owner, gym).endDate).toBe(s.date("Fri"));

    await s.advanceTo("Fri 23:59");
    expect(stageOf(owner, gym)).toEqual({ stage: "active" });
    await s.advanceTo("Sat 00:00");

    expect(penaltyDays(owner)).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu"), s.date("Fri")]);
    expect(stageOf(owner, gym)).toEqual({ stage: "ended", endedAt: s.at("Sat 00:00") });
    expect(owner.pacts()).toEqual([expect.objectContaining({ id: gym, stage: "ended" })]);
    // Yesterday was Friday, its last day.
    expect(owner.today().yesterday).toEqual([expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Fri") })]);

    s.setClockTo("Sat 10:00");
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    await s.advanceTo("Mon+1 00:00");
    expect(penaltyDays(owner)).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu"), s.date("Fri")]);
    expect(owner.today().yesterday).toEqual([]);
    const days = heatMapDays(owner, gym);
    expect(days.map((d) => d.date)).toEqual([
      s.date("Mon"),
      s.date("Tue"),
      s.date("Wed"),
      s.date("Thu"),
      s.date("Fri"),
      s.date("Sat"),
      s.date("Sun"),
    ]);
    expect(days.filter((d) => d.occurrence === null).map((d) => d.date)).toEqual([s.date("Sat"), s.date("Sun")]);
  });

  test("on a bedtime pact, the last night is judged at 6pm the next day, then the pact is Ended", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);
    const created = ok(await owner.createPact({ ...bedtimePact(sam.id, reviewer), endDate: s.date("Fri") }));
    const bed = created.pactId;

    await s.advanceTo("Sat 17:59");
    expect(stageOf(owner, bed)).toEqual({ stage: "active" });
    await s.advanceTo("Sat 18:00");

    expect(penaltyDays(owner).at(-1)).toBe(s.date("Fri"));
    expect(stageOf(owner, bed)).toEqual({ stage: "ended", endedAt: s.at("Sat 18:00") });
    await s.advanceTo("Mon+1 18:00");
    expect(penaltyDays(owner).at(-1)).toBe(s.date("Fri"));
  });

  test("before the first occurrence, or not a date, is refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    await expect(
      createPact("Gym", EVERY_DAY, { dates: { startDate: s.date("Mon+1"), endDate: s.date("Fri") } }),
    ).rejects.toThrow("end-date-too-early");
    await expect(createPact("Gym", EVERY_DAY, { dates: { dueBy: "09:00", endDate: s.date("Mon") } })).rejects.toThrow(
      "end-date-too-early",
    );
    await expect(createPact("Gym", EVERY_DAY, { dates: { endDate: "Friday" } })).rejects.toThrow("invalid-end-date");
    // Its first occurrence is its only one.
    const once = await createPact("Gym", EVERY_DAY, { dates: { endDate: s.date("Mon") } });
    expect(pactOf(owner, once).firstOccurrence.date).toBe(s.date("Mon"));
  });
});

describe("changing them after the edit window", () => {
  test("moving the due-by time later → a change request; approved, it applies from the next occurrence not open yet", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "09:00" } });
    await s.advanceTo("Thu 08:00");

    const result = ok(await owner.changePact(gym, changed(owner, gym, { dueBy: "10:00" })));

    expect(result.outcome).toEqual({
      kind: "needs-approval",
      reviewerNames: ["reviewer", "second"],
      bundlesStricter: false,
      appliesNow: [],
      changeRequestId: expect.any(String),
    });
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({
        kind: "change-request",
        changes: [{ term: "due-by", before: "09:00", after: "10:00", effect: "needs-approval", reason: "later-time" }],
        start: expect.objectContaining({ appliesFrom: s.date("Fri") }),
      }),
    ]);
    expect(pactOf(owner, gym)).toMatchObject({ dueBy: "09:00" });
    await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
    expect(pactOf(owner, gym)).toMatchObject({
      dueBy: "10:00",
      newTerms: { appliesFrom: s.date("Fri"), todayKeepsCents: null },
    });

    // Thursday keeps 09:00.
    s.setClockTo("Thu 09:30");
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    s.setClockTo("Fri 09:30");
    await submit(owner, gym);
  });

  test("moving it earlier applies without approval from the next occurrence not open yet", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { dueBy: "21:00" } });
    await s.advanceTo("Wed 12:00");

    const result = ok(await owner.changePact(gym, changed(owner, gym, { dueBy: "09:00" })));

    expect(result.outcome).toEqual({
      kind: "stricter",
      appliesFrom: s.date("Thu"),
      todayKeepsCents: null,
      appliesNow: [],
    });
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owner.today().sections[0]).toEqual({
      kind: "to-do",
      cards: [expect.objectContaining({ occurrenceDate: s.date("Wed"), dueAt: s.at("Wed 21:00"), dueBy: "21:00" })],
    });
    s.setClockTo("Wed 20:00");
    await submit(owner, gym);
    await s.advanceTo("Thu 09:00");
    expect(penaltyDays(owner)).toEqual([s.date("Mon"), s.date("Tue"), s.date("Thu")]);
  });

  test("adding a due-by time is stricter; removing one needs approval", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const plain = await createPact("Gym", EVERY_DAY);
    const early = await createPact("Run", EVERY_DAY, { dates: { dueBy: "09:00" } });
    await s.advanceTo("Wed 12:00");

    expect(ok(await owner.changePact(plain, changed(owner, plain, { dueBy: "21:00" }))).outcome).toEqual({
      kind: "stricter",
      appliesFrom: s.date("Thu"),
      todayKeepsCents: null,
      appliesNow: [],
    });
    const removed = ok(await owner.changePact(early, changed(owner, early, { dueBy: undefined })));
    expect(removed.outcome.kind).toBe("needs-approval");
    expect(owner.changeRequest(changeRequestIdOf(removed))).toMatchObject({
      ok: true,
      changeRequest: {
        changes: [
          { term: "due-by", before: "09:00", after: null, effect: "needs-approval", reason: "due-at-midnight" },
        ],
      },
    });
  });

  test("a later start date needs approval, an earlier one is stricter, and once the pact has started it can't change", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const later = await createPact("Gym", EVERY_DAY, { dates: { startDate: s.date("Mon+1") } });
    const started = await createPact("Run", EVERY_DAY);
    await s.advanceTo("Tue 12:00");

    const pushed = ok(await owner.changePact(later, changed(owner, later, { startDate: s.date("Wed+1") })));
    expect(pushed.outcome.kind).toBe("needs-approval");
    expect(reviewer.reviewQueue()[0]).toMatchObject({
      changes: [
        {
          term: "start-date",
          before: s.date("Mon+1"),
          after: s.date("Wed+1"),
          effect: "needs-approval",
          reason: "later-start",
        },
      ],
    });
    await owner.withdrawChangeRequest(changeRequestIdOf(pushed));

    const sooner = ok(await owner.changePact(later, changed(owner, later, { startDate: s.date("Fri") })));
    expect(sooner.outcome).toEqual({
      kind: "stricter",
      appliesFrom: s.date("Fri"),
      todayKeepsCents: null,
      appliesNow: [],
    });
    expect(pactOf(owner, later)).toMatchObject({ startDate: s.date("Fri"), firstOccurrence: { date: s.date("Fri") } });

    expect(await owner.changePact(started, changed(owner, started, { startDate: s.date("Mon+1") }))).toEqual({
      ok: false,
      reason: "pact-started",
    });
  });

  test("a stricter change to a pact starting more than a week off applies from its first occurrence", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { startDate: "2026-01-26" } });
    await s.advanceTo("Tue 12:00");

    const result = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 })));

    expect(result.outcome).toEqual({
      kind: "stricter",
      appliesFrom: "2026-01-26",
      todayKeepsCents: null,
      appliesNow: [],
    });
  });

  test("adding an end date or moving it earlier needs approval; moving it later or removing it is stricter", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const open = await createPact("Gym", EVERY_DAY);
    const ending = await createPact("Run", EVERY_DAY, { dates: { endDate: "2026-01-31" } });
    await s.advanceTo("Wed 12:00");

    const added = await owner.changePact(open, changed(owner, open, { endDate: "2026-01-31" }));
    expect(added).toMatchObject({ ok: true, outcome: { kind: "needs-approval" } });
    expect(owner.changePreview(ending, changed(owner, ending, { endDate: "2026-01-20" }))).toMatchObject({
      ok: true,
      preview: {
        changes: [
          {
            term: "end-date",
            before: "2026-01-31",
            after: "2026-01-20",
            effect: "needs-approval",
            reason: "earlier-end",
          },
        ],
        outcome: { kind: "needs-approval" },
      },
    });
    expect(owner.changePreview(ending, changed(owner, ending, { endDate: "2026-02-28" }))).toMatchObject({
      ok: true,
      preview: {
        changes: [{ term: "end-date", effect: "stricter" }],
        outcome: { kind: "stricter", appliesFrom: s.date("Thu") },
      },
    });
    const removed = ok(await owner.changePact(ending, changed(owner, ending, { endDate: undefined })));
    expect(removed.outcome).toEqual({
      kind: "stricter",
      appliesFrom: s.date("Thu"),
      todayKeepsCents: null,
      appliesNow: [],
    });
    expect(pactOf(owner, ending).endDate).toBeNull();
  });

  test("when several refusals apply: the edit window, then the terms, then the schedule's kind, then a waiting request, then what's open", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    expect(await owner.changePact(gym, changed(owner, gym, { name: " " }))).toEqual({
      ok: false,
      reason: "edit-window-open",
    });
    expect(await owner.renamePact(gym, " ")).toEqual({ ok: false, reason: "edit-window-open" });
    await s.advanceTo("Wed 12:00");
    const weekly = { kind: "weekly-count", target: 3 } as const;

    // Each refused on its own.
    expect(await owner.changePact(gym, changed(owner, gym, { startDate: s.date("Tue") }))).toEqual({
      ok: false,
      reason: "pact-started",
    });
    expect(await owner.changePact(gym, changed(owner, gym, { endDate: s.date("Tue") }))).toEqual({
      ok: false,
      reason: "end-date-too-early",
    });
    // Together, the start date is the one refused.
    expect(
      await owner.changePact(gym, changed(owner, gym, { startDate: s.date("Tue"), endDate: s.date("Tue") })),
    ).toEqual({
      ok: false,
      reason: "pact-started",
    });
    expect(
      await owner.changePact(gym, changed(owner, gym, { name: " ", schedule: weekly, startDate: s.date("Tue") })),
    ).toEqual({
      ok: false,
      reason: "blank-name",
    });
    expect(await owner.changePact(gym, changed(owner, gym, { schedule: weekly, startDate: s.date("Tue") }))).toEqual({
      ok: false,
      reason: "schedule-kind-fixed",
    });
    ok(await owner.changePact(gym, changed(owner, gym, { endDate: "2026-01-31" })));
    expect(
      await owner.changePact(gym, changed(owner, gym, { startDate: s.date("Tue"), endDate: s.date("Tue") })),
    ).toEqual({
      ok: false,
      reason: "change-request-waiting",
    });
  });

  test("an approved end date ends the pact once it passes; one already past is refused", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Wed 12:00");

    expect(await owner.changePact(gym, changed(owner, gym, { endDate: s.date("Tue") }))).toEqual({
      ok: false,
      reason: "end-date-too-early",
    });
    const result = ok(await owner.changePact(gym, changed(owner, gym, { endDate: s.date("Fri") })));
    await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
    await s.advanceTo("Sun 00:00");

    expect(stageOf(owner, gym)).toEqual({ stage: "ended", endedAt: s.at("Sat 00:00") });
    expect(penaltyDays(owner)).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu"), s.date("Fri")]);
  });
});

describe("in the edit window", () => {
  test("they change freely, and the first occurrence follows them", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    s.setClockTo("Mon 09:05");

    const edited = await owner.editPact(
      gym,
      cameraPact("Gym", EVERY_DAY, {
        recipientId: sam.id,
        reviewers: [reviewer, second],
        dates: { dueBy: "07:00", startDate: s.date("Wed"), endDate: s.date("Mon+1") },
      }),
    );

    expect(edited).toEqual({ ok: true });
    expect(pactOf(owner, gym)).toMatchObject({
      dueBy: "07:00",
      startDate: s.date("Wed"),
      endDate: s.date("Mon+1"),
      firstOccurrence: { date: s.date("Wed"), dueAt: s.at("Wed 07:00") },
    });
  });
});
