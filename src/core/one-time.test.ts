// One-time: a Camera pact with a single occurrence by a deadline, such as a
// dentist appointment on a set day or taxes filed any time before April 15.
// Off (the default), Submit anytime opens the occurrence at the start of the
// deadline's date; on, it's open from the pact's creation. Either way it's
// judged at the deadline (the due-by time on that date, or else midnight),
// and once judged the pact is Ended. A change applies to the occurrence even
// once it's open, as long as the new deadline is at least an hour off.

import { describe, expect, test } from "vitest";
import type { NewPact, PactChange, Schedule } from "../shared/types.ts";
import { bedtimePact, ownerWithOura } from "./testing/bedtime-pact.ts";
import { MON_WED_FRI, ownerWithReviewers, photo } from "./testing/camera-pact.ts";
import type { AccountHandle, Scenario } from "./testing/scenario.ts";
import { scenario } from "./testing/scenario.ts";

// The reference week: Mon Jan 5 to Sun Jan 11, 2026; the clock starts Mon 09:00.
const TUESDAY = "2026-01-06";
const THURSDAY = "2026-01-08";
const FRIDAY = "2026-01-09";
const SATURDAY = "2026-01-10";
const THURSDAY_1 = "2026-01-15";
const DAY_MS = 24 * 3600_000;

const oneTime = (deadline: string, submitAnytime = false): Schedule => ({ kind: "one-time", deadline, submitAnytime });

function pactOf(owner: AccountHandle, pactId: string) {
  const result = owner.pact(pactId);
  if (!result.ok) throw new Error(result.reason);
  return result.pact;
}

/** The pact's one square on its heat map. */
function occurrenceOf(owner: AccountHandle, pactId: string) {
  const { history } = pactOf(owner, pactId);
  if (history.kind !== "one-time") throw new Error(`a ${history.kind} heat map`);
  return history.day;
}

function owed(owner: AccountHandle): number {
  return owner.ledgers()[0]?.owedCents ?? 0;
}

async function submit(owner: AccountHandle, pactId: string): Promise<string> {
  const submitted = await owner.submitEvidence(pactId, [photo()]);
  if (!submitted.ok) throw new Error(submitted.reason);
  return submitted.evidenceId;
}

function sectionCards(owner: AccountHandle, kind: string) {
  return owner.today().sections.find((section) => section.kind === kind)?.cards ?? [];
}

/** The pact's terms as they stand, with `change` made, as the Request change form sends them. */
function changed(owner: AccountHandle, pactId: string, change: Partial<PactChange>): PactChange {
  const pact = pactOf(owner, pactId);
  return {
    name: pact.name,
    description: pact.description,
    ...(pact.dueBy !== null && { dueBy: pact.dueBy }),
    reminders: pact.reminders,
    schedule: pact.schedule,
    penaltyCents: pact.penaltyCents,
    recipientId: pact.recipient.id,
    reviewerIds: pact.reviewers.map((r) => r.id),
    ...change,
  };
}

/** Past the edit window, so changes follow the rules for an Active pact. */
async function pastEditWindow(s: Scenario) {
  await s.advanceTo("Mon 09:11");
}

describe("making a One-time pact", () => {
  test("a deadline 30 minutes after creation is refused; one an hour away is fine", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    s.setClockTo("Thu 08:30");

    await expect(createPact("Dentist", oneTime(THURSDAY), { dates: { dueBy: "09:00" } })).rejects.toThrow(
      "deadline-too-soon",
    );
    expect(owner.firstOccurrence({ schedule: oneTime(THURSDAY), dueBy: "09:00" })).toEqual({
      ok: false,
      reason: "deadline-too-soon",
    });
    const dentist = await createPact("Dentist", oneTime(THURSDAY), { dates: { dueBy: "09:30" } });
    expect(pactOf(owner, dentist).firstOccurrence).toEqual({ date: THURSDAY, dueAt: s.at("Thu 09:30") });
  });

  test("its deadline is the due-by time on its date, or midnight ending it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);

    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));

    expect(pactOf(owner, taxes)).toMatchObject({
      schedule: oneTime(THURSDAY, true),
      dueBy: null,
      firstOccurrence: { date: THURSDAY, dueAt: s.at("Fri 00:00") },
    });
    expect(owner.firstOccurrence({ schedule: oneTime(THURSDAY), dueBy: "09:00" })).toEqual({
      ok: true,
      firstOccurrence: { date: THURSDAY, dueAt: s.at("Thu 09:00") },
    });
  });

  test("is Camera only, with a real date and no start or end date", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);
    const camera: NewPact = {
      evidenceKind: "camera",
      name: "Taxes",
      description: "The e-file confirmation",
      schedule: oneTime(THURSDAY),
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    };

    expect(
      await owner.createPact({ ...bedtimePact(sam.id, reviewer, "23:00", []), schedule: oneTime(THURSDAY) }),
    ).toEqual({
      ok: false,
      reason: "invalid-schedule",
    });
    expect(await owner.createPact({ ...camera, schedule: oneTime("Thursday") })).toEqual({
      ok: false,
      reason: "invalid-schedule",
    });
    expect(await owner.createPact({ ...camera, startDate: TUESDAY })).toEqual({
      ok: false,
      reason: "invalid-start-date",
    });
    expect(await owner.createPact({ ...camera, endDate: FRIDAY })).toEqual({ ok: false, reason: "invalid-end-date" });
    expect(await owner.createPact(camera)).toMatchObject({ ok: true });
  });

  test("in the edit window, a new deadline takes the evidence already submitted with it", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    const evidenceId = await submit(owner, taxes);

    const edited = await owner.editPact(taxes, {
      evidenceKind: "camera",
      name: "Taxes",
      description: "A photo of Taxes",
      schedule: oneTime(FRIDAY, true),
      penaltyCents: 500,
      recipientId: sam.id,
      reviewerIds: [reviewer.id],
    });

    expect(edited).toEqual({ ok: true });
    expect(owner.today().waiting).toEqual([
      expect.objectContaining({ kind: "evidence", id: evidenceId, occurrenceDate: FRIDAY }),
    ]);
    await s.advanceTo("Mon 09:11");
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Sat 00:00");
    expect(occurrenceOf(owner, taxes)).toMatchObject({ date: FRIDAY, occurrence: { status: { kind: "satisfied" } } });
  });
});

describe("Submit anytime off", () => {
  test("deadline Thursday: evidence on Tuesday is refused; on Thursday at 15:00, approved, it's Satisfied and the pact Ended", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(THURSDAY));

    s.setClockTo("Tue 10:00");
    expect(await owner.submitEvidence(dentist, [photo()])).toEqual({ ok: false, reason: "not-open" });
    s.setClockTo("Thu 15:00");
    const evidenceId = await submit(owner, dentist);
    await reviewer.decide(evidenceId, { kind: "approve" });
    expect(pactOf(owner, dentist).stage).toBe("active");
    await s.advanceTo("Fri 00:00");

    expect(occurrenceOf(owner, dentist)).toEqual({
      date: THURSDAY,
      occurrence: {
        status: { kind: "satisfied" },
        decidedBy: { kind: "evidence-approved", reviewerName: "reviewer" },
        recipientName: null,
      },
    });
    expect(pactOf(owner, dentist)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 00:00") });
    expect(owner.pacts()).toEqual([expect.objectContaining({ id: dentist, stage: "ended" })]);
    expect(owed(owner)).toBe(0);
  });

  test("deadline Thursday 09:00: evidence at 08:59 is accepted, at 09:01 refused; with none it's Missed at 09:00", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const early = await createPact("Early", oneTime(THURSDAY), { dates: { dueBy: "09:00" } });
    const late = await createPact("Late", oneTime(THURSDAY), { dates: { dueBy: "09:00" } });

    s.setClockTo("Thu 08:59");
    expect(await owner.submitEvidence(early, [photo()])).toMatchObject({ ok: true });
    s.setClockTo("Thu 09:01");
    expect(await owner.submitEvidence(late, [photo()])).toEqual({ ok: false, reason: "not-open" });
    await s.advanceTo("Thu 09:01");

    expect(occurrenceOf(owner, late).occurrence?.status).toEqual({
      kind: "missed",
      penaltyCents: 500,
      held: false,
      excusableUntil: new Date(s.at("Thu 09:00").getTime() + 2 * DAY_MS),
    });
    expect(pactOf(owner, late)).toMatchObject({ stage: "ended", endedAt: s.at("Thu 09:00") });
    // Waiting evidence holds the outcome: the pact stays Active until it's decided.
    expect(occurrenceOf(owner, early).occurrence?.status).toMatchObject({ kind: "not-judged", evidenceWaiting: true });
    expect(pactOf(owner, early).stage).toBe("active");
    expect(sectionCards(owner, "missed")).toEqual([
      expect.objectContaining({ pactId: late, occurrenceDate: THURSDAY, closed: { dueBy: "09:00" } }),
    ]);
  });
});

describe("Submit anytime on", () => {
  test("evidence three days before the deadline, approved, is Satisfied at the deadline and the pact Ended", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));

    await s.advanceTo("Mon 10:00");
    const evidenceId = await submit(owner, taxes);
    expect(owner.today().waiting).toEqual([
      expect.objectContaining({ kind: "evidence", id: evidenceId, occurrenceDate: THURSDAY }),
    ]);
    await reviewer.decide(evidenceId, { kind: "approve" });
    expect(await owner.submitEvidence(taxes, [photo(2)])).toEqual({ ok: false, reason: "already-approved" });
    await s.advanceTo("Thu 23:00");
    expect(pactOf(owner, taxes).stage).toBe("active");
    await s.advanceTo("Fri 00:00");

    expect(occurrenceOf(owner, taxes).occurrence?.status).toEqual({ kind: "satisfied" });
    expect(pactOf(owner, taxes)).toMatchObject({ stage: "ended", endedAt: s.at("Fri 00:00") });
  });

  test("the due-by time limits only the deadline's date", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true), { dates: { dueBy: "09:00" } });
    const forms = await createPact("Forms", oneTime(THURSDAY, true), { dates: { dueBy: "09:00" } });

    s.setClockTo("Tue 22:00");
    expect(await owner.submitEvidence(taxes, [photo()])).toMatchObject({ ok: true });
    s.setClockTo("Thu 09:00");
    expect(await owner.submitEvidence(forms, [photo()])).toEqual({ ok: false, reason: "not-open" });
  });
});

describe("judging", () => {
  test.each([false, true])(
    "no evidence by the deadline: Missed, with its penalty owed (Submit anytime %s)",
    async (submitAnytime) => {
      const s = scenario();
      const { owner, createPact } = await ownerWithReviewers(s);
      const taxes = await createPact("Taxes", oneTime(THURSDAY, submitAnytime));

      await s.advanceTo("Fri 00:00");

      expect(occurrenceOf(owner, taxes).occurrence?.status).toMatchObject({ kind: "missed", penaltyCents: 500 });
      expect(owed(owner)).toBe(500);
      expect(pactOf(owner, taxes).stage).toBe("ended");
      expect(s.notifier.sentTo(owner).filter((n) => n.kind === "missed-occurrence")).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ occurrenceDate: THURSDAY, body: "Thu Jan 8 · $5 to Sam" }),
        }),
      ]);
      // Missed in the last 48 hours, it's on Today though the pact has Ended.
      expect(sectionCards(owner, "missed")).toEqual([expect.objectContaining({ pactId: taxes })]);
    },
  );

  test("evidence rejected before the deadline: Missed at once, its penalty owed, and new evidence is refused", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    s.setClockTo("Tue 10:00");

    await reviewer.decide(await submit(owner, taxes), { kind: "reject", reason: "That's last year's return" });

    expect(occurrenceOf(owner, taxes).occurrence).toMatchObject({
      status: { kind: "missed", penaltyCents: 500 },
      decidedBy: { kind: "evidence-rejected", reviewerName: "reviewer", reason: "That's last year's return" },
    });
    expect(owed(owner)).toBe(500);
    expect(pactOf(owner, taxes)).toMatchObject({ stage: "ended", endedAt: s.at("Tue 10:00") });
    expect(owner.today().alerts).toEqual([
      expect.objectContaining({ kind: "evidence-rejected", pactId: taxes, occurrenceDate: THURSDAY }),
    ]);
    expect(await owner.submitEvidence(taxes, [photo(2)])).toEqual({ ok: false, reason: "already-judged" });
    await s.advanceTo("Fri 00:00");
    expect(owed(owner)).toBe(500);
  });

  test("a Missed occurrence can be excused within 48 hours, and Yesterday shows it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(THURSDAY));
    await s.advanceTo("Fri 10:00");

    expect(owner.today().yesterday).toEqual([expect.objectContaining({ pactId: dentist, occurrenceDate: THURSDAY })]);
    const filed = await owner.fileExcuse(
      dentist,
      { from: THURSDAY, to: THURSDAY, reason: "The dentist cancelled" },
      [],
    );
    if (!filed.ok) throw new Error(filed.reason);
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    expect(occurrenceOf(owner, dentist).occurrence?.status).toEqual({ kind: "excused" });
    expect(owed(owner)).toBe(0);
  });

  test("with Submit anytime, an excuse filed on any day before the deadline covers the occurrence", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await s.advanceTo("Tue 10:00");

    const filed = await owner.fileExcuse(taxes, { from: TUESDAY, to: TUESDAY, reason: "The forms never came" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    expect(sectionCards(owner, "to-do")).toEqual([]);
    await reviewer.decide(filed.excuseId, { kind: "approve" });
    await s.advanceTo("Fri 00:00");

    expect(occurrenceOf(owner, taxes).occurrence?.status).toEqual({ kind: "excused" });
    expect(pactOf(owner, taxes).stage).toBe("ended");
    expect(owed(owner)).toBe(0);
  });
});

describe("Today", () => {
  test("Submit anytime off: Coming up before its date, then To do on it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(THURSDAY));
    await s.advanceTo("Wed 10:00");

    expect(owner.today().sections).toEqual([
      {
        kind: "coming-up",
        cards: [
          {
            pactId: dentist,
            name: "Dentist",
            penaltyCents: 500,
            editWindowClosesAt: null,
            opensOn: THURSDAY,
            startDate: null,
          },
        ],
      },
    ]);
    await s.advanceTo("Thu 10:00");
    expect(owner.today().sections).toEqual([
      {
        kind: "to-do",
        cards: [
          {
            kind: "evidence",
            pactId: dentist,
            name: "Dentist",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: THURSDAY,
            dueAt: s.at("Fri 00:00"),
            dueBy: null,
          },
        ],
      },
    ]);
  });

  test("Submit anytime on: To do from creation, below things due today", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    // Named to come after Taxes, so only the sort by due time puts it first.
    const walk = await createPact("Walk", MON_WED_FRI);

    expect(sectionCards(owner, "to-do").map((card) => ("pactId" in card ? card.pactId : null))).toEqual([walk, taxes]);
    expect(sectionCards(owner, "to-do")[1]).toMatchObject({ occurrenceDate: THURSDAY, dueAt: s.at("Fri 00:00") });
  });
});

describe("reminders", () => {
  test("each has its own date and time and fires once, unless evidence was already submitted", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const reminders = [`${SATURDAY}T09:00`];
    const taxes = await createPact("Taxes", oneTime(THURSDAY_1, true), { reminders });
    const forms = await createPact("Forms", oneTime(THURSDAY_1, true), { reminders });
    await s.advanceTo("Fri 10:00");
    await submit(owner, forms);

    await s.advanceTo("Sat 09:00");
    await s.advanceTo("Sun 09:00");
    await s.advanceTo("Sat+1 09:00");

    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "reminder")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          pactId: taxes,
          occurrenceDate: THURSDAY_1,
          body: "No photo yet. Due Thu Jan 15 at midnight.",
        }),
      }),
    ]);
    expect(pactOf(owner, taxes).reminders).toEqual(reminders);
  });

  test("a reminder at or after the deadline, or with no date, is refused", async () => {
    const s = scenario();
    const { createPact } = await ownerWithReviewers(s);

    await expect(
      createPact("Taxes", oneTime(THURSDAY), { dates: { dueBy: "17:00" }, reminders: [`${THURSDAY}T17:00`] }),
    ).rejects.toThrow("reminder-after-due-time");
    await expect(createPact("Taxes", oneTime(THURSDAY), { reminders: ["09:00"] })).rejects.toThrow("invalid-reminders");
  });
});

describe("changing a One-time pact", () => {
  test("turning Submit anytime on needs approval; turning it off applies at once, and evidence already submitted still counts", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(THURSDAY));
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await pastEditWindow(s);

    expect(
      await owner.changePact(dentist, changed(owner, dentist, { schedule: oneTime(THURSDAY, true) })),
    ).toMatchObject({
      ok: true,
      outcome: { kind: "needs-approval" },
    });
    expect(pactOf(owner, dentist).schedule).toEqual(oneTime(THURSDAY));

    const evidenceId = await submit(owner, taxes);
    expect(await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(THURSDAY) }))).toMatchObject({
      ok: true,
      outcome: { kind: "stricter", appliesFrom: THURSDAY, todayKeepsCents: null },
    });
    expect(pactOf(owner, taxes)).toMatchObject({ schedule: oneTime(THURSDAY), newTerms: null });
    await reviewer.decide(evidenceId, { kind: "approve" });
    await s.advanceTo("Fri 00:00");
    expect(occurrenceOf(owner, taxes).occurrence?.status).toEqual({ kind: "satisfied" });
  });

  test("Submit anytime off: moving the date earlier or later needs approval", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(THURSDAY));
    await pastEditWindow(s);

    for (const deadline of [TUESDAY, FRIDAY]) {
      expect(owner.changePreview(dentist, changed(owner, dentist, { schedule: oneTime(deadline) }))).toEqual({
        ok: true,
        preview: {
          changes: [
            { term: "schedule", before: oneTime(THURSDAY), after: oneTime(deadline), effect: "needs-approval" },
          ],
          outcome: { kind: "needs-approval", reviewerNames: ["reviewer", "second"], bundlesStricter: false },
        },
      });
    }
  });

  test("Submit anytime on: an earlier deadline is stricter, a later one needs approval; due-by times follow the usual rule", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await pastEditWindow(s);

    const effect = (change: Partial<PactChange>) => {
      const preview = owner.changePreview(taxes, changed(owner, taxes, change));
      if (!preview.ok) throw new Error(preview.reason);
      return preview.preview.changes.map((c) => `${c.term}: ${c.effect}`);
    };
    expect(effect({ schedule: oneTime(TUESDAY, true) })).toEqual(["schedule: stricter"]);
    expect(effect({ schedule: oneTime(FRIDAY, true) })).toEqual(["schedule: needs-approval"]);
    expect(effect({ dueBy: "17:00" })).toEqual(["due-by: stricter"]);
  });

  test("an approved later deadline applies to the open occurrence, and the evidence already submitted counts for it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    const forms = await createPact("Forms", oneTime(THURSDAY, true));
    await s.advanceTo("Tue 10:00");
    const filed = await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(SATURDAY, true) }));
    if (!filed.ok || filed.outcome.kind !== "needs-approval") throw new Error("not sent");
    expect(reviewer.reviewQueue()).toEqual([
      expect.objectContaining({ kind: "change-request", appliesFrom: SATURDAY, todayKeepsCents: null }),
    ]);

    await reviewer.decide(filed.outcome.changeRequestId, { kind: "approve" });
    expect(s.notifier.sentTo(owner).find((n) => n.kind === "change-request-decided")?.payload.body).toBe(
      "Taxes · New terms start Sat Jan 10",
    );
    const evidenceId = await submit(owner, forms);
    const moved = await owner.changePact(forms, changed(owner, forms, { schedule: oneTime(SATURDAY, true) }));
    if (!moved.ok || moved.outcome.kind !== "needs-approval") throw new Error("not sent");
    await reviewer.decide(moved.outcome.changeRequestId, { kind: "approve" });
    expect(owner.today().waiting).toEqual([
      expect.objectContaining({ kind: "evidence", id: evidenceId, occurrenceDate: SATURDAY }),
    ]);
    await s.advanceTo("Fri 10:00");

    expect(pactOf(owner, taxes)).toMatchObject({
      stage: "active",
      schedule: oneTime(SATURDAY, true),
      firstOccurrence: { date: SATURDAY, dueAt: s.at("Sun 00:00") },
      newTerms: null,
    });
    expect(owed(owner)).toBe(0);
    await s.advanceTo("Sun 00:00");
    expect(occurrenceOf(owner, taxes)).toMatchObject({
      date: SATURDAY,
      occurrence: { status: { kind: "missed", penaltyCents: 500 } },
    });
    await reviewer.decide(evidenceId, { kind: "approve" });
    expect(occurrenceOf(owner, forms)).toMatchObject({ date: SATURDAY, occurrence: { status: { kind: "satisfied" } } });
  });

  test("an earlier deadline under an hour away is refused; one further off applies at once", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(FRIDAY, true));
    const forms = await createPact("Forms", oneTime(FRIDAY, true));
    await s.advanceTo("Thu 22:00");

    expect(await owner.changePact(forms, changed(owner, forms, { schedule: oneTime(THURSDAY, true) }))).toMatchObject({
      ok: true,
      outcome: { kind: "stricter" },
    });
    s.setClockTo("Thu 23:30");
    expect(await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(THURSDAY, true) }))).toEqual({
      ok: false,
      reason: "deadline-too-soon",
    });
    await s.advanceTo("Fri 00:00");
    expect(occurrenceOf(owner, forms)).toMatchObject({ date: THURSDAY, occurrence: { status: { kind: "missed" } } });
    expect(pactOf(owner, taxes)).toMatchObject({ stage: "active", schedule: oneTime(FRIDAY, true) });
  });

  test("approving a new deadline that's less than an hour away by then is refused; it can still be rejected", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const dentist = await createPact("Dentist", oneTime(FRIDAY));
    await pastEditWindow(s);
    const sent = await owner.changePact(dentist, changed(owner, dentist, { schedule: oneTime(THURSDAY) }));
    if (!sent.ok || sent.outcome.kind !== "needs-approval") throw new Error("not sent");

    s.setClockTo("Thu 23:30");
    expect(await reviewer.decide(sent.outcome.changeRequestId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "deadline-too-soon",
    });
    expect(await reviewer.decide(sent.outcome.changeRequestId, { kind: "reject", reason: "Too late" })).toEqual({
      ok: true,
    });
    expect(pactOf(owner, dentist).schedule).toEqual(oneTime(FRIDAY));
  });

  test("a change request still waiting when the occurrence is judged is withdrawn, and the Ended pact stays as it was", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await pastEditWindow(s);
    const sent = await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(SATURDAY, true) }));
    if (!sent.ok || sent.outcome.kind !== "needs-approval") throw new Error("not sent");
    await s.advanceTo("Fri 00:00");

    expect(reviewer.reviewQueue()).toEqual([]);
    expect(await reviewer.decide(sent.outcome.changeRequestId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "item-not-found",
    });

    expect(pactOf(owner, taxes)).toMatchObject({ stage: "ended", schedule: oneTime(THURSDAY, true), waiting: [] });
    expect(occurrenceOf(owner, taxes)).toMatchObject({ date: THURSDAY, occurrence: { status: { kind: "missed" } } });
    expect(s.notifier.sentTo(owner).filter((n) => n.kind === "change-request-decided")).toEqual([]);
  });

  test("a later deadline approved after the old one passed, before the scheduler's tick, doesn't rescue it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await pastEditWindow(s);
    const sent = await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(SATURDAY, true) }));
    if (!sent.ok || sent.outcome.kind !== "needs-approval") throw new Error("not sent");
    s.setClockTo("Fri 00:00");

    expect(await reviewer.decide(sent.outcome.changeRequestId, { kind: "approve" })).toEqual({
      ok: false,
      reason: "item-not-found",
    });

    expect(pactOf(owner, taxes)).toMatchObject({ stage: "ended", schedule: oneTime(THURSDAY, true) });
    expect(occurrenceOf(owner, taxes)).toMatchObject({ date: THURSDAY, occurrence: { status: { kind: "missed" } } });
    expect(owed(owner)).toBe(500);
  });

  test("its change request's push names the deadline", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await pastEditWindow(s);

    await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(SATURDAY, true) }));

    expect(s.notifier.sentTo(reviewer).find((n) => n.payload.itemKind === "change-request")?.payload.body).toBe(
      "Deadline",
    );
  });

  test("a raised penalty applies to the occurrence even once it's open", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await s.advanceTo("Tue 10:00");

    expect(await owner.changePact(taxes, changed(owner, taxes, { penaltyCents: 900 }))).toMatchObject({
      ok: true,
      outcome: { kind: "stricter", appliesFrom: THURSDAY, todayKeepsCents: null },
    });
    await s.advanceTo("Fri 00:00");

    expect(owed(owner)).toBe(900);
  });

  test("can't become a recurring schedule, nor take a start or end date", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    const gym = await createPact("Gym", MON_WED_FRI);
    await pastEditWindow(s);

    expect(
      await owner.changePact(taxes, changed(owner, taxes, { schedule: { kind: "fixed-days", days: ["fri"] } })),
    ).toEqual({
      ok: false,
      reason: "schedule-kind-fixed",
    });
    expect(await owner.changePact(gym, changed(owner, gym, { schedule: oneTime(THURSDAY) }))).toEqual({
      ok: false,
      reason: "schedule-kind-fixed",
    });
    expect(await owner.changePact(taxes, changed(owner, taxes, { endDate: FRIDAY }))).toEqual({
      ok: false,
      reason: "invalid-end-date",
    });
  });

  test("once judged it's Ended, and can't be changed", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithReviewers(s);
    const taxes = await createPact("Taxes", oneTime(THURSDAY, true));
    await s.advanceTo("Fri 00:00");

    expect(await owner.changePact(taxes, changed(owner, taxes, { schedule: oneTime(SATURDAY, true) }))).toEqual({
      ok: false,
      reason: "pact-ended",
    });
  });
});
