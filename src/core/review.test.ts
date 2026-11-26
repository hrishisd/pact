import { describe, expect, test } from "vitest";
import { gymEvidenceWaiting, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

describe("the Review Queue", () => {
  test("shows each reviewer the evidence submitted, with the pact's description, the photos in order, and what rejecting would cost", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const submitted = ok(await owner.submitEvidence(gym, [photo(1), photo(2)]));

    const item = {
      kind: "evidence",
      id: submitted.evidenceId,
      pactId: gym,
      pactName: "Gym",
      ownerName: "owner",
      description: "A photo of Gym",
      photoIds: s.photoStore.photoIds,
      submittedAt: s.at("Mon 18:00"),
      occurrenceDate: s.date("Mon"),
      penaltyCents: 500,
      recipientName: "Sam",
      thread: { comments: [], waitingOnReply: false },
    };
    expect(reviewer.reviewQueue()).toEqual([item]);
    expect(second.reviewQueue()).toEqual([item]);
    expect(owner.reviewQueue()).toEqual([]);
    expect(s.photoStore.photoIds).toHaveLength(2);
  });

  test("lists the oldest evidence first, across pacts and days", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", ["mon", "tue"]);
    s.setClockTo("Mon 20:00");
    await owner.submitEvidence(run, [photo()]);
    s.setClockTo("Mon 21:00");
    await owner.submitEvidence(gym, [photo()]);
    s.setClockTo("Tue 07:00");
    await owner.submitEvidence(run, [photo()]);

    expect(
      reviewer
        .reviewQueue()
        .map((item) => item.kind === "evidence" && [item.pactName, item.occurrenceDate, item.submittedAt]),
    ).toEqual([
      ["Run", s.date("Mon"), s.at("Mon 20:00")],
      ["Gym", s.date("Mon"), s.at("Mon 21:00")],
      ["Run", s.date("Tue"), s.at("Tue 07:00")],
    ]);
  });
});

describe("a restart", () => {
  test("keeps the queue, and a decision made before it stays final", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    const run = await createPact("Run", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    const gymEvidence = ok(await owner.submitEvidence(gym, [photo(1)]));
    const runEvidence = ok(await owner.submitEvidence(run, [photo(2)]));
    await reviewer.decide(gymEvidence.evidenceId, { kind: "reject", reason: "Blurry" });
    const queue = second.reviewQueue();
    const today = owner.today();

    await s.restart();

    expect(second.reviewQueue()).toEqual(queue);
    expect(queue).toEqual([expect.objectContaining({ id: runEvidence.evidenceId })]);
    expect(owner.today()).toEqual(today);
    expect(today.alerts).toEqual([expect.objectContaining({ pactId: gym, reason: "Blurry" })]);
    expect(await second.decide(gymEvidence.evidenceId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "already-decided",
    });
  });
});

describe("deciding on evidence", () => {
  test("with two reviewers, the first to decide wins: the item leaves both queues and a second decision is refused", async () => {
    const s = scenario();
    const { reviewer, second, evidenceId } = await gymEvidenceWaiting(s);
    s.setClockTo("Mon 19:00");

    expect(await second.decide(evidenceId, { kind: "approve" })).toEqual({ ok: true });

    expect(second.reviewQueue()).toEqual([]);
    expect(reviewer.reviewQueue()).toEqual([]);
    const refused = { ok: false, reason: "already-decided" };
    expect(await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" })).toEqual(refused);
    expect(await second.decide(evidenceId, { kind: "approve" })).toEqual(refused);
  });

  test("a rejection needs a reason: a blank one is refused and the item stays in the queue", async () => {
    const { reviewer, evidenceId } = await gymEvidenceWaiting(scenario());

    for (const reason of ["", "  \n "]) {
      expect(await reviewer.decide(evidenceId, { kind: "reject", reason })).toEqual({
        ok: false,
        reason: "blank-reason",
      });
    }
    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ id: evidenceId })]);
  });

  test("only a reviewer of the pact can decide: the owner, a stranger and an unknown item are not found", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s);
    const stranger = await s.befriend(owner, "stranger");

    const notFound = { ok: false, reason: "item-not-found" };
    expect(await owner.decide(evidenceId, { kind: "approve" })).toEqual(notFound);
    expect(await stranger.decide(evidenceId, { kind: "approve" })).toEqual(notFound);
    expect(await reviewer.decide("no-such-item", { kind: "approve" })).toEqual(notFound);
    expect(owner.today().waiting).toEqual([expect.objectContaining({ id: evidenceId })]);
    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ id: evidenceId })]);
  });

  test("the owner is told of the decision, and the reviewers aren't", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await gymEvidenceWaiting(s);
    await reviewer.decide(evidenceId, { kind: "reject", reason: "  That's last week's photo " });

    expect(s.notifier.sentTo(owner)).toEqual([
      {
        recipient: owner.id,
        kind: "evidence-decided",
        payload: {
          itemKind: "evidence",
          itemId: evidenceId,
          pactId: gym,
          decision: "rejected",
          reason: "That's last week's photo",
          title: "reviewer rejected your evidence",
          body: "Gym · “That's last week's photo”",
          url: "/",
        },
      },
    ]);
    // Each reviewer had only the review item.
    expect(s.notifier.kindsSentTo(reviewer)).toEqual(["review-item"]);
    expect(s.notifier.kindsSentTo(second)).toEqual(["review-item"]);
  });
});

describe("the owner's Today after a decision", () => {
  test("approved evidence: the pact is done for the day, so it leaves Today", async () => {
    const s = scenario();
    const { owner, reviewer, evidenceId } = await gymEvidenceWaiting(s);
    s.setClockTo("Mon 19:00");

    await reviewer.decide(evidenceId, { kind: "approve" });

    expect(owner.today()).toEqual({
      date: expect.any(String),
      hasPacts: true,
      alerts: [],
      sections: [],
      waiting: [],
      yesterday: [],
    });
  });
});
