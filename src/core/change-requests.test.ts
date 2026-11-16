// Changing a pact after its edit window: a change that only makes it stricter
// applies at once, from the first occurrence not open yet; one that relaxes it
// becomes a change request, and the old terms stay until a reviewer approves
// it. The name and an added reviewer apply at once, and ending the pact is a
// change request of its own.

import { describe, expect, test } from "vitest";
import { termsOf } from "../shared/terms.ts";
import type { PactChange } from "../shared/types.ts";
import { ownerWithAnki } from "./testing/anki-pact.ts";
import { bedtimePact, ownerWithOura, sleep } from "./testing/bedtime-pact.ts";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import type { Scenario } from "./testing/scenario.ts";
import { changed, ok, pactOf, penalties, penaltyDays } from "./testing/queries.ts";
import { changeRequestIdOf, scenario } from "./testing/scenario.ts";

/** An every-day $5 Gym pact made Mon 09:00, its edit window long closed by Thu 15:00. */
async function dailyGym(s: Scenario) {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", EVERY_DAY);
  await s.advanceTo("Thu 15:00");
  return { ...setup, gym };
}

describe("a stricter change applies at once, from the first occurrence not open yet", () => {
  test("the spec's example: raising the penalty at 3pm Thursday on a daily pact → Thursday still costs $5, Friday $10", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);

    const result = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 })));

    expect(result).toEqual({
      ok: true,
      outcome: { kind: "stricter", appliesFrom: s.date("Fri"), todayKeepsCents: 500, appliesNow: [] },
    });
    expect(pactOf(owner, gym)).toMatchObject({
      penaltyCents: 1000,
      newTerms: { appliesFrom: s.date("Fri"), todayKeepsCents: 500 },
    });
    // Today's card keeps today's terms.
    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        cards: [expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Thu"), penaltyCents: 500 })],
      },
      expect.objectContaining({ kind: "missed" }),
    ]);
    expect(reviewer.reviewQueue()).toEqual([]);

    await s.advanceTo("Sat 00:00");

    expect(penalties(owner).filter((p) => p.date >= s.date("Thu"))).toEqual([
      { date: s.date("Thu"), cents: 500, recipient: "Sam", pactName: "Gym" },
      { date: s.date("Fri"), cents: 1000, recipient: "Sam", pactName: "Gym" },
    ]);
    expect(pactOf(owner, gym).newTerms).toBeNull();
  });

  test("adding a day is stricter: the new day counts from tomorrow, never today", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", ["mon", "fri"]);
    await s.advanceTo("Wed 12:00");

    const result = ok(
      await owner.changePact(
        gym,
        changed(owner, gym, { schedule: { kind: "fixed-days", days: ["mon", "wed", "thu", "fri"] } }),
      ),
    );

    expect(result.outcome).toEqual({
      kind: "stricter",
      appliesFrom: s.date("Thu"),
      todayKeepsCents: null,
      appliesNow: [],
    });
    await s.advanceTo("Sat 00:00");
    expect(penalties(owner).map((p) => p.date)).toEqual([s.date("Mon"), s.date("Thu"), s.date("Fri")]);
  });

  test("a rejection after the change still costs that day's penalty, to that day's recipient", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const submitted = ok(await owner.submitEvidence(gym, [photo()]));
    ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 })));
    await s.advanceTo("Fri 10:00");

    await reviewer.decide(submitted.evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(penalties(owner).find((p) => p.date === s.date("Thu"))).toEqual({
      date: s.date("Thu"),
      cents: 500,
      recipient: "Sam",
      pactName: "Gym",
    });
  });

  test("the name, and adding a reviewer, apply at once and the new reviewer is told", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [second] });
    await s.advanceTo("Wed 12:00");
    const third = await s.befriend(owner, "third");

    expect(await owner.renamePact(gym, " Morning gym ")).toEqual({ ok: true });
    // One who already reviews it is left as they are, and isn't told again.
    expect(await owner.addReviewers(gym, [second.id, third.id, third.id])).toEqual({ ok: true });

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(s.notifier.sentTo(second, "picked-as-reviewer")).toHaveLength(1);
    expect(pactOf(owner, gym)).toMatchObject({
      name: "Morning gym",
      reviewers: [
        { id: second.id, name: "second" },
        { id: third.id, name: "third" },
      ],
      newTerms: null,
    });
    expect(s.notifier.sentTo(third)).toEqual([
      {
        recipient: third.id,
        kind: "picked-as-reviewer",
        payload: {
          pactId: gym,
          title: "owner added you as a reviewer",
          body: "Morning gym · Mon, Wed, Fri · $5 per miss",
          url: "/review",
        },
      },
    ]);
  });
});

describe("the pact page's at-once changes apply to the terms as they stand", () => {
  test("after an approved change, a rename, an added reviewer and new reminders leave the approved terms in place", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym } = await dailyGym(s);
    const third = await s.befriend(owner, "third");
    // The pact page loads these terms; a reviewer then approves a lower penalty and second's removal elsewhere.
    expect(pactOf(owner, gym)).toMatchObject({
      penaltyCents: 500,
      reviewers: [{ name: "reviewer" }, { name: "second" }],
    });
    const sent = ok(
      await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200, reviewerIds: [reviewer.id] })),
    );
    await reviewer.decide(changeRequestIdOf(sent), { kind: "approve" });

    expect(await owner.renamePact(gym, "Morning gym")).toEqual({ ok: true });
    expect(await owner.addReviewers(gym, [third.id])).toEqual({ ok: true });
    expect(await owner.setReminders(gym, ["18:00"])).toEqual({ ok: true });

    expect(pactOf(owner, gym)).toMatchObject({
      name: "Morning gym",
      penaltyCents: 200,
      reviewers: [
        { id: reviewer.id, name: "reviewer" },
        { id: third.id, name: "third" },
      ],
      reminders: ["18:00"],
    });
    // Told once, when the edit window closed: never added back.
    expect(s.notifier.sentTo(second, "picked-as-reviewer")).toHaveLength(1);
    expect(reviewer.reviewQueue()).toEqual([]);
  });

  test("made while a change request waits, they stay out of it, and approving it keeps them", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const third = await s.befriend(owner, "third");
    const id = changeRequestIdOf(ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 }))));

    expect(await owner.renamePact(gym, "Morning gym")).toEqual({ ok: true });
    expect(await owner.addReviewers(gym, [third.id])).toEqual({ ok: true });
    expect(await owner.setReminders(gym, ["18:00"])).toEqual({ ok: true });
    expect(owner.changeRequest(id)).toMatchObject({
      ok: true,
      changeRequest: { pactName: "Morning gym", changes: [{ term: "penalty", before: 500, after: 200 }] },
    });
    await reviewer.decide(id, { kind: "approve" });

    expect(pactOf(owner, gym)).toMatchObject({
      name: "Morning gym",
      penaltyCents: 200,
      reviewers: [{ name: "reviewer" }, { name: "second" }, { name: "third" }],
      reminders: ["18:00"],
    });
  });
});

describe("a relaxing change waits for a reviewer", () => {
  test("lowering the penalty → a change request; $5 applies until approved, then from the next occurrence not open yet", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym } = await dailyGym(s);

    const result = ok(
      await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200, note: "Money is tight this month" })),
    );

    expect(result).toEqual({
      ok: true,
      outcome: {
        kind: "needs-approval",
        reviewerNames: ["reviewer", "second"],
        bundlesStricter: false,
        appliesNow: [],
        changeRequestId: expect.any(String),
      },
    });
    const id = changeRequestIdOf(result);
    expect(pactOf(owner, gym)).toMatchObject({ penaltyCents: 500, newTerms: null });
    for (const r of [reviewer, second]) {
      expect(s.notifier.sentTo(r, "review-item")).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            itemKind: "change-request",
            itemId: id,
            pactId: gym,
            title: "owner asked to change Gym",
            body: "Penalty · “Money is tight this month”",
          }),
        }),
      ]);
    }
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({
        kind: "change-request",
        id,
        pactId: gym,
        pactName: "Gym",
        ownerName: "owner",
        endsPact: false,
        note: "Money is tight this month",
        requestedAt: s.at("Thu 15:00"),
        changes: [{ term: "penalty", before: 500, after: 200, effect: "needs-approval", reason: "lower-penalty" }],
        start: { appliesFrom: s.date("Fri"), todayKeepsCents: 500 },
      }),
    ]);

    await s.advanceTo("Fri 10:00");
    expect(await reviewer.decide(id, { kind: "approve" })).toEqual({ ok: true });

    expect(pactOf(owner, gym)).toMatchObject({
      penaltyCents: 200,
      newTerms: { appliesFrom: s.date("Sat"), todayKeepsCents: 500 },
    });
    expect(s.notifier.sentTo(owner, "change-request-decided")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          itemId: id,
          decision: "approved",
          title: "reviewer approved your change",
          body: "Gym · New terms start Sat Jan 10",
        }),
      }),
    ]);
    await s.advanceTo("Sun 00:00");
    expect(penalties(owner).filter((p) => p.date >= s.date("Thu"))).toEqual([
      { date: s.date("Thu"), cents: 500, recipient: "Sam", pactName: "Gym" },
      { date: s.date("Fri"), cents: 500, recipient: "Sam", pactName: "Gym" },
      { date: s.date("Sat"), cents: 200, recipient: "Sam", pactName: "Gym" },
    ]);
  });

  test("a change of recipient is a change request; approved, the next day's penalty goes to the new recipient", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const added = ok(await owner.addRecipient({ name: "Red Cross" }));

    const result = ok(await owner.changePact(gym, changed(owner, gym, { recipientId: added.recipient.id })));

    expect(result.outcome.kind).toBe("needs-approval");
    expect(pactOf(owner, gym).recipient.name).toBe("Sam");
    expect(reviewer.reviewQueue()[0]).toMatchObject({
      changes: [
        {
          term: "recipient",
          before: { name: "Sam" },
          after: { id: added.recipient.id, name: "Red Cross" },
          effect: "needs-approval",
          reason: "recipient-changed",
        },
      ],
    });
    await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
    await s.advanceTo("Sat 00:00");
    expect(penalties(owner).filter((p) => p.date >= s.date("Thu"))).toEqual([
      { date: s.date("Thu"), cents: 500, recipient: "Sam", pactName: "Gym" },
      { date: s.date("Fri"), cents: 500, recipient: "Red Cross", pactName: "Gym" },
    ]);
  });

  test("a change of description is a change request; reviewers check today's photo against today's description", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);

    const result = ok(await owner.changePact(gym, changed(owner, gym, { description: "A photo of any workout" })));

    expect(result.outcome.kind).toBe("needs-approval");
    expect(pactOf(owner, gym).description).toBe("A photo of Gym");
    await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
    expect(pactOf(owner, gym).description).toBe("A photo of any workout");
    ok(await owner.submitEvidence(gym, [photo()]));
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({ kind: "evidence", occurrenceDate: s.date("Thu"), description: "A photo of Gym" }),
    ]);
  });

  test("removing a reviewer is a change request; approved, they stop reviewing the pact", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym } = await dailyGym(s);

    const result = ok(await owner.changePact(gym, changed(owner, gym, { reviewerIds: [reviewer.id] })));

    expect(result.outcome).toEqual({
      kind: "needs-approval",
      reviewerNames: ["reviewer", "second"],
      bundlesStricter: false,
      appliesNow: [],
      changeRequestId: expect.any(String),
    });
    expect(pactOf(owner, gym).reviewers.map((r) => r.name)).toEqual(["reviewer", "second"]);
    expect(second.reviewQueue()[0]).toMatchObject({
      changes: [
        {
          term: "reviewers",
          before: [
            { id: reviewer.id, name: "reviewer" },
            { id: second.id, name: "second" },
          ],
          after: [{ id: reviewer.id, name: "reviewer" }],
          added: [],
          removed: [{ id: second.id, name: "second" }],
          effect: "needs-approval",
          reason: "reviewers-removed",
        },
      ],
    });
    await second.decide(changeRequestIdOf(result), { kind: "approve" });
    expect(pactOf(owner, gym).reviewers.map((r) => r.name)).toEqual(["reviewer"]);
    ok(await owner.submitEvidence(gym, [photo()]));
    expect(second.reviewQueue()).toEqual([]);
    expect(reviewer.reviewQueue()).toHaveLength(1);
  });

  test("raising the penalty and removing a day in one change → one change request; nothing applies until approved", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Wed 12:00");
    const fewer: Partial<PactChange> = { schedule: { kind: "fixed-days", days: ["mon", "wed"] }, penaltyCents: 1000 };

    expect(owner.changePreview(gym, changed(owner, gym, fewer))).toEqual({
      ok: true,
      preview: {
        changes: [
          {
            term: "schedule",
            before: { kind: "fixed-days", days: MON_WED_FRI },
            after: { kind: "fixed-days", days: ["mon", "wed"] },
            effect: "needs-approval",
            reason: "fewer-days",
          },
          { term: "penalty", before: 500, after: 1000, effect: "stricter" },
        ],
        outcome: {
          kind: "needs-approval",
          reviewerNames: ["reviewer", "second"],
          bundlesStricter: true,
          appliesNow: [],
        },
      },
    });
    const result = ok(await owner.changePact(gym, changed(owner, gym, fewer)));

    expect(pactOf(owner, gym)).toMatchObject({ penaltyCents: 500, schedule: { days: MON_WED_FRI } });
    await s.advanceTo("Sat 00:00");
    expect(penalties(owner).map((p) => [p.date, p.cents])).toEqual([
      [s.date("Mon"), 500],
      [s.date("Wed"), 500],
      [s.date("Fri"), 500],
    ]);

    await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
    await s.advanceTo("Sat+1 00:00");
    expect(penalties(owner).map((p) => [p.date, p.cents])).toEqual([
      [s.date("Mon"), 500],
      [s.date("Wed"), 500],
      [s.date("Fri"), 500],
      [s.date("Mon+1"), 1000],
      [s.date("Wed+1"), 1000],
    ]);
  });

  test("a rejected change leaves the terms as they were, and the owner hears why", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const result = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 })));

    expect(await reviewer.decide(changeRequestIdOf(result), { kind: "reject", reason: "You can afford $5" })).toEqual({
      ok: true,
    });

    expect(pactOf(owner, gym)).toMatchObject({ penaltyCents: 500, newTerms: null, waiting: [] });
    expect(owner.changeRequest(changeRequestIdOf(result))).toMatchObject({
      ok: true,
      changeRequest: {
        state: { kind: "rejected", reviewerName: "reviewer", reason: "You can afford $5" },
        endsPact: false,
        changes: [{ term: "penalty", before: 500, after: 200, effect: "needs-approval", reason: "lower-penalty" }],
        // Decided: nothing starts any more.
        start: null,
      },
    });
    expect(s.notifier.sentTo(owner, "change-request-decided")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ title: "reviewer rejected your change", body: "Gym · “You can afford $5”" }),
      }),
    ]);
    await s.advanceTo("Sat 00:00");
    expect(
      penalties(owner)
        .filter((p) => p.date >= s.date("Thu"))
        .map((p) => p.cents),
    ).toEqual([500, 500]);
  });

  test("a later in-bed-by time relaxes a bedtime pact; an earlier one is stricter", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");
    const reviewer = await s.befriend(owner, "reviewer");
    const sam = ok(await owner.addRecipient({ name: "Sam" }));
    await owner.connectOura();
    const created = ok(await owner.createPact(bedtimePact(sam.recipient.id, reviewer, "23:00")));
    await s.advanceTo("Wed 12:00");
    const terms = termsOf(pactOf(owner, created.pactId));

    expect(owner.changePreview(created.pactId, { ...terms, inBedBy: "00:30" })).toMatchObject({
      ok: true,
      preview: {
        changes: [
          { term: "in-bed-by", before: "23:00", after: "00:30", effect: "needs-approval", reason: "later-time" },
        ],
      },
    });
    expect(owner.changePreview(created.pactId, { ...terms, inBedBy: "22:30" })).toMatchObject({
      ok: true,
      preview: {
        changes: [{ term: "in-bed-by", before: "23:00", after: "22:30", effect: "stricter" }],
        outcome: { kind: "stricter", appliesFrom: s.date("Thu") },
      },
    });

    // Its change request shows the in-bed-by time it leaves alone, and no due-by time or deck.
    const sent = ok(await owner.changePact(created.pactId, changed(owner, created.pactId, { penaltyCents: 200 })));
    const view = owner.changeRequest(changeRequestIdOf(sent));
    expect(view).toMatchObject({ ok: true, changeRequest: { current: { evidenceKind: "oura", inBedBy: "23:00" } } });
    expect(view).not.toHaveProperty("changeRequest.current.dueBy");
    expect(view).not.toHaveProperty("changeRequest.current.anki");
  });
});

describe("a change with the Oura or AnkiWeb connection gone", () => {
  test("an Oura Ring pact: a higher penalty applies, and a later in-bed-by time waits for approval", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const bed = await createPact("23:00");
    await s.advanceTo("Wed 12:00");
    await owner.disconnectOura();

    expect(ok(await owner.changePact(bed, changed(owner, bed, { penaltyCents: 1000 }))).outcome).toMatchObject({
      kind: "stricter",
      appliesFrom: s.date("Thu"),
    });
    expect(ok(await owner.changePact(bed, changed(owner, bed, { inBedBy: "00:30" }))).outcome).toMatchObject({
      kind: "needs-approval",
    });
    expect(pactOf(owner, bed)).toMatchObject({ penaltyCents: 1000, inBedBy: "23:00" });
  });

  test("an Anki pact: fewer days waits for approval on its own deck; another deck is refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const spanish = await createPact();
    await s.advanceTo("Wed 12:00");
    await owner.disconnectAnki();

    expect(
      ok(await owner.changePact(spanish, changed(owner, spanish, { schedule: { kind: "fixed-days", days: ["mon"] } })))
        .outcome,
    ).toMatchObject({ kind: "needs-approval" });
    expect(owner.changePreview(spanish, changed(owner, spanish, { ankiDeckId: "1700000000002" }))).toEqual({
      ok: false,
      reason: "anki-not-connected",
    });
    expect(await owner.changePact(spanish, changed(owner, spanish, { ankiDeckId: "1700000000002" }))).toEqual({
      ok: false,
      reason: "anki-not-connected",
    });
  });
});

describe("why a change needs approval, and what applies at once with it", () => {
  /** Pacts made Mon 09:00 with each kind of term to change, looked at Tue 12:00. */
  async function pactsToChange(s: Scenario) {
    const setup = await ownerWithReviewers(s);
    const { owner, createPact } = setup;
    const other = ok(await owner.addRecipient({ name: "Other" })).recipient;
    const third = await s.befriend(owner, "third");
    const fourth = await s.befriend(owner, "fourth");
    const pacts = {
      gym: await createPact("Gym", EVERY_DAY, { dates: { dueBy: "21:00", endDate: s.date("Mon+8") } }),
      run: await createPact("Run", MON_WED_FRI),
      swim: await createPact("Swim", ["thu"], { dates: { startDate: s.date("Thu+1") } }),
      yoga: await createPact("Yoga", ["thu"]),
      piano: await createPact("Piano", { kind: "weekly-count", target: 3 }),
      essay: await createPact("Essay", { kind: "one-time", deadline: s.date("Fri+1"), submitAnytime: false }),
      thesis: await createPact("Thesis", { kind: "one-time", deadline: s.date("Fri+1"), submitAnytime: true }),
    };
    await s.advanceTo("Tue 12:00");
    /** What the preview of `change` to `pact` says of each changed term: why it needs approval, or its effect. */
    const why = (pact: keyof typeof pacts, change: Partial<PactChange>) => {
      const { preview } = ok(owner.changePreview(pacts[pact], changed(owner, pacts[pact], change)));
      return preview.changes.map((c) => [c.term, c.effect === "needs-approval" ? c.reason : c.effect]);
    };
    const outcomeOf = (pact: keyof typeof pacts, change: Partial<PactChange>) =>
      ok(owner.changePreview(pacts[pact], changed(owner, pacts[pact], change))).preview.outcome;
    return { ...setup, other, third, fourth, pacts, why, outcomeOf };
  }

  test("each relaxing change carries why it needs approval; a stricter one doesn't", async () => {
    const s = scenario();
    const { reviewer, other, why } = await pactsToChange(s);
    const oneTime = (deadline: string, submitAnytime: boolean) =>
      ({ kind: "one-time", deadline: s.date(deadline), submitAnytime }) as const;

    expect(why("gym", { description: "Me at the gym" })).toEqual([["description", "defines-photo"]]);
    expect(why("gym", { schedule: { kind: "fixed-days", days: ["mon", "tue"] } })).toEqual([
      ["schedule", "fewer-days"],
    ]);
    expect(why("gym", { dueBy: "22:00" })).toEqual([["due-by", "later-time"]]);
    expect(why("gym", { dueBy: undefined })).toEqual([["due-by", "due-at-midnight"]]);
    expect(why("gym", { dueBy: "20:00" })).toEqual([["due-by", "stricter"]]);
    expect(why("gym", { endDate: s.date("Mon+4") })).toEqual([["end-date", "earlier-end"]]);
    expect(why("gym", { endDate: undefined })).toEqual([["end-date", "stricter"]]);
    expect(why("run", { endDate: s.date("Mon+4") })).toEqual([["end-date", "end-added"]]);
    expect(why("swim", { startDate: s.date("Thu+2") })).toEqual([["start-date", "later-start"]]);
    expect(why("swim", { startDate: s.date("Thu") })).toEqual([["start-date", "stricter"]]);
    expect(why("yoga", { startDate: s.date("Thu+1") })).toEqual([["start-date", "start-added"]]);
    expect(why("gym", { penaltyCents: 300 })).toEqual([["penalty", "lower-penalty"]]);
    expect(why("gym", { penaltyCents: 1000 })).toEqual([["penalty", "stricter"]]);
    expect(why("gym", { recipientId: other.id })).toEqual([["recipient", "recipient-changed"]]);
    expect(why("gym", { reviewerIds: [reviewer.id] })).toEqual([["reviewers", "reviewers-removed"]]);
    expect(why("piano", { schedule: { kind: "weekly-count", target: 2 } })).toEqual([["schedule", "lower-target"]]);
    expect(why("piano", { schedule: { kind: "weekly-count", target: 4 } })).toEqual([["schedule", "stricter"]]);
    expect(why("essay", { schedule: oneTime("Fri+1", true) })).toEqual([["schedule", "submit-anytime-on"]]);
    expect(why("essay", { schedule: oneTime("Thu+1", false) })).toEqual([["schedule", "date-moved"]]);
    expect(why("thesis", { schedule: oneTime("Mon+2", true) })).toEqual([["schedule", "later-deadline"]]);
    expect(why("thesis", { schedule: oneTime("Thu+1", true) })).toEqual([["schedule", "stricter"]]);
    expect(why("thesis", { schedule: oneTime("Mon+2", false) })).toEqual([["schedule", "date-moved"]]);
    expect(why("gym", { name: "Gym time", reminders: ["18:00"] })).toEqual([
      ["name", "at-once"],
      ["reminders", "at-once"],
    ]);
  });

  test("a stricter change, or one that needs approval, says what in it applies at once: the name, the reminders, the new reviewers", async () => {
    const s = scenario();
    const { reviewer, second, third, fourth, outcomeOf } = await pactsToChange(s);

    expect(outcomeOf("gym", { penaltyCents: 1000 })).toMatchObject({ kind: "stricter", appliesNow: [] });
    expect(outcomeOf("gym", { penaltyCents: 1000, name: "Gym time" })).toMatchObject({
      kind: "stricter",
      appliesNow: ["name"],
    });
    expect(outcomeOf("gym", { penaltyCents: 300 })).toMatchObject({ kind: "needs-approval", appliesNow: [] });
    expect(outcomeOf("gym", { penaltyCents: 300, reminders: ["18:00"] })).toMatchObject({
      kind: "needs-approval",
      appliesNow: ["reminders"],
    });
    expect(
      outcomeOf("gym", {
        penaltyCents: 300,
        name: "Gym time",
        reminders: ["18:00"],
        reviewerIds: [reviewer.id, second.id, third.id, fourth.id],
      }),
    ).toMatchObject({ kind: "needs-approval", appliesNow: ["name", "reminders", "new-reviewers"] });
    // Removing one reviewer needs approval; the one added joins at once.
    expect(outcomeOf("gym", { reviewerIds: [reviewer.id, third.id] })).toMatchObject({
      kind: "needs-approval",
      appliesNow: ["new-reviewer"],
    });
    expect(outcomeOf("gym", { penaltyCents: 1000, reviewerIds: [reviewer.id, second.id, third.id] })).toMatchObject({
      kind: "stricter",
      appliesNow: ["new-reviewer"],
    });
    // A change that only applies at once needs no list: all of it does.
    expect(outcomeOf("gym", { name: "Gym time", reviewerIds: [reviewer.id, second.id, third.id] })).toEqual({
      kind: "at-once",
    });
  });
});

describe("one change request at a time", () => {
  test("while one waits, only the name and an added reviewer change; a stricter change or ending waits for it to be withdrawn", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const third = await s.befriend(owner, "third");
    const waiting = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 })));
    const id = changeRequestIdOf(waiting);

    expect(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 }))).toEqual({
      ok: false,
      reason: "change-request-waiting",
    });
    expect(owner.changePreview(gym, changed(owner, gym, { penaltyCents: 1000 }))).toEqual({
      ok: false,
      reason: "change-request-waiting",
    });
    expect(await owner.requestEnd(gym)).toEqual({ ok: false, reason: "change-request-waiting" });
    expect(await owner.renamePact(gym, "Gym, any gym")).toEqual({ ok: true });
    expect(await owner.addReviewers(gym, [third.id])).toEqual({ ok: true });
    expect(await owner.setReminders(gym, ["18:00"])).toEqual({ ok: true });
    // The new reviewer can decide the change already waiting.
    expect(third.reviewQueue()).toEqual([expect.objectContaining({ kind: "change-request", id })]);
    expect(pactOf(owner, gym).waiting).toEqual([
      {
        kind: "change-request",
        id,
        pactId: gym,
        name: "Gym, any gym",
        endsPact: false,
        requestedAt: s.at("Thu 15:00"),
      },
    ]);

    expect(await owner.withdrawChangeRequest(id)).toEqual({ ok: true });

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owner.today().waiting).toEqual([]);
    const withdrawal = { reason: "owner", withdrawnAt: s.at("Thu 15:00") };
    expect(owner.changeRequest(id)).toMatchObject({
      ok: true,
      changeRequest: { state: { kind: "withdrawn", ...withdrawal } },
    });
    expect(await reviewer.decide(id, { kind: "approve" })).toEqual({ ok: false, reason: "withdrawn", withdrawal });
    expect(await owner.withdrawChangeRequest(id)).toEqual({ ok: false, reason: "not-waiting" });
    expect(ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 })))).toMatchObject({
      outcome: { kind: "stricter" },
    });
  });

  test("a reviewer added inside a relaxing change joins at once, and can decide it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { reviewers: [reviewer] });
    await s.advanceTo("Thu 15:00");
    const third = await s.befriend(owner, "third");

    const result = ok(
      await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200, reviewerIds: [reviewer.id, third.id] })),
    );

    expect(result.outcome).toEqual({
      kind: "needs-approval",
      reviewerNames: ["reviewer", "third"],
      bundlesStricter: false,
      appliesNow: ["new-reviewer"],
      changeRequestId: expect.any(String),
    });
    expect(pactOf(owner, gym)).toMatchObject({
      penaltyCents: 500,
      reviewers: [{ name: "reviewer" }, { name: "third" }],
    });
    expect(s.notifier.kindsSentTo(third)).toEqual(["picked-as-reviewer", "review-item"]);
    // The penalty in force until the change is approved.
    expect(s.notifier.sentTo(third)[0]?.payload).toEqual({
      pactId: gym,
      title: "owner added you as a reviewer",
      body: "Gym · Every day · $5 per miss",
      url: "/review",
    });
    expect(third.reviewQueue()).toEqual([
      expect.objectContaining({
        kind: "change-request",
        changes: [{ term: "penalty", before: 500, after: 200, effect: "needs-approval", reason: "lower-penalty" }],
      }),
    ]);
    expect(await third.decide(changeRequestIdOf(result), { kind: "approve" })).toEqual({ ok: true });
    expect(pactOf(owner, gym).penaltyCents).toBe(200);
  });

  test("reviewers don't see the owner's reminders on a change request", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { reminders: ["18:00"] });
    await s.advanceTo("Tue 12:00");

    ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 })));
    expect(pactOf(owner, gym).reminders).toEqual(["18:00"]);

    const [item] = reviewer.reviewQueue();
    expect(item).toMatchObject({ kind: "change-request", current: { penaltyCents: 500 } });
    expect(JSON.stringify(item)).not.toContain("18:00");
    expect(item).not.toHaveProperty("current.reminders");
  });

  test("change requests come first in the Review Queue, then everything else oldest first", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const submitted = ok(await owner.submitEvidence(gym, [photo()]));
    s.setClockTo("Thu 16:00");

    const result = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 })));

    expect(reviewer.reviewQueue().map((item) => item.id)).toEqual([changeRequestIdOf(result), submitted.evidenceId]);
    expect(owner.today().waiting.map((item) => item.kind)).toEqual(["change-request", "evidence"]);
  });
});

describe("what can't be changed", () => {
  test("removing the only reviewer is refused, as a pact always keeps one", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { reviewers: [reviewer] });
    await s.advanceTo("Thu 15:00");

    expect(await owner.changePact(gym, changed(owner, gym, { reviewerIds: [] }))).toEqual({
      ok: false,
      reason: "no-reviewers",
    });
    expect(reviewer.reviewQueue()).toEqual([]);
  });

  test("in the edit window, the pact is edited, not changed; nothing changed is refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);

    expect(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200 }))).toEqual({
      ok: false,
      reason: "edit-window-open",
    });
    expect(await owner.requestEnd(gym)).toEqual({ ok: false, reason: "edit-window-open" });
    const editWindowOpen = { ok: false, reason: "edit-window-open" };
    expect(await owner.renamePact(gym, "Morning gym")).toEqual(editWindowOpen);
    expect(await owner.addReviewers(gym, [])).toEqual(editWindowOpen);
    expect(await owner.setReminders(gym, ["18:00"])).toEqual(editWindowOpen);
    await s.advanceTo("Mon 10:00");
    expect(await owner.changePact(gym, termsOf(pactOf(owner, gym)))).toEqual({ ok: false, reason: "nothing-changed" });
    expect(owner.changePreview(gym, termsOf(pactOf(owner, gym)))).toEqual({
      ok: true,
      preview: { changes: [], outcome: { kind: "nothing" } },
    });
  });

  test("someone else's pact is not found", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    expect(await reviewer.changePact(gym, termsOf(pactOf(owner, gym)))).toEqual({
      ok: false,
      reason: "pact-not-found",
    });
    expect(await reviewer.requestEnd(gym)).toEqual({ ok: false, reason: "pact-not-found" });
    const notFound = { ok: false, reason: "pact-not-found" };
    expect(await reviewer.renamePact(gym, "Morning gym")).toEqual(notFound);
    expect(await reviewer.addReviewers(gym, [])).toEqual(notFound);
    expect(await reviewer.setReminders(gym, [])).toEqual(notFound);
  });

  test("a blank name, or a reviewer who isn't the owner's friend, is refused", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    // Invited by the reviewer: their friend, not the owner's.
    const stranger = await s.befriend(reviewer, "stranger");

    expect(await owner.renamePact(gym, " ")).toEqual({ ok: false, reason: "blank-name" });
    expect(await owner.addReviewers(gym, [stranger.id])).toEqual({ ok: false, reason: "not-a-friend" });
    expect(await owner.addReviewers(gym, [owner.id])).toEqual({ ok: false, reason: "not-a-friend" });
    expect(pactOf(owner, gym)).toMatchObject({ name: "Gym", reviewers: [{ name: "reviewer" }, { name: "second" }] });
    expect(s.notifier.kindsSentTo(stranger)).toEqual([]);
    expect(reviewer.reviewQueue()).toEqual([]);
  });
});

describe("ending a pact", () => {
  test("approved end → the week open at approval is judged in full, then the pact is Ended; already-judged penalties stay on the ledger", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", { kind: "weekly-count", target: 3 });
    const read = await createPact("Read", MON_WED_FRI);
    await s.advanceTo("Sat+1 12:00");

    const result = await owner.requestEnd(gym, "I've moved and the gym is too far");

    expect(result).toEqual({ ok: true, changeRequestId: expect.any(String) });
    const id = result.ok ? result.changeRequestId : "";
    const queued = reviewer.reviewQueue()[0];
    expect(queued).toMatchObject({
      kind: "change-request",
      id,
      endsPact: true,
      ending: { kind: "after", lastDay: s.date("Sun+1") },
      note: "I've moved and the gym is too far",
    });
    expect(queued).not.toHaveProperty("changes");
    expect(queued).not.toHaveProperty("start");
    expect(s.notifier.sentTo(reviewer, "review-item").at(-1)).toMatchObject({
      payload: { title: "owner asked to end Gym", body: "“I've moved and the gym is too far”" },
    });

    s.setClockTo("Sat+1 13:00");
    await reviewer.decide(id, { kind: "approve" });

    // Active until the week closes, and the page says when it Ends.
    expect(pactOf(owner, gym)).toMatchObject({
      stage: "active",
      ending: { lastDay: s.date("Sun+1") },
      endDate: s.date("Sun+1"),
      waiting: [],
    });
    expect(owner.changeRequest(id)).toMatchObject({ ok: true, changeRequest: { ending: null } });
    expect(s.notifier.sentTo(owner, "change-request-decided").at(-1)).toMatchObject({
      payload: { title: "reviewer approved ending Gym", body: "Gym ends after Sun Jan 18" },
    });

    await s.advanceTo("Sun+1 23:59");
    expect(pactOf(owner, gym)).toMatchObject({ stage: "active" });
    expect(penalties(owner).filter((p) => p.pactName === "Gym")).toEqual([]);

    await s.advanceTo("Mon+2 00:00");

    // The week open at approval is Missed in full, three sessions short.
    expect(penalties(owner).filter((p) => p.pactName === "Gym")).toEqual([
      expect.objectContaining({ date: s.date("Mon+1"), cents: 1500 }),
    ]);
    expect(s.notifier.sentTo(owner, "missed-occurrence").at(-1)).toMatchObject({ payload: { pactId: gym } });
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt: s.at("Mon+2 00:00") });
    expect(owner.pacts().map((p) => [p.name, p.stage])).toEqual([
      ["Read", "active"],
      ["Gym", "ended"],
    ]);

    await s.advanceTo("Sun+2 12:00");
    expect(penaltyDays(owner, "Gym")).toEqual([s.date("Mon+1")]);
    expect(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 1000 }))).toEqual({
      ok: false,
      reason: "pact-ended",
    });
    expect(await owner.requestEnd(gym)).toEqual({ ok: false, reason: "pact-ended" });
  });

  test("an end approved Thursday 23:00 with no photo: Thursday is Missed, then the pact is Ended", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", ["mon", "tue", "wed", "thu", "fri"]);
    await s.advanceTo("Thu+1 22:00");
    const end = ok(await owner.requestEnd(gym));

    s.setClockTo("Thu+1 23:00");
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    expect(pactOf(owner, gym)).toMatchObject({ stage: "active", ending: { lastDay: s.date("Thu+1") } });
    await s.advanceTo("Sat+1 12:00");

    expect(penaltyDays(owner, "Gym")).toContain(s.date("Thu+1"));
    expect(penaltyDays(owner, "Gym")).not.toContain(s.date("Fri+1"));
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt: s.at("Fri+1 00:00") });
  });

  test("an end approved on a day the schedule skips, with nothing open, Ends the pact at once, judging the day before", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Mon+1 23:00");
    const end = ok(await owner.requestEnd(gym));
    expect(reviewer.reviewQueue()[0]).toMatchObject({ ending: { kind: "after", lastDay: s.date("Mon+1") } });

    // Monday closed at midnight; the scheduler hasn't judged it yet.
    s.setClockTo("Tue+1 00:00");
    expect(reviewer.reviewQueue()[0]).toMatchObject({ ending: { kind: "at-once" } });
    await reviewer.decide(end.changeRequestId, { kind: "approve" });

    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt: s.at("Tue+1 00:00"), ending: null });
    expect(s.notifier.sentTo(owner, "change-request-decided").at(-1)).toMatchObject({
      payload: { body: "Gym is Ended" },
    });
    await s.advanceTo("Sat+1 12:00");
    expect(penaltyDays(owner, "Gym")).toEqual([s.date("Mon"), s.date("Wed"), s.date("Fri"), s.date("Mon+1")]);
  });

  test("while an approved end waits, a new end request or change request is refused; the name and an added reviewer still change", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const third = await s.befriend(owner, "third");
    const end = ok(await owner.requestEnd(gym));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    expect(pactOf(owner, gym)).toMatchObject({ stage: "active", ending: { lastDay: s.date("Thu") } });

    expect(await owner.requestEnd(gym)).toEqual({ ok: false, reason: "end-approved" });
    for (const change of [
      { penaltyCents: 200 },
      { penaltyCents: 1000 },
      { endDate: s.date("Mon+2") },
      { endDate: undefined },
    ]) {
      expect(await owner.changePact(gym, changed(owner, gym, change))).toEqual({ ok: false, reason: "end-approved" });
      expect(owner.changePreview(gym, changed(owner, gym, change))).toEqual({ ok: false, reason: "end-approved" });
    }
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(await owner.renamePact(gym, "Gym, any gym")).toEqual({ ok: true });
    expect(await owner.addReviewers(gym, [third.id])).toEqual({ ok: true });
    expect(await owner.setReminders(gym, ["18:00"])).toEqual({ ok: true });
    expect(pactOf(owner, gym)).toMatchObject({ name: "Gym, any gym", reminders: ["18:00"] });
    expect(pactOf(owner, gym).reviewers.map((r) => r.name)).toEqual(["reviewer", "second", "third"]);

    await s.advanceTo("Sat 12:00");
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 00:00") });
  });

  test("a rejected end keeps the pact running", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const result = ok(await owner.requestEnd(gym));

    await reviewer.decide(result.changeRequestId, { kind: "reject", reason: "Keep going" });

    expect(pactOf(owner, gym)).toMatchObject({ stage: "active" });
    expect(pactOf(owner, gym)).not.toHaveProperty("endedAt");
    await s.advanceTo("Fri 00:00");
    expect(penalties(owner).map((p) => p.date)).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu")]);
  });
});

describe("once a pact has Ended", () => {
  test("after an approved end it takes no evidence, nor an excuse for its days after the end; a recent miss can still be excused", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const end = ok(await owner.requestEnd(gym));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    await s.advanceTo("Fri 12:00");

    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    const ended = { ok: false, reason: "pact-ended" };
    expect(await owner.renamePact(gym, "Morning gym")).toEqual(ended);
    expect(await owner.addReviewers(gym, [])).toEqual(ended);
    expect(await owner.setReminders(gym, [])).toEqual(ended);
    expect(await owner.fileExcuse(gym, { from: s.date("Fri"), to: s.date("Sat"), reason: "Away" }, [])).toEqual({
      ok: false,
      reason: "nothing-to-excuse",
    });
    // Wednesday, Missed at Thursday 00:00 before the end, is still inside its 48 hours.
    expect(await owner.fileExcuse(gym, { from: s.date("Wed"), to: s.date("Fri"), reason: "Sick" }, [])).toMatchObject({
      ok: true,
    });
    await s.advanceTo("Sun 12:00");
    // Thursday was open when the end was approved: it was judged, Missed at Friday 00:00.
    expect(penaltyDays(owner, "Gym")).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu")]);
  });

  test("evidence waiting for the day open when the end was approved, rejected afterwards, adds the penalty", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const submitted = ok(await owner.submitEvidence(gym, [photo()]));
    const end = ok(await owner.requestEnd(gym));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    await s.advanceTo("Fri 12:00");
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 00:00") });

    await reviewer.decide(submitted.evidenceId, { kind: "reject", reason: "Blurry" });

    expect(penaltyDays(owner, "Gym")).toEqual([s.date("Mon"), s.date("Tue"), s.date("Wed"), s.date("Thu")]);
  });

  test("a change request still waiting when the end date passes is withdrawn: it leaves the queue and Today, and can't be decided", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { endDate: s.date("Thu") } });
    await s.advanceTo("Tue 12:00");
    const sent = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 100 })));
    await reviewer.askOwner(changeRequestIdOf(sent), "Why?");
    expect(owner.today().alerts).toEqual([expect.objectContaining({ kind: "reviewer-question" })]);

    await s.advanceTo("Sat 12:00");

    expect(pactOf(owner, gym)).toMatchObject({
      stage: "ended",
      endDate: s.date("Thu"),
      penaltyCents: 500,
      waiting: [],
    });
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(reviewer.waitingOnReply()).toEqual([]);
    expect(owner.today().alerts.filter((alert) => alert.kind === "reviewer-question")).toEqual([]);
    // Withdrawn when the pact Ended, at Fri 00:00, with that reason on its page and in a reviewer's refusal.
    const withdrawal = { reason: "pact-ended", withdrawnAt: s.at("Fri 00:00"), pactNames: ["Gym"] };
    expect(owner.changeRequest(changeRequestIdOf(sent))).toMatchObject({
      ok: true,
      changeRequest: { state: { kind: "withdrawn", ...withdrawal } },
    });
    expect(await reviewer.decide(changeRequestIdOf(sent), { kind: "approve" })).toEqual({
      ok: false,
      reason: "withdrawn",
      withdrawal,
    });
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endDate: s.date("Thu"), penaltyCents: 500 });
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
  });

  test("an end request still waiting when the end date passes is withdrawn, and the pact keeps the end it had", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY, { dates: { endDate: s.date("Thu") } });
    await s.advanceTo("Tue 12:00");
    const end = ok(await owner.requestEnd(gym));
    await s.advanceTo("Sat 12:00");
    const ended = pactOf(owner, gym);
    if (ended.stage !== "ended") throw new Error("not ended");
    const { endedAt } = ended;
    const withdrawal = { reason: "pact-ended", withdrawnAt: endedAt, pactNames: ["Gym"] };

    expect(owner.changeRequest(end.changeRequestId)).toMatchObject({
      ok: true,
      changeRequest: { state: { kind: "withdrawn", ...withdrawal } },
    });
    expect(await reviewer.decide(end.changeRequestId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "withdrawn",
      withdrawal,
    });
    expect(pactOf(owner, gym)).toMatchObject({ stage: "ended", endedAt });
    expect(s.notifier.sentTo(owner, "change-request-decided")).toEqual([]);
  });

  test("an end approved after midnight, before the scheduler's tick, still judges the day before", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await dailyGym(s);
    const end = ok(await owner.requestEnd(gym));
    s.setClockTo("Fri 00:00");

    await reviewer.decide(end.changeRequestId, { kind: "approve" });
    await s.advanceTo("Sat 12:00");

    // Friday opened at midnight, so the pact kept it too.
    expect(penaltyDays(owner, "Gym")).toEqual([
      s.date("Mon"),
      s.date("Tue"),
      s.date("Wed"),
      s.date("Thu"),
      s.date("Fri"),
    ]);
  });
});

describe("ending a bedtime pact", () => {
  test("the nights open when the end was approved are still judged; later nights never are", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const bed = await createPact("00:00");
    await s.advanceTo("Tue 12:00"); // Monday night was due at midnight; Oura hasn't reported it.
    const end = ok(await owner.requestEnd(bed));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });

    // Tuesday night opened at the start of Tuesday: the pact keeps it.
    expect(pactOf(owner, bed)).toMatchObject({ stage: "active", ending: { lastDay: s.date("Tue") } });

    s.ouraSource.addSleep(owner.id, sleep("Tue 01:00"));
    await s.advanceTo("Tue 12:01");
    expect(penaltyDays(owner, "In bed by midnight")).toEqual([s.date("Mon")]);
    // Oura never reports Tuesday night: Missed at 6pm Wednesday, when the pact Ends.
    await s.advanceTo("Fri 12:00");
    expect(penaltyDays(owner, "In bed by midnight")).toEqual([s.date("Mon"), s.date("Tue")]);
    expect(pactOf(owner, bed)).toMatchObject({ stage: "ended", endedAt: s.at("Wed 18:00") });
  });

  test("with no data, that night is Missed at 6pm the next day", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const bed = await createPact("00:00");
    await s.advanceTo("Tue 12:00");
    const end = ok(await owner.requestEnd(bed));
    await reviewer.decide(end.changeRequestId, { kind: "approve" });

    await s.advanceTo("Tue 17:59");
    expect(penaltyDays(owner, "In bed by midnight")).toEqual([]);
    await s.advanceTo("Tue 18:00");
    expect(penaltyDays(owner, "In bed by midnight")).toEqual([s.date("Mon")]);
  });
});

test("a waiting change request survives a restart", async () => {
  const s = scenario();
  const { owner, reviewer, gym } = await dailyGym(s);
  const result = ok(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 200, note: "Tight month" })));

  await s.restart();

  expect(reviewer.reviewQueue()).toEqual([
    expect.objectContaining({ kind: "change-request", id: changeRequestIdOf(result), note: "Tight month" }),
  ]);
  expect(owner.changeRequest(changeRequestIdOf(result))).toMatchObject({
    ok: true,
    changeRequest: {
      pactId: gym,
      state: { kind: "waiting" },
      reviewerNames: ["reviewer", "second"],
      changes: [{ term: "penalty", before: 500, after: 200 }],
    },
  });
  await reviewer.decide(changeRequestIdOf(result), { kind: "approve" });
  expect(pactOf(owner, gym).penaltyCents).toBe(200);
});
