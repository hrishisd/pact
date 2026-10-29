import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("recipients", () => {
  test("an owner can add an organization recipient by name and link", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    const added = await owner.addRecipient({
      kind: "organization",
      name: "Food Bank",
      link: "https://foodbank.example/donate",
    });

    expect(added).toEqual({
      ok: true,
      recipient: { id: expect.any(String), kind: "organization", name: "Food Bank", link: "https://foodbank.example/donate" },
    });
    expect(owner.recipients()).toEqual([added.ok && added.recipient]);
  });

  test("an owner can pick a friend as a person recipient", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const friend = await s.befriend(owner, "reviewer");

    const added = await owner.addRecipient({ kind: "person", friendId: friend.id });

    expect(added).toEqual({
      ok: true,
      recipient: { id: expect.any(String), kind: "person", friendId: friend.id, name: "reviewer" },
    });
    expect(owner.recipients()).toEqual([added.ok && added.recipient]);
  });

  test("picking a friend who is already a recipient gives back that recipient", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const friend = await s.befriend(owner, "reviewer");
    const first = await owner.addRecipient({ kind: "person", friendId: friend.id });

    const again = await owner.addRecipient({ kind: "person", friendId: friend.id });

    expect(again).toEqual(first);
    expect(owner.recipients()).toEqual([first.ok && first.recipient]);
  });

  test("an owner can pick only friends as person recipients", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const stranger = await s.befriend(reviewer, "stranger");

    expect(await owner.addRecipient({ kind: "person", friendId: stranger.id })).toEqual({
      ok: false,
      reason: "not-a-friend",
    });
    expect(await owner.addRecipient({ kind: "person", friendId: owner.id })).toEqual({
      ok: false,
      reason: "not-a-friend",
    });
    expect(await owner.addRecipient({ kind: "person", friendId: "no-such-account" })).toEqual({
      ok: false,
      reason: "not-a-friend",
    });
    expect(owner.recipients()).toEqual([]);
  });

  test("an organization needs a name and an http(s) link", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    for (const organization of [
      { name: "", link: "https://foodbank.example" },
      { name: "   ", link: "https://foodbank.example" },
      { name: "Food Bank", link: "" },
      { name: "Food Bank", link: "foodbank.example" },
      { name: "Food Bank", link: "javascript:alert(1)" },
      { name: "Food Bank", link: "ftp://foodbank.example" },
    ]) {
      expect(await owner.addRecipient({ kind: "organization", ...organization })).toEqual({
        ok: false,
        reason: "invalid-recipient",
      });
    }
    expect(owner.recipients()).toEqual([]);
    expect(await owner.addRecipient({ kind: "organization", name: "Food Bank", link: "http://foodbank.example" }))
      .toMatchObject({ ok: true });
  });

  test("recipients are each owner's own, listed by name, and survive a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const zoe = await s.befriend(owner, "zoe");
    await owner.addRecipient({ kind: "person", friendId: zoe.id });
    await owner.addRecipient({ kind: "organization", name: "Animal Shelter", link: "https://shelter.example" });

    await s.restart();

    expect(owner.recipients().map((r) => r.name)).toEqual(["Animal Shelter", "zoe"]);
    expect(zoe.recipients()).toEqual([]);
  });
});
