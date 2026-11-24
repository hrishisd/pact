import { describe, expect, test } from "vitest";
import type { NewPact } from "../shared/types.ts";
import { ankiPact, ownerWithAnki } from "./testing/anki-pact.ts";
import { bedtimePact } from "./testing/bedtime-pact.ts";
import { cameraPact, MON_WED_FRI, ownerWithReviewers } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

/** Gym, a Mon/Wed/Fri Camera pact to `recipientId` that `reviewer` reviews, with `changes`. */
function gymPact(recipientId: string, reviewer: AccountHandle, changes: Partial<NewPact> = {}): NewPact {
  return { ...cameraPact("Gym", MON_WED_FRI, { recipientId, reviewers: [reviewer] }), ...changes };
}

describe("creating a pact", () => {
  test("a Camera pact is Active at once and its pact page shows its terms", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);

    const created = ok(await owner.createPact(gymPact(sam.id, reviewer)));

    expect(owner.pact(created.pactId)).toEqual({
      ok: true,
      pact: {
        id: created.pactId,
        name: "Gym",
        description: "A photo of Gym",
        evidenceKind: "camera",
        dueBy: null,
        startDate: null,
        endDate: null,
        schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
        penaltyCents: 500,
        recipient: { id: sam.id, name: "Sam" },
        reviewers: [{ id: reviewer.id, name: "reviewer" }],
        reminders: [],
        stage: "active",
        firstOccurrence: { date: s.date("Mon"), dueAt: s.at("Tue 00:00") },
        editWindowClosesAt: s.at("Mon 09:10"),
        newTerms: null,
        waiting: [],
        history: expect.objectContaining({ kind: "fixed-days" }),
        tripAhead: null,
        connectionProblem: null,
        ending: null,
        excuseWindowsClose: [],
      },
    });
  });
});

describe("what a pact needs", () => {
  test.each([
    [{ name: "  " }, "blank-name"],
    [{ description: "" }, "blank-description"],
    [{ schedule: { kind: "fixed-days", days: [] } }, "no-days"],
    [{ penaltyCents: 0 }, "invalid-penalty"],
    [{ penaltyCents: -500 }, "invalid-penalty"],
    [{ penaltyCents: 2.5 }, "invalid-penalty"],
    [{ penaltyCents: Number.NaN }, "invalid-penalty"],
  ] as [Partial<NewPact>, string][])("%o is refused as %s and writes nothing", async (changes, reason) => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);

    expect(await owner.createPact(gymPact(sam.id, reviewer, changes))).toEqual({ ok: false, reason });
    expect(owner.pacts()).toEqual([]);
  });

  test("name and description are stored without surrounding spaces", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);

    const created = ok(await owner.createPact(gymPact(sam.id, reviewer, { name: " Gym ", description: " A photo\n" })));

    expect(owner.pact(created.pactId)).toMatchObject({ ok: true, pact: { name: "Gym", description: "A photo" } });
  });
});

describe("when several refusals apply", () => {
  // The evidence source is checked first, then the terms, then the recipient and reviewers.
  test.each([
    [{ evidenceKind: "oura", inBedBy: "25:00", name: " " }, "oura-not-connected"],
    [{ evidenceKind: "oura", inBedBy: "00:00", recipientId: "no-such-recipient" }, "oura-not-connected"],
    [{ evidenceKind: "anki", ankiDeckId: "999", schedule: { kind: "weekly-count", target: 3 } }, "anki-not-connected"],
    [{ name: " ", recipientId: "no-such-recipient", reviewerIds: [] }, "blank-name"],
    [{ penaltyCents: 0, reviewerIds: [] }, "invalid-penalty"],
    [{ schedule: { kind: "fixed-days", days: [] }, penaltyCents: 0 }, "no-days"],
    [{ reminders: ["9am"], name: " " }, "invalid-reminders"],
    [{ dueBy: "09:00", reminders: ["10:00"], endDate: "2026-01-04", penaltyCents: 0 }, "reminder-after-due-time"],
    [{ endDate: "2026-01-04", penaltyCents: 0, reviewerIds: [] }, "end-date-too-early"],
    [{ recipientId: "no-such-recipient", reviewerIds: [] }, "unknown-recipient"],
  ] as [Partial<NewPact>, string][])("%o is refused as %s", async (changes, reason) => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);

    expect(await owner.createPact(gymPact(sam.id, reviewer, changes))).toEqual({ ok: false, reason });
    expect(owner.pacts()).toEqual([]);
  });

  test("an Anki pact's deck comes before its terms and its recipient", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);

    const weekly = { schedule: { kind: "weekly-count", target: 3 } } as const;
    expect(
      await owner.createPact({ ...ankiPact(sam.id, reviewer, { ankiDeckId: "999", name: " " }), ...weekly }),
    ).toEqual({ ok: false, reason: "unknown-deck" });
    expect(await owner.createPact({ ...ankiPact("no-such-recipient", reviewer), ...weekly })).toEqual({
      ok: false,
      reason: "invalid-schedule",
    });
  });

  test("a blank description comes before the recipient, and the evidence source before the terms", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const stranger = await s.befriend(reviewer, "stranger");
    const added = ok(await owner.addRecipient({ name: "Sam" }));

    expect(await owner.createPact(gymPact(added.recipient.id, reviewer, { description: " " }))).toEqual({
      ok: false,
      reason: "blank-description",
    });
    expect(await owner.createPact(gymPact("no-such-recipient", reviewer, { reviewerIds: [stranger.id] }))).toEqual({
      ok: false,
      reason: "unknown-recipient",
    });
    expect(await owner.createPact(bedtimePact(added.recipient.id, reviewer, "25:00"))).toEqual({
      ok: false,
      reason: "oura-not-connected",
    });
  });
});

describe("reviewers and recipient", () => {
  test("an owner can pick only friends as reviewers, one or more", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam } = await ownerWithReviewers(s);
    const stranger = await s.befriend(reviewer, "stranger");

    for (const [reviewerIds, reason] of [
      [[], "no-reviewers"],
      [[stranger.id], "not-a-friend"],
      [[reviewer.id, stranger.id], "not-a-friend"],
      [[owner.id], "not-a-friend"],
      [["no-such-account"], "not-a-friend"],
    ] as const) {
      expect(await owner.createPact(gymPact(sam.id, reviewer, { reviewerIds: [...reviewerIds] }))).toEqual({
        ok: false,
        reason,
      });
    }
    expect(owner.pacts()).toEqual([]);

    const created = ok(await owner.createPact(gymPact(sam.id, reviewer, { reviewerIds: [second.id, reviewer.id] })));
    expect(owner.pact(created.pactId)).toMatchObject({
      pact: {
        reviewers: [
          { id: reviewer.id, name: "reviewer" },
          { id: second.id, name: "second" },
        ],
      },
    });
  });

  test("the recipient must be one of the owner's own saved recipients", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    const theirs = ok(await reviewer.addRecipient({ name: "Shelter" }));

    for (const recipientId of [theirs.recipient.id, "no-such-recipient"]) {
      expect(await owner.createPact(gymPact(recipientId, reviewer))).toEqual({
        ok: false,
        reason: "unknown-recipient",
      });
    }
    expect(owner.pacts()).toEqual([]);
    expect(await owner.createPact(gymPact(sam.id, reviewer))).toMatchObject({ ok: true });
  });
});

describe("the Pacts tab", () => {
  test("lists the owner's Active pacts by name, only to their owner, and survives a restart", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    const gym = ok(await owner.createPact(gymPact(sam.id, reviewer)));
    const reading = ok(
      await owner.createPact(
        gymPact(sam.id, reviewer, {
          name: "Reading",
          description: "The page I got to",
          schedule: { kind: "fixed-days", days: ["sun", "sat"] },
          penaltyCents: 250,
        }),
      ),
    );

    await s.restart();

    expect(owner.pacts()).toEqual([
      {
        id: gym.pactId,
        name: "Gym",
        schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
        penaltyCents: 500,
        stage: "active",
        editWindowClosesAt: s.at("Mon 09:10"),
      },
      {
        id: reading.pactId,
        name: "Reading",
        schedule: { kind: "fixed-days", days: ["sat", "sun"] },
        penaltyCents: 250,
        stage: "active",
        editWindowClosesAt: s.at("Mon 09:10"),
      },
    ]);
    expect(owner.pact(gym.pactId)).toMatchObject({ ok: true, pact: { name: "Gym" } });
    expect(reviewer.pacts()).toEqual([]);
    expect(reviewer.pact(gym.pactId)).toEqual({ ok: false, reason: "pact-not-found" });
    expect(owner.pact("no-such-pact")).toEqual({ ok: false, reason: "pact-not-found" });
  });
});

describe("first occurrence", () => {
  const daily = { kind: "fixed-days", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } as const;

  test.each([
    { createdAt: "Mon 10:00", day: "Mon", dueAt: "Tue 00:00" },
    // Monday's midnight is exactly an hour away: still at least an hour.
    { createdAt: "Mon 23:00", day: "Mon", dueAt: "Tue 00:00" },
    // Monday's midnight is under an hour away.
    { createdAt: "Mon 23:01", day: "Tue", dueAt: "Wed 00:00" },
    { createdAt: "Mon 23:30", day: "Tue", dueAt: "Wed 00:00" },
  ])("a daily pact created $createdAt first falls due on $day", async ({ createdAt, day, dueAt }) => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    s.setClockTo(createdAt);

    const named = owner.firstOccurrence({ schedule: { ...daily, days: [...daily.days] } });
    const created = ok(
      await owner.createPact(gymPact(sam.id, reviewer, { schedule: { ...daily, days: [...daily.days] } })),
    );

    const expected = { date: s.date(day), dueAt: s.at(dueAt) };
    expect(named).toEqual({ ok: true, firstOccurrence: expected });
    expect(owner.pact(created.pactId)).toMatchObject({ pact: { firstOccurrence: expected } });
  });

  test("a Mon/Wed/Fri pact created on Tuesday first falls due on Wednesday", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewers(s);
    s.setClockTo("Tue 12:00");

    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] } })).toEqual({
      ok: true,
      firstOccurrence: { date: s.date("Wed"), dueAt: s.at("Thu 00:00") },
    });
  });

  test("a schedule with no days has no first occurrence", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewers(s);

    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: [] } })).toEqual({
      ok: false,
      reason: "no-days",
    });
  });

  test("days are counted in the owner's timezone", async () => {
    const s = scenario();
    // Mon 09:00 in New York is already Tue 03:00 in Auckland (UTC+13 in January).
    const { owner, reviewer, sam } = await ownerWithReviewers(s, { timezone: "Pacific/Auckland" });
    s.setClockTo("Mon 09:00");

    // Auckland's Monday is over, so a Monday-only pact starts next Monday,
    // due at midnight ending it in Auckland (Mon 12 Jan 11:00 UTC).
    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: ["mon"] } })).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-12", dueAt: new Date("2026-01-12T11:00:00Z") },
    });
    const created = ok(
      await owner.createPact(gymPact(sam.id, reviewer, { schedule: { kind: "fixed-days", days: ["tue"] } })),
    );
    expect(owner.pact(created.pactId)).toMatchObject({
      pact: { firstOccurrence: { date: "2026-01-06", dueAt: new Date("2026-01-06T11:00:00Z") } },
    });
  });
});
