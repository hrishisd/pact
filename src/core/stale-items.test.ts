// Stale-item reminders (R2): no item decides itself. A reviewer is pushed once
// a day while an item in their Review Queue has waited more than 24 hours, and
// an owner while a reviewer's question to them has gone unanswered that long;
// both at 09:00 in the recipient's timezone.

import { describe, expect, test } from "vitest";
import { EVERY_DAY, gymEvidenceWaiting, ownerWithReviewers, submit } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

describe("the reviewer's daily reminder", () => {
  test("evidence filed Monday 10:00: first at Wednesday 09:00, then daily, none once decided", async () => {
    const s = scenario();
    const { owner, reviewer, second, evidenceId } = await gymEvidenceWaiting(s, "Mon 10:00");
    const reminders = () => s.notifier.sentTo(reviewer, "stale-review-items");

    await s.advanceTo("Tue 10:00");
    await s.advanceTo("Wed 08:59");
    expect(reminders()).toEqual([]);

    await s.advanceTo("Wed 09:00");
    expect(reminders()).toEqual([
      {
        recipient: reviewer.id,
        kind: "stale-review-items",
        payload: {
          count: 1,
          oldestItemKind: "evidence",
          oldestItemId: evidenceId,
          title: "1 item waits for your review",
          body: "The oldest, owner's evidence for Gym, has waited 2 days.",
          url: "/review",
        },
      },
    ]);
    expect(s.notifier.sentTo(second, "stale-review-items")).toHaveLength(1);
    expect(s.notifier.sentTo(owner, "stale-review-items")).toEqual([]);

    await s.advanceTo("Wed 20:00");
    expect(reminders()).toHaveLength(1);
    await s.advanceTo("Thu 09:00");
    expect(reminders().map((n) => n.payload.body)).toEqual([
      "The oldest, owner's evidence for Gym, has waited 2 days.",
      "The oldest, owner's evidence for Gym, has waited 3 days.",
    ]);

    s.setClockTo("Thu 12:00");
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Fri 09:00");
    await s.advanceTo("Sat 09:00");
    expect(reminders()).toHaveLength(2);
  });

  test("three items, the oldest 2 days old: the push says 3 and 2 days", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    const read = await createPact("Read", EVERY_DAY);
    s.setClockTo("Mon 10:00");
    await submit(owner, gym);
    s.setClockTo("Tue 10:00");
    await submit(owner, gym);
    s.setClockTo("Tue 11:00");
    await submit(owner, read);

    await s.advanceTo("Wed 09:00");

    expect(s.notifier.sentTo(reviewer, "stale-review-items").map((n) => [n.payload.title, n.payload.body])).toEqual([
      ["3 items wait for your review", "The oldest, owner's evidence for Gym, has waited 2 days."],
    ]);
  });

  test("at 09:00 in the reviewer's own timezone", async () => {
    const s = scenario();
    const { reviewer } = await gymEvidenceWaiting(s, "Mon 10:00");
    await reviewer.setTimezone("America/Los_Angeles");

    // Filed Monday 07:00 in Los Angeles: more than 24 hours old by Tuesday 09:00 there, 12:00 in New York.
    await s.advanceTo("Tue 11:59");
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toEqual([]);
    await s.advanceTo("Tue 12:00");
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);
  });

  test('with "New review item" off, none', async () => {
    const s = scenario();
    const { reviewer } = await gymEvidenceWaiting(s, "Mon 10:00");
    await reviewer.setNotificationSetting("review-item", false);

    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Thu 09:00");

    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toEqual([]);
  });

  test("no second one after a move west brings 09:00 round again on another date", async () => {
    const s = scenario();
    const { reviewer } = await gymEvidenceWaiting(s, "Mon 10:00");
    await reviewer.setTimezone("Asia/Kolkata");
    // 09:00 on Wednesday in Kolkata.
    await s.advanceTo("Tue 22:30");
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);

    await reviewer.setTimezone("America/New_York");
    await s.advanceTo("Wed 20:00");
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);

    await s.advanceTo("Thu 09:00");
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(2);
  });

  test("no second reminder the same day across a restart", async () => {
    const s = scenario();
    const { reviewer } = await gymEvidenceWaiting(s, "Mon 10:00");
    await s.advanceTo("Wed 09:00");

    await s.restart();
    await s.advanceTo("Wed 12:00");

    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);
  });
});

describe("a question waiting on the owner's reply", () => {
  test("isn't counted for the reviewer; the owner is reminded daily until they reply, then it counts again from the reply", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s, "Mon 10:00");
    s.setClockTo("Mon 12:00");
    await reviewer.askOwner(evidenceId, "Is that this week's?");
    const ownerReminders = () => s.notifier.sentTo(owner, "unanswered-question");
    const reviewerReminders = () => s.notifier.sentTo(reviewer, "stale-review-items");

    await s.advanceTo("Tue 09:00");
    expect(ownerReminders()).toEqual([]);

    await s.advanceTo("Wed 09:00");
    expect(reviewerReminders()).toEqual([]);
    expect(ownerReminders()).toEqual([
      {
        recipient: owner.id,
        kind: "unanswered-question",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          title: "reviewer asked about your evidence for Gym 2 days ago",
          body: "Reply so they can decide.",
          url: `/evidence/${evidenceId}`,
        },
      },
    ]);
    await s.advanceTo("Thu 09:00");
    expect(ownerReminders()).toHaveLength(2);

    s.setClockTo("Thu 10:00");
    await owner.reply(evidenceId, "Yes, Monday's");
    await s.advanceTo("Fri 09:00");
    await s.advanceTo("Sat 09:00");
    expect(ownerReminders()).toHaveLength(2);
    // Back in the queue Thursday 10:00: more than 24 hours by Saturday 09:00, not by Friday's.
    expect(reviewerReminders().map((n) => [n.payload.title, n.payload.body])).toEqual([
      ["1 item waits for your review", "The oldest, owner's evidence for Gym, has waited 2 days."],
    ]);
  });

  test('with "Comment" off, the owner gets none', async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s, "Mon 10:00");
    await reviewer.askOwner(evidenceId, "Is that this week's?");
    await owner.setNotificationSetting("comment", false);

    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Thu 09:00");

    expect(s.notifier.sentTo(owner, "unanswered-question")).toEqual([]);
  });
});
