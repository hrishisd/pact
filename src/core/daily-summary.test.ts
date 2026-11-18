// The daily summary: an email a person turns on, at 09:00 in their timezone,
// listing the items in their Review Queue that have waited more than 24 hours
// and the reviewers' questions to them unanswered that long. Off to start
// with, apart from the push settings, at most one a local day.

import { describe, expect, test } from "vitest";
import { EVERY_DAY, fifteenOwed, ownerWithReviewers, recordPayment, submit } from "./testing/camera-pact.ts";
import { ok } from "./testing/queries.ts";
import { scenario, type Scenario } from "./testing/scenario.ts";

const FOOTER = [
  "You're getting this because you turned on the daily summary in Pact. It comes at 9am your time, only on days something has waited more than a day.",
  "Turn it off in Profile: https://pact.example.test/profile",
].join("\n");

/** The operator alert's words for the reviewer's summary queued on Wednesday, given up. */
const GIVEN_UP =
  "The Pact Daily Summary for Wed Jan 7 to reviewer (reviewer@example.test) failed for 24 hours and was given up.";

/** The log lines saying a daily summary's send failed and waits for the next tick. */
function failuresIn(s: Scenario) {
  return s.logs.filter((line) => /^email \d+ \(daily-summary to .*\) not sent, will retry next tick: /.test(line));
}

/** The daily summaries sent to `name`'s address, in order. */
function summariesTo(s: Scenario, name: string) {
  return s.mailer.sent.filter((email) => email.to === `${name}@example.test` && email.subject === "Pact daily summary");
}

/** The owner with Gym, every day, reviewed by "reviewer" and "second", and its evidence submitted at `at`. */
async function evidenceAt(s: Scenario, at: string) {
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", EVERY_DAY);
  s.setClockTo(at);
  const evidenceId = await submit(setup.owner, gym);
  return { ...setup, gym, evidenceId };
}

describe("the setting", () => {
  test("off by default: a new account gets no email, whatever waits, and its pushes still go", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await evidenceAt(s, "Tue 08:00");
    await reviewer.askOwner(evidenceId, "Which gym?");

    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Thu 09:00");

    expect(reviewer.dailySummary()).toEqual({ enabled: false, to: "reviewer@example.test" });
    expect(summariesTo(s, "owner")).toEqual([]);
    expect(summariesTo(s, "reviewer")).toEqual([]);
    expect(summariesTo(s, "second")).toEqual([]);
    expect(s.notifier.sentTo(owner, "unanswered-question")).toHaveLength(2);
  });

  test("turned on and off again", async () => {
    const s = scenario();
    const reviewer = await s.signIn("owner");

    expect(await reviewer.setDailySummary(true)).toEqual({ enabled: true, to: "owner@example.test" });
    expect(reviewer.dailySummary()).toEqual({ enabled: true, to: "owner@example.test" });
    expect(await reviewer.setDailySummary(false)).toEqual({ enabled: false, to: "owner@example.test" });
  });

  test("with the Review item push off, a reviewer's email still goes", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    await reviewer.setNotificationSetting("review-item", false);

    await s.advanceTo("Wed 09:00");

    expect(summariesTo(s, "reviewer")).toHaveLength(1);
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toEqual([]);
  });

  test("with the Comment push off, an owner's email still goes", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await evidenceAt(s, "Tue 08:00");
    await reviewer.askOwner(evidenceId, "Which gym?");
    await owner.setDailySummary(true);
    await owner.setNotificationSetting("comment", false);

    await s.advanceTo("Wed 09:00");

    expect(summariesTo(s, "owner")).toHaveLength(1);
    expect(s.notifier.sentTo(owner, "unanswered-question")).toEqual([]);
  });
});

describe("the reviewer's section", () => {
  test("evidence waited 25 hours at 09:00: one email listing it, and none the next day once it's decided", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await reviewer.setDailySummary(true);
    s.setClockTo("Tue 08:00");
    const evidenceId = await submit(owner, gym);

    await s.advanceTo("Wed 08:59");
    expect(summariesTo(s, "reviewer")).toEqual([]);
    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Wed 12:00");

    expect(summariesTo(s, "reviewer")).toEqual([
      {
        to: "reviewer@example.test",
        subject: "Pact daily summary",
        text: [
          "1 item is waiting for your review.",
          "",
          "Items waiting for your review",
          "Each has waited more than a day.",
          "",
          "owner's evidence",
          "Gym · waited 1 day",
          "",
          "Open your Review Queue: https://pact.example.test/review",
          "",
          "--",
          FOOTER,
          "",
        ].join("\n"),
        html: expect.any(String),
      },
    ]);

    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Thu 09:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("every item that waited more than 24 hours, oldest first: a payment shows its recipient, a vacation its dates", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, gym } = await fifteenOwed(s);
    s.setClockTo("Sat 08:00");
    await recordPayment(owner, { recipientId: sam.id, amountCents: 1000, note: "Venmo" });
    s.setClockTo("Sat 10:00");
    ok(
      await owner.fileVacation({
        from: s.date("Mon+2"),
        to: s.date("Wed+2"),
        pactIds: [gym],
        reviewerIds: [reviewer.id],
      }),
    );
    s.setClockTo("Mon+1 08:00");
    await submit(owner, gym);
    await reviewer.setDailySummary(true);
    await second.setDailySummary(true);

    await s.advanceTo("Tue+1 09:00");

    const [email] = summariesTo(s, "reviewer");
    expect(email?.text.split("\n").slice(0, 16)).toEqual([
      "3 items are waiting for your review.",
      "",
      "Items waiting for your review",
      "Each has waited more than a day.",
      "",
      "owner's payment",
      "To Sam · waited 3 days",
      "",
      "owner's vacation",
      "Jan 19 – 21 · waited 3 days",
      "",
      "owner's evidence",
      "Gym · waited 1 day",
      "",
      "Open your Review Queue: https://pact.example.test/review",
      "",
    ]);
    // Not picked for the vacation.
    expect(summariesTo(s, "second")[0]?.text.split("\n")[0]).toBe("2 items are waiting for your review.");
  });

  test("nothing waited more than 24 hours: no email", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Tue 10:00");
    await reviewer.setDailySummary(true);

    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Wed 23:00");
    expect(summariesTo(s, "reviewer")).toEqual([]);

    await s.advanceTo("Thu 09:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("at 09:00 in the account's own timezone", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Tue 10:00");
    await reviewer.setDailySummary(true);
    await reviewer.setTimezone("America/Los_Angeles");

    // Filed Tuesday 07:00 in Los Angeles: more than 24 hours old at Wednesday 09:00 there, 12:00 in New York.
    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Wed 11:59");
    expect(summariesTo(s, "reviewer")).toEqual([]);
    await s.advanceTo("Wed 12:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("the HTML: the same lines, each section's link as a button, the footer's link, and the people's words escaped", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const pact = await createPact("Gym & <Swim>", EVERY_DAY);
    await reviewer.setDailySummary(true);
    s.setClockTo("Tue 08:00");
    await submit(owner, pact);

    await s.advanceTo("Wed 09:00");

    const html = summariesTo(s, "reviewer")[0]?.html ?? "";
    expect(html).toContain("1 item is waiting for your review.");
    expect(html).toContain("Items waiting for your review");
    expect(html).toContain("owner&#39;s evidence");
    expect(html).toContain("Gym &#38; &#60;Swim&#62; · waited 1 day");
    expect(html).not.toContain("<Swim>");
    expect(html).toMatch(/<a href="https:\/\/pact\.example\.test\/review" [^>]*>Open your Review Queue<\/a>/);
    expect(html).toMatch(/<a href="https:\/\/pact\.example\.test\/profile" [^>]*>Turn it off in Profile<\/a>/);
    expect(html).not.toContain("Questions waiting for your reply");
  });
});

describe("the owner's section", () => {
  test("only questions: a reviewer's question unanswered 25 hours, nothing in their queue", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await evidenceAt(s, "Tue 08:00");
    await reviewer.askOwner(evidenceId, "Which gym?");
    await owner.setDailySummary(true);

    await s.advanceTo("Wed 09:00");

    expect(summariesTo(s, "owner").map((email) => email.text)).toEqual([
      [
        "1 question is waiting for your reply.",
        "",
        "Questions waiting for your reply",
        "Your reviewers asked about these instead of deciding them. Reply so they can decide.",
        "",
        "reviewer asked about your evidence",
        "Gym · asked 1 day ago",
        "",
        "Open Today: https://pact.example.test/",
        "",
        "--",
        FOOTER,
        "",
      ].join("\n"),
    ]);
  });
});

describe("an owner who is also a reviewer", () => {
  test("gets both sections in one email, and never two in one day, across a restart too", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await evidenceAt(s, "Tue 08:00");
    await reviewer.askOwner(evidenceId, "Which gym?");
    const ana = ok(await reviewer.addRecipient({ name: "Ana" }));
    const read = ok(
      await reviewer.createPact({
        evidenceKind: "camera",
        name: "Read",
        description: "A photo of a book",
        schedule: { kind: "fixed-days", days: EVERY_DAY },
        penaltyCents: 500,
        recipientId: ana.recipient.id,
        reviewerIds: [owner.id],
      }),
    ).pactId;
    await submit(reviewer, read);
    await owner.setDailySummary(true);

    await s.advanceTo("Wed 09:00");
    await s.restart();
    await s.advanceTo("Wed 12:00");

    const emails = summariesTo(s, "owner");
    expect(emails).toHaveLength(1);
    expect(emails[0]?.text.split("\n").slice(0, 18)).toEqual([
      "1 item is waiting for your review. 1 question is waiting for your reply.",
      "",
      "Items waiting for your review",
      "Each has waited more than a day.",
      "",
      "reviewer's evidence",
      "Read · waited 1 day",
      "",
      "Open your Review Queue: https://pact.example.test/review",
      "",
      "Questions waiting for your reply",
      "Your reviewers asked about these instead of deciding them. Reply so they can decide.",
      "",
      "reviewer asked about your evidence",
      "Gym · asked 1 day ago",
      "",
      "Open Today: https://pact.example.test/",
      "",
    ]);
  });
});

describe("when it goes", () => {
  test("turned on at 22:00: nothing until the next 09:00, however long things have waited", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Mon 10:00");
    s.setClockTo("Wed 22:00");
    await reviewer.setDailySummary(true);

    await s.advanceTo("Wed 22:00");
    await s.advanceTo("Thu 08:59");
    expect(summariesTo(s, "reviewer")).toEqual([]);

    await s.advanceTo("Thu 09:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("turned on at 08:00: sent at 09:00 that day", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Mon 10:00");
    s.setClockTo("Thu 08:00");
    await reviewer.setDailySummary(true);

    await s.advanceTo("Thu 08:00");
    await s.advanceTo("Thu 08:59");
    expect(summariesTo(s, "reviewer")).toEqual([]);

    await s.advanceTo("Thu 09:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("at most one a local day, with the pushes, even after a move west makes 09:00 come round again", async () => {
    const s = scenario();
    const { reviewer } = await evidenceAt(s, "Mon 10:00");
    await reviewer.setTimezone("Europe/London");
    await reviewer.setDailySummary(true);

    await s.advanceTo("Wed 04:00"); // 09:00 in London
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);

    await reviewer.setTimezone("America/Los_Angeles");
    await s.advanceTo("Wed 12:00"); // 09:00 in Los Angeles, still Wednesday
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);

    await s.advanceTo("Thu 12:00");
    expect(summariesTo(s, "reviewer")).toHaveLength(2);
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(2);
  });
});

describe("a send that keeps failing", () => {
  test("is retried each tick, and given up 24 hours after it was queued, with an operator alert by log and push, not email", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await reviewer.setDailySummary(true);
    s.mailer.fail("reviewer@example.test");
    s.setClockTo("Tue 08:00");
    await submit(owner, gym);
    const failures = () => failuresIn(s);

    await s.advanceTo("Wed 09:00");
    await s.advanceTo("Wed 09:01");
    await s.advanceTo("Thu 08:59");
    expect(failures()).toHaveLength(3);
    expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toEqual([]);

    await s.advanceTo("Thu 09:00");

    expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toEqual([
      `OPERATOR_ALERT ${GIVEN_UP} Last error: injected failure: mail to reviewer@example.test`,
    ]);
    expect(s.notifier.sentTo(owner, "operator-alert")).toEqual([
      {
        recipient: owner.id,
        kind: "operator-alert",
        payload: {
          alert: "email-given-up",
          to: "reviewer@example.test",
          title: "Operator alert",
          body: GIVEN_UP,
          url: "/",
        },
      },
    ]);
    expect(s.mailer.sent.filter((email) => email.to === s.operatorEmail)).toEqual([]);

    // Thursday's own summary, queued at 09:00 too, goes once the address works again; Wednesday's never does.
    s.mailer.recover("reviewer@example.test");
    await s.advanceTo("Thu 09:01");
    await s.advanceTo("Fri 08:00");
    expect(summariesTo(s, "reviewer").map((email) => email.text.split("\n").at(6))).toEqual(["Gym · waited 2 days"]);
  });

  test("is retried only by the tick: a command after the failure doesn't send it", async () => {
    const s = scenario();
    const { owner, reviewer } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    s.mailer.fail("reviewer@example.test");
    await s.advanceTo("Wed 09:00");
    s.mailer.recover("reviewer@example.test");

    s.setClockTo("Wed 09:02");
    await owner.addRecipient({ name: "Ana" });
    await reviewer.setTimezone("America/New_York");
    expect(failuresIn(s)).toHaveLength(1);
    expect(summariesTo(s, "reviewer")).toEqual([]);

    await s.advanceTo("Wed 09:03");
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });

  test("not sent after its 24 hours, however long the server was down: given up at the restart's first tick", async () => {
    const s = scenario();
    const { owner, reviewer } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    s.mailer.fail("reviewer@example.test");
    await s.advanceTo("Wed 09:00");
    expect(failuresIn(s)).toHaveLength(1);

    await s.restart();
    s.mailer.recover("reviewer@example.test");
    s.setClockTo("Thu 10:00");
    await owner.addRecipient({ name: "Ana" });
    await s.advanceTo("Thu 10:00");

    expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toEqual([
      `OPERATOR_ALERT ${GIVEN_UP} Last error: injected failure: mail to reviewer@example.test`,
    ]);
    expect(s.notifier.sentTo(owner, "operator-alert").map((sent) => sent.payload.body)).toEqual([GIVEN_UP]);
    // Only Thursday's own, queued at this tick.
    expect(summariesTo(s, "reviewer").map((email) => email.text.split("\n").at(6))).toEqual(["Gym · waited 2 days"]);
  });

  test("past its 24 hours by the time a slow pass reaches it: not sent, and given up at the next tick", async () => {
    const s = scenario();
    const { owner, reviewer, second } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    await second.setDailySummary(true);
    s.mailer.fail("reviewer@example.test");
    s.mailer.fail("second@example.test");
    await s.advanceTo("Wed 09:00");
    s.mailer.recover("reviewer@example.test");
    s.mailer.recover("second@example.test");

    // The pass sends the reviewer's first, and that send hangs past the 24 hours of both.
    const release = s.mailer.hold();
    s.setClockTo("Thu 08:59");
    await s.core.advanceTo(s.clock.now());
    s.setClockTo("Thu 09:00");
    release();
    await s.core.emailsSettled();

    expect(summariesTo(s, "reviewer")).toHaveLength(1);
    expect(summariesTo(s, "second")).toEqual([]);

    await s.advanceTo("Thu 09:01");
    expect(s.notifier.sentTo(owner, "operator-alert").map((sent) => sent.payload.body)).toEqual([
      "The Pact Daily Summary for Wed Jan 7 to second (second@example.test) failed for 24 hours and was given up.",
    ]);
  });

  test("being sent when its 24 hours end: delivered, and not given up", async () => {
    const s = scenario();
    const { owner, reviewer } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    s.mailer.fail("reviewer@example.test");
    await s.advanceTo("Wed 09:00");
    s.mailer.recover("reviewer@example.test");

    const release = s.mailer.hold();
    s.setClockTo("Thu 08:59");
    await s.core.advanceTo(s.clock.now());
    s.setClockTo("Thu 09:00");
    await s.core.advanceTo(s.clock.now());
    release();
    await s.core.emailsSettled();

    expect(summariesTo(s, "reviewer").map((email) => email.text.split("\n").at(6))).toEqual(["Gym · waited 1 day"]);
    expect(s.notifier.sentTo(owner, "operator-alert")).toEqual([]);
    expect(s.logs.filter((line) => line.startsWith("OPERATOR_ALERT"))).toEqual([]);
  });
});

describe("apart from the pushes", () => {
  test("a hung mail server holds up neither the tick nor a push queued while it hangs, and one pass runs at a time", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await evidenceAt(s, "Tue 08:00");
    await reviewer.setDailySummary(true);
    const release = s.mailer.hold();

    s.setClockTo("Wed 09:00");
    await s.core.advanceTo(s.clock.now());
    expect(s.notifier.sentTo(reviewer, "stale-review-items")).toHaveLength(1);
    await reviewer.askOwner(evidenceId, "Which gym?");
    expect(s.notifier.sentTo(owner, "reviewer-question")).toHaveLength(1);
    s.setClockTo("Wed 09:01");
    await s.core.advanceTo(s.clock.now());
    expect(summariesTo(s, "reviewer")).toEqual([]);

    release();
    await s.core.emailsSettled();
    expect(summariesTo(s, "reviewer")).toHaveLength(1);
  });
});
