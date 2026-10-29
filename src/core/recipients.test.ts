import { describe, expect, test } from "vitest";
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
