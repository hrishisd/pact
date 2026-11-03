// Reviewer questions: a reviewer asks the owner about a review item instead
// of deciding it. The item waits on the owner's reply: it leaves every
// reviewer's Review Queue and puts an alert on the owner's Today. The reply
// sends it back to every reviewer. A reviewer can still decide it meanwhile.

import { describe, expect, test } from "vitest";
import { fifteenOwed, MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle } from "./testing/scenario.ts";

const MONDAY = "2026-01-05";

/** An owner with a Mon/Wed/Fri "Gym" pact two friends review, and evidence for Monday submitted at Mon 18:00. */
async function evidenceWaiting() {
  const s = scenario();
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  s.setClockTo("Mon 18:00");
  const submitted = await setup.owner.submitEvidence(gym, [photo()]);
  if (!submitted.ok) throw new Error(submitted.reason);
  return { s, ...setup, gym, evidenceId: submitted.evidenceId };
}

/** Asks as `by`; throws if it's refused. */
async function ask(by: AccountHandle, itemId: string, question: string) {
  const asked = await by.askOwner(itemId, question);
  if (!asked.ok) throw new Error(asked.reason);
}

/** Replies as `owner`; throws if it's refused. */
async function reply(owner: AccountHandle, itemId: string, text: string) {
  const replied = await owner.reply(itemId, text);
  if (!replied.ok) throw new Error(replied.reason);
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("asking about evidence", () => {
  test("the question takes it out of both reviewers' queues and puts an alert on the owner's Today; the reply puts it back and resolves the alert", async () => {
    const { s, owner, reviewer, second, gym, evidenceId } = await evidenceWaiting();
    s.setClockTo("Mon 19:00");

    await ask(reviewer, evidenceId, "  Which gym is this? ");

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
          occurrenceDate: MONDAY,
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
    await reply(owner, evidenceId, "The one on 5th Street");

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
    const { s, owner, reviewer, gym, evidenceId } = await evidenceWaiting();
    await ask(reviewer, evidenceId, "Which gym is this?");

    await s.advanceTo("Tue 00:00");

    const preview = owner.excusePreview(gym, { from: MONDAY, to: MONDAY });
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.covered).toEqual([
      expect.objectContaining({
        date: MONDAY,
        status: expect.objectContaining({ kind: "not-judged", evidenceWaiting: true }),
      }),
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(owner.today().alerts).toEqual([expect.objectContaining({ kind: "reviewer-question" })]);
  });

  test("a reviewer can still decide it while it waits on the owner's reply; the alert goes, and a reply is refused", async () => {
    const { s, owner, reviewer, second, evidenceId } = await evidenceWaiting();
    await ask(reviewer, evidenceId, "Which gym is this?");

    expect(await second.decide(evidenceId, { kind: "approve" })).toEqual({ ok: true });

    expect(second.waitingOnReply()).toEqual([]);
    expect(reviewer.waitingOnReply()).toEqual([]);
    expect(owner.today().alerts).toEqual([]);
    expect(await owner.reply(evidenceId, "The one on 5th")).toEqual({ ok: false, reason: "not-waiting" });
    expect(await reviewer.askOwner(evidenceId, "And now?")).toEqual({ ok: false, reason: "already-decided" });
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["review-item"]);
  });

  test("a second question while it waits keeps it waiting, and the alert shows the latest", async () => {
    const { s, owner, reviewer, second, evidenceId } = await evidenceWaiting();
    s.setClockTo("Mon 19:00");
    await ask(reviewer, evidenceId, "Which gym is this?");
    s.setClockTo("Mon 19:30");
    await ask(second, evidenceId, "Is that today?");

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
    const { owner, reviewer, evidenceId } = await evidenceWaiting();

    expect(await reviewer.askOwner(evidenceId, "  \n ")).toEqual({ ok: false, reason: "blank-question" });
    expect(ids(reviewer.reviewQueue())).toEqual([evidenceId]);
    await ask(reviewer, evidenceId, "Which gym is this?");
    expect(await owner.reply(evidenceId, " ")).toEqual({ ok: false, reason: "blank-reply" });
    expect(reviewer.reviewQueue()).toEqual([]);
  });

  test("only a reviewer who may decide it can ask, and only its owner can reply, and only to a question", async () => {
    const { s, owner, reviewer, evidenceId } = await evidenceWaiting();
    const stranger = await s.befriend(owner, "stranger");
    const notFound = { ok: false, reason: "item-not-found" };

    expect(await owner.askOwner(evidenceId, "Hm?")).toEqual(notFound);
    expect(await stranger.askOwner(evidenceId, "Hm?")).toEqual(notFound);
    expect(await reviewer.askOwner("no-such-item", "Hm?")).toEqual(notFound);
    expect(await owner.reply(evidenceId, "Nobody asked")).toEqual({ ok: false, reason: "no-question" });

    await ask(reviewer, evidenceId, "Which gym is this?");
    expect(await reviewer.reply(evidenceId, "Me again")).toEqual(notFound);
    expect(await stranger.reply(evidenceId, "Me again")).toEqual(notFound);
    expect(await owner.reply("no-such-item", "Hm")).toEqual(notFound);
    await reply(owner, evidenceId, "The one on 5th");
    expect(await owner.reply(evidenceId, "Twice")).toEqual({ ok: false, reason: "no-question" });
  });

  test("the owner's evidence page shows the photos, where it stands and the thread", async () => {
    const { s, owner, reviewer, gym, evidenceId } = await evidenceWaiting();
    s.setClockTo("Mon 19:00");
    await ask(reviewer, evidenceId, "Which gym is this?");

    expect(owner.evidence(evidenceId)).toEqual({
      ok: true,
      evidence: {
        id: evidenceId,
        pactId: gym,
        pactName: "Gym",
        occurrenceDate: MONDAY,
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
    const { s, owner, reviewer, second, evidenceId } = await evidenceWaiting();
    await ask(reviewer, evidenceId, "Which gym is this?");

    expect(s.notifier.sentTo(owner)).toEqual([
      {
        recipient: owner.id,
        kind: "reviewer-question",
        channel: "push",
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
    expect(s.notifier.sentTo(second).map((n) => n.kind)).toEqual(["review-item"]);

    await reply(owner, evidenceId, "The one on 5th");

    for (const each of [reviewer, second]) {
      expect(s.notifier.sentTo(each).at(-1)).toEqual({
        recipient: each.id,
        kind: "owner-replied",
        channel: "push",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          title: "owner replied about their evidence for Gym",
          body: "“The one on 5th” It's back in your queue.",
          url: "/review",
        },
      });
    }
  });

  test("Comment turned off records neither the question nor the reply for that account", async () => {
    const { s, owner, reviewer, second, evidenceId } = await evidenceWaiting();
    await owner.setNotificationSetting("comment", false);
    await second.setNotificationSetting("comment", false);

    await ask(reviewer, evidenceId, "Which gym is this?");
    await reply(owner, evidenceId, "The one on 5th");

    expect(s.notifier.sentTo(owner)).toEqual([]);
    expect(s.notifier.sentTo(second).map((n) => n.kind)).toEqual(["review-item"]);
    expect(s.notifier.sentTo(reviewer).map((n) => n.kind)).toEqual(["review-item", "owner-replied"]);
  });
});

describe("every item kind", () => {
  test("an excuse: out of the queue, an alert, the thread on the excuse's page, and back once replied", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 10:00");
    const filed = await owner.fileExcuse(gym, { from: MONDAY, to: MONDAY, reason: "Sick" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    const { excuseId } = filed;

    await ask(second, excuseId, "Did you see a doctor?");

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(ids(reviewer.waitingOnReply())).toEqual([excuseId]);
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "reviewer-question",
        item: expect.objectContaining({ kind: "excuse", id: excuseId, firstDate: MONDAY, lastDate: MONDAY }),
        reviewerName: "second",
      }),
    ]);
    expect(owner.excuse(excuseId)).toMatchObject({ ok: true, excuse: { thread: { waitingOnReply: true } } });
    expect(s.notifier.sentTo(owner).at(-1)?.payload).toMatchObject({
      title: "second asked about your excuse for Gym",
      url: `/excuses/${excuseId}`,
    });

    await reply(owner, excuseId, "Yes, Monday morning");

    expect(ids(reviewer.reviewQueue())).toEqual([excuseId]);
    expect(owner.today().alerts).toEqual([]);
    expect(owner.excuse(excuseId)).toMatchObject({ ok: true, excuse: { thread: { waitingOnReply: false } } });
  });

  test("a payment: its reviewers are those of any pact with the recipient, and the owner sees it on the payment's page", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam } = await fifteenOwed(s);
    s.setClockTo("Sat 10:00");
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 1000, note: "Venmo" });

    await ask(reviewer, paymentId, "Can you send the whole screenshot?");

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

    await reply(owner, paymentId, "It cut off, sorry: it's $10 to Sam");

    expect(ids(second.reviewQueue())).toEqual([paymentId]);
    expect(s.notifier.sentTo(second).at(-1)?.kind).toBe("owner-replied");
  });

  test("a change request: the thread shows on its page; withdrawn while waiting on the reply, the alert goes", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 10:00");
    const ended = await owner.requestEnd(gym, "Moved away");
    if (!ended.ok) throw new Error(ended.reason);
    const { changeRequestId } = ended;

    await ask(reviewer, changeRequestId, "Is there no gym near you now?");

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
    const gymEvidence = await owner.submitEvidence(gym, [photo(1)]);
    s.setClockTo("Mon 18:05");
    const runEvidence = await owner.submitEvidence(run, [photo(2)]);
    if (!gymEvidence.ok || !runEvidence.ok) throw new Error("evidence refused");
    s.setClockTo("Mon 18:10");
    const ended = await owner.requestEnd(run);
    if (!ended.ok) throw new Error(ended.reason);

    expect(ids(reviewer.reviewQueue())).toEqual([
      ended.changeRequestId,
      gymEvidence.evidenceId,
      runEvidence.evidenceId,
    ]);

    await ask(reviewer, gymEvidence.evidenceId, "Which gym?");
    expect(ids(reviewer.reviewQueue())).toEqual([ended.changeRequestId, runEvidence.evidenceId]);
    await reply(owner, gymEvidence.evidenceId, "The one on 5th");
    expect(ids(reviewer.reviewQueue())).toEqual([
      ended.changeRequestId,
      gymEvidence.evidenceId,
      runEvidence.evidenceId,
    ]);
  });
});
