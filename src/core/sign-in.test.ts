import { describe, expect, test } from "vitest";
import { UnknownAccountError } from "./rows.ts";
import { scenario } from "./testing/scenario.ts";

describe("sign-in", () => {
  test("the operator's first sign-in creates their account, with the browser's timezone", async () => {
    const s = scenario();

    const owner = await s.signIn("owner", { timezone: "Europe/London" });

    expect(owner.profile()).toEqual({
      email: "owner@example.test",
      name: "owner",
      timezone: "Europe/London",
      connections: [],
    });
  });

  test("the timezone is stored under its canonical name", async () => {
    const s = scenario();

    const owner = await s.signIn("owner", { timezone: "america/new_york" });

    expect(owner.profile().timezone).toBe("America/New_York");
  });

  test.each([
    ["missing", undefined],
    ["blank", ""],
    ["unrecognised", "Mars/Olympus_Mons"],
    ["UTC-offset", "+05:00"],
  ])("a sign-in with a %s timezone is not refused, and the account gets UTC", async (_, timezone) => {
    const s = scenario();

    const result = await s.core.signIn(
      { email: "owner@example.test", name: "owner" },
      timezone === undefined ? {} : { timezone },
    );

    if (!result.ok) throw new Error(result.reason);
    expect(s.core.as(result.accountId).profile().timezone).toBe("UTC");
  });

  test("an invited person's new account gets their browser's timezone", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const { token } = await owner.createInvite();

    const friend = await s.signIn("friend", { inviteToken: token, timezone: "Asia/Tokyo" });

    expect(friend.profile().timezone).toBe("Asia/Tokyo");
  });

  test("signing in again keeps the account's timezone, whatever the browser's", async () => {
    const s = scenario();
    const owner = await s.signIn("owner", { timezone: "Europe/London" });
    await owner.setTimezone("America/Chicago");

    await s.signIn("owner", { timezone: "Asia/Tokyo" });

    expect(owner.profile().timezone).toBe("America/Chicago");
  });

  test("signing in again returns the same account", async () => {
    const s = scenario();
    const first = await s.attemptSignIn("owner");

    const again = await s.attemptSignIn("owner");

    expect(again).toEqual(first);
  });

  test("the operator is recognised whatever the case of their email", async () => {
    const s = scenario();
    const first = await s.attemptSignIn("owner");

    const shouted = await s.core.signIn({ email: "OWNER@Example.Test", name: "owner" });

    expect(shouted).toEqual(first);
  });

  test("a different email without an invite is refused and no account is created", async () => {
    const s = scenario();

    expect(await s.attemptSignIn("stranger")).toEqual({ ok: false, reason: "invite-required" });

    // Had an account been created, sign-in (which is idempotent) would now return it.
    expect(await s.attemptSignIn("stranger")).toEqual({ ok: false, reason: "invite-required" });
  });

  test("a stranger is refused before and after the operator has an account", async () => {
    const s = scenario();
    await s.attemptSignIn("stranger");

    const owner = await s.signIn("owner");
    await s.restart();

    expect(await s.attemptSignIn("stranger")).toEqual({ ok: false, reason: "invite-required" });
    expect(owner.profile().email).toBe("owner@example.test");
  });

  test("an account is found by its email, whatever the case, without signing in", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(s.core.accountIdForEmail("owner@example.test")).toBe(owner.id);
    expect(s.core.accountIdForEmail(" OWNER@Example.Test ")).toBe(owner.id);
    expect(s.core.accountIdForEmail("stranger@example.test")).toBeNull();
  });

  test("looking up an email that has no account creates none", async () => {
    const s = scenario();

    expect(s.core.accountIdForEmail("owner@example.test")).toBeNull();

    // The operator's first sign-in still creates the account: the lookup changed nothing.
    const owner = await s.signIn("owner");
    expect(s.core.accountIdForEmail("owner@example.test")).toBe(owner.id);
  });

  test("acting as an account that doesn't exist throws, for queries and commands alike", async () => {
    const s = scenario();
    const nobody = s.core.as("no-such-account");

    expect(() => nobody.pacts()).toThrow(UnknownAccountError);
    expect(() => nobody.pact("no-such-pact")).toThrow(UnknownAccountError);
    await expect(nobody.setTimezone("Europe/London")).rejects.toThrow(UnknownAccountError);
    await expect(nobody.submitEvidence("no-such-pact", [])).rejects.toThrow(UnknownAccountError);
  });

  test("every call as an account that doesn't exist is refused, whatever it is given", async () => {
    const nobody = scenario().core.as("no-such-account");

    for (const [name, call] of Object.entries(nobody) as [string, () => unknown][]) {
      const outcome = new Promise((resolve) => resolve(call()));
      await expect(outcome, name).rejects.toThrow(UnknownAccountError);
    }
  });
});
