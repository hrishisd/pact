// Anki pacts: connecting AnkiWeb, creating a pact on a deck, and judging
// each Anki day from AnkiWeb's counts. A day is Satisfied at the first check
// that finds its deck finished (New, Learn and Due all 0) for that Anki day,
// evaluated before its due time, and Missed at its due time without one.
// AnkiWeb is checked every 10 minutes per account while a day is open and
// not judged, before the tick's write transaction.
//
// The scenarios' Anki days start at 4am (the fake's rollover hour), in New
// York, the scenario's timezone.

import { describe, expect, test } from "vitest";
import { WEEKDAYS } from "../shared/types.ts";
import { ankiPact, ownerWithAnki, SPANISH } from "./testing/anki-pact.ts";
import { failOnCall } from "./testing/fakes.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";

const TUE = "2026-01-06";
const WED = "2026-01-07";
const ITALIAN = "1700000000002";

/** The day `date` as the pact's heat map shows it. */
function day(owner: AccountHandle, pactId: string, date: string) {
  const result = owner.pact(pactId);
  if (!result.ok) throw new Error(result.reason);
  const { history } = result.pact;
  if (history.kind !== "fixed-days") throw new Error(`a ${history.kind} heat map`);
  return history.days.find((d) => d.date === date)?.occurrence;
}

function status(owner: AccountHandle, pactId: string, date: string) {
  return day(owner, pactId, date)?.status.kind;
}

function toDo(owner: AccountHandle) {
  return owner.today().sections.find((section) => section.kind === "to-do")?.cards ?? [];
}

function missedCards(owner: AccountHandle) {
  return owner.today().sections.find((section) => section.kind === "missed")?.cards ?? [];
}

describe("connecting AnkiWeb", () => {
  test("Profile lists the connection once the owner connects", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    s.setClockTo("Mon 09:30");
    await owner.connectAnki();
    expect(owner.profile().connections).toEqual([
      { service: "anki", status: "connected", connectedAt: s.at("Mon 09:30"), activePacts: 0 },
    ]);
  });

  test("the deck list comes from AnkiWeb, with the rollover hour", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    expect(await owner.ankiDecks()).toEqual({ ok: false, reason: "not-connected" });
    await owner.connectAnki();
    s.ankiSource.setDeck(owner.id, { id: "1", name: "Spanish", review: 30, new: 10, learn: 2 });
    s.ankiSource.setDeck(owner.id, { id: "2", name: "Spanish::Verbs", parentId: "1" });
    expect(await owner.ankiDecks()).toEqual({
      ok: true,
      rolloverHour: 4,
      decks: [
        { id: "1", name: "Spanish", parentId: null, counts: { new: 10, learn: 2, review: 30 } },
        { id: "2", name: "Spanish::Verbs", parentId: "1", counts: { new: 0, learn: 0, review: 0 } },
      ],
    });
  });

  test("an AnkiWeb that can't be reached, or refuses the login, gives no deck list", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.connectAnki();
    failOnCall(s.ankiSource, "decks", 1);
    expect(await owner.ankiDecks()).toEqual({ ok: false, reason: "unreachable" });
    s.ankiSource.disconnect(owner.id);
    expect(await owner.ankiDecks()).toEqual({ ok: false, reason: "disconnected" });
  });
});

describe("creating an Anki pact", () => {
  test("needs an AnkiWeb connection", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");
    const reviewer = await s.befriend(owner, "reviewer");
    const added = await owner.addRecipient({ name: "Sam" });
    if (!added.ok) throw new Error(added.reason);
    expect(await owner.createPact(ankiPact(added.recipient.id, reviewer))).toEqual({
      ok: false,
      reason: "anki-not-connected",
    });
  });

  test("needs a deck from the owner's deck list", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    for (const ankiDeckId of [undefined, "", "999"]) {
      expect(await owner.createPact({ ...ankiPact(sam.id, reviewer), ankiDeckId })).toEqual({
        ok: false,
        reason: "unknown-deck",
      });
    }
  });

  test("is on Fixed days only", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    for (const schedule of [
      { kind: "weekly-count" as const, target: 3 },
      { kind: "one-time" as const, deadline: TUE, submitAnytime: false },
    ]) {
      expect(await owner.createPact({ ...ankiPact(sam.id, reviewer), schedule })).toEqual({
        ok: false,
        reason: "invalid-schedule",
      });
    }
  });

  test("takes a due-by time from noon through the rollover hour", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    for (const dueBy of ["12:00", "22:00", "23:59", "00:30", "04:00"]) {
      expect(await owner.createPact(ankiPact(sam.id, reviewer, { dueBy }))).toMatchObject({ ok: true });
    }
    for (const dueBy of ["04:01", "09:00", "11:59", "00:00", "25:00"]) {
      expect(await owner.createPact(ankiPact(sam.id, reviewer, { dueBy }))).toEqual({
        ok: false,
        reason: "invalid-due-by",
      });
    }
  });

  test("its pact page names the deck and the rollover hour, and it has no description", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ dueBy: "01:00" });
    const result = owner.pact(pactId);
    if (!result.ok) throw new Error(result.reason);
    expect(result.pact).toMatchObject({
      evidenceKind: "anki",
      description: "",
      dueBy: "01:00",
      inBedBy: null,
      anki: { deckId: SPANISH, deckName: "Spanish", rolloverHour: 4 },
    });
    expect(owner.profile().connections).toEqual([expect.objectContaining({ service: "anki", activePacts: 1 })]);
  });

  test("an Anki day opens at the rollover hour, and a due-by time after midnight is the morning after", async () => {
    const s = scenario();
    const { owner } = await ownerWithAnki(s);
    expect(
      owner.firstOccurrence({ evidenceKind: "anki", schedule: { kind: "fixed-days", days: ["tue"] }, dueBy: "02:00" }),
    ).toEqual({ ok: true, firstOccurrence: { date: TUE, dueAt: s.at("Wed 02:00") } });
    expect(owner.firstOccurrence({ evidenceKind: "anki", schedule: { kind: "fixed-days", days: ["tue"] } })).toEqual({
      ok: true,
      firstOccurrence: { date: TUE, dueAt: s.at("Wed 00:00") },
    });
  });
});

describe("judging an Anki day", () => {
  test("a finished deck satisfies the day at once, and a learning card back later doesn't change it", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    deckShows({}, TUE, "Tue 21:05");
    await s.advanceTo("Tue 21:10");
    expect(status(owner, pactId, TUE)).toBe("satisfied");
    expect(toDo(owner)).toEqual([]);

    deckShows({ learn: 1 }, TUE, "Tue 22:25");
    await owner.checkAnki();
    await s.advanceTo("Tue 22:30");
    await s.advanceTo("Wed 00:00");
    expect(day(owner, pactId, TUE)).toMatchObject({
      status: { kind: "satisfied" },
      anki: { cardsLeft: 0, checkedAt: s.at("Tue 21:10") },
    });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("a deck not finished by the due time is Missed then, with the last check's count", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    deckShows({ new: 2, learn: 1, review: 9 }, TUE, "Tue 23:45");
    await s.advanceTo("Tue 23:50");
    expect(status(owner, pactId, TUE)).toBe("not-judged");
    await s.advanceTo("Wed 00:00");

    expect(status(owner, pactId, TUE)).toBe("missed");
    expect(missedCards(owner)).toEqual([
      expect.objectContaining({
        pactId,
        occurrenceDate: TUE,
        missedAt: s.at("Wed 00:00"),
        anki: { cardsLeft: 12, checkedAt: s.at("Tue 23:50") },
      }),
    ]);
    expect(s.notifier.sentTo(owner).map((n) => n.payload.title)).toContain("Spanish is Missed");
  });

  test("a finished deck on the next morning's clock still counts for the Anki day it's for, not the next", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue", "wed"], dueBy: "03:00" });

    // 02:00 on Wednesday is still Tuesday's Anki day.
    deckShows({}, TUE, "Wed 01:55");
    await s.advanceTo("Wed 02:00");
    expect(status(owner, pactId, TUE)).toBe("satisfied");
    expect(status(owner, pactId, WED)).toBe("not-judged");
  });

  test("a check for the day before doesn't satisfy today", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["wed"] });

    // The collection hasn't been opened since Tuesday's Anki day: its counts are Tuesday's.
    deckShows({}, TUE, "Tue 23:00");
    await s.advanceTo("Wed 05:00");
    expect(status(owner, pactId, WED)).toBe("not-judged");
  });

  test("counts evaluated after the due time don't satisfy the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"], dueBy: "22:00" });

    deckShows({}, TUE, "Tue 22:01");
    await s.advanceTo("Tue 21:59");
    await s.advanceTo("Tue 22:00");
    expect(status(owner, pactId, TUE)).toBe("missed");
    expect(day(owner, pactId, TUE)?.anki).toEqual({ cardsLeft: null, checkedAt: null });
  });

  test("a day no check reached AnkiWeb for is Missed, as not reached", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    for (let n = 1; n <= 30; n++) failOnCall(s.ankiSource, "deckCounts", 1);

    await s.advanceTo("Tue 04:00");
    await s.advanceTo("Tue 23:50");
    await s.advanceTo("Wed 00:00");

    expect(status(owner, pactId, TUE)).toBe("missed");
    expect(missedCards(owner)).toEqual([expect.objectContaining({ anki: { cardsLeft: null, checkedAt: null } })]);
  });

  test("with nothing due and no answers yet, the first check satisfies the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    // No answers on Tuesday yet: the counts are evaluated at the check itself.
    deckShows({}, TUE, "Tue 04:00");
    await s.advanceTo("Tue 04:00");
    expect(status(owner, pactId, TUE)).toBe("satisfied");
  });

  test("a day an approved excuse covers is Excused at its due time, unless the deck is finished first", async () => {
    const s = scenario();
    const { owner, reviewer, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue", "wed"] });
    await s.advanceTo("Mon 09:11");
    const filed = await owner.fileExcuse(pactId, { from: TUE, to: WED, reason: "Travelling" }, []);
    if (!filed.ok) throw new Error(filed.reason);
    expect(await reviewer.decide(filed.excuseId, { kind: "approve" })).toEqual({ ok: true });

    deckShows({ review: 5 }, TUE, "Tue 22:00");
    await s.advanceTo("Tue 22:00");
    await s.advanceTo("Wed 00:00");
    expect(status(owner, pactId, TUE)).toBe("excused");

    deckShows({}, WED, "Wed 20:00");
    await s.advanceTo("Wed 20:00");
    expect(status(owner, pactId, WED)).toBe("satisfied");
  });
});

describe("checking AnkiWeb", () => {
  test("an account with an Anki day open is checked every 10 minutes, and not once the day is judged", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    await createPact({ days: ["tue", "wed"] });
    const calls = () => s.ankiSource.countCalls.length;

    // Before Tuesday's Anki day opens, nothing waits.
    await s.advanceTo("Tue 03:59");
    expect(calls()).toBe(0);

    deckShows({ review: 42 }, TUE, "Tue 04:00");
    for (let minute = 0; minute < 30; minute++) {
      await s.advanceTo(`Tue 04:${String(minute).padStart(2, "0")}`);
    }
    expect(calls()).toBe(3);
    expect(s.ankiSource.countCalls[0]).toEqual({ account: owner.id, deckIds: [SPANISH] });

    deckShows({}, TUE, "Tue 04:29");
    await s.advanceTo("Tue 04:30");
    expect(calls()).toBe(4);
    await s.advanceTo("Tue 05:00");
    await s.advanceTo("Tue 23:00");
    await s.advanceTo("Wed 03:59");
    expect(calls()).toBe(4);

    // Wednesday's Anki day opens.
    deckShows({ review: 42 }, WED, "Wed 04:00");
    await s.advanceTo("Wed 04:00");
    expect(calls()).toBe(5);
  });

  test("an account with no Anki pact is never checked", async () => {
    const s = scenario();
    await ownerWithAnki(s);
    await s.advanceTo("Tue 04:00");
    await s.advanceTo("Tue 12:00");
    expect(s.ankiSource.countCalls).toEqual([]);
  });

  test("check now is ignored less than 15 seconds after the last check", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    await createPact({ days: ["tue"] });
    deckShows({ review: 42 }, TUE, "Tue 20:00");

    s.setClockTo("Tue 20:00");
    await owner.checkAnki();
    s.clock.set(new Date(s.at("Tue 20:00").getTime() + 10_000));
    await owner.checkAnki();
    expect(s.ankiSource.countCalls).toHaveLength(1);
    s.clock.set(new Date(s.at("Tue 20:00").getTime() + 26_000));
    await owner.checkAnki();
    expect(s.ankiSource.countCalls).toHaveLength(2);
  });

  test("check now does nothing while no Anki day waits", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    await createPact({ days: ["tue"] });
    s.setClockTo("Mon 20:00");
    await owner.checkAnki();
    expect(s.ankiSource.countCalls).toEqual([]);
  });

  test("two Anki pacts on one account share one check per tick", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    s.ankiSource.setDeck(owner.id, { id: ITALIAN, name: "Italian" });
    await owner.ankiDecks();
    const spanish = await createPact({ days: ["tue"] });
    const italian = await createPact({ days: ["tue"], ankiDeckId: ITALIAN, name: "Italian" });

    deckShows({ review: 3 }, TUE, "Tue 20:00");
    await s.advanceTo("Tue 20:00");
    expect(s.ankiSource.countCalls).toEqual([{ account: owner.id, deckIds: [SPANISH, ITALIAN] }]);
    expect(status(owner, spanish, TUE)).toBe("not-judged");
    expect(status(owner, italian, TUE)).toBe("satisfied");
  });

  test("a failed check is logged, judges nothing, and is tried again on the next tick", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    deckShows({}, TUE, "Tue 20:00");

    failOnCall(s.ankiSource, "deckCounts", 1, new Error("AnkiWeb timed out"));
    await s.advanceTo("Tue 20:00");
    expect(status(owner, pactId, TUE)).toBe("not-judged");
    expect(s.logs).toContainEqual(expect.stringContaining("AnkiWeb timed out"));

    // The failed call never reached the fake; the retry, a minute later, did.
    await s.advanceTo("Tue 20:01");
    expect(s.ankiSource.countCalls).toHaveLength(1);
    expect(status(owner, pactId, TUE)).toBe("satisfied");
  });
});

describe("Today", () => {
  test("an open Anki day shows the cards left as of the last check, until the deck is finished", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    await s.advanceTo("Tue 03:00");
    expect(toDo(owner)).toEqual([]);

    s.setClockTo("Tue 04:00");
    expect(toDo(owner)).toEqual([
      {
        kind: "anki",
        pactId,
        name: "Spanish",
        penaltyCents: 500,
        editWindowClosesAt: null,
        occurrenceDate: TUE,
        dueAt: s.at("Wed 00:00"),
        dueBy: null,
        deckName: "Spanish",
        lastCheck: null,
      },
    ]);

    deckShows({ new: 10, learn: 2, review: 30 }, TUE, "Tue 21:00");
    await s.advanceTo("Tue 21:10");
    expect(toDo(owner)).toEqual([
      expect.objectContaining({ kind: "anki", lastCheck: { cardsLeft: 42, checkedAt: s.at("Tue 21:10") } }),
    ]);

    deckShows({}, TUE, "Tue 21:30");
    await s.advanceTo("Tue 21:30");
    expect(toDo(owner)).toEqual([]);
    s.setClockTo("Wed 12:00");
    expect(owner.today().yesterday).toEqual([
      expect.objectContaining({ pactId, evidenceKind: "anki", occurrenceDate: TUE }),
    ]);
  });

  test("an Anki day is still open past midnight when it's due later", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    await createPact({ days: ["tue"], dueBy: "02:00" });
    s.setClockTo("Wed 01:00");
    expect(toDo(owner)).toEqual([expect.objectContaining({ occurrenceDate: TUE, dueAt: s.at("Wed 02:00") })]);
  });
});

describe("reminders", () => {
  test("a reminder goes off while the deck isn't finished, with the cards left at the last check", async () => {
    const s = scenario();
    const { owner, reviewer, sam, deckShows } = await ownerWithAnki(s);
    const created = await owner.createPact({
      ...ankiPact(sam.id, reviewer, { days: ["tue", "wed"] }),
      reminders: ["21:00"],
    });
    if (!created.ok) throw new Error(created.reason);

    deckShows({ new: 10, review: 32 }, TUE, "Tue 20:50");
    await s.advanceTo("Tue 20:50");
    await s.advanceTo("Tue 21:00");
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "reminder");
    expect(reminders().map((n) => [n.payload.title, n.payload.body])).toEqual([
      ["Spanish", "42 cards left, due at midnight"],
    ]);

    // Finished at 20:30 on Wednesday: nothing to remind.
    deckShows({}, WED, "Wed 20:25");
    await s.advanceTo("Wed 20:30");
    await s.advanceTo("Wed 21:00");
    expect(reminders()).toHaveLength(1);
  });

  test("a reminder after midnight goes off the morning after, and must be before the due time", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    const pact = ankiPact(sam.id, reviewer, { days: ["tue"], dueBy: "02:00" });
    expect(await owner.createPact({ ...pact, reminders: ["02:30"] })).toEqual({
      ok: false,
      reason: "reminder-after-due-time",
    });
    const created = await owner.createPact({ ...pact, reminders: ["23:00", "01:30"] });
    if (!created.ok) throw new Error(created.reason);
    const result = owner.pact(created.pactId);
    expect(result.ok && result.pact.reminders).toEqual(["23:00", "01:30"]);

    await s.advanceTo("Tue 23:00");
    await s.advanceTo("Wed 01:30");
    expect(
      s.notifier
        .sentTo(owner)
        .filter((n) => n.kind === "reminder")
        .map((n) => n.payload.body),
    ).toEqual(["Due at 2:00am. Not checked yet.", "Due at 2:00am. Not checked yet."]);
  });
});

describe("the edit window", () => {
  test("keeps the evidence kind, and takes a due-by time only through the rollover hour", async () => {
    const s = scenario();
    const { owner, reviewer, sam, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    expect(await owner.editPact(pactId, { ...ankiPact(sam.id, reviewer), evidenceKind: "camera" })).toEqual({
      ok: false,
      reason: "evidence-kind-fixed",
    });
    expect(await owner.editPact(pactId, ankiPact(sam.id, reviewer, { dueBy: "04:30" }))).toEqual({
      ok: false,
      reason: "invalid-due-by",
    });
    expect(await owner.editPact(pactId, ankiPact(sam.id, reviewer, { dueBy: "03:30" }))).toEqual({ ok: true });
    const result = owner.pact(pactId);
    expect(result.ok && result.pact.dueBy).toBe("03:30");
  });
});

describe("a rollover hour after noon", () => {
  test("a due-by time before the rollover hour is the next day's, and one after it is that day's", async () => {
    const s = scenario();
    s.ankiSource.rolloverHour = 14;
    const { owner, createPact } = await ownerWithAnki(s);
    const tuesday = (dueBy: string) =>
      owner.firstOccurrence({ evidenceKind: "anki", schedule: { kind: "fixed-days", days: ["tue"] }, dueBy });
    expect(tuesday("13:00")).toEqual({ ok: true, firstOccurrence: { date: TUE, dueAt: s.at("Wed 13:00") } });
    expect(tuesday("14:00")).toEqual({ ok: true, firstOccurrence: { date: TUE, dueAt: s.at("Wed 14:00") } });
    expect(tuesday("14:30")).toEqual({ ok: true, firstOccurrence: { date: TUE, dueAt: s.at("Tue 14:30") } });

    // Due at 13:00, Tuesday's Anki day, open from 14:00, is still to do on Wednesday morning.
    await createPact({ days: ["tue"], dueBy: "13:00" });
    s.setClockTo("Wed 12:00");
    expect(toDo(owner)).toEqual([expect.objectContaining({ occurrenceDate: TUE, dueAt: s.at("Wed 13:00") })]);
  });
});

describe("changing an Anki pact after its edit window", () => {
  /** A daily Spanish pact due by `dueBy` (or midnight), and a way to change its due-by time on Tuesday. */
  async function dailySpanish(s: Scenario, dueBy?: string) {
    const { owner, reviewer, sam, createPact } = await ownerWithAnki(s);
    const pactId = await createPact(dueBy === undefined ? {} : { dueBy });
    await s.advanceTo("Tue 09:00");
    return (newDueBy: string) =>
      owner.changePact(pactId, {
        name: "Spanish",
        description: "",
        dueBy: newDueBy,
        schedule: { kind: "fixed-days", days: [...WEEKDAYS] },
        penaltyCents: 500,
        recipientId: sam.id,
        reviewerIds: [reviewer.id],
      });
  }

  test("moving the due-by time from midnight to 3am the morning after needs approval", async () => {
    const s = scenario();
    const changeDueBy = await dailySpanish(s);
    expect(await changeDueBy("03:00")).toMatchObject({ ok: true, outcome: { kind: "needs-approval" } });
  });

  test("moving the due-by time from 2am the morning after to 11pm is stricter", async () => {
    const s = scenario();
    const changeDueBy = await dailySpanish(s, "02:00");
    expect(await changeDueBy("23:00")).toMatchObject({ ok: true, outcome: { kind: "stricter" } });
  });
});

describe("a reminder from the rollover hour", () => {
  test("goes off that day: 9am, with the day due at midnight", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithAnki(s);
    const created = await owner.createPact({ ...ankiPact(sam.id, reviewer, { days: ["tue"] }), reminders: ["09:00"] });
    if (!created.ok) throw new Error(created.reason);
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "reminder");

    await s.advanceTo("Tue 08:59");
    expect(reminders()).toEqual([]);
    await s.advanceTo("Tue 09:00");
    expect(reminders()).toHaveLength(1);
    await s.advanceTo("Wed 10:00");
    expect(reminders()).toHaveLength(1);
  });
});
