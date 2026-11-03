// What the core records for each kind of notification, the settings that turn
// a kind off, and the devices a notification goes to.

import { describe, expect, test } from "vitest";
import type { PushDevice } from "./ports.ts";
import { failOnCall } from "./testing/fakes.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";

// A real P-256 public key, from RFC 8291's example.
const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = Buffer.alloc(16, 9).toString("base64url");

function device(name: string): PushDevice {
  return { endpoint: `https://web.push.apple.com/${name}`, p256dh: P256DH, auth: AUTH };
}

async function submitted(s: Scenario) {
  const people = await ownerWithReviewers(s);
  const gym = await people.createPact("Gym", MON_WED_FRI);
  s.setClockTo("Mon 18:00");
  const evidence = await people.owner.submitEvidence(gym, [photo()]);
  if (!evidence.ok) throw new Error(evidence.reason);
  return { ...people, gym, evidenceId: evidence.evidenceId };
}

describe("each kind records one notification for each person it's for", () => {
  test("approving evidence: one decision to the owner, opening the pact", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await submitted(s);
    const before = s.notifier.sent.length;

    await reviewer.decide(evidenceId, { kind: "approve" });

    expect(s.notifier.sent.slice(before)).toEqual([
      {
        recipient: owner.id,
        kind: "evidence-decided",
        channel: "push",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          pactId: gym,
          decision: "approved",
          title: "reviewer approved your evidence",
          body: "Gym · Mon Jan 5",
          url: `/pacts/${gym}`,
        },
      },
    ]);
    expect(s.notifier.sentTo(second).map((n) => n.kind)).toEqual(["review-item"]);
  });

  test("a Missed judgment: one to the owner, opening the pact", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    await s.advanceTo("Tue 00:00");

    expect(s.notifier.sentTo(owner)).toEqual([
      {
        recipient: owner.id,
        kind: "missed-occurrence",
        channel: "push",
        payload: {
          pactId: gym,
          occurrenceDate: "2026-01-05",
          title: "Gym is Missed",
          body: "Mon Jan 5 · $5 to Sam",
          url: `/pacts/${gym}`,
        },
      },
    ]);
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["picked-as-reviewer"]);

    await s.advanceTo("Tue 00:00");
    expect(s.notifier.sentTo(owner)).toHaveLength(1);
  });

  test("a rejection sends the decision only, not a Missed occurrence as well", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await submitted(s);

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Last week's" });
    await s.advanceTo("Tue 00:00");

    expect(s.notifier.sentTo(owner).map((n) => n.kind)).toEqual(["evidence-decided"]);
  });
});

describe("notification settings", () => {
  test("every kind starts on", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(owner.notificationSettings()).toEqual([
      { setting: "picked-as-reviewer", enabled: true },
      { setting: "review-item", enabled: true },
      { setting: "decision", enabled: true },
      { setting: "comment", enabled: true },
      { setting: "missed-occurrence", enabled: true },
      { setting: "new-bill", enabled: true },
      { setting: "overdue-bill", enabled: true },
    ]);
  });

  test("a new review item turned off records nothing for that account, and others still get theirs", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await reviewer.setNotificationSetting("review-item", false);

    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo()]);

    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    expect(s.notifier.sentTo(second).map((n) => n.kind)).toEqual(["review-item"]);
    expect(reviewer.reviewQueue()).toHaveLength(1);
  });

  test("decision turned off covers evidence and payments", async () => {
    const s = scenario();
    const { owner, reviewer, sam, evidenceId } = await submitted(s);
    await owner.setNotificationSetting("decision", false);

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Last week's" });
    const payment = await owner.recordPayment({ recipientId: sam.id, amountCents: 500 }, photo(2));
    if (!payment.ok) throw new Error(payment.reason);
    await reviewer.decide(payment.paymentId, { kind: "approve" });

    expect(s.notifier.sentTo(owner)).toEqual([]);
  });

  test("Missed occurrence turned off records nothing, though the penalty is still added", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI);
    await owner.setNotificationSetting("missed-occurrence", false);

    await s.advanceTo("Tue 00:00");

    expect(s.notifier.sentTo(owner)).toEqual([]);
    expect(owner.ledgers()[0]?.owedCents).toBe(500);
  });

  test("turned back on, it records again, and the setting is remembered until then", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await reviewer.setNotificationSetting("review-item", false);
    await s.restart();
    expect(reviewer.notificationSettings()).toContainEqual({ setting: "review-item", enabled: false });

    await reviewer.setNotificationSetting("review-item", true);
    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo()]);

    expect(s.notifier.sentTo(reviewer)).toHaveLength(1);
  });

  test("an operator alert can't be turned off", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    for (const { setting } of owner.notificationSettings()) await owner.setNotificationSetting(setting, false);

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sentTo(owner).map((n) => n.kind)).toEqual(["operator-alert"]);
  });
});

describe("a command that fails part way records no notifications", () => {
  test("whichever read of the clock fails, while one or both reviewers were queued", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const before = s.notifier.sent.length;

    // Fails each clock read in turn, until the command gets through without one.
    let failedAtLeastOnce = false;
    for (let n = 1; n < 20; n++) {
      failOnCall(s.clock, "now", n);
      const attempt = await owner.submitEvidence(gym, [photo(n)]).catch(() => "failed" as const);
      if (attempt !== "failed") break;
      failedAtLeastOnce = true;
      expect(s.notifier.sent.slice(before)).toEqual([]);
      expect(reviewer.reviewQueue()).toEqual([]);
    }

    expect(failedAtLeastOnce).toBe(true);
    await s.advanceTo("Mon 19:00");
    expect(s.notifier.sentTo(reviewer).length).toBeGreaterThanOrEqual(1);
    expect(s.notifier.sentTo(second).length).toBeGreaterThanOrEqual(1);
  });
});

describe("the devices a notification goes to", () => {
  test("every device of the recipient, and only theirs", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await reviewer.savePushSubscription(device("phone"));
    await reviewer.savePushSubscription(device("laptop"));
    await second.savePushSubscription(device("second-phone"));

    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo()]);

    expect(
      s.notifier
        .devicesOf(reviewer)
        .map((d) => d.endpoint)
        .sort(),
    ).toEqual([device("laptop").endpoint, device("phone").endpoint]);
    expect(s.notifier.devicesOf(second)).toEqual([device("second-phone")]);
    expect(s.notifier.devicesOf(owner)).toEqual([]);
  });

  test("saving a device twice keeps one, with its newest keys", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.savePushSubscription(device("phone"));
    const rotated = { ...device("phone"), auth: Buffer.alloc(16, 1).toString("base64url") };
    await owner.savePushSubscription(rotated);

    await s.core.raiseRestoreAlert();

    expect(s.notifier.devicesOf(owner)).toEqual([rotated]);
  });

  test("a device someone else signs in on moves to their account", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await owner.savePushSubscription(device("shared"));
    await reviewer.savePushSubscription(device("shared"));

    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo()]);

    expect(s.notifier.devicesOf(reviewer)).toEqual([device("shared")]);
    expect(s.notifier.devicesOf(owner)).toEqual([]);
  });

  test("a device the push service says has expired is removed", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.savePushSubscription(device("old"));
    await owner.savePushSubscription(device("new"));
    s.notifier.expire(device("old").endpoint);

    await s.core.raiseRestoreAlert();
    expect(s.notifier.devicesOf(owner)).toHaveLength(2);
    await s.core.raiseRestoreAlert();

    expect(s.notifier.devicesOf(owner).slice(2)).toEqual([device("new")]);
  });

  test("one device failing is retried alone, and the others don't get it twice", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.savePushSubscription(device("fine"));
    await owner.savePushSubscription(device("down"));
    s.notifier.fail(device("down").endpoint);

    await s.core.raiseRestoreAlert();
    await s.advanceTo("Mon 09:01");
    await s.advanceTo("Mon 09:02");
    expect(s.notifier.devicesOf(owner)).toEqual([device("fine")]);
    expect(s.logs).toContainEqual(expect.stringContaining("will retry: injected failure"));

    s.notifier.recover(device("down").endpoint);
    await s.advanceTo("Mon 09:03");
    await s.advanceTo("Mon 09:04");

    expect(s.notifier.devicesOf(owner)).toEqual([device("fine"), device("down")]);
  });

  test("an account removes its own device, not someone else's", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    const friend = await s.befriend(owner, "friend");
    await owner.savePushSubscription(device("mine"));
    await owner.savePushSubscription(device("kept"));

    await friend.removePushSubscription(device("mine").endpoint);
    await owner.removePushSubscription(device("kept").endpoint);
    await s.core.raiseRestoreAlert();

    expect(s.notifier.devicesOf(owner)).toEqual([device("mine")]);
  });

  test.each([
    ["a host that isn't a push service", { endpoint: "https://internal.example/hook" }],
    ["a look-alike host", { endpoint: "https://web.push.apple.com.example/x" }],
    ["plain http", { endpoint: "http://web.push.apple.com/x" }],
    ["not a URL", { endpoint: "nonsense" }],
    ["a key of the wrong length", { p256dh: AUTH }],
    [
      "a key that isn't a point on the curve",
      { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url") },
    ],
    ["an auth secret of the wrong length", { auth: P256DH }],
    ["a key that isn't base64url", { p256dh: "!!!" }],
  ])("refuses %s, saving nothing", async (_name, change) => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.savePushSubscription({ ...device("phone"), ...change })).toEqual({
      ok: false,
      reason: "invalid-subscription",
    });

    await s.core.raiseRestoreAlert();
    expect(s.notifier.devicesOf(owner)).toEqual([]);
  });

  test.each([
    "https://web.push.apple.com/abc",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", async (endpoint) => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.savePushSubscription({ ...device("phone"), endpoint })).toEqual({ ok: true });
  });
});

describe("delivery happens after the command", () => {
  test("a command doesn't wait for a slow push service", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const release = s.notifier.hold();

    // Straight through the core: the scenario's handles wait for delivery.
    const result = await s.core.as(owner.id).submitEvidence(gym, [photo()]);

    expect(result.ok).toBe(true);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    release();
    await s.core.deliveriesSettled();
    expect(s.notifier.sentTo(reviewer)).toHaveLength(1);
  });

  test("a notification whose delivery never finished goes out after a restart", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [reviewer] });
    s.setClockTo("Mon 18:00");
    failOnCall(s.notifier, "deliver", 1);
    await owner.submitEvidence(gym, [photo()]);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);

    await s.restart();
    await s.advanceTo("Mon 18:01");

    expect(s.notifier.sentTo(reviewer).filter((n) => n.kind === "review-item")).toHaveLength(1);
  });
});
