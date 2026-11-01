// The first 10 minutes of a pact: what the owner can still change, and when
// the reviewers hear about it.

import { describe, expect, test } from "vitest";
import type { NewPact } from "../shared/types.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";

/** A pact created at "Mon 10:00", so its window closes at "Mon 10:10". */
async function newGym(s: Scenario) {
  const people = await ownerWithReviewers(s);
  s.setClockTo("Mon 10:00");
  const gym = await people.createPact("Gym", MON_WED_FRI, { reviewers: [people.reviewer] });
  const edited = (changes: Partial<NewPact> = {}): NewPact => ({
    evidenceKind: "camera",
    name: "Gym",
    description: "A photo of Gym",
    schedule: { kind: "fixed-days", days: MON_WED_FRI },
    penaltyCents: 500,
    recipientId: people.sam.id,
    reviewerIds: [people.reviewer.id],
    ...changes,
  });
  return { ...people, gym, edited };
}

describe("editing a pact in its edit window", () => {
  test.each(["Mon 10:05", "Mon 10:09"])("an edit at %s changes the pact's terms", async (when) => {
    const s = scenario();
    const { owner, gym, edited } = await newGym(s);
    s.setClockTo(when);

    const result = await owner.editPact(gym, edited({ name: " Morning gym ", penaltyCents: 1000 }));

    expect(result).toEqual({ ok: true });
    expect(owner.pact(gym)).toMatchObject({ pact: { name: "Morning gym", penaltyCents: 1000 } });
  });

  test("an edit at minute 10 is refused and changes nothing", async () => {
    const s = scenario();
    const { owner, gym, edited } = await newGym(s);
    s.setClockTo("Mon 10:10");

    expect(await owner.editPact(gym, edited({ name: "Too late" }))).toEqual({
      ok: false,
      reason: "edit-window-closed",
    });
    expect(owner.pact(gym)).toMatchObject({ pact: { name: "Gym" } });
  });

  test("an edit at minute 9 doesn't restart the 10 minutes", async () => {
    const s = scenario();
    const { owner, gym, edited } = await newGym(s);
    s.setClockTo("Mon 10:09");
    await owner.editPact(gym, edited({ name: "Morning gym" }));

    expect(owner.pact(gym)).toMatchObject({ pact: { editWindowClosesAt: s.at("Mon 10:10") } });
    s.setClockTo("Mon 10:10");
    expect(await owner.editPact(gym, edited())).toEqual({ ok: false, reason: "edit-window-closed" });
    expect(owner.pact(gym)).toMatchObject({ pact: { editWindowClosesAt: null } });
  });

  test("changing the evidence kind is refused, even in the window", async () => {
    const s = scenario();
    const { owner, gym, edited } = await newGym(s);

    expect(await owner.editPact(gym, edited({ evidenceKind: "oura" }))).toEqual({
      ok: false,
      reason: "evidence-kind-fixed",
    });
  });

  test("an edit follows the same rules as creating a pact", async () => {
    const s = scenario();
    const { owner, gym, edited } = await newGym(s);

    for (const [changes, reason] of [
      [{ name: " " }, "blank-name"],
      [{ schedule: { kind: "fixed-days", days: [] } }, "no-days"],
      [{ penaltyCents: 0 }, "invalid-penalty"],
      [{ recipientId: "no-such-recipient" }, "unknown-recipient"],
      [{ reviewerIds: [] }, "no-reviewers"],
      [{ reviewerIds: [owner.id] }, "not-a-friend"],
    ] as [Partial<NewPact>, string][]) {
      expect(await owner.editPact(gym, edited(changes))).toEqual({ ok: false, reason });
    }
    expect(owner.pact(gym)).toMatchObject({ pact: { name: "Gym", penaltyCents: 500 } });
  });

  test("only the owner can edit it", async () => {
    const s = scenario();
    const { reviewer, gym, edited } = await newGym(s);

    expect(await reviewer.editPact(gym, edited({ name: "Mine now" }))).toEqual({
      ok: false,
      reason: "pact-not-found",
    });
  });

  test("the first occurrence is worked out again from when the pact was created", async () => {
    const s = scenario();
    const { owner, createPact, sam, reviewer } = await ownerWithReviewers(s);
    // Monday's midnight is exactly an hour after creation, so it still counts...
    s.setClockTo("Mon 23:00");
    const gym = await createPact("Gym", ["tue"], { reviewers: [reviewer] });
    const daily = { kind: "fixed-days", days: ["mon", "tue"] } as const;
    const terms: NewPact = {
      evidenceKind: "camera",
      name: "Gym",
      description: "A photo of Gym",
      schedule: { ...daily, days: [...daily.days] },
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    };

    // ...even when the edit, at 23:05, comes under an hour before it.
    s.setClockTo("Mon 23:05");
    expect(owner.firstOccurrence(terms.schedule, gym)).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-05", dueAt: s.at("Tue 00:00") },
    });
    expect(await owner.editPact(gym, terms)).toEqual({ ok: true });

    expect(owner.pact(gym)).toMatchObject({
      pact: { firstOccurrence: { date: "2026-01-05", dueAt: s.at("Tue 00:00") } },
    });
  });
});

describe("the first occurrence of an edit", () => {
  test("someone else's pact, or none, is not found", async () => {
    const s = scenario();
    const { reviewer, gym } = await newGym(s);

    for (const editing of [gym, "no-such-pact"]) {
      expect(reviewer.firstOccurrence({ kind: "fixed-days", days: ["mon"] }, editing)).toEqual({
        ok: false,
        reason: "pact-not-found",
      });
    }
  });
});

describe("deleting a pact in its edit window", () => {
  test("it's gone with no trace, and its reviewers never hear about it", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);
    s.setClockTo("Mon 10:05");

    expect(await owner.deletePact(gym)).toEqual({ ok: true });

    expect(owner.pacts()).toEqual([]);
    expect(owner.pact(gym)).toEqual({ ok: false, reason: "pact-not-found" });
    expect(owner.today()).toMatchObject({ hasPacts: false, sections: [], waiting: [] });
    expect(owner.ledgers()).toEqual([]);

    await s.advanceTo("Mon 10:10");
    await s.advanceTo("Tue 00:00");
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    expect(s.notifier.sentTo(owner)).toEqual([]);
  });

  test("at minute 10 it's refused", async () => {
    const s = scenario();
    const { owner, gym } = await newGym(s);
    s.setClockTo("Mon 10:10");

    expect(await owner.deletePact(gym)).toEqual({ ok: false, reason: "edit-window-closed" });
    expect(owner.pact(gym)).toMatchObject({ ok: true });
  });

  test("only the owner can delete it", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);

    expect(await reviewer.deletePact(gym)).toEqual({ ok: false, reason: "pact-not-found" });
    expect(owner.pact(gym)).toMatchObject({ ok: true });
  });

  test("its waiting evidence goes with it", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);
    const evidence = await owner.submitEvidence(gym, [photo()]);
    if (!evidence.ok) throw new Error(evidence.reason);

    expect(await owner.deletePact(gym)).toEqual({ ok: true });

    expect(owner.today().waiting).toEqual([]);
    await s.advanceTo("Mon 10:10");
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
  });
});

describe("when the edit window closes", () => {
  test("each reviewer gets one picked-as-reviewer notification, even across a restart", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 10:00");
    const gym = await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Mon 10:09");
    expect(s.notifier.sentTo(reviewer)).toEqual([]);

    await s.advanceTo("Mon 10:10");
    const picked = {
      kind: "picked-as-reviewer",
      channel: "push",
      payload: {
        pactId: gym,
        title: "owner picked you as a reviewer",
        body: "Gym · Mon, Wed, Fri · $5 per miss",
        url: "/review",
      },
    };
    expect(s.notifier.sentTo(reviewer)).toEqual([{ recipient: reviewer.id, ...picked }]);
    expect(s.notifier.sentTo(second)).toEqual([{ recipient: second.id, ...picked }]);
    expect(s.notifier.sentTo(owner)).toEqual([]);

    await s.restart();
    await s.advanceTo("Mon 10:11");
    expect(s.notifier.sentTo(reviewer)).toHaveLength(1);
  });

  test("a stopped scheduler still notifies when it catches up", async () => {
    const s = scenario();
    const { reviewer } = await newGym(s);

    await s.advanceTo("Mon 15:00");

    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["picked-as-reviewer"]);
  });

  test("an edit that swaps the reviewer notifies only the final one, with the final terms", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, edited } = await newGym(s);
    await owner.editPact(gym, edited({ name: "Morning gym", penaltyCents: 1000, reviewerIds: [second.id] }));

    await s.advanceTo("Mon 10:10");

    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    expect(s.notifier.sentTo(second).map((n) => n.payload.body)).toEqual([
      "Morning gym · Mon, Wed, Fri · $10 per miss",
    ]);
  });

  test("the setting turned off records nothing for that account", async () => {
    const s = scenario();
    const { reviewer } = await newGym(s);
    await reviewer.setNotificationSetting("picked-as-reviewer", false);

    await s.advanceTo("Mon 10:10");

    expect(s.notifier.sentTo(reviewer)).toEqual([]);
  });
});

describe("evidence submitted in the edit window", () => {
  test("no reviewer sees or hears of it until the window closes, after being picked", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);
    s.setClockTo("Mon 10:05");
    const evidence = await owner.submitEvidence(gym, [photo()]);
    if (!evidence.ok) throw new Error(evidence.reason);

    expect(owner.today().waiting).toMatchObject([{ kind: "evidence", id: evidence.evidenceId }]);
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(await reviewer.decide(evidence.evidenceId, { kind: "approve" })).toMatchObject({ ok: false });
    expect(s.notifier.sentTo(reviewer)).toEqual([]);

    await s.advanceTo("Mon 10:10");
    expect(reviewer.reviewQueue()).toMatchObject([{ kind: "evidence", id: evidence.evidenceId }]);
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["picked-as-reviewer", "review-item"]);

    await s.advanceTo("Mon 10:11");
    expect(s.notifier.sentTo(reviewer)).toHaveLength(2);
  });

  test("evidence after the window closes goes out at once, and only once", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);
    s.setClockTo("Mon 10:10");
    await owner.submitEvidence(gym, [photo()]);
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["review-item"]);

    await s.advanceTo("Mon 10:11");
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["review-item", "picked-as-reviewer"]);
  });

  test("evidence still uploading when the window closes isn't lost", async () => {
    const s = scenario();
    const { owner, reviewer, gym } = await newGym(s);
    s.setClockTo("Mon 10:09");

    const submitting = owner.submitEvidence(gym, [photo()]);
    await s.advanceTo("Mon 10:10");
    await submitting;

    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["picked-as-reviewer", "review-item"]);
  });

  test("an edit that takes its day off the schedule removes it", async () => {
    const s = scenario();
    const { owner, reviewer, gym, edited } = await newGym(s);
    await owner.submitEvidence(gym, [photo()]);

    await owner.editPact(gym, edited({ schedule: { kind: "fixed-days", days: ["wed", "fri"] } }));

    expect(owner.today().waiting).toEqual([]);
    await s.advanceTo("Mon 10:10");
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["picked-as-reviewer"]);
  });

  test("an edit that swaps the reviewer sends it to the final one", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, edited } = await newGym(s);
    await owner.submitEvidence(gym, [photo()]);
    await owner.editPact(gym, edited({ reviewerIds: [second.id] }));

    await s.advanceTo("Mon 10:10");

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    expect(second.reviewQueue()).toHaveLength(1);
    expect(s.notifier.sentTo(second).map((n) => n.kind)).toEqual(["picked-as-reviewer", "review-item"]);
  });
});

describe("the Pacts tab", () => {
  test("pacts in their edit window come first, and go back in order when it closes", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 10:00");
    await createPact("Reading", MON_WED_FRI);
    s.setClockTo("Mon 10:30");
    await createPact("Yoga", MON_WED_FRI);
    await createPact("Gym", MON_WED_FRI);

    expect(owner.pacts().map((p) => [p.name, p.editWindowClosesAt])).toEqual([
      ["Gym", s.at("Mon 10:40")],
      ["Yoga", s.at("Mon 10:40")],
      ["Reading", null],
    ]);

    s.setClockTo("Mon 10:40");
    expect(owner.pacts().map((p) => p.name)).toEqual(["Gym", "Reading", "Yoga"]);
  });
});
