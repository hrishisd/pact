import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

describe("recipients", () => {
  test("an owner can add a recipient by name", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    const added = await owner.addRecipient({ name: "  City Food Bank " });

    expect(added).toEqual({ ok: true, recipient: { id: expect.any(String), name: "City Food Bank" } });
    expect(owner.recipients()).toEqual([added.ok && added.recipient]);
  });

  test("a recipient needs a name", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.addRecipient({ name: "" })).toEqual({ ok: false, reason: "blank-name" });
    expect(await owner.addRecipient({ name: "   " })).toEqual({ ok: false, reason: "blank-name" });
    expect(owner.recipients()).toEqual([]);
  });

  test("two recipients can share a name", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    const first = await owner.addRecipient({ name: "Sam" });
    const second = await owner.addRecipient({ name: "Sam" });

    expect(first.ok && second.ok && first.recipient.id !== second.recipient.id).toBe(true);
    expect(owner.recipients().map((r) => r.name)).toEqual(["Sam", "Sam"]);
  });

  test("recipients are each owner's own, listed by name, and survive a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const friend = await s.befriend(owner, "friend");
    await owner.addRecipient({ name: "Zoe" });
    await owner.addRecipient({ name: "Animal Shelter" });

    await s.restart();

    expect(owner.recipients().map((r) => r.name)).toEqual(["Animal Shelter", "Zoe"]);
    expect(friend.recipients()).toEqual([]);
  });
});

describe("people are listed by name the same way on every page", () => {
  test('"alice" comes before "Bob": friends, recipients, ledgers, a pact\'s and an excuse\'s reviewers', async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const bob = await s.befriend(owner, "Bob");
    const alice = await s.befriend(owner, "alice");
    const bobRecipient = await owner.addRecipient({ name: "Bob" });
    const aliceRecipient = await owner.addRecipient({ name: "alice" });
    if (!bobRecipient.ok || !aliceRecipient.ok) throw new Error("recipient refused");
    await createPact("Gym", MON_WED_FRI, { reviewers: [bob, alice], recipientId: bobRecipient.recipient.id });
    const run = await createPact("Run", MON_WED_FRI, {
      reviewers: [bob, alice],
      recipientId: aliceRecipient.recipient.id,
    });
    s.setClockTo("Mon 10:00"); // after the edit window
    const filed = await owner.fileExcuse(run, { from: "2026-01-07", to: "2026-01-07", reason: "Trip" }, []);
    if (!filed.ok) throw new Error(filed.reason);

    expect(owner.friends().map((f) => f.name)).toEqual(["alice", "Bob", "reviewer", "second"]);
    expect(owner.recipients().map((r) => r.name)).toEqual(["alice", "Bob", "Sam"]);
    expect(owner.ledgers().map((l) => l.name)).toEqual(["alice", "Bob"]);
    expect(owner.pact(run)).toMatchObject({ pact: { reviewers: [{ name: "alice" }, { name: "Bob" }] } });
    expect(owner.excuse(filed.excuseId)).toMatchObject({ excuse: { reviewerNames: ["alice", "Bob"] } });
  });
});
