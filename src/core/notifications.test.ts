// What the core records for each kind of notification, the settings that turn
// a kind off, and the devices a notification goes to.

import { describe, expect, test } from "vitest";
import type { PushDevice } from "./ports.ts";
import { createContext } from "./context.ts";
import { openDatabase } from "./db.ts";
import { deliverPending } from "./outbox.ts";
import { failOnCall, RecordingNotifier } from "./testing/fakes.ts";
import { gymEvidenceWaiting, MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok, owed } from "./testing/queries.ts";

// A real P-256 public key, from RFC 8291's example.
const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = Buffer.alloc(16, 9).toString("base64url");

function device(name: string): PushDevice {
  return { endpoint: `https://web.push.apple.com/${name}`, p256dh: P256DH, auth: AUTH };
}

describe("each kind records one notification for each person it's for", () => {
  test("approving evidence: one decision to the owner, opening the pact", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await gymEvidenceWaiting(s);
    const before = s.notifier.sent.length;

    await reviewer.decide(evidenceId, { kind: "approve" });

    expect(s.notifier.sent.slice(before)).toEqual([
      {
        recipient: owner.id,
        kind: "evidence-decided",
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
    expect(s.notifier.kindsSentTo(second)).toEqual(["review-item"]);
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
        payload: {
          pactId: gym,
          occurrenceDate: s.date("Mon"),
          title: "You missed Gym",
          body: "Mon Jan 5 · $5 penalty to Sam",
          url: `/pacts/${gym}`,
        },
      },
    ]);
    expect(s.notifier.kindsSentTo(reviewer)).toEqual(["picked-as-reviewer"]);

    await s.advanceTo("Tue 00:00");
    expect(s.notifier.sentTo(owner)).toHaveLength(1);
  });

  test("a rejection sends the decision only, not a Missed occurrence as well", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s);

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Last week's" });
    await s.advanceTo("Tue 00:00");

    expect(s.notifier.kindsSentTo(owner)).toEqual(["evidence-decided"]);
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
      { setting: "connection-problem", enabled: true },
      { setting: "reviewed-pact", enabled: true },
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
    expect(s.notifier.kindsSentTo(second)).toEqual(["review-item"]);
    expect(reviewer.reviewQueue()).toHaveLength(1);
  });

  test("decision turned off covers evidence and payments", async () => {
    const s = scenario();
    const { owner, reviewer, sam, evidenceId } = await gymEvidenceWaiting(s);
    await owner.setNotificationSetting("decision", false);

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Last week's" });
    const payment = ok(await owner.recordPayment({ recipientId: sam.id, amountCents: 500 }, photo(2)));
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
    expect(owed(owner)).toBe(500);
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

  test("Pacts you review turned off: a reviewer isn't told of the owner's timezone change", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s, { timezone: "Europe/London" });
    await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Mon 12:00");
    await reviewer.setNotificationSetting("reviewed-pact", false);

    await owner.setTimezone("Pacific/Honolulu");

    expect(s.notifier.sentTo(reviewer, "timezone-changed")).toEqual([]);
    expect(s.notifier.sentTo(second, "timezone-changed")).toHaveLength(1);
  });

  test("Pacts you review turned off: a reviewer isn't told another was added", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Mon 12:00");
    const third = await s.befriend(owner, "third");
    await reviewer.setNotificationSetting("reviewed-pact", false);

    ok(await owner.addReviewers(gym, [third.id]));

    expect(s.notifier.sentTo(reviewer, "reviewer-added")).toEqual([]);
    expect(s.notifier.sentTo(second, "reviewer-added")).toHaveLength(1);
  });

  test("Pacts you review turned off: a reviewer isn't told of an approved vacation", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Wed 12:00");
    await second.setNotificationSetting("reviewed-pact", false);
    const vacation = ok(
      await owner.fileVacation({
        from: s.date("Mon+1"),
        to: s.date("Sun+1"),
        pactIds: [gym],
        reviewerIds: [reviewer.id],
      }),
    );

    await reviewer.decide(vacation.vacationId, { kind: "approve" });

    expect(s.notifier.sentTo(second, "vacation-approved")).toEqual([]);
  });

  test("an operator alert can't be turned off", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    for (const { setting } of owner.notificationSettings()) await owner.setNotificationSetting(setting, false);

    await s.core.raiseRestoreAlert();

    expect(s.notifier.kindsSentTo(owner)).toEqual(["operator-alert"]);
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

    expect(s.notifier.sentTo(reviewer, "review-item")).toHaveLength(1);
  });
});

describe("the app icon's badge", () => {
  test("each push carries its recipient's Review Queue size as it goes, the item it tells of included", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    for (const person of [owner, reviewer, second]) await person.savePushSubscription(device(person.id));
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    const gymEvidence = await submit(owner, gym);
    const runEvidence = await submit(owner, run);
    expect(s.notifier.badgesSentTo(reviewer, "review-item")).toEqual([1, 2]);

    await reviewer.decide(gymEvidence, { kind: "approve" });
    // The owner reviews nothing: their own items waiting aren't in it.
    expect(s.notifier.badgesSentTo(owner, "evidence-decided")).toEqual([0]);

    await reviewer.askOwner(runEvidence, "Which gym?");
    await owner.reply(runEvidence, "The one on Main St");
    // Back in both queues, the decided one gone from both.
    expect(s.notifier.badgesSentTo(reviewer, "owner-replied")).toEqual([1]);
    expect(s.notifier.badgesSentTo(second, "owner-replied")).toEqual([1]);
  });

  test("a push to someone with no devices carries no badge", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [reviewer] });
    s.setClockTo("Mon 18:00");

    await submit(owner, gym);

    expect(s.notifier.badgesSentTo(reviewer, "review-item")).toEqual([undefined]);
  });

  test("a push sent again after a failure carries the count when it goes, not when it was queued", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    await reviewer.savePushSubscription(device("phone"));
    const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [reviewer] });
    const run = await createPact("Run", MON_WED_FRI, { reviewers: [reviewer] });
    s.setClockTo("Mon 18:00");
    failOnCall(s.notifier, "deliver", 1);

    await submit(owner, gym);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
    await submit(owner, run);

    expect(s.notifier.badgesSentTo(reviewer, "review-item")).toEqual([2, 2]);
  });

  test("a device sent to again after it alone failed gets the count then", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    await reviewer.savePushSubscription(device("fine"));
    await reviewer.savePushSubscription(device("down"));
    const gym = await createPact("Gym", MON_WED_FRI, { reviewers: [reviewer] });
    const run = await createPact("Run", MON_WED_FRI, { reviewers: [reviewer] });
    s.setClockTo("Mon 18:00");
    s.notifier.fail(device("down").endpoint);

    await submit(owner, gym);
    s.notifier.recover(device("down").endpoint);
    await submit(owner, run);

    // Gym's to both devices (the down one failing), Gym's again to the down one alone, then Run's.
    expect(s.notifier.badgesSentTo(reviewer, "review-item")).toEqual([1, 2, 2]);
    expect(s.notifier.devicesOf(reviewer).map((d) => d.endpoint)).toEqual([
      device("fine").endpoint,
      device("down").endpoint,
      device("down").endpoint,
      device("fine").endpoint,
    ]);
  });

  // At `deliverPending`'s own interface: no command can break the Review Queue,
  // so a broken one is handed in.
  test("when the count can't be worked out, the push still goes, with no badge, and it's logged", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.savePushSubscription(device("phone"));
    s.notifier.fail(device("phone").endpoint);
    await s.core.raiseRestoreAlert();
    const logs: string[] = [];
    const ctx = createContext({
      db: openDatabase(s.dbPath),
      clock: s.clock,
      newId: () => "unused",
      log: (line) => logs.push(line),
      enqueue: () => {},
      ankiChecksRunning: new Map(),
    });
    const notifier = new RecordingNotifier();

    await deliverPending(ctx, notifier, () => {
      throw new Error("the queue broke");
    });

    expect(notifier.kindsSentTo(owner)).toEqual(["operator-alert"]);
    expect(notifier.badgesSentTo(owner)).toEqual([undefined]);
    expect(notifier.devicesOf(owner)).toEqual([device("phone")]);
    expect(logs).toContainEqual(expect.stringMatching(/operator-alert to .* without a badge: .*the queue broke/));
    ctx.db.close();
  });
});
