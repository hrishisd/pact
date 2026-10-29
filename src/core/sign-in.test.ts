import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("sign-in", () => {
  test("the operator's first sign-in creates their account, with no timezone confirmed yet", async () => {
    const s = scenario();

    const owner = await s.signIn("owner");

    expect(owner.profile()).toEqual({ email: "owner@example.test", name: "owner", timezone: null });
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
});
