// Per-pact reminders, pushed to the owner at a time of day in their timezone.
// On a Camera pact they fire on scheduled days, before the day's due time,
// only while the day has no evidence. On a bedtime pact they fire every
// scheduled night before its in-bed-by time, even if the owner is already in
// bed. Changing them applies at once, with no review. After downtime, a
// reminder more than 15 minutes late is dropped, logged, and summed up in one
// operator alert.

import { describe, expect, test } from "vitest";
import { WEEKDAYS, type NewPact } from "../shared/types.ts";
import { bedtimePact, ownerWithOura, sleep } from "./testing/bedtime-pact.ts";
import { cameraPact, MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";
import { changed, ok, pactOf } from "./testing/queries.ts";

/** The reminders the owner was sent, as pact and occurrence date. */
function reminders(s: Scenario, owner: AccountHandle) {
  return s.notifier
    .sentTo(owner, "reminder")
    .map((n) => ({ pactId: n.payload.pactId, occurrenceDate: n.payload.occurrenceDate }));
}

async function bedtimeWithReminders(s: Scenario, inBedBy: string, reminderTimes: string[], days = [...WEEKDAYS]) {
  const setup = await ownerWithOura(s);
  const pact: NewPact = { ...bedtimePact(setup.sam.id, setup.reviewer, inBedBy, days), reminders: reminderTimes };
  const created = ok(await setup.owner.createPact(pact));
  return { ...setup, bed: created.pactId };
}

describe("setting reminders", () => {
  test("a new pact keeps its reminders, each a time of day, in order", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00", "07:30", "18:00"] });

    expect(pactOf(owner, gym).reminders).toEqual(["07:30", "18:00"]);
  });

  test("a pact may have none", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI);

    expect(pactOf(owner, gym).reminders).toEqual([]);
  });

  test("a bedtime pact lists them in night order, the evening before the morning after", async () => {
    const s = scenario();
    const { owner, bed } = await bedtimeWithReminders(s, "01:00", ["00:30", "22:00"]);

    expect(pactOf(owner, bed).reminders).toEqual(["22:00", "00:30"]);
  });

  test("a time that isn't HH:MM, or more than five, is refused", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    const pact = cameraPact("Gym", MON_WED_FRI, { recipientId: sam.id, reviewers: [reviewer] });

    expect(await owner.createPact({ ...pact, reminders: ["6pm"] })).toEqual({
      ok: false,
      reason: "invalid-reminders",
    });
    expect(
      await owner.createPact({ ...pact, reminders: ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00"] }),
    ).toEqual({ ok: false, reason: "invalid-reminders" });
  });

  test("one at or after the due time is refused, since it would never go off", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithReviewers(s);
    const camera = cameraPact("Gym", MON_WED_FRI, {
      recipientId: sam.id,
      reviewers: [reviewer],
      dates: { dueBy: "10:00" },
    });
    await owner.connectOura();

    expect(await owner.createPact({ ...camera, reminders: ["09:00", "10:00"] })).toEqual({
      ok: false,
      reason: "reminder-after-due-time",
    });
    // A night runs from 18:00: 02:00 is the morning after, past 01:00.
    expect(await owner.createPact({ ...bedtimePact(sam.id, reviewer, "01:00"), reminders: ["02:00"] })).toEqual({
      ok: false,
      reason: "reminder-after-due-time",
    });
    expect((await owner.createPact({ ...bedtimePact(sam.id, reviewer, "01:00"), reminders: ["00:30"] })).ok).toBe(true);
  });

  test("editing in the edit window replaces them", async () => {
    const s = scenario();
    const { owner, reviewer, second, sam, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    const edited = await owner.editPact(
      gym,
      cameraPact("Gym", MON_WED_FRI, { recipientId: sam.id, reviewers: [reviewer, second], reminders: ["17:00"] }),
    );

    expect(edited).toEqual({ ok: true });
    expect(pactOf(owner, gym).reminders).toEqual(["17:00"]);
  });
});

describe("reminders on a Fixed days Camera pact", () => {
  test("fire on a scheduled day at their time when the day has no evidence", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    await s.advanceTo("Mon 17:59");
    expect(reminders(s, owner)).toEqual([]);

    await s.advanceTo("Mon 18:00");
    expect(s.notifier.sentTo(owner, "reminder")).toEqual([
      {
        recipient: owner.id,
        kind: "reminder",
        payload: {
          pactId: gym,
          occurrenceDate: s.date("Mon"),
          title: "Gym",
          body: "No photo yet today. Due at midnight.",
          url: "/",
        },
      },
    ]);
  });

  test("don't fire when evidence was submitted earlier that day", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    await s.advanceTo("Mon 17:00");
    expect((await owner.submitEvidence(gym, [photo()])).ok).toBe(true);
    await s.advanceTo("Mon 18:00");

    expect(reminders(s, owner)).toEqual([]);
  });

  test("never fire on a day the schedule skips", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await s.advanceTo(`${day} 18:00`);

    expect(reminders(s, owner)).toEqual([
      { pactId: gym, occurrenceDate: s.date("Mon") },
      { pactId: gym, occurrenceDate: s.date("Wed") },
      { pactId: gym, occurrenceDate: s.date("Fri") },
    ]);
  });

  test("say when the day is due by", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    // Created Mon 09:00, Monday's 10:00 due time is too close: Wednesday is the first day.
    const gym = await createPact("Gym", MON_WED_FRI, { dates: { dueBy: "10:00" }, reminders: ["08:00"] });

    await s.advanceTo("Wed 08:00");

    expect(s.notifier.sentTo(owner, "reminder")).toMatchObject([
      { payload: { pactId: gym, occurrenceDate: s.date("Wed"), body: "No photo yet today. Due at 10:00am." } },
    ]);
  });

  test("don't fire on a day an approved excuse covers", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 09:30");
    const filed = ok(await owner.fileExcuse(gym, { from: s.date("Wed"), to: s.date("Wed"), reason: "Travelling" }, []));
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    await s.advanceTo("Mon 18:00");
    await s.advanceTo("Wed 18:00");

    expect(reminders(s, owner)).toEqual([{ pactId: gym, occurrenceDate: s.date("Mon") }]);
  });

  test("stop once the pact has Ended", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI, { dates: { endDate: s.date("Mon") }, reminders: ["18:00"] });

    for (const time of ["Mon 18:00", "Wed 18:00", "Fri 18:00"]) await s.advanceTo(time);

    expect(reminders(s, owner).map((r) => r.occurrenceDate)).toEqual([s.date("Mon")]);
  });

  test("are times in the owner's timezone", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await owner.setTimezone("America/Los_Angeles");
    await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    await s.advanceTo("Mon 18:00"); // 15:00 in Los Angeles
    expect(reminders(s, owner)).toEqual([]);

    await s.advanceTo("Mon 21:00"); // 18:00 in Los Angeles
    expect(reminders(s, owner).map((r) => r.occurrenceDate)).toEqual([s.date("Mon")]);
  });
});

describe("reminders on a bedtime pact", () => {
  test("fire every scheduled night, even when the owner is already in bed", async () => {
    const s = scenario();
    const { owner, bed } = await bedtimeWithReminders(s, "00:00", ["23:30"], ["mon", "tue", "wed"]);
    // In bed at 22:00, and the ring synced before the reminder.
    s.ouraSource.addSleep(owner.id, sleep("Mon 22:00"));

    for (const day of ["Mon", "Tue", "Wed", "Thu"]) await s.advanceTo(`${day} 23:30`);

    expect(s.notifier.sentTo(owner, "reminder")).toMatchObject([
      {
        payload: {
          pactId: bed,
          occurrenceDate: s.date("Mon"),
          title: "In bed by midnight",
          body: "In bed by 12:00am tonight.",
        },
      },
      { payload: { pactId: bed, occurrenceDate: s.date("Tue") } },
      { payload: { pactId: bed, occurrenceDate: s.date("Wed") } },
    ]);
  });

  test("a time before 18:00 goes off the morning after", async () => {
    const s = scenario();
    const { owner, bed } = await bedtimeWithReminders(s, "01:00", ["00:30"], ["mon"]);

    for (const time of ["Mon 23:59", "Tue 00:30", "Wed 00:30"]) await s.advanceTo(time);

    expect(reminders(s, owner)).toEqual([{ pactId: bed, occurrenceDate: s.date("Mon") }]);
    expect(s.notifier.sentTo(owner, "reminder")[0]?.payload.body).toBe("In bed by 1:00am tonight.");
  });
});

describe("after downtime", () => {
  test("advancing from 17:50 to 18:20 in one step drops the 18:00 reminder and records one operator alert", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    const run = await createPact("Run", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 17:50");

    await s.advanceTo("Mon 18:20");

    expect(reminders(s, owner)).toEqual([]);
    const drops = s.logs.filter((line) => line.startsWith("reminder dropped"));
    expect(drops).toHaveLength(2);
    expect(drops).toEqual(expect.arrayContaining([expect.stringContaining(gym), expect.stringContaining(run)]));
    expect(s.logs.filter((line) => line.includes("OPERATOR_ALERT"))).toEqual([
      expect.stringMatching(/OPERATOR_ALERT dropped 2 reminders/),
    ]);
    expect(s.notifier.sentTo(owner, "operator-alert").map((n) => n.payload)).toEqual([
      {
        alert: "reminders-dropped",
        dropped: 2,
        title: "Operator alert",
        body: "Dropped 2 reminders more than 15 minutes late after downtime.",
        url: "/",
      },
    ]);
  });

  test("advancing from 17:50 to 18:10 sends it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 17:50");

    await s.advanceTo("Mon 18:10");

    expect(reminders(s, owner)).toEqual([{ pactId: gym, occurrenceDate: s.date("Mon") }]);
    expect(s.notifier.sentTo(owner, "operator-alert")).toEqual([]);
  });

  test("a reminder that wouldn't have fired isn't counted as dropped", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Tue 17:50");

    await s.advanceTo("Tue 18:20");

    expect(s.notifier.sentTo(owner, "operator-alert")).toEqual([]);
    expect(s.logs.filter((line) => line.includes("OPERATOR_ALERT"))).toEqual([]);
  });
});

describe("a reminder fires once", () => {
  test("across more ticks", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });

    for (const time of ["Mon 18:00", "Mon 18:00", "Mon 18:05", "Mon 23:00"]) await s.advanceTo(time);

    expect(reminders(s, owner)).toHaveLength(1);
  });

  test("also across a restart right after it fires", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 18:00");

    await s.restart();
    await s.advanceTo("Mon 18:01");
    await s.advanceTo("Mon 18:10");

    expect(reminders(s, owner)).toHaveLength(1);
  });

  test("also when the owner moves their timezone west after it fired, and across a restart", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    await createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 18:00");
    s.setClockTo("Mon 18:30");
    await owner.setTimezone("America/Los_Angeles");

    await s.advanceTo("Mon 20:00");
    await s.restart();
    await s.advanceTo("Mon 21:00"); // 18:00 Monday again, in Los Angeles
    expect(reminders(s, owner).map((r) => r.occurrenceDate)).toEqual([s.date("Mon")]);

    await s.advanceTo("Wed 21:00");
    expect(reminders(s, owner).map((r) => r.occurrenceDate)).toEqual([s.date("Mon"), s.date("Wed")]);
  });
});

describe("changing reminders on an Active pact", () => {
  async function pastEditWindow() {
    const s = scenario();
    const setup = await ownerWithReviewers(s);
    const gym = await setup.createPact("Gym", MON_WED_FRI, { reminders: ["18:00"] });
    await s.advanceTo("Mon 09:30");
    return { s, ...setup, gym };
  }

  test("applies at once, with no review", async () => {
    const { s, owner, reviewer, gym } = await pastEditWindow();

    const preview = owner.changePreview(gym, changed(owner, gym, { reminders: ["17:00", "20:00"] }));
    expect(preview).toEqual({
      ok: true,
      preview: {
        changes: [{ term: "reminders", before: ["18:00"], after: ["17:00", "20:00"], effect: "at-once" }],
        outcome: { kind: "at-once" },
      },
    });
    const result = await owner.changePact(gym, changed(owner, gym, { reminders: ["17:00", "20:00"] }));

    expect(result).toEqual({ ok: true, outcome: { kind: "at-once" } });
    expect(pactOf(owner, gym).reminders).toEqual(["17:00", "20:00"]);
    expect(reviewer.reviewQueue()).toEqual([]);
    for (const time of ["Mon 17:00", "Mon 18:00", "Mon 20:00"]) await s.advanceTo(time);
    expect(s.notifier.sentTo(owner, "reminder")).toHaveLength(2);
  });

  test("may change while a change request waits, and approving it keeps them", async () => {
    const { s, owner, reviewer, gym } = await pastEditWindow();
    const requested = await owner.changePact(gym, changed(owner, gym, { penaltyCents: 300 }));
    if (!requested.ok || requested.outcome.kind !== "needs-approval") throw new Error("expected a change request");

    const result = await owner.changePact(gym, changed(owner, gym, { reminders: [] }));
    expect(result).toEqual({ ok: true, outcome: { kind: "at-once" } });
    expect(pactOf(owner, gym).reminders).toEqual([]);

    await reviewer.decide(requested.outcome.changeRequestId, { kind: "approve" });
    expect(pactOf(owner, gym).reminders).toEqual([]);
    await s.advanceTo("Mon 18:00");
    expect(reminders(s, owner)).toEqual([]);
  });

  test("set with a later due-by time that needs approval, one after the due-by time in force now is refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const gym = await createPact("Gym", MON_WED_FRI, { dates: { dueBy: "18:00" } });
    await s.advanceTo("Mon 09:30");

    expect(await owner.changePact(gym, changed(owner, gym, { dueBy: "21:00", reminders: ["19:00"] }))).toEqual({
      ok: false,
      reason: "reminder-after-due-time",
    });
    expect(await owner.changePact(gym, changed(owner, gym, { dueBy: "21:00", reminders: ["17:00"] }))).toMatchObject({
      ok: true,
      outcome: { kind: "needs-approval" },
    });
  });

  test("inside a change that needs approval, they apply at once and aren't part of the request", async () => {
    const { owner, gym } = await pastEditWindow();

    const result = await owner.changePact(gym, changed(owner, gym, { penaltyCents: 300, reminders: ["19:00"] }));
    if (!result.ok || result.outcome.kind !== "needs-approval") throw new Error("expected a change request");

    expect(pactOf(owner, gym).reminders).toEqual(["19:00"]);
    const request = owner.changeRequest(result.outcome.changeRequestId);
    if (!request.ok || request.changeRequest.endsPact) throw new Error("expected a change of terms");
    expect(request.changeRequest.changes.map((c) => c.term)).toEqual(["penalty"]);
  });
});
