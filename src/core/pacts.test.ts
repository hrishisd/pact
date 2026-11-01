import { describe, expect, test } from "vitest";
import type { NewPact } from "../shared/types.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

/** An owner in New York with one friend, "reviewer", and one saved recipient, "Sam". */
async function ownerWithReviewer(s: Scenario, timezone = "America/New_York") {
  const owner = await s.signIn("owner");
  await owner.setTimezone(timezone);
  const reviewer = await s.befriend(owner, "reviewer");
  const added = await owner.addRecipient({ name: "Sam" });
  if (!added.ok) throw new Error(added.reason);
  return { owner, reviewer, recipient: added.recipient };
}

function gymPact(recipientId: string, reviewer: AccountHandle, changes: Partial<NewPact> = {}): NewPact {
  return {
    evidenceKind: "camera",
    name: "Gym",
    description: "Me at the gym, holding today's paper",
    schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
    penaltyCents: 500,
    recipientId,
    reviewerIds: [reviewer.id],
    ...changes,
  };
}

describe("creating a pact", () => {
  test("a Camera pact is Active at once and its pact page shows its terms", async () => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);

    const created = await owner.createPact(gymPact(recipient.id, reviewer));

    if (!created.ok) throw new Error(created.reason);
    expect(owner.pact(created.pactId)).toEqual({
      ok: true,
      pact: {
        id: created.pactId,
        name: "Gym",
        description: "Me at the gym, holding today's paper",
        evidenceKind: "camera",
        schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
        penaltyCents: 500,
        recipient: { id: recipient.id, name: "Sam" },
        reviewers: [{ id: reviewer.id, name: "reviewer" }],
        stage: "active",
        firstOccurrence: { date: "2026-01-05", dueAt: s.at("Tue 00:00") },
        editWindowClosesAt: s.at("Mon 09:10"),
      },
    });
  });
});

describe("what a pact needs", () => {
  test("Oura Ring pacts aren't available yet", async () => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);

    expect(await owner.createPact(gymPact(recipient.id, reviewer, { evidenceKind: "oura" }))).toEqual({
      ok: false,
      reason: "evidence-kind-unavailable",
    });
    expect(owner.pacts()).toEqual([]);
  });

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
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);

    expect(await owner.createPact(gymPact(recipient.id, reviewer, changes))).toEqual({ ok: false, reason });
    expect(owner.pacts()).toEqual([]);
  });

  test("an owner needs a confirmed timezone, since days are counted in it", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const added = await owner.addRecipient({ name: "Sam" });
    if (!added.ok) throw new Error(added.reason);

    expect(await owner.createPact(gymPact(added.recipient.id, reviewer))).toEqual({ ok: false, reason: "no-timezone" });
    expect(owner.firstOccurrence({ kind: "fixed-days", days: ["mon"] })).toEqual({ ok: false, reason: "no-timezone" });
    expect(owner.pacts()).toEqual([]);
  });

  test("name and description are stored without surrounding spaces", async () => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);

    const created = await owner.createPact(
      gymPact(recipient.id, reviewer, { name: " Gym ", description: " A photo\n" }),
    );

    if (!created.ok) throw new Error(created.reason);
    expect(owner.pact(created.pactId)).toMatchObject({ ok: true, pact: { name: "Gym", description: "A photo" } });
  });
});

describe("reviewers and recipient", () => {
  test("an owner can pick only friends as reviewers, one or more", async () => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);
    const second = await s.befriend(owner, "second");
    const stranger = await s.befriend(reviewer, "stranger");

    for (const [reviewerIds, reason] of [
      [[], "no-reviewers"],
      [[stranger.id], "not-a-friend"],
      [[reviewer.id, stranger.id], "not-a-friend"],
      [[owner.id], "not-a-friend"],
      [["no-such-account"], "not-a-friend"],
    ] as const) {
      expect(await owner.createPact(gymPact(recipient.id, reviewer, { reviewerIds: [...reviewerIds] }))).toEqual({
        ok: false,
        reason,
      });
    }
    expect(owner.pacts()).toEqual([]);

    const created = await owner.createPact(gymPact(recipient.id, reviewer, { reviewerIds: [second.id, reviewer.id] }));
    if (!created.ok) throw new Error(created.reason);
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
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);
    const theirs = await reviewer.addRecipient({ name: "Shelter" });
    if (!theirs.ok) throw new Error(theirs.reason);

    for (const recipientId of [theirs.recipient.id, "no-such-recipient"]) {
      expect(await owner.createPact(gymPact(recipientId, reviewer))).toEqual({
        ok: false,
        reason: "unknown-recipient",
      });
    }
    expect(owner.pacts()).toEqual([]);
    expect(await owner.createPact(gymPact(recipient.id, reviewer))).toMatchObject({ ok: true });
  });
});

describe("the Pacts tab", () => {
  test("lists the owner's Active pacts by name, only to their owner, and survives a restart", async () => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);
    const gym = await owner.createPact(gymPact(recipient.id, reviewer));
    const reading = await owner.createPact(
      gymPact(recipient.id, reviewer, {
        name: "Reading",
        description: "The page I got to",
        schedule: { kind: "fixed-days", days: ["sun", "sat"] },
        penaltyCents: 250,
      }),
    );
    if (!gym.ok || !reading.ok) throw new Error("not created");

    await s.restart();

    expect(owner.pacts()).toEqual([
      {
        id: gym.pactId,
        name: "Gym",
        schedule: { kind: "fixed-days", days: ["mon", "wed", "fri"] },
        penaltyCents: 500,
        editWindowClosesAt: s.at("Mon 09:10"),
      },
      {
        id: reading.pactId,
        name: "Reading",
        schedule: { kind: "fixed-days", days: ["sat", "sun"] },
        penaltyCents: 250,
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
    { createdAt: "Mon 10:00", date: "2026-01-05", dueAt: "Tue 00:00" },
    // Monday's midnight is exactly an hour away: still at least an hour.
    { createdAt: "Mon 23:00", date: "2026-01-05", dueAt: "Tue 00:00" },
    // Monday's midnight is under an hour away.
    { createdAt: "Mon 23:01", date: "2026-01-06", dueAt: "Wed 00:00" },
    { createdAt: "Mon 23:30", date: "2026-01-06", dueAt: "Wed 00:00" },
  ])("a daily pact created $createdAt first falls due on $date", async ({ createdAt, date, dueAt }) => {
    const s = scenario();
    const { owner, reviewer, recipient } = await ownerWithReviewer(s);
    s.setClockTo(createdAt);

    const named = owner.firstOccurrence({ ...daily, days: [...daily.days] });
    const created = await owner.createPact(
      gymPact(recipient.id, reviewer, { schedule: { ...daily, days: [...daily.days] } }),
    );

    const expected = { date, dueAt: s.at(dueAt) };
    expect(named).toEqual({ ok: true, firstOccurrence: expected });
    if (!created.ok) throw new Error(created.reason);
    expect(owner.pact(created.pactId)).toMatchObject({ pact: { firstOccurrence: expected } });
  });

  test("a Mon/Wed/Fri pact created on Tuesday first falls due on Wednesday", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewer(s);
    s.setClockTo("Tue 12:00");

    expect(owner.firstOccurrence({ kind: "fixed-days", days: ["mon", "wed", "fri"] })).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-07", dueAt: s.at("Thu 00:00") },
    });
  });

  test("a schedule with no days has no first occurrence", async () => {
    const s = scenario();
    const { owner } = await ownerWithReviewer(s);

    expect(owner.firstOccurrence({ kind: "fixed-days", days: [] })).toEqual({ ok: false, reason: "no-days" });
  });

  test("days are counted in the owner's timezone", async () => {
    const s = scenario();
    // Mon 09:00 in New York is already Tue 03:00 in Auckland (UTC+13 in January).
    const { owner, reviewer, recipient } = await ownerWithReviewer(s, "Pacific/Auckland");
    s.setClockTo("Mon 09:00");

    // Auckland's Monday is over, so a Monday-only pact starts next Monday,
    // due at midnight ending it in Auckland (Mon 12 Jan 11:00 UTC).
    expect(owner.firstOccurrence({ kind: "fixed-days", days: ["mon"] })).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-12", dueAt: new Date("2026-01-12T11:00:00Z") },
    });
    const created = await owner.createPact(
      gymPact(recipient.id, reviewer, { schedule: { kind: "fixed-days", days: ["tue"] } }),
    );
    if (!created.ok) throw new Error(created.reason);
    expect(owner.pact(created.pactId)).toMatchObject({
      pact: { firstOccurrence: { date: "2026-01-06", dueAt: new Date("2026-01-06T11:00:00Z") } },
    });
  });
});
