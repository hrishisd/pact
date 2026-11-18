// Reviewer questions: a reviewer asks the owner about a review item instead
// of deciding it. The item waits on the owner's reply: it leaves every
// reviewer's Review Queue and puts an alert on the owner's Today. The reply
// sends it back to every reviewer. A reviewer can still decide it meanwhile.

import { describe, expect, test } from "vitest";
import {
  fifteenOwed,
  gymEvidenceWaiting,
  MON_WED_FRI,
  ownerWithReviewers,
  photo,
  recordPayment,
} from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("asking about evidence", () => {
  test("the question takes it out of both reviewers' queues and puts an alert on the owner's Today; the reply puts it back and resolves the alert", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await gymEvidenceWaiting(s);
    s.setClockTo("Mon 19:00");

    ok(await reviewer.askOwner(evidenceId, "  Which gym is this? "));

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
    const question = {
      fromOwner: false,
      authorName: "reviewer",
      text: "Which gym is this?",
      sentAt: s.at("Mon 19:00"),
    };
    for (const each of [reviewer, second]) {
      expect(each.waitingOnReply()).toEqual([
        expect.objectContaining({
          kind: "evidence",
          id: evidenceId,
          thread: { comments: [question], waitingOnReply: true },
        }),
      ]);
    }
    expect(owner.today().alerts).toEqual([
      {
        kind: "reviewer-question",
        item: {
          kind: "evidence",
          id: evidenceId,
          pactId: gym,
          name: "Gym",
          occurrenceDate: s.date("Mon"),
          submittedAt: s.at("Mon 18:00"),
        },
        reviewerName: "reviewer",
        question: "Which gym is this?",
        askedAt: s.at("Mon 19:00"),
      },
    ]);
    // Still waiting for approval: any reviewer can decide it.
    expect(ids(owner.today().waiting)).toEqual([evidenceId]);

    s.setClockTo("Mon 20:00");
    ok(await owner.reply(evidenceId, "The one on 5th Street"));

    const answered = {
      comments: [
        question,
        { fromOwner: true, authorName: "owner", text: "The one on 5th Street", sentAt: s.at("Mon 20:00") },
      ],
      waitingOnReply: false,
    };
    for (const each of [reviewer, second]) {
      expect(each.reviewQueue()).toEqual([expect.objectContaining({ id: evidenceId, thread: answered })]);
      expect(each.waitingOnReply()).toEqual([]);
    }
    expect(owner.today().alerts).toEqual([]);
  });

  test("an occurrence whose evidence is waiting on the owner's reply at midnight stays not judged yet", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s);
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));

    await s.advanceTo("Tue 00:00");

    const preview = ok(owner.excusePreview(gym, { from: s.date("Mon"), to: s.date("Mon") }));
    expect(preview.preview.covered).toEqual([
      expect.objectContaining({
        date: s.date("Mon"),
        status: expect.objectContaining({ kind: "not-judged", evidenceWaiting: true }),
      }),
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(owner.today().alerts).toEqual([expect.objectContaining({ kind: "reviewer-question" })]);
  });

  test("a reviewer can still decide it while it waits on the owner's reply; the alert goes, and a reply is refused", async () => {
    const s = scenario();
    const { owner, reviewer, second, evidenceId } = await gymEvidenceWaiting(s);
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));

    expect(await second.decide(evidenceId, { kind: "approve" })).toEqual({ ok: true });

    expect(second.waitingOnReply()).toEqual([]);
    expect(reviewer.waitingOnReply()).toEqual([]);
    expect(owner.today().alerts).toEqual([]);
    expect(await owner.reply(evidenceId, "The one on 5th")).toEqual({ ok: false, reason: "not-waiting" });
    expect(await reviewer.askOwner(evidenceId, "And now?")).toEqual({ ok: false, reason: "already-decided" });
    expect(s.notifier.kindsSentTo(reviewer)).toEqual(["review-item"]);
  });

  test("a second question while it waits keeps it waiting, and the alert shows the latest", async () => {
    const s = scenario();
    const { owner, reviewer, second, evidenceId } = await gymEvidenceWaiting(s);
    s.setClockTo("Mon 19:00");
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));
    s.setClockTo("Mon 19:30");
    ok(await second.askOwner(evidenceId, "Is that today?"));

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ reviewerName: "second", question: "Is that today?", askedAt: s.at("Mon 19:30") }),
    ]);
    expect(reviewer.waitingOnReply()[0]?.thread.comments.map((c) => c.text)).toEqual([
      "Which gym is this?",
      "Is that today?",
    ]);
  });
});

describe("what can be asked and replied", () => {
  test("a blank question or reply is refused and changes nothing", async () => {
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(scenario());

    expect(await reviewer.askOwner(evidenceId, "  \n ")).toEqual({ ok: false, reason: "blank-question" });
    expect(ids(reviewer.reviewQueue())).toEqual([evidenceId]);
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));
    expect(await owner.reply(evidenceId, " ")).toEqual({ ok: false, reason: "blank-reply" });
    expect(reviewer.reviewQueue()).toEqual([]);
  });

  test("only a reviewer who may decide it can ask, and only its owner can reply, and only to a question", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s);
    const stranger = await s.befriend(owner, "stranger");
    const notFound = { ok: false, reason: "item-not-found" };

    expect(await owner.askOwner(evidenceId, "Hm?")).toEqual(notFound);
    expect(await stranger.askOwner(evidenceId, "Hm?")).toEqual(notFound);
    expect(await reviewer.askOwner("no-such-item", "Hm?")).toEqual(notFound);
    expect(await owner.reply(evidenceId, "Nobody asked")).toEqual({ ok: false, reason: "no-question" });

    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));
    expect(await reviewer.reply(evidenceId, "Me again")).toEqual(notFound);
    expect(await stranger.reply(evidenceId, "Me again")).toEqual(notFound);
    expect(await owner.reply("no-such-item", "Hm")).toEqual(notFound);
    ok(await owner.reply(evidenceId, "The one on 5th"));
    expect(await owner.reply(evidenceId, "Twice")).toEqual({ ok: false, reason: "no-question" });
  });

  test("the owner's evidence page shows the photos, where it stands and the thread", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s);
    s.setClockTo("Mon 19:00");
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));

    expect(owner.evidence(evidenceId)).toEqual({
      ok: true,
      evidence: {
        id: evidenceId,
        pactId: gym,
        pactName: "Gym",
        occurrenceDate: s.date("Mon"),
        description: "A photo of Gym",
        photoIds: s.photoStore.photoIds,
        submittedAt: s.at("Mon 18:00"),
        state: { kind: "waiting" },
        reviewerNames: ["reviewer", "second"],
        thread: {
          comments: [
            { fromOwner: false, authorName: "reviewer", text: "Which gym is this?", sentAt: s.at("Mon 19:00") },
          ],
          waitingOnReply: true,
        },
      },
    });
    expect(reviewer.evidence(evidenceId)).toEqual({ ok: false, reason: "evidence-not-found" });
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    expect(owner.evidence(evidenceId)).toMatchObject({
      ok: true,
      evidence: {
        state: { kind: "rejected", reviewerName: "reviewer", reason: "Blurry" },
        thread: { waitingOnReply: false },
      },
    });
  });
});

describe("notifications", () => {
  test("the question goes to the owner, opening the item's page; the reply goes to every reviewer, opening Review", async () => {
    const s = scenario();
    const { owner, reviewer, second, evidenceId } = await gymEvidenceWaiting(s);
    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));

    expect(s.notifier.sentTo(owner)).toEqual([
      {
        recipient: owner.id,
        kind: "reviewer-question",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          title: "reviewer asked about your evidence for Gym",
          body: "“Which gym is this?”",
          url: `/evidence/${evidenceId}`,
        },
      },
    ]);
    // The other reviewer isn't told: the item just leaves their queue.
    expect(s.notifier.kindsSentTo(second)).toEqual(["review-item"]);

    ok(await owner.reply(evidenceId, "The one on 5th"));

    for (const each of [reviewer, second]) {
      expect(s.notifier.sentTo(each).at(-1)).toEqual({
        recipient: each.id,
        kind: "owner-replied",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          title: "owner replied about their evidence for Gym",
          body: "“The one on 5th” You can decide it now.",
          url: "/review",
        },
      });
    }
  });

  test("Comment turned off records neither the question nor the reply for that account", async () => {
    const s = scenario();
    const { owner, reviewer, second, evidenceId } = await gymEvidenceWaiting(s);
    await owner.setNotificationSetting("comment", false);
    await second.setNotificationSetting("comment", false);

    ok(await reviewer.askOwner(evidenceId, "Which gym is this?"));
    ok(await owner.reply(evidenceId, "The one on 5th"));

    expect(s.notifier.sentTo(owner)).toEqual([]);
    expect(s.notifier.kindsSentTo(second)).toEqual(["review-item"]);
    expect(s.notifier.kindsSentTo(reviewer)).toEqual(["review-item", "owner-replied"]);
  });
});

describe("every item kind", () => {
  test("an excuse: out of the queue, an alert, the thread on the excuse's page, and back once replied", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 10:00");
    const filed = ok(await owner.fileExcuse(gym, { from: s.date("Mon"), to: s.date("Mon"), reason: "Sick" }, []));
    const { excuseId } = filed;

    ok(await second.askOwner(excuseId, "Did you see a doctor?"));

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(ids(reviewer.waitingOnReply())).toEqual([excuseId]);
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "reviewer-question",
        item: expect.objectContaining({
          kind: "excuse",
          id: excuseId,
          firstDate: s.date("Mon"),
          lastDate: s.date("Mon"),
        }),
        reviewerName: "second",
      }),
    ]);
    expect(owner.excuse(excuseId)).toMatchObject({ ok: true, excuse: { thread: { waitingOnReply: true } } });
    expect(s.notifier.sentTo(owner).at(-1)?.payload).toMatchObject({
      title: "second asked about your excuse for Gym",
      url: `/excuses/${excuseId}`,
    });

    ok(await owner.reply(excuseId, "Yes, Monday morning"));

    expect(ids(reviewer.reviewQueue())).toEqual([excuseId]);
    expect(owner.today().alerts).toEqual([]);
    expect(owner.excuse(excuseId)).toMatchObject({ ok: true, excuse: { thread: { waitingOnReply: false } } });
  });

  test("a payment: its reviewers are those of any pact with the recipient, and the owner sees it on the payment's page", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam } = await fifteenOwed(s);
    s.setClockTo("Sat 10:00");
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000, note: "Venmo" });

    ok(await reviewer.askOwner(paymentId, "Can you send the whole screenshot?"));

    expect(second.reviewQueue()).toEqual([]);
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "reviewer-question",
        item: expect.objectContaining({ kind: "payment", id: paymentId, recipientName: "Sam", amountCents: 1000 }),
      }),
    ]);
    expect(owner.payment(paymentId)).toEqual({
      ok: true,
      payment: {
        id: paymentId,
        recipientId: sam.id,
        recipientName: "Sam",
        amountCents: 1000,
        note: "Venmo",
        photoId: s.photoStore.photoIds.at(-1),
        recordedAt: s.at("Sat 10:00"),
        state: { kind: "waiting" },
        reviewerNames: ["reviewer", "second"],
        thread: {
          comments: [
            {
              fromOwner: false,
              authorName: "reviewer",
              text: "Can you send the whole screenshot?",
              sentAt: s.at("Sat 10:00"),
            },
          ],
          waitingOnReply: true,
        },
      },
    });
    expect(reviewer.payment(paymentId)).toEqual({ ok: false, reason: "payment-not-found" });
    expect(s.notifier.sentTo(owner).at(-1)?.payload).toMatchObject({
      title: "reviewer asked about your $10 payment to Sam",
      url: `/payments/${paymentId}`,
    });

    ok(await owner.reply(paymentId, "It cut off, sorry: it's $10 to Sam"));

    expect(ids(second.reviewQueue())).toEqual([paymentId]);
    expect(s.notifier.sentTo(second).at(-1)?.kind).toBe("owner-replied");
  });

  test("a change request: the thread shows on its page; withdrawn while waiting on the reply, the alert goes", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 10:00");
    const ended = ok(await owner.requestEnd(gym, "Moved away"));
    const { changeRequestId } = ended;

    ok(await reviewer.askOwner(changeRequestId, "Is there no gym near you now?"));

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "reviewer-question",
        item: expect.objectContaining({ kind: "change-request", id: changeRequestId, endsPact: true }),
      }),
    ]);
    expect(owner.changeRequest(changeRequestId)).toMatchObject({
      ok: true,
      changeRequest: { thread: { waitingOnReply: true } },
    });
    expect(s.notifier.sentTo(owner).at(-1)?.payload).toMatchObject({
      title: "reviewer asked about your request to end Gym",
      url: `/changes/${changeRequestId}`,
    });

    await owner.withdrawChangeRequest(changeRequestId);

    expect(owner.today().alerts).toEqual([]);
    expect(reviewer.waitingOnReply()).toEqual([]);
    expect(await owner.reply(changeRequestId, "Never mind")).toEqual({ ok: false, reason: "not-waiting" });
  });
});

describe("the Review Queue's order", () => {
  test("a change request filed after two evidence items still comes first, and a replied item goes back to its place", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const gymEvidence = ok(await owner.submitEvidence(gym, [photo(1)]));
    s.setClockTo("Mon 18:05");
    const runEvidence = ok(await owner.submitEvidence(run, [photo(2)]));
    s.setClockTo("Mon 18:10");
    const ended = ok(await owner.requestEnd(run));

    expect(ids(reviewer.reviewQueue())).toEqual([
      ended.changeRequestId,
      gymEvidence.evidenceId,
      runEvidence.evidenceId,
    ]);

    ok(await reviewer.askOwner(gymEvidence.evidenceId, "Which gym?"));
    expect(ids(reviewer.reviewQueue())).toEqual([ended.changeRequestId, runEvidence.evidenceId]);
    ok(await owner.reply(gymEvidence.evidenceId, "The one on 5th"));
    expect(ids(reviewer.reviewQueue())).toEqual([
      ended.changeRequestId,
      gymEvidence.evidenceId,
      runEvidence.evidenceId,
    ]);
  });
});
