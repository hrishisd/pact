import { describe, expect, test } from "vitest";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";

describe("submitting evidence", () => {
  test("on Monday, for a Mon/Wed/Fri pact, moves the pact from To do to Waiting for approval", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 09:00");
    const gym = await createPact("Gym", MON_WED_FRI);

    s.setClockTo("Mon 18:00");
    const submitted = await owner.submitEvidence(gym, [photo(1), photo(2)]);

    expect(submitted).toEqual({ ok: true, evidenceId: expect.any(String) });
    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [],
      sections: [],
      waiting: [
        {
          kind: "evidence",
          id: submitted.ok && submitted.evidenceId,
          pactId: gym,
          name: "Gym",
          occurrenceDate: "2026-01-05",
          submittedAt: s.at("Mon 18:00"),
        },
      ],
      yesterday: [],
    });
  });

  test("each reviewer of the pact gets a review item", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    s.setClockTo("Mon 18:00");
    const submitted = await owner.submitEvidence(gym, [photo()]);
    if (!submitted.ok) throw new Error(submitted.reason);

    const reviewItem = {
      kind: "review-item",
      channel: "push",
      payload: {
        itemKind: "evidence",
        itemId: submitted.evidenceId,
        pactId: gym,
        title: "owner submitted evidence",
        body: "Gym · Mon Jan 5",
        url: "/review",
      },
    };
    expect(s.notifier.sentTo(reviewer)).toEqual([{ ...reviewItem, recipient: reviewer.id }]);
    expect(s.notifier.sentTo(second)).toEqual([{ ...reviewItem, recipient: second.id }]);
    expect(s.notifier.sentTo(owner)).toEqual([]);
  });

  test("a restart after submitting changes nothing: it's still waiting", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo()]);
    const before = owner.today();

    await s.restart();

    expect(owner.today()).toEqual(before);
    expect(before.waiting).toHaveLength(1);
    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "evidence-waiting" });
  });
});

describe("evidence is refused", () => {
  test("on a day the schedule skips: Tuesday, for a Mon/Wed/Fri pact", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    s.setClockTo("Tue 12:00");

    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(owner.today().waiting).toEqual([]);
  });

  test("after midnight: Monday's occurrence is closed at Tue 00:00", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    s.setClockTo("Tue 00:00");

    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(owner.today().waiting).toEqual([]);
  });

  test("when the server receives the photos after midnight, though the upload started before", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 23:59");
    // A slow upload: the photo reaches the server at Tue 00:00.
    const store = s.photoStore.store.bind(s.photoStore);
    s.photoStore.store = async (p) => {
      s.setClockTo("Tue 00:00");
      return store(p);
    };

    expect(await owner.submitEvidence(gym, [photo()])).toEqual({ ok: false, reason: "not-open" });
    expect(owner.today().waiting).toEqual([]);
    expect(s.notifier.sentTo(reviewer)).toEqual([]);
  });

  test("before the pact's first occurrence", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Mon 23:30");
    // Monday's midnight is under an hour away, so the first occurrence is Tuesday.
    const daily = await createPact("Stretch", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

    s.setClockTo("Mon 23:40");

    expect(await owner.submitEvidence(daily, [photo()])).toEqual({ ok: false, reason: "not-open" });
  });

  test("for someone else's pact, even as its reviewer, or a pact that doesn't exist", async () => {
    const s = scenario();
    const { reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    const notFound = { ok: false, reason: "pact-not-found" };
    expect(await reviewer.submitEvidence(gym, [photo()])).toEqual(notFound);
    const stranger = await s.befriend(reviewer, "stranger");
    expect(await stranger.submitEvidence(gym, [photo()])).toEqual(notFound);
    expect(await reviewer.submitEvidence("no-such-pact", [photo()])).toEqual(notFound);
    expect(s.notifier.sent.filter((n) => n.kind === "review-item")).toEqual([]);
  });

  test("while evidence for the occurrence is already waiting", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo(1)]);

    s.setClockTo("Mon 19:00");

    expect(await owner.submitEvidence(gym, [photo(2)])).toEqual({ ok: false, reason: "evidence-waiting" });
    expect(owner.today().waiting).toEqual([expect.objectContaining({ submittedAt: s.at("Mon 18:00") })]);
    expect(s.notifier.sentTo(reviewer)).toHaveLength(1);
  });

  test("without photos", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    expect(await owner.submitEvidence(gym, [])).toEqual({ ok: false, reason: "no-photos" });
    expect(owner.today().waiting).toEqual([]);
  });

  test("with more than 10 photos, before any is stored", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");

    const eleven = Array.from({ length: 11 }, (_, n) => photo(n));

    expect(await owner.submitEvidence(gym, eleven)).toEqual({ ok: false, reason: "too-many-photos" });
    expect(s.photoStore.photoIds).toEqual([]);
    expect(owner.today().waiting).toEqual([]);
    expect(await owner.submitEvidence(gym, eleven.slice(0, 10))).toEqual({ ok: true, evidenceId: expect.any(String) });
  });
});

describe("a photo of some evidence", () => {
  test("is shown to the pact's owner and each of its reviewers, and to no one else", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    // A friend of the owner who doesn't review this pact.
    const friend = await s.befriend(owner, "friend");
    const stranger = await s.befriend(friend, "stranger");
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    await owner.submitEvidence(gym, [photo(7)]);
    const [photoId] = s.photoStore.photoIds;
    if (photoId === undefined) throw new Error("no photo stored");

    for (const viewer of [owner, reviewer, second]) {
      expect(await viewer.photo(photoId)).toEqual({ ok: true, photo: photo(7) });
    }
    for (const viewer of [friend, stranger]) {
      expect(await viewer.photo(photoId)).toEqual({ ok: false, reason: "photo-not-found" });
    }
    expect(await owner.photo("no-such-photo")).toEqual({ ok: false, reason: "photo-not-found" });
  });
});
