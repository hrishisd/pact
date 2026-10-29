import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

// The clock starts at Mon 09:00 (2026-01-05T14:00Z), so an invite made then
// expires at 2026-01-12T14:00Z, the following Monday, outside the named week.
const JUST_BEFORE_EXPIRY = "2026-01-12T13:59:00Z";
const AT_EXPIRY = "2026-01-12T14:00:00Z";

describe("invites", () => {
  test("an invite accepted within 7 days makes the two accounts friends both ways", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();

    s.setClockTo(JUST_BEFORE_EXPIRY);
    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });
    expect(await reviewer.acceptInvite(invite.token)).toEqual({
      ok: true,
      friend: { id: owner.id, name: "owner" },
    });

    expect(owner.friends()).toEqual([{ id: reviewer.id, name: "reviewer" }]);
    expect(reviewer.friends()).toEqual([{ id: owner.id, name: "owner" }]);
  });

  test("an invite expires 7 days after it was created", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect((await owner.createInvite()).expiresAt).toEqual(new Date(AT_EXPIRY));
  });

  test("a second accept of the same link is refused, even by the person who used it", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();
    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });
    await reviewer.acceptInvite(invite.token);

    expect(await reviewer.acceptInvite(invite.token)).toEqual({ ok: false, reason: "invite-used" });
    expect(await s.attemptSignIn("latecomer", { inviteToken: invite.token })).toEqual({
      ok: false,
      reason: "invite-required",
    });
    expect(owner.friends()).toEqual([{ id: reviewer.id, name: "reviewer" }]);
  });

  test("an accept after 7 days is refused and creates no friendship", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();
    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });

    s.setClockTo(AT_EXPIRY);

    expect(await reviewer.acceptInvite(invite.token)).toEqual({ ok: false, reason: "invite-expired" });
    expect(owner.friends()).toEqual([]);
    expect(reviewer.friends()).toEqual([]);
  });

  test("an unknown token is refused", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.createInvite();
    const reviewer = await s.signIn("reviewer", { inviteToken: (await owner.createInvite()).token });

    expect(await reviewer.acceptInvite("not-a-token")).toEqual({ ok: false, reason: "invite-not-found" });
    expect(reviewer.friends()).toEqual([]);
  });

  test("someone who already has an account can accept an unclaimed invite", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const existing = await s.befriend(reviewer, "existing");
    const invite = await owner.createInvite();

    expect(await existing.acceptInvite(invite.token)).toEqual({ ok: true, friend: { id: owner.id, name: "owner" } });
    expect(owner.friends().map((f) => f.name)).toEqual(["existing", "reviewer"]);
  });

  test("accepting your own invite is refused and leaves it usable", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();

    expect(await owner.acceptInvite(invite.token)).toEqual({ ok: false, reason: "own-invite" });

    expect(owner.friends()).toEqual([]);
    expect(s.core.invite(invite.token)).toMatchObject({ ok: true });
  });

  test("accepting a second invite from a friend is refused and leaves that invite usable", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const second = await owner.createInvite();

    expect(await reviewer.acceptInvite(second.token)).toEqual({ ok: false, reason: "already-friends" });

    expect(owner.friends()).toEqual([{ id: reviewer.id, name: "reviewer" }]);
    expect(s.core.invite(second.token)).toMatchObject({ ok: true });
  });

  test("each invite has its own unguessable token", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    const a = await owner.createInvite();
    const b = await owner.createInvite();

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(32);
  });

  test("friends are listed by name, and survive a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const zoe = await s.befriend(owner, "zoe");
    const amy = await s.befriend(owner, "amy");

    await s.restart();

    expect(owner.friends()).toEqual([
      { id: amy.id, name: "amy" },
      { id: zoe.id, name: "zoe" },
    ]);
    expect(zoe.friends()).toEqual([{ id: owner.id, name: "owner" }]);
  });

  test("a friend can invite someone else, who becomes their friend only", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");

    const third = await s.befriend(reviewer, "third");

    expect(reviewer.friends().map((f) => f.name)).toEqual(["owner", "third"]);
    expect(owner.friends().map((f) => f.name)).toEqual(["reviewer"]);
    expect(third.friends().map((f) => f.name)).toEqual(["reviewer"]);
  });
});

describe("the invite page", () => {
  test("shows who sent a usable invite, without an account", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();

    expect(s.core.invite(invite.token)).toEqual({
      ok: true,
      inviterName: "owner",
      expiresAt: new Date(AT_EXPIRY),
    });
  });

  test("says why an invite can't be used", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const used = await owner.createInvite();
    await s.befriend(owner, "reviewer", used.token);
    const expired = await owner.createInvite();
    s.setClockTo(AT_EXPIRY);

    expect(s.core.invite(used.token)).toEqual({ ok: false, reason: "invite-used" });
    expect(s.core.invite(expired.token)).toEqual({ ok: false, reason: "invite-expired" });
    expect(s.core.invite("not-a-token")).toEqual({ ok: false, reason: "invite-not-found" });
  });
});

describe("signing in with an invite", () => {
  test("a usable invite lets a new person create an account, and stays open to them to accept", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();

    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });

    expect(reviewer.profile()).toEqual({ email: "reviewer@example.test", name: "reviewer", timezone: null });
    expect(reviewer.friends()).toEqual([]);
    expect(reviewer.invite(invite.token)).toMatchObject({ ok: true });
  });

  test("the first new person to sign in with a link claims it: a stranger with the forwarded link is refused", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();
    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });

    expect(await s.attemptSignIn("stranger", { inviteToken: invite.token })).toEqual({
      ok: false,
      reason: "invite-required",
    });
    expect(await reviewer.acceptInvite(invite.token)).toMatchObject({ ok: true });
    expect(owner.friends()).toEqual([{ id: reviewer.id, name: "reviewer" }]);
  });

  test("a claimed link looks used to anyone but the person who claimed it", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const someoneElse = await s.befriend(owner, "someone-else");
    const invite = await owner.createInvite();
    const reviewer = await s.signIn("reviewer", { inviteToken: invite.token });

    expect(s.core.invite(invite.token)).toEqual({ ok: false, reason: "invite-used" });
    expect(someoneElse.invite(invite.token)).toEqual({ ok: false, reason: "invite-used" });
    expect(reviewer.invite(invite.token)).toEqual({ ok: true, inviterName: "owner", expiresAt: new Date(AT_EXPIRY) });
  });

  test("someone who already has an account can't accept a link another person claimed", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");
    const existing = await s.befriend(reviewer, "existing");
    const invite = await owner.createInvite();
    const claimant = await s.signIn("claimant", { inviteToken: invite.token });

    expect(await existing.acceptInvite(invite.token)).toEqual({ ok: false, reason: "invite-used" });
    expect(await claimant.acceptInvite(invite.token)).toMatchObject({ ok: true });
  });

  test("without a usable invite a new person is refused", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const invite = await owner.createInvite();

    expect(await s.attemptSignIn("stranger", { inviteToken: "not-a-token" })).toEqual({
      ok: false,
      reason: "invite-required",
    });
    s.setClockTo(AT_EXPIRY);
    expect(await s.attemptSignIn("stranger", { inviteToken: invite.token })).toEqual({
      ok: false,
      reason: "invite-required",
    });
  });

  test("an existing account signs in whatever token it carries", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const reviewer = await s.befriend(owner, "reviewer");

    expect(await s.attemptSignIn("reviewer")).toEqual({ ok: true, accountId: reviewer.id });
    expect(await s.attemptSignIn("reviewer", { inviteToken: "not-a-token" })).toEqual({
      ok: true,
      accountId: reviewer.id,
    });
  });
});
