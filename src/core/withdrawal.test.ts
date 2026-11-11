// Rule R8: when deciding a review item either way can no longer change any
// outcome, penalty or terms, the system withdraws it and records why
// (`pact-ended` or `no-longer-needed`; the owner's own withdrawal records
// `owner`). It leaves every queue and waiting list, its question alert goes,
// the owner's page and a reviewer's refusal say why, and nobody is pushed.

import { describe, expect, test } from "vitest";
import type { AccountId, Schedule } from "../shared/types.ts";
import type { Notification } from "./ports.ts";
import { EVERY_DAY, MON_WED_FRI, ownerWithReviewers, photo, recordPayment, submit } from "./testing/camera-pact.ts";
import { changed, ok, pactOf, statusOn } from "./testing/queries.ts";
import { changeRequestIdOf, scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

/** Every notification about `itemId` sent to any of `accounts`. */
function aboutItem(s: Scenario, accounts: { id: AccountId }[], itemId: string): Notification[] {
  return accounts.flatMap((account) =>
    s.notifier.sentTo(account).filter((n) => "itemId" in n.payload && n.payload.itemId === itemId),
  );
}

/** The ids in `reviewer`'s Review Queue and in their list waiting on a reply. */
function queued(reviewer: AccountHandle): string[] {
  return [...reviewer.reviewQueue(), ...reviewer.waitingOnReply()].map((item) => item.id);
}

/** The ids on the owner's waiting list. */
function waiting(owner: AccountHandle): string[] {
  return owner.today().waiting.map((item) => item.id);
}

describe("moot items are withdrawn with their reason, silently", () => {
  test("an excuse whose only day an approved change removed is no longer needed", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 12:00");
    const request = ok(
      await owner.changePact(gym, changed(owner, gym, { schedule: { kind: "fixed-days", days: ["mon", "fri"] } })),
    );
    const { excuseId } = ok(
      await owner.fileExcuse(gym, { from: s.date("Wed+1"), to: s.date("Wed+1"), reason: "Dentist" }, [photo()]),
    );
    expect(queued(reviewer)).toContain(excuseId);
    const told = aboutItem(s, [owner, reviewer, second], excuseId).length;

    ok(await reviewer.decide(changeRequestIdOf(request), { kind: "approve" }));

    expect(queued(reviewer)).not.toContain(excuseId);
    expect(waiting(owner)).not.toContain(excuseId);
    expect(owner.excuse(excuseId)).toMatchObject({
      ok: true,
      excuse: { state: { kind: "withdrawn", reason: "no-longer-needed", withdrawnAt: s.at("Tue 12:00") } },
    });
    expect(await second.decide(excuseId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "withdrawn",
      withdrawal: { reason: "no-longer-needed", withdrawnAt: s.at("Tue 12:00") },
    });
    expect(aboutItem(s, [owner, reviewer, second], excuseId)).toHaveLength(told);
  });

  test("an excuse and a vacation whose days all fall after an approved end are withdrawn when the pact Ended", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    s.setClockTo("Tue 12:00");
    const { excuseId } = ok(
      await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Fri"), reason: "Away" }, [photo()]),
    );
    const { vacationId } = ok(
      await owner.fileVacation({ from: s.date("Sat"), to: s.date("Sun"), pactIds: [gym], reviewerIds: [reviewer.id] }),
    );
    s.setClockTo("Wed 12:00");
    const end = ok(await owner.requestEnd(gym));
    const told = [excuseId, vacationId].map((id) => aboutItem(s, [owner, reviewer, second], id).length);

    // Wednesday is open: the pact keeps it, and Ends once it closes.
    ok(await reviewer.decide(end.changeRequestId, { kind: "approve" }));

    for (const id of [excuseId, vacationId]) {
      expect(queued(reviewer)).not.toContain(id);
      expect(waiting(owner)).not.toContain(id);
    }
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { state: { kind: "withdrawn", reason: "pact-ended", pactNames: ["Gym"] } },
    });
    expect(await reviewer.decide(vacationId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "withdrawn",
      withdrawal: { reason: "pact-ended", withdrawnAt: s.at("Wed 12:00"), pactNames: ["Gym"] },
    });
    expect(owner.vacations().map((card) => card.id)).not.toContain(vacationId);
    await s.advanceTo("Fri 12:00");
    expect([excuseId, vacationId].map((id) => aboutItem(s, [owner, reviewer, second], id).length)).toEqual(told);
  });

  test("an excuse whose day approved evidence made Satisfied is no longer needed, and its question goes", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Thu 20:00");
    const evidenceId = await submit(owner, gym);
    await s.advanceTo("Fri 01:00");
    const { excuseId } = ok(
      await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Thu"), reason: "Wrong photo" }, [photo()]),
    );
    ok(await second.askOwner(excuseId, "Which photo?"));
    expect(owner.today().alerts).toContainEqual(expect.objectContaining({ kind: "reviewer-question" }));
    const told = aboutItem(s, [owner, reviewer, second], excuseId).length;

    ok(await reviewer.decide(evidenceId, { kind: "approve" }));

    expect(statusOn(owner, gym, s.date("Thu"))).toBe("satisfied");
    expect(queued(reviewer)).not.toContain(excuseId);
    expect(queued(second)).not.toContain(excuseId);
    expect(waiting(owner)).not.toContain(excuseId);
    expect(owner.today().alerts.filter((alert) => alert.kind === "reviewer-question")).toEqual([]);
    expect(owner.excuse(excuseId)).toMatchObject({
      excuse: { state: { kind: "withdrawn", reason: "no-longer-needed", withdrawnAt: s.at("Fri 01:00") } },
    });
    expect(await owner.reply(excuseId, "The blue one")).toEqual({ ok: false, reason: "not-waiting" });
    expect(aboutItem(s, [owner, reviewer, second], excuseId)).toHaveLength(told);
  });

  test("a vacation whose only day approved evidence made Satisfied is no longer needed once the day is judged", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);
    s.setClockTo("Tue 12:00");
    const { vacationId } = ok(
      await owner.fileVacation({ from: s.date("Wed"), to: s.date("Wed"), pactIds: [gym], reviewerIds: [reviewer.id] }),
    );
    await s.advanceTo("Wed 10:00");
    const evidenceId = await submit(owner, gym);
    ok(await second.decide(evidenceId, { kind: "approve" }));
    // Not judged yet: until then, approving the vacation would still matter.
    expect(queued(reviewer)).toContain(vacationId);
    const told = aboutItem(s, [owner, reviewer, second], vacationId).length;

    await s.advanceTo("Thu 01:00");

    expect(statusOn(owner, gym, s.date("Wed"))).toBe("satisfied");
    expect(queued(reviewer)).not.toContain(vacationId);
    expect(waiting(owner)).not.toContain(vacationId);
    expect(await reviewer.decide(vacationId, { kind: "reject", reason: "No" })).toEqual({
      ok: false,
      reason: "withdrawn",
      withdrawal: { reason: "no-longer-needed", withdrawnAt: s.at("Thu 01:00") },
    });
    expect(aboutItem(s, [owner, reviewer, second], vacationId)).toHaveLength(told);
  });

  test("evidence for a Weekly count week its target already Satisfied is no longer needed once the week is judged", async () => {
    const s = scenario();
    const { owner, reviewer, second, createPact } = await ownerWithReviewers(s);
    const twiceAWeek: Schedule = { kind: "weekly-count", target: 2 };
    const piano = await createPact("Piano", twiceAWeek);
    s.setClockTo("Tue+1 12:00");
    ok(await reviewer.decide(await submit(owner, piano), { kind: "approve" }));
    s.setClockTo("Wed+1 12:00");
    ok(await reviewer.decide(await submit(owner, piano), { kind: "approve" }));
    s.setClockTo("Thu+1 12:00");
    const extra = await submit(owner, piano);
    await s.advanceTo("Sat+1 12:00");
    // The week isn't judged until it closes.
    expect(queued(reviewer)).toContain(extra);
    const told = aboutItem(s, [owner, reviewer, second], extra).length;

    await s.advanceTo("Mon+2 00:00");

    expect(pactOf(owner, piano).history).toMatchObject({
      weeks: expect.arrayContaining([
        expect.objectContaining({
          date: s.date("Mon+1"),
          occurrence: expect.objectContaining({ status: expect.objectContaining({ kind: "satisfied" }) }),
        }),
      ]),
    });
    expect(queued(reviewer)).not.toContain(extra);
    expect(waiting(owner)).not.toContain(extra);
    expect(owner.evidence(extra)).toMatchObject({
      evidence: { state: { kind: "withdrawn", reason: "no-longer-needed", withdrawnAt: s.at("Mon+2 00:00") } },
    });
    expect(aboutItem(s, [owner, reviewer, second], extra)).toHaveLength(told);
  });
});

describe("items whose decision still matters stay", () => {
  test("evidence for a day an approved excuse already made Excused stays: approving it would make the day Satisfied", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Thu 20:00");
    const evidenceId = await submit(owner, gym);
    await s.advanceTo("Fri 01:00");
    const { excuseId } = ok(
      await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Thu"), reason: "Wrong photo" }, [photo()]),
    );
    ok(await reviewer.decide(excuseId, { kind: "approve" }));
    await s.advanceTo("Fri 12:00");

    expect(statusOn(owner, gym, s.date("Thu"))).toBe("excused");
    expect(queued(reviewer)).toContain(evidenceId);
    expect(waiting(owner)).toContain(evidenceId);
    expect(owner.evidence(evidenceId)).toMatchObject({ evidence: { state: { kind: "waiting" } } });
  });

  test("evidence for an open day, an excuse for a day not judged yet and one for a Missed day, and a payment stay", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Thu 12:00");
    const evidenceId = await submit(owner, gym);
    const ahead = ok(
      await owner.fileExcuse(gym, { from: s.date("Sat"), to: s.date("Sat"), reason: "Away" }, [photo()]),
    ).excuseId;
    const missed = ok(
      await owner.fileExcuse(gym, { from: s.date("Wed"), to: s.date("Wed"), reason: "Sick" }, [photo()]),
    ).excuseId;
    const paymentId = await recordPayment(owner, { recipientId: sam.id, amountCents: 500 });

    await s.advanceTo("Thu 18:00");

    expect(statusOn(owner, gym, s.date("Wed"))).toBe("missed");
    for (const id of [evidenceId, ahead, missed, paymentId]) {
      expect(queued(reviewer)).toContain(id);
      expect(waiting(owner)).toContain(id);
    }
  });

  test("a change request on an Active pact stays", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", EVERY_DAY);
    await s.advanceTo("Thu 12:00");
    const id = changeRequestIdOf(await owner.changePact(gym, changed(owner, gym, { penaltyCents: 100 })));

    await s.advanceTo("Sat 12:00");

    expect(queued(reviewer)).toContain(id);
  });
});
