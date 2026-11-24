import { describe, expect, test } from "vitest";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle } from "./testing/scenario.ts";
import { ok, owed, pactOf, penaltyDays, statusOn } from "./testing/queries.ts";

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
          occurrenceDate: s.date("Mon"),
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
    const submitted = ok(await owner.submitEvidence(gym, [photo()]));

    const reviewItem = {
      kind: "review-item",
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

  test("when storing a photo fails: the submit fails and writes nothing", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 18:00");
    s.photoStore.store = () => Promise.reject(new Error("upload failed"));

    await expect(owner.submitEvidence(gym, [photo()])).rejects.toThrow("upload failed");
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

// The vacation spec (vac:78, decision 4 of the design review): approved
// evidence still makes an occurrence under a cover Satisfied, even once the
// cover has made it Excused.
describe("a late approval on an Excused occurrence", () => {
  /** How the Weekly count week starting `monday` stands on its heat map. */
  const weekStatus = (owner: AccountHandle, pactId: string, monday: string) => {
    const { history } = pactOf(owner, pactId);
    if (history.kind !== "weekly-count") throw new Error(`a ${history.kind} heat map`);
    return history.weeks.find((week) => week.date === monday)?.occurrence?.status.kind;
  };
  /** How a One-time pact's occurrence stands on its heat map. */
  const oneTimeStatus = (owner: AccountHandle, pactId: string) => {
    const { history } = pactOf(owner, pactId);
    if (history.kind !== "one-time") throw new Error(`a ${history.kind} heat map`);
    return history.day.occurrence?.status.kind;
  };

  test("evidence waiting when an approved excuse made the day Excused: its approval makes the day Satisfied, with no penalty", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Thu 20:00");
    const evidenceId = await submit(owner, gym);
    await s.advanceTo("Fri 01:00");
    const excuse = ok(await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Thu"), reason: "Ran late" }, []));
    ok(await reviewer.decide(excuse.excuseId, { kind: "approve" }));
    expect(statusOn(owner, gym, s.date("Thu"))).toBe("excused");
    await s.advanceTo("Fri 09:00");

    ok(await reviewer.decide(evidenceId, { kind: "approve" }));

    expect(statusOn(owner, gym, s.date("Thu"))).toBe("satisfied");
    expect(penaltyDays(owner)).not.toContain(s.date("Thu"));
    expect(s.notifier.sentTo(owner, "missed-occurrence").map((n) => n.payload.occurrenceDate)).not.toContain(
      s.date("Thu"),
    );
  });

  test("a day excused ahead and Excused at its due time with evidence waiting: approval makes it Satisfied, rejection leaves it Excused", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Wed 10:00");
    const excuse = ok(await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Fri"), reason: "Away" }, []));
    ok(await reviewer.decide(excuse.excuseId, { kind: "approve" }));
    await s.advanceTo("Thu 20:00");
    const approved = await submit(owner, gym);
    await s.advanceTo("Fri 20:00");
    const rejected = await submit(owner, gym);
    await s.advanceTo("Sat 09:00");
    expect(statusOn(owner, gym, s.date("Thu"))).toBe("excused");
    expect(statusOn(owner, gym, s.date("Fri"))).toBe("excused");

    ok(await reviewer.decide(approved, { kind: "approve" }));
    ok(await reviewer.decide(rejected, { kind: "reject", reason: "Blurry" }));

    expect(statusOn(owner, gym, s.date("Thu"))).toBe("satisfied");
    expect(statusOn(owner, gym, s.date("Fri"))).toBe("excused");
    expect(penaltyDays(owner)).not.toContain(s.date("Thu"));
    expect(penaltyDays(owner)).not.toContain(s.date("Fri"));
  });

  test("a Weekly count week Excused with evidence waiting is Satisfied once a late approval reaches its target", async () => {
    const s = scenario();
    // Made on a Tuesday, the pact starts the Monday after, as this test expects.
    await s.advanceTo("Tue 09:00");
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", { kind: "weekly-count", target: 2 });
    s.setClockTo("Tue+1 10:00");
    const excuse = ok(
      await owner.fileExcuse(piano, { from: s.date("Thu+1"), to: s.date("Thu+1"), reason: "Recital" }, []),
    );
    ok(await reviewer.decide(excuse.excuseId, { kind: "approve" }));
    s.setClockTo("Wed+1 10:00");
    ok(await reviewer.decide(await submit(owner, piano), { kind: "approve" }));
    s.setClockTo("Sun+1 22:00");
    const late = await submit(owner, piano);
    await s.advanceTo("Mon+2 09:00");
    expect(weekStatus(owner, piano, s.date("Mon+1"))).toBe("excused");

    ok(await reviewer.decide(late, { kind: "approve" }));

    expect(weekStatus(owner, piano, s.date("Mon+1"))).toBe("satisfied");
    expect(owed(owner)).toBe(0);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });

  test("a One-time occurrence Excused with evidence waiting: approval makes it Satisfied, and the pact stays Ended as of the excuse", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", { kind: "one-time", deadline: s.date("Thu"), submitAnytime: false });
    await s.advanceTo("Thu 10:00");
    const evidenceId = await submit(owner, dentist);
    await s.advanceTo("Fri 01:00");
    const excuse = ok(
      await owner.fileExcuse(dentist, { from: s.date("Thu"), to: s.date("Thu"), reason: "Ran late" }, []),
    );
    ok(await reviewer.decide(excuse.excuseId, { kind: "approve" }));
    expect(pactOf(owner, dentist)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 01:00") });
    await s.advanceTo("Fri 09:00");

    ok(await reviewer.decide(evidenceId, { kind: "approve" }));

    expect(oneTimeStatus(owner, dentist)).toBe("satisfied");
    expect(pactOf(owner, dentist)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 01:00") });
    expect(owed(owner)).toBe(0);
  });
});
