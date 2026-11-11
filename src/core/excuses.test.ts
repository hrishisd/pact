// Excuses: the owner asks a pact's reviewers to treat some of its days as
// Excused, ahead of time, on the day, or within 48 hours of a miss. While an
// excuse waits, the penalties of its Missed days are held; approving makes
// its days Excused, rejecting makes those penalties owed again and raises a
// rejected-excuse alert.

import { describe, expect, test } from "vitest";
import type { NewExcuse, TodayAlert, Weekday } from "../shared/types.ts";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo, recordPayment } from "./testing/camera-pact.ts";
import type { AccountHandle } from "./testing/scenario.ts";
import { changeRequestIdOf, scenario } from "./testing/scenario.ts";
import { changed, ledgerHistory, ok, owed, penaltyDays, statusOn } from "./testing/queries.ts";

/** An excuse for `from` to `to` (or just `from`), "Sick with the flu". */
function sick(from: string, to = from): NewExcuse {
  return { from, to, reason: "Sick with the flu" };
}

/** Files an excuse as `owner`; returns its id, or throws if it's refused. */
async function fileExcuse(owner: AccountHandle, pactId: string, excuse: NewExcuse, photos = [photo()]) {
  return ok(await owner.fileExcuse(pactId, excuse, photos)).excuseId;
}

/** The spec's example: a Mon/Wed/Fri $5 Gym pact, and Monday Missed at Tue 00:00. */
async function gymMissedMonday() {
  const s = scenario();
  const setup = await ownerWithReviewers(s);
  const gym = await setup.createPact("Gym", MON_WED_FRI);
  await s.advanceTo("Tue 00:00");
  return { s, ...setup, gym };
}

describe("the spec's example", () => {
  test("Monday Missed, $5 owed → excuse within 48h → held, owed $0 → approved → Excused, owed $0, no penalty in the history", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    expect(owed(owner)).toBe(500);
    s.setClockTo("Tue 08:00");

    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(owed(owner)).toBe(0);
    expect(ledgerHistory(owner)).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Mon"), held: true, paidCents: 0 }),
    ]);
    expect(owner.today()).toMatchObject({
      alerts: [],
      sections: [],
      waiting: [
        {
          kind: "excuse",
          id: excuseId,
          pactId: gym,
          name: "Gym",
          firstDate: s.date("Mon"),
          lastDate: s.date("Mon"),
          filedAt: s.at("Tue 08:00"),
        },
      ],
    });

    s.setClockTo("Tue 12:00");
    expect(await reviewer.decide(excuseId, { kind: "approve" })).toEqual({ ok: true });

    expect(owed(owner)).toBe(0);
    expect(ledgerHistory(owner)).toEqual([]);
    expect(owner.today()).toMatchObject({ alerts: [], sections: [], waiting: [] });
    expect(owner.excuse(excuseId)).toMatchObject({
      ok: true,
      excuse: {
        state: { kind: "approved", reviewerName: "reviewer", decidedAt: s.at("Tue 12:00") },
        days: [{ date: s.date("Mon"), status: { kind: "excused" } }],
      },
    });
  });

  test("the same, rejected → $5 owed again, and a rejected-excuse alert is raised", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    s.setClockTo("Tue 12:00");

    expect(await reviewer.decide(excuseId, { kind: "reject", reason: "You were at the movies" })).toEqual({ ok: true });

    expect(owed(owner)).toBe(500);
    expect(ledgerHistory(owner)).toEqual([expect.objectContaining({ occurrenceDate: s.date("Mon"), held: false })]);
    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [
        {
          kind: "excuse-rejected",
          excuseId,
          pactId: gym,
          name: "Gym",
          reviewerName: "reviewer",
          reason: "You were at the movies",
          firstDate: s.date("Mon"),
          lastDate: s.date("Mon"),
          owedAgainCents: 500,
          hasDaysNotJudged: false,
          refile: { closesAt: s.at("Thu 00:00") },
        },
      ] satisfies TodayAlert[],
      // Monday is in the alert, not also a Missed card.
      sections: [],
      waiting: [],
      yesterday: [
        expect.objectContaining({
          occurrenceDate: s.date("Mon"),
          occurrence: expect.objectContaining({ status: expect.objectContaining({ kind: "missed", rejection: null }) }),
        }),
      ],
    });
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { state: { kind: "rejected", reviewerName: "reviewer", reason: "You were at the movies" } },
    });
  });
});

describe("re-filing after a rejection", () => {
  test("a new excuse for Monday inside the original 48 hours is accepted and resolves the alert; after them it's refused", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const first = await fileExcuse(owner, gym, sick(s.date("Mon")));
    await reviewer.decide(first, { kind: "reject", reason: "No" });

    s.setClockTo("Wed 23:00");
    const second = await fileExcuse(owner, gym, { ...sick(s.date("Mon")), reason: "Here's the doctor's note" });
    expect(owner.today().alerts).toEqual([]);
    expect(owed(owner)).toBe(0);
    await reviewer.decide(second, { kind: "reject", reason: "Still no" });

    // The window runs from Monday's miss, Tue 00:00; a rejection never restarts it.
    s.setClockTo("Thu 00:00");
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toEqual({ ok: false, reason: "nothing-to-excuse" });
    expect(owner.excusePreview(gym, sick(s.date("Mon")))).toEqual({
      ok: true,
      preview: { covered: [], skipped: [{ date: s.date("Mon"), reason: "window-closed" }], heldCents: 0 },
    });
    expect(owner.today().alerts).toEqual([expect.objectContaining({ kind: "excuse-rejected", refile: null })]);
  });
});

describe("the 48 hours after a miss", () => {
  test("an excuse filed 47 hours after Monday's miss is accepted", async () => {
    const { s, owner, gym } = await gymMissedMonday();
    s.setClockTo("Wed 23:00");
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toEqual({ ok: true, excuseId: expect.any(String) });
  });

  test("one filed 49 hours after is refused, and writes nothing", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Thu 01:00");
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [photo()])).toEqual({
      ok: false,
      reason: "nothing-to-excuse",
    });
    expect(owner.today().waiting).toEqual([]);
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owed(owner)).toBe(500);
  });

  test("judged when the server received the photos: one received at Wed 23:59 is accepted, though the upload finished after", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Wed 23:59");
    // A slow upload: the server has the photo at Wed 23:59, but writes the excuse at Thu 00:01.
    const store = s.photoStore.store.bind(s.photoStore);
    s.photoStore.store = async (p) => {
      const stored = await store(p);
      s.setClockTo("Thu 00:01");
      return stored;
    };

    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [photo()])).toEqual({
      ok: true,
      excuseId: expect.any(String),
    });
    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ kind: "excuse", filedAt: s.at("Wed 23:59") })]);
  });

  test("when storing a photo fails: filing fails and writes nothing", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 10:00");
    s.photoStore.store = () => Promise.reject(new Error("upload failed"));

    await expect(owner.fileExcuse(gym, sick(s.date("Mon")), [photo()])).rejects.toThrow("upload failed");
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(s.notifier.sentTo(reviewer).filter((n) => n.kind === "review-item")).toEqual([]);
  });
});

describe("days ahead", () => {
  test("an excuse for Fri–Sun filed Wednesday and approved Thursday: those days are Excused when they end, with no penalty", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const run = await createPact("Run", EVERY_DAY);
    await s.advanceTo("Wed 10:00");

    const excuseId = await fileExcuse(owner, run, { from: s.date("Fri"), to: s.date("Sun"), reason: "Trip" });
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: {
        days: [s.date("Fri"), s.date("Sat"), s.date("Sun")].map((date) => ({
          date,
          status: { kind: "not-judged", evidenceWaiting: false, cover: { kind: "excuse", state: "waiting" } },
        })),
      },
    });
    await s.advanceTo("Thu 10:00");
    await reviewer.decide(excuseId, { kind: "approve" });
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { days: [{ status: { kind: "not-judged", cover: { kind: "excuse", state: "approved" } } }, {}, {}] },
    });
    await s.advanceTo("2026-01-12T05:00:00Z"); // Mon Jan 12, 00:00 in New York

    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: {
        days: [s.date("Fri"), s.date("Sat"), s.date("Sun")].map((date) => ({ date, status: { kind: "excused" } })),
      },
    });
    // Mon–Thu were Missed; Fri–Sun added nothing, and their owner wasn't told they were Missed.
    expect(ledgerHistory(owner).map((entry) => entry.kind === "penalty" && entry.occurrenceDate)).toEqual([
      s.date("Thu"),
      s.date("Wed"),
      s.date("Tue"),
      s.date("Mon"),
    ]);
    const missedPushes = s.notifier.sent.filter((n) => n.kind === "missed-occurrence");
    expect(missedPushes.map((n) => n.payload.occurrenceDate)).toEqual([
      s.date("Mon"),
      s.date("Tue"),
      s.date("Wed"),
      s.date("Thu"),
    ]);
  });
});

describe("an excuse covering today", () => {
  test("today leaves To do for Waiting for approval; still waiting at midnight, today is Missed with its penalty held; approval then makes it Excused", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 15:00");

    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(owner.today()).toMatchObject({
      sections: [],
      waiting: [{ kind: "excuse", id: excuseId, firstDate: s.date("Mon"), lastDate: s.date("Mon") }],
    });
    await s.advanceTo("Tue 08:00");
    expect(owed(owner)).toBe(0);
    expect(ledgerHistory(owner)).toEqual([expect.objectContaining({ occurrenceDate: s.date("Mon"), held: true })]);
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: {
        days: [
          {
            date: s.date("Mon"),
            status: { kind: "missed", penaltyCents: 500, cover: { kind: "excuse", state: "waiting" } },
          },
        ],
      },
    });
    // A miss with an excuse waiting isn't on Today's Missed section, and isn't pushed.
    expect(owner.today().sections).toEqual([]);
    expect(s.notifier.sent.filter((n) => n.kind === "missed-occurrence")).toEqual([]);

    await reviewer.decide(excuseId, { kind: "approve" });

    expect(owner.excuse(excuseId)).toMatchObject({ excuse: { days: [{ status: { kind: "excused" } }] } });
    expect(ledgerHistory(owner)).toEqual([]);
  });
});

describe("which days an excuse covers", () => {
  test("a range with a Satisfied day and a day Missed 3 days ago covers only the days that can be excused, and reports the others as skipped", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    // Monday Missed (Tue 00:00); Wednesday Satisfied; Friday not judged yet.
    s.setClockTo("Wed 12:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    await reviewer.decide(evidence.evidenceId, { kind: "approve" });
    await s.advanceTo("Fri 08:00");

    const dates = { from: s.date("Mon"), to: s.date("Sun") };
    const fridayOpen = { kind: "not-judged", evidenceWaiting: false, cover: null, phase: "open" };
    expect(owner.excusePreview(gym, dates)).toEqual({
      ok: true,
      preview: {
        covered: [
          {
            date: s.date("Fri"),
            status: { ...fridayOpen, opensAt: s.at("Fri 00:00"), dueAt: new Date("2026-01-10T05:00:00Z") },
          },
        ],
        skipped: [
          { date: s.date("Mon"), reason: "window-closed" },
          { date: s.date("Wed"), reason: "satisfied" },
        ],
        heldCents: 0,
      },
    });
    const excuseId = await fileExcuse(owner, gym, { ...dates, reason: "Sick" });
    expect(owner.excuse(excuseId)).toMatchObject({ excuse: { days: [{ date: s.date("Fri") }] } });
    expect(owed(owner)).toBe(500);
  });

  test("a range with no day that can be excused is refused: Satisfied, Missed too long ago, or no pact day at all", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Wed 12:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    await reviewer.decide(evidence.evidenceId, { kind: "approve" });
    await s.advanceTo("Thu 08:00");

    const nothing = { ok: false, reason: "nothing-to-excuse" };
    expect(await owner.fileExcuse(gym, sick(s.date("Mon"), s.date("Wed")), [])).toEqual(nothing);
    expect(await owner.fileExcuse(gym, sick(s.date("Tue")), [])).toEqual(nothing);
    expect(owner.excusePreview(gym, sick(s.date("Tue")))).toEqual({
      ok: true,
      preview: { covered: [], skipped: [], heldCents: 0 },
    });
    expect(owner.today().waiting).toEqual([]);
  });

  test("a day already on a waiting excuse can't go on a second one", async () => {
    const { s, owner, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toEqual({ ok: false, reason: "nothing-to-excuse" });
    expect(owner.excusePreview(gym, sick(s.date("Mon"), s.date("Wed")))).toMatchObject({
      preview: {
        covered: [{ date: s.date("Wed") }],
        skipped: [{ date: s.date("Mon"), reason: "on-waiting-excuse" }],
      },
    });
  });

  test("an approved day ahead, or an Excused day, is skipped as Excused", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon"), s.date("Wed")));
    await reviewer.decide(excuseId, { kind: "approve" });

    expect(owner.excusePreview(gym, sick(s.date("Mon"), s.date("Fri")))).toMatchObject({
      preview: {
        covered: [{ date: s.date("Fri") }],
        skipped: [
          { date: s.date("Mon"), reason: "excused" },
          { date: s.date("Wed"), reason: "excused" },
        ],
      },
    });
  });
});

describe("filing is refused", () => {
  test("with a blank reason, bad or reversed dates, more than 62 days, or more than 3 photos; nothing is written", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");

    const refused = (reason: string) => ({ ok: false, reason });
    expect(await owner.fileExcuse(gym, { ...sick(s.date("Mon")), reason: "  " }, [])).toEqual(refused("blank-reason"));
    expect(await owner.fileExcuse(gym, sick(s.date("Wed"), s.date("Mon")), [])).toEqual(refused("invalid-dates"));
    expect(await owner.fileExcuse(gym, sick("2026-02-30"), [])).toEqual(refused("invalid-dates"));
    expect(await owner.fileExcuse(gym, sick("Monday"), [])).toEqual(refused("invalid-dates"));
    // 62 days is fine; 63 isn't.
    expect(owner.excusePreview(gym, sick(s.date("Mon"), "2026-03-07"))).toMatchObject({ ok: true });
    expect(await owner.fileExcuse(gym, sick(s.date("Mon"), "2026-03-08"), [])).toEqual(refused("too-many-days"));
    const photos = [photo(1), photo(2), photo(3), photo(4)];
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), photos)).toEqual(refused("too-many-photos"));

    expect(owner.today().waiting).toEqual([]);
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owed(owner)).toBe(500);
  });

  test("for someone else's pact or none, and in the pact's edit window", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toEqual({ ok: false, reason: "edit-window-open" });
    expect(owner.excuseOptions(gym)).toEqual({ ok: false, reason: "edit-window-open" });
    s.setClockTo("Mon 09:10");
    expect(await reviewer.fileExcuse(gym, sick(s.date("Mon")), [])).toEqual({ ok: false, reason: "pact-not-found" });
    expect(await owner.fileExcuse("no-such-pact", sick(s.date("Mon")), [])).toEqual({
      ok: false,
      reason: "pact-not-found",
    });
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toMatchObject({ ok: true });
  });
});

describe("rejected evidence", () => {
  test("the alert says until when an excuse is accepted: 48 hours from the rejection", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 13:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    s.setClockTo("Tue 09:00");
    await reviewer.decide(evidence.evidenceId, { kind: "reject", reason: "Blurry" });

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "evidence-rejected",
        occurrenceDate: s.date("Mon"),
        excusableUntil: s.at("Thu 09:00"),
      }),
    ]);
  });

  test("an excuse filed within 48 hours of the rejection is accepted, holds the penalty and resolves the alert", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 13:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    s.setClockTo("Tue 09:00");
    await reviewer.decide(evidence.evidenceId, { kind: "reject", reason: "Blurry" });

    // Monday was judged Missed at the rejection, so its window runs to Thu 09:00, not Thu 00:00.
    s.setClockTo("Thu 08:00");
    const excuseId = await fileExcuse(owner, gym, { ...sick(s.date("Mon")), reason: "That was the gym's mirror" });

    expect(owner.today()).toMatchObject({ alerts: [], sections: [], waiting: [{ kind: "excuse", id: excuseId }] });
    expect(owed(owner)).toBe(0);

    // Rejected again: the excuse's alert takes over from the evidence's.
    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ kind: "excuse-rejected", excuseId, refile: { closesAt: s.at("Thu 09:00") } }),
    ]);
  });

  test("after Take the L on its alert, an excuse is still accepted within 48 hours of the rejection", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 13:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    s.setClockTo("Tue 09:00");
    await reviewer.decide(evidence.evidenceId, { kind: "reject", reason: "Blurry" });
    await owner.acceptMiss(gym, s.date("Mon"));
    expect(owner.today().alerts).toEqual([]);

    s.setClockTo("Thu 08:59");
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toMatchObject({ ok: true });
  });

  test("evidence rejected on a day with an excuse waiting: Missed with its penalty held, and no evidence alert", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Mon 13:00");
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    await fileExcuse(owner, gym, sick(s.date("Mon")));
    await reviewer.decide(evidence.evidenceId, { kind: "reject", reason: "Blurry" });

    expect(owed(owner)).toBe(0);
    expect(owner.today().alerts).toEqual([]);
  });
});

describe("Take the L", () => {
  test("on a Missed card: it leaves Today, owed is unchanged, and an excuse is still accepted inside the window", async () => {
    const { s, owner, gym } = await gymMissedMonday();
    expect(owner.today().sections).toEqual([
      {
        kind: "missed",
        cards: [
          expect.objectContaining({ pactId: gym, occurrenceDate: s.date("Mon"), excusableUntil: s.at("Thu 00:00") }),
        ],
      },
    ]);

    await owner.acceptMiss(gym, s.date("Mon"));
    expect(owner.today().sections).toEqual([]);
    expect(owed(owner)).toBe(500);

    s.setClockTo("Wed 20:00");
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toMatchObject({ ok: true });
    expect(owed(owner)).toBe(0);
  });

  test("a Missed card leaves Today while an excuse for it waits", async () => {
    const { s, owner, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    await fileExcuse(owner, gym, sick(s.date("Mon")));
    expect(owner.today().sections).toEqual([]);
  });

  test("on a rejected-excuse alert: it leaves Today with its Missed days, owed is unchanged, and a new excuse is still accepted inside the window", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });

    expect(await owner.acceptExcuseRejection(excuseId)).toEqual({ ok: true });

    expect(owner.today()).toMatchObject({ alerts: [], sections: [], waiting: [] });
    expect(owed(owner)).toBe(500);
    expect(await owner.acceptExcuseRejection(excuseId)).toEqual({ ok: false, reason: "nothing-to-accept" });
    expect(await reviewer.acceptExcuseRejection(excuseId)).toEqual({ ok: false, reason: "excuse-not-found" });
    expect(await owner.fileExcuse(gym, sick(s.date("Mon")), [])).toMatchObject({ ok: true });
  });

  test("only on a rejected excuse: one waiting or approved has nothing to accept", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    expect(await owner.acceptExcuseRejection(excuseId)).toEqual({ ok: false, reason: "nothing-to-accept" });
    await reviewer.decide(excuseId, { kind: "approve" });
    expect(await owner.acceptExcuseRejection(excuseId)).toEqual({ ok: false, reason: "nothing-to-accept" });
  });
});

describe("a rejected excuse with days not judged yet", () => {
  test("its days ahead are judged as usual, and the alert says so", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon"), s.date("Fri")));
    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "excuse-rejected",
        firstDate: s.date("Mon"),
        lastDate: s.date("Fri"),
        owedAgainCents: 500,
        hasDaysNotJudged: true,
        refile: { closesAt: s.at("Thu 00:00") },
      }),
    ]);
    await s.advanceTo("Thu 08:00");
    // Wednesday is Missed as usual, with its push, and its own Missed card.
    expect(owed(owner)).toBe(1000);
    expect(s.notifier.sent.filter((n) => n.kind === "missed-occurrence").map((n) => n.payload.occurrenceDate)).toEqual([
      s.date("Mon"),
      s.date("Wed"),
    ]);
    expect(owner.today().sections).toEqual([
      { kind: "missed", cards: [expect.objectContaining({ occurrenceDate: s.date("Wed") })] },
    ]);
    // Wednesday, Missed after the rejection, can be excused until Sat 00:00; Friday is not judged yet.
    expect(owner.today().alerts).toEqual([expect.objectContaining({ refile: { closesAt: s.at("Sat 00:00") } })]);
  });
  test("an approved change takes all its days off the schedule: no alert is left, and Today still loads", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Fri")));
    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });
    expect(owner.today().alerts).toEqual([expect.objectContaining({ kind: "excuse-rejected", excuseId })]);

    const sent = await owner.changePact(
      gym,
      changed(owner, gym, { schedule: { kind: "fixed-days", days: ["mon", "wed"] } }),
    );
    await reviewer.decide(changeRequestIdOf(sent), { kind: "approve" });

    expect(owner.today().alerts).toEqual([]);
  });
});

describe("holds and payments", () => {
  test("a held penalty isn't owed, so a payment can't cover it; released by a rejection, it's owed and payable again", async () => {
    const { s, owner, reviewer, gym, sam } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, payableCents: 0 })]);
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 500 }, photo())).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });

    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500, payableCents: 500 })]);
    await recordPayment(owner, { recipientId: sam.id, amountCents: 500 });
  });

  test("an excuse approved after its penalty was paid: owed stays $0, and the payment pays the next penalty", async () => {
    const { s, owner, reviewer, gym, sam } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    await reviewer.decide(await recordPayment(owner, { recipientId: sam.id, amountCents: 500 }), { kind: "approve" });
    await reviewer.decide(await fileExcuse(owner, gym, sick(s.date("Mon"))), { kind: "approve" });

    expect(owner.ledgers()).toEqual([
      expect.objectContaining({
        owedCents: 0,
        payableCents: 0,
        paidCents: 500,
        overdueCents: 0,
        billDue: null,
        creditCents: 500,
      }),
    ]);
    expect(await owner.recordPayment({ recipientId: sam.id, amountCents: 1 }, photo())).toEqual({
      ok: false,
      reason: "payment-exceeds-owed",
    });

    // Wednesday's miss is paid already; Friday's is owed.
    await s.advanceTo("Thu 00:00");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, payableCents: 0, creditCents: 0 })]);
    expect(ledgerHistory(owner).filter((entry) => entry.kind === "penalty")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Wed"), paidCents: 500 }),
    ]);
    await s.advanceTo("Sat 00:00");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500, payableCents: 500 })]);
  });

  test("a payment awaiting approval while an excuse holds its penalty, approved: owed doesn't go below $0", async () => {
    const { s, owner, reviewer, gym, sam } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 });
    await fileExcuse(owner, gym, sick(s.date("Mon")));
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, awaitingCents: 500, payableCents: 0 })]);
    expect(reviewer.reviewQueue()).toContainEqual(
      expect.objectContaining({ kind: "payment", owedCents: 0, owedAfterApprovalCents: 0 }),
    );

    await reviewer.decide(paymentId, { kind: "approve" });

    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0, payableCents: 0, paidCents: 500 })]);
  });

  test("an excuse holds a penalty a payment already part paid: the Review Queue says $0 owed, not below", async () => {
    const { s, owner, reviewer, gym, sam } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    await reviewer.decide(await recordPayment(owner, { recipientId: sam.id, amountCents: 300 }), { kind: "approve" });
    const waiting = await recordPayment(owner, { recipientId: sam.id, amountCents: 200 });
    await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(reviewer.reviewQueue()).toContainEqual(
      expect.objectContaining({ kind: "payment", id: waiting, owedCents: 0, owedAfterApprovalCents: 0 }),
    );
  });
});

describe("who decides", () => {
  test("either reviewer of a two-reviewer pact can decide; the second decision is refused", async () => {
    const { s, owner, reviewer, second, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    expect(reviewer.reviewQueue()).toEqual([expect.objectContaining({ kind: "excuse", id: excuseId })]);
    expect(second.reviewQueue()).toEqual([expect.objectContaining({ kind: "excuse", id: excuseId })]);

    expect(await second.decide(excuseId, { kind: "approve" })).toEqual({ ok: true });

    expect(await reviewer.decide(excuseId, { kind: "reject", reason: "No" })).toEqual({
      ok: false,
      reason: "already-decided",
    });
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(owner.excuse(excuseId)).toMatchObject({ excuse: { state: { kind: "approved", reviewerName: "second" } } });
  });

  test("the owner can't decide their own excuse, and a rejection needs a reason", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    expect(await owner.decide(excuseId, { kind: "approve" })).toEqual({ ok: false, reason: "item-not-found" });
    expect(await reviewer.decide(excuseId, { kind: "reject", reason: " " })).toEqual({
      ok: false,
      reason: "blank-reason",
    });
  });
});

describe("the review item", () => {
  test("shows the reason, photos, the days with their held penalties, and what's held", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon"), s.date("Wed")), [photo(1), photo(2)]);

    const [item] = reviewer.reviewQueue();
    expect(item).toEqual({
      kind: "excuse",
      id: excuseId,
      pactId: gym,
      pactName: "Gym",
      ownerName: "owner",
      reason: "Sick with the flu",
      photoIds: [expect.any(String), expect.any(String)],
      filedAt: s.at("Tue 08:00"),
      days: [
        {
          date: s.date("Mon"),
          status: {
            kind: "missed",
            penaltyCents: 500,
            excusableUntil: s.at("Thu 00:00"),
            cover: { kind: "excuse", state: "waiting" },
            phase: "past-due",
          },
        },
        {
          date: s.date("Wed"),
          status: {
            kind: "not-judged",
            opensAt: s.at("Wed 00:00"),
            dueAt: s.at("Thu 00:00"),
            evidenceWaiting: false,
            cover: { kind: "excuse", state: "waiting" },
            phase: "ahead",
          },
        },
      ],
      heldCents: 500,
      recipientName: "Sam",
      thread: { comments: [], waitingOnReply: false },
    });
    // Its photos are the owner's and the reviewers' to see.
    const photoId = item!.kind === "excuse" ? item!.photoIds[0]! : "";
    expect(await reviewer.photo(photoId)).toMatchObject({ ok: true });
    expect(await owner.photo(photoId)).toMatchObject({ ok: true });
    const stranger = await s.befriend(owner, "stranger");
    expect(await stranger.photo(photoId)).toEqual({ ok: false, reason: "photo-not-found" });
  });
});

describe("notifications", () => {
  test("each reviewer is told of a new excuse; the owner is told the decision", async () => {
    const { s, owner, reviewer, second, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon"), s.date("Wed")));

    const items = s.notifier.sent.filter((n) => n.kind === "review-item");
    expect(items.map((n) => n.recipient).toSorted()).toEqual([reviewer.id, second.id].toSorted());
    expect(items[0]!.payload).toMatchObject({
      itemKind: "excuse",
      itemId: excuseId,
      title: "owner filed an excuse",
      body: "Gym · Mon Jan 5 – Wed Jan 7",
      url: "/review",
    });

    await reviewer.decide(excuseId, { kind: "reject", reason: "No" });
    expect(s.notifier.sent.filter((n) => n.kind === "excuse-decided")).toEqual([
      expect.objectContaining({
        recipient: owner.id,
        payload: expect.objectContaining({ title: "reviewer rejected your excuse", body: "Gym · “No”", url: "/" }),
      }),
    ]);
  });
});

describe("the pact page", () => {
  test("lists the pact's waiting evidence and excuses, and offers the recent days an excuse would cover", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    await s.advanceTo("Wed 10:00");

    expect(owner.excuseOptions(gym)).toEqual({
      ok: true,
      options: {
        today: s.date("Wed"),
        recentDays: [
          { date: s.date("Wed"), status: expect.objectContaining({ kind: "not-judged" }) },
          { date: s.date("Mon"), status: expect.objectContaining({ kind: "missed", cover: null }) },
        ],
      },
    });
    const evidence = ok(await owner.submitEvidence(gym, [photo()]));
    s.setClockTo("Wed 11:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));

    expect(owner.pact(gym)).toMatchObject({
      pact: {
        waiting: [
          { kind: "excuse", id: excuseId },
          { kind: "evidence", id: evidence.evidenceId },
        ],
      },
    });
  });
});

describe("restarts", () => {
  test("an excuse waiting for approval survives a restart with its holds intact", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));

    await s.restart();

    expect(owed(owner)).toBe(0);
    expect(owner.today().waiting).toEqual([expect.objectContaining({ kind: "excuse", id: excuseId })]);
    await reviewer.decide(excuseId, { kind: "approve" });
    expect(ledgerHistory(owner)).toEqual([]);
  });
});

describe("a change that removes a covered day", () => {
  /** Puts `days` in force for Gym: approved by the reviewer, or at once if the change is stricter. */
  async function changeDays(owner: AccountHandle, reviewer: AccountHandle, gym: string, days: Weekday[]) {
    const result = ok(await owner.changePact(gym, changed(owner, gym, { schedule: { kind: "fixed-days", days } })));
    if (result.outcome.kind !== "stricter") ok(await reviewer.decide(changeRequestIdOf(result), { kind: "approve" }));
  }

  test("a Wednesday dropped by an approved change and added back by a later one isn't excused any more: it is Missed with its penalty", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 12:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon+1"), s.date("Sun+1")));
    ok(await reviewer.decide(excuseId, { kind: "approve" }));

    await changeDays(owner, reviewer, gym, ["mon", "fri"]);
    await changeDays(owner, reviewer, gym, MON_WED_FRI);
    await s.advanceTo("Sat 00:00");
    await s.advanceTo("Thu+1 00:00");

    expect(statusOn(owner, gym, s.date("Wed+1"))).toBe("missed");
    expect(penaltyDays(owner)).toContain(s.date("Wed+1"));
    // The days the schedule kept stay excused.
    expect(statusOn(owner, gym, s.date("Mon+1"))).toBe("excused");
  });

  test("a judged day's excuse is untouched by a later change that removes the day", async () => {
    const { s, owner, reviewer, gym } = await gymMissedMonday();
    s.setClockTo("Tue 08:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Mon")));
    ok(await reviewer.decide(excuseId, { kind: "approve" }));

    await changeDays(owner, reviewer, gym, ["wed", "fri"]);
    await changeDays(owner, reviewer, gym, MON_WED_FRI);

    expect(statusOn(owner, gym, s.date("Mon"))).toBe("excused");
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { days: [{ date: s.date("Mon"), status: { kind: "excused" } }] },
    });
  });

  test("an excuse whose only day was removed shows no days on its page, and is withdrawn as no longer needed", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 12:00");
    const excuseId = await fileExcuse(owner, gym, sick(s.date("Wed+1")));

    await changeDays(owner, reviewer, gym, ["mon", "fri"]);
    await changeDays(owner, reviewer, gym, MON_WED_FRI);

    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { days: [], state: { kind: "withdrawn", reason: "no-longer-needed" } },
    });
    expect(reviewer.reviewQueue()).toEqual([]);
  });
});
