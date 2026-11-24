// A rejection is final straight away: rejected evidence makes the occurrence
// Missed as of the rejection, with its penalty, whether the day is still open
// or already past its due time, and the day takes no more evidence. Today
// shows it only as a rejected-evidence alert, until the owner takes the L.

import { describe, expect, test } from "vitest";
import type { Today } from "../shared/types.ts";
import { gymEvidenceWaiting, ownerWithReviewers, photo, submit } from "./testing/camera-pact.ts";
import { scenario } from "./testing/scenario.ts";
import { ok } from "./testing/queries.ts";

describe("a rejection is final straight away", () => {
  test("rejected Monday afternoon, while the day is still open: Missed at once, $5 owed; the pact leaves To do; Today shows only the alert", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");

    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [
        {
          kind: "evidence-rejected",
          pactId: gym,
          name: "Gym",
          reviewerName: "reviewer",
          reason: "Blurry",
          occurrenceDate: s.date("Mon"),
          penaltyCents: 500,
          recipientName: "Sam",
          excusableUntil: s.at("Wed 15:00"),
          period: null,
        },
      ],
      sections: [],
      waiting: [],
      yesterday: [],
    } satisfies Today);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ name: "Sam", owedCents: 500 })]);
    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: { history: [{ pactId: gym, occurrenceDate: s.date("Mon"), addedAt: s.at("Mon 15:00") }] },
    });
  });

  test("rejected Tuesday, after Monday's due time: the same alert, and Monday isn't in the Missed section", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    await s.advanceTo("Tue 00:00");
    s.setClockTo("Tue 08:00");

    await reviewer.decide(evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(owner.today()).toEqual({
      hasPacts: true,
      alerts: [
        {
          kind: "evidence-rejected",
          pactId: gym,
          name: "Gym",
          reviewerName: "reviewer",
          reason: "That's last week's photo",
          occurrenceDate: s.date("Mon"),
          penaltyCents: 500,
          recipientName: "Sam",
          excusableUntil: s.at("Thu 08:00"),
          period: null,
        },
      ],
      sections: [],
      waiting: [],
      yesterday: [
        expect.objectContaining({
          occurrenceDate: s.date("Mon"),
          occurrence: expect.objectContaining({
            status: expect.objectContaining({
              kind: "missed",
              rejection: { reviewerName: "reviewer", reason: "That's last week's photo" },
            }),
          }),
        }),
      ],
    } satisfies Today);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });

  test("when the day ends it isn't judged again: still one penalty, as of the rejection", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    await s.advanceTo("Tue 00:00");

    expect(owner.ledger(owner.ledgers()[0]!.recipientId)).toMatchObject({
      ledger: {
        summary: { owedCents: 500 },
        history: [{ pactId: gym, occurrenceDate: s.date("Mon"), addedAt: s.at("Mon 15:00") }],
      },
    });
    expect(owner.today()).toMatchObject({ alerts: [{ pactId: gym, occurrenceDate: s.date("Mon") }], sections: [] });
  });

  test("evidence for a day whose evidence was rejected is refused, and nothing reaches the reviewers", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    const today = owner.today();

    s.setClockTo("Mon 20:00");
    expect(await owner.submitEvidence(gym, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });

    expect(owner.today()).toEqual(today);
    expect(reviewer.reviewQueue()).toEqual([]);
    expect(second.reviewQueue()).toEqual([]);
    // Wednesday is a new day: its evidence is accepted.
    s.setClockTo("Wed 09:00");
    expect(await owner.submitEvidence(gym, [photo(3)])).toEqual({ ok: true, evidenceId: expect.any(String) });
  });
});

describe("the rejected-evidence alert", () => {
  test("an excuse is accepted until 48 hours after the rejection, on Fixed days and One-time; on Weekly count the week isn't judged, so there's no limit", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const piano = await createPact("Piano", { kind: "weekly-count", target: 2 });
    const essay = await createPact("Essay", { kind: "one-time", deadline: s.date("Fri+1"), submitAnytime: true });
    const gym = await createPact("Gym", ["tue"]);
    s.setClockTo("Tue+1 10:00");
    const photos = [await submit(owner, piano), await submit(owner, essay), await submit(owner, gym)];
    s.setClockTo("Tue+1 11:00");
    for (const id of photos) await reviewer.decide(id, { kind: "reject", reason: "Blurry" });

    const alerts = owner
      .today()
      .alerts.map((alert) =>
        alert.kind === "evidence-rejected" ? [alert.name, alert.excusableUntil, alert.period] : alert.kind,
      );
    expect(alerts).toEqual(
      expect.arrayContaining([
        ["Gym", s.at("Thu+1 11:00"), null],
        ["Essay", s.at("Thu+1 11:00"), null],
        ["Piano", null, { kind: "weekly-count", lastDay: s.date("Sun+1") }],
      ]),
    );
    expect(alerts).toHaveLength(3);
  });

  test("Take the L clears it; owed and the ledger's history are unchanged", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    const [summary] = owner.ledgers();
    const ledger = owner.ledger(summary!.recipientId);

    s.setClockTo("Mon 16:00");
    expect(await owner.acceptMiss(gym, s.date("Mon"))).toEqual({ ok: true });

    expect(owner.today()).toEqual({ hasPacts: true, alerts: [], sections: [], waiting: [], yesterday: [] });
    expect(owner.ledgers()).toEqual([summary]);
    expect(owner.ledger(summary!.recipientId)).toEqual(ledger);
    expect(ledger).toMatchObject({
      ledger: {
        history: [{ occurrenceDate: s.date("Mon"), rejection: { reviewerName: "reviewer", reason: "Blurry" } }],
      },
    });
  });

  test("is still there after 48 hours, and after a restart, if Take the L wasn't tapped", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });

    await s.advanceTo("Fri 12:00");
    await s.restart();

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({
        kind: "evidence-rejected",
        pactId: gym,
        occurrenceDate: s.date("Mon"),
        reason: "Blurry",
      }),
    ]);
  });

  test("one per rejected occurrence, newest rejection first; Take the L clears only its own", async () => {
    const s = scenario();
    const { owner, reviewer, second, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    s.setClockTo("Wed 09:00");
    const wednesday = ok(await owner.submitEvidence(gym, [photo(2)]));
    s.setClockTo("Wed 10:00");
    await second.decide(wednesday.evidenceId, { kind: "reject", reason: "That's last week's photo" });

    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Wed"), reviewerName: "second" }),
      expect.objectContaining({ occurrenceDate: s.date("Mon"), reviewerName: "reviewer" }),
    ]);

    await owner.acceptMiss(gym, s.date("Wed"));

    expect(owner.today().alerts).toEqual([expect.objectContaining({ occurrenceDate: s.date("Mon") })]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 1000 })]);
  });

  test("Take the L survives a restart", async () => {
    const s = scenario();
    const { owner, reviewer, gym, evidenceId } = await gymEvidenceWaiting(s, "Mon 13:00");
    s.setClockTo("Mon 15:00");
    await reviewer.decide(evidenceId, { kind: "reject", reason: "Blurry" });
    await owner.acceptMiss(gym, s.date("Mon"));

    await s.restart();

    expect(owner.today().alerts).toEqual([]);
    expect(await owner.acceptMiss(gym, s.date("Mon"))).toEqual({ ok: false, reason: "nothing-to-accept" });
  });
});
