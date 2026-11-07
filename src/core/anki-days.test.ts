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
import { WEEKDAYS, type PactChange } from "../shared/types.ts";
import { ankiPact, ownerWithAnki, SPANISH } from "./testing/anki-pact.ts";
import { failOnCall } from "./testing/fakes.ts";
import { scenario, type AccountHandle, type Scenario } from "./testing/scenario.ts";
import { cards, dayOn, ok, pactOf, statusOn } from "./testing/queries.ts";

const TUE = "2026-01-06";
const WED = "2026-01-07";
const ITALIAN = "1700000000002";

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
    const added = ok(await owner.addRecipient({ name: "Sam" }));
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
    expect(pactOf(owner, pactId)).toMatchObject({
      evidenceKind: "anki",
      description: "",
      dueBy: "01:00",
      anki: { deckId: SPANISH, deckName: "Spanish", deckMissing: false, rolloverHour: 4 },
    });
    expect(pactOf(owner, pactId)).not.toHaveProperty("inBedBy");
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

  test("the Check step reads a due-by time the Anki day can't be due by as none; creating refuses it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    expect(
      owner.firstOccurrence({ evidenceKind: "anki", schedule: { kind: "fixed-days", days: ["tue"] }, dueBy: "09:00" }),
    ).toEqual({ ok: true, firstOccurrence: { date: TUE, dueAt: s.at("Wed 00:00") } });
    await expect(createPact({ dueBy: "09:00" })).rejects.toThrow("invalid-due-by");
  });
});

describe("judging an Anki day", () => {
  test("a finished deck satisfies the day at once, and a learning card back later doesn't change it", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    deckShows({}, TUE, "Tue 21:05");
    await s.advanceTo("Tue 21:10");
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
    expect(cards(owner, "to-do")).toEqual([]);

    deckShows({ learn: 1 }, TUE, "Tue 22:25");
    await owner.checkAnki();
    await s.advanceTo("Tue 22:30");
    await s.advanceTo("Wed 00:00");
    expect(dayOn(owner, pactId, TUE)).toMatchObject({
      status: { kind: "satisfied" },
      detail: { kind: "anki", lastCheck: { cardsLeft: 0, checkedAt: s.at("Tue 21:10") } },
    });
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("a deck not finished by the due time is Missed then, with the last check's count", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    deckShows({ new: 2, learn: 1, review: 9 }, TUE, "Tue 23:45");
    await s.advanceTo("Tue 23:50");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");
    await s.advanceTo("Wed 00:00");

    expect(statusOn(owner, pactId, TUE)).toBe("missed");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        pactId,
        occurrenceDate: TUE,
        missedAt: s.at("Wed 00:00"),
        detail: { kind: "anki", lastCheck: { cardsLeft: 12, checkedAt: s.at("Tue 23:50") } },
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
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
    expect(statusOn(owner, pactId, WED)).toBe("not-judged");
  });

  test("a check for the day before doesn't satisfy today", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["wed"] });

    // The collection hasn't been opened since Tuesday's Anki day: its counts are Tuesday's.
    deckShows({}, TUE, "Tue 23:00");
    await s.advanceTo("Wed 05:00");
    expect(statusOn(owner, pactId, WED)).toBe("not-judged");
  });

  test("counts evaluated after the due time don't satisfy the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"], dueBy: "22:00" });

    deckShows({}, TUE, "Tue 22:01");
    await s.advanceTo("Tue 21:59");
    await s.advanceTo("Tue 22:00");
    expect(statusOn(owner, pactId, TUE)).toBe("missed");
    expect(dayOn(owner, pactId, TUE)?.detail).toEqual({ kind: "anki", lastCheck: null });
  });

  test("a day Missed at today's due-by time shows the check that decided it, not Closed", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"], dueBy: "22:00" });

    deckShows({ review: 3 }, TUE, "Tue 21:50");
    await s.advanceTo("Tue 21:55");
    await s.advanceTo("Tue 22:00");

    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        pactId,
        occurrenceDate: TUE,
        detail: { kind: "anki", lastCheck: { cardsLeft: 3, checkedAt: s.at("Tue 21:55") } },
      }),
    ]);
  });

  test("a day no check reached AnkiWeb for is Missed, as not reached", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    for (let n = 1; n <= 30; n++) failOnCall(s.ankiSource, "deckCounts", 1);

    await s.advanceTo("Tue 04:00");
    await s.advanceTo("Tue 23:50");
    await s.advanceTo("Wed 00:00");

    expect(statusOn(owner, pactId, TUE)).toBe("missed");
    expect(cards(owner, "missed")).toEqual([expect.objectContaining({ detail: { kind: "anki", lastCheck: null } })]);
  });

  test("with nothing due and no answers yet, the first check satisfies the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    // No answers on Tuesday yet: the counts are evaluated at the check itself.
    deckShows({}, TUE, "Tue 04:00");
    await s.advanceTo("Tue 04:00");
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
  });

  test("a day an approved excuse covers is Excused at its due time, and AnkiWeb isn't checked for it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    await s.advanceTo("Mon 09:11");
    const filed = ok(await owner.fileExcuse(pactId, { from: TUE, to: TUE, reason: "Travelling" }, []));
    expect(await reviewer.decide(filed.excuseId, { kind: "approve" })).toEqual({ ok: true });

    deckShows({}, TUE, "Tue 04:00");
    await s.advanceTo("Tue 04:00");
    await s.advanceTo("Tue 12:00");
    await owner.checkAnki();
    await s.advanceTo("Wed 00:00");
    expect(s.ankiSource.countCalls).toEqual([]);
    expect(statusOn(owner, pactId, TUE)).toBe("excused");
  });

  test("a check still running at the due time can still satisfy the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    deckShows({ review: 3 }, TUE, "Tue 23:45");
    await s.advanceTo("Tue 23:50");

    // Check now at 23:59 is still downloading the collection at midnight.
    deckShows({}, TUE, "Tue 23:58");
    s.setClockTo("Tue 23:59");
    const download = s.ankiSource.holdDeckCounts(owner.id);
    const checking = owner.checkAnki();
    await download.started;
    await s.advanceTo("Wed 00:00");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");

    download.release();
    await checking;
    await s.advanceTo("Wed 00:01");
    expect(dayOn(owner, pactId, TUE)).toMatchObject({
      status: { kind: "satisfied" },
      detail: { kind: "anki", lastCheck: { cardsLeft: 0, checkedAt: s.at("Tue 23:59") } },
    });
  });

  test("a check still running at the due time that finds cards left lets the next tick judge the day Missed", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    deckShows({ review: 2 }, TUE, "Tue 23:58");
    s.setClockTo("Tue 23:59");
    const download = s.ankiSource.holdDeckCounts(owner.id);
    const checking = owner.checkAnki();
    await download.started;
    await s.advanceTo("Wed 00:00");
    download.release();
    await checking;
    await s.advanceTo("Wed 00:01");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        pactId,
        missedAt: s.at("Wed 00:00"),
        detail: { kind: "anki", lastCheck: { cardsLeft: 2, checkedAt: s.at("Tue 23:59") } },
      }),
    ]);
  });

  test("a check still running at the due time of a pact's last day can still satisfy it", async () => {
    const s = scenario();
    const { owner, reviewer, sam, deckShows } = await ownerWithAnki(s);
    const created = ok(await owner.createPact({ ...ankiPact(sam.id, reviewer, { days: ["tue"] }), endDate: TUE }));

    deckShows({}, TUE, "Tue 23:58");
    s.setClockTo("Tue 23:59");
    const download = s.ankiSource.holdDeckCounts(owner.id);
    const checking = owner.checkAnki();
    await download.started;
    await s.advanceTo("Wed 00:00");
    download.release();
    await checking;
    await s.advanceTo("Wed 00:01");
    expect(statusOn(owner, created.pactId, TUE)).toBe("satisfied");
  });

  test("a check stuck past AnkiWeb's timeout no longer holds the day open", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    s.setClockTo("Tue 23:59");
    const download = s.ankiSource.holdDeckCounts(owner.id);
    const checking = owner.checkAnki();
    await download.started;
    await s.advanceTo("Wed 00:00");
    await s.advanceTo("Wed 00:01");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");
    await s.advanceTo("Wed 00:03");
    expect(statusOn(owner, pactId, TUE)).toBe("missed");

    deckShows({}, TUE, "Tue 23:58");
    download.release();
    await checking;
    expect(statusOn(owner, pactId, TUE)).toBe("missed");
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
    expect(statusOn(owner, spanish, TUE)).toBe("not-judged");
    expect(statusOn(owner, italian, TUE)).toBe("satisfied");
  });

  test("one account's slow AnkiWeb doesn't hold up checking another's", async () => {
    const s = scenario();
    s.setClockTo("Mon 10:00");
    const first = await ownerWithAnki(s);
    await first.createPact({ days: ["tue"] });
    s.setClockTo("Mon 10:01");
    const second = await ownerWithAnki(s, await s.befriend(first.owner, "second"));
    const pactId = await second.createPact({ days: ["tue"] });
    first.deckShows({ review: 3 }, TUE, "Tue 20:00");
    second.deckShows({}, TUE, "Tue 20:00");

    const slow = s.ankiSource.holdDeckCounts(first.owner.id);
    const ticking = s.advanceTo("Tue 20:00");
    await slow.started;
    expect(s.ankiSource.countCalls.map((call) => call.account)).toEqual([first.owner.id, second.owner.id]);
    slow.release();
    await ticking;
    expect(statusOn(second.owner, pactId, TUE)).toBe("satisfied");
  });

  test("a failed check is logged, judges nothing, and is tried again on the next tick", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    deckShows({}, TUE, "Tue 20:00");

    failOnCall(s.ankiSource, "deckCounts", 1, new Error("AnkiWeb timed out"));
    await s.advanceTo("Tue 20:00");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");
    expect(s.logs).toContainEqual(expect.stringContaining("AnkiWeb timed out"));

    // The failed call never reached the fake; the retry, a minute later, did.
    await s.advanceTo("Tue 20:01");
    expect(s.ankiSource.countCalls).toHaveLength(1);
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
  });
});

describe("Today", () => {
  test("an open Anki day shows the cards left as of the last check, until the deck is finished", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    await s.advanceTo("Tue 03:00");
    expect(cards(owner, "to-do")).toEqual([]);

    s.setClockTo("Tue 04:00");
    expect(cards(owner, "to-do")).toEqual([
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
        deckMissing: false,
        lastCheck: null,
      },
    ]);

    deckShows({ new: 10, learn: 2, review: 30 }, TUE, "Tue 21:00");
    await s.advanceTo("Tue 21:10");
    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ kind: "anki", lastCheck: { cardsLeft: 42, checkedAt: s.at("Tue 21:10") } }),
    ]);

    deckShows({}, TUE, "Tue 21:30");
    await s.advanceTo("Tue 21:30");
    expect(cards(owner, "to-do")).toEqual([]);
    s.setClockTo("Wed 12:00");
    expect(owner.today().yesterday).toEqual([
      expect.objectContaining({ pactId, evidenceKind: "anki", occurrenceDate: TUE }),
    ]);
  });

  test("a deck renamed in Anki shows its new name after the next check, on Today and the pact page", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    s.ankiSource.setDeck(owner.id, { id: SPANISH, name: "Languages::Spanish", review: 42 });
    s.ankiSource.setAnkiDay(owner.id, TUE, s.at("Tue 20:00"));
    s.setClockTo("Tue 19:59");
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, deckName: "Spanish" })]);

    await s.advanceTo("Tue 20:00");
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, deckName: "Languages::Spanish" })]);
    expect(pactOf(owner, pactId)).toMatchObject({ anki: { deckId: SPANISH, deckName: "Languages::Spanish" } });
  });

  test("an Anki day is still open past midnight when it's due later", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    await createPact({ days: ["tue"], dueBy: "02:00" });
    s.setClockTo("Wed 01:00");
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ occurrenceDate: TUE, dueAt: s.at("Wed 02:00") })]);
  });
});

describe("reminders", () => {
  test("a reminder goes off while the deck isn't finished, with the cards left at the last check", async () => {
    const s = scenario();
    const { owner, reviewer, sam, deckShows } = await ownerWithAnki(s);
    ok(
      await owner.createPact({
        ...ankiPact(sam.id, reviewer, { days: ["tue", "wed"] }),
        reminders: ["21:00"],
      }),
    );

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
    const created = ok(await owner.createPact({ ...pact, reminders: ["23:00", "01:30"] }));
    expect(pactOf(owner, created.pactId).reminders).toEqual(["23:00", "01:30"]);

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
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { dueBy: "03:30" } });
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
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ occurrenceDate: TUE, dueAt: s.at("Wed 13:00") })]);
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
    ok(await owner.createPact({ ...ankiPact(sam.id, reviewer, { days: ["tue"] }), reminders: ["09:00"] }));
    const reminders = () => s.notifier.sentTo(owner).filter((n) => n.kind === "reminder");

    await s.advanceTo("Tue 08:59");
    expect(reminders()).toEqual([]);
    await s.advanceTo("Tue 09:00");
    expect(reminders()).toHaveLength(1);
    await s.advanceTo("Wed 10:00");
    expect(reminders()).toHaveLength(1);
  });
});

describe("AnkiWeb refusing Pact's login", () => {
  function connectionProblems(s: Scenario, owner: AccountHandle) {
    return s.notifier.sentTo(owner).filter((n) => n.kind === "connection-problem");
  }

  test("at 08:00: one alert and one push, then no calls; reconnected at 12:00, a finished deck satisfies the day", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    deckShows({ review: 42 }, TUE, "Tue 07:50");
    await s.advanceTo("Tue 07:50");

    s.ankiSource.disconnect(owner.id);
    await s.advanceTo("Tue 08:00");
    const calls = s.ankiSource.countCalls.length;
    await s.advanceTo("Tue 08:30");
    await s.advanceTo("Tue 11:59");
    s.setClockTo("Tue 11:59");
    await owner.checkAnki();

    expect(s.ankiSource.countCalls).toHaveLength(calls);
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "needs-reconnecting" })]);
    expect(owner.today().alerts).toEqual([{ kind: "connection", service: "anki", status: "needs-reconnecting" }]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: "needs-reconnecting" } });
    expect(connectionProblems(s, owner)).toEqual([
      {
        recipient: owner.id,
        kind: "connection-problem",
        payload: {
          title: "AnkiWeb needs reconnecting",
          body: "A day whose deck isn't finished by its due time counts as Missed. Reconnect before then.",
          url: "/",
        },
      },
    ]);

    s.ankiSource.reconnect(owner.id);
    s.setClockTo("Tue 12:00");
    await owner.connectAnki();
    deckShows({}, TUE, "Tue 12:00");
    await s.advanceTo("Tue 12:01");

    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
    expect(owner.today().alerts).toEqual([]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: null } });
    expect(connectionProblems(s, owner)).toHaveLength(1);
  });

  test("a check now that finds it refused marks it the same way", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    await createPact({ days: ["tue"] });
    s.ankiSource.disconnect(owner.id);
    s.setClockTo("Tue 09:00");
    await owner.checkAnki();
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "needs-reconnecting" })]);
    expect(connectionProblems(s, owner)).toHaveLength(1);
  });

  test("never reconnected: the day is Missed at its due time, as not reached", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    s.ankiSource.disconnect(owner.id);
    await s.advanceTo("Tue 08:00");
    await s.advanceTo("Tue 23:59");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");
    await s.advanceTo("Wed 00:00");
    expect(dayOn(owner, pactId, TUE)).toMatchObject({
      status: { kind: "missed" },
      detail: { kind: "anki", lastCheck: null },
    });
  });

  test("a reconnect while a check is running isn't undone when the check comes back refused", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    s.ankiSource.disconnect(owner.id);
    const download = s.ankiSource.holdDeckCounts(owner.id);
    const ticking = s.advanceTo("Tue 08:00");
    await download.started;
    // The owner reconnects with a new login while the check with the old one is still running.
    s.clock.set(new Date(s.at("Tue 08:00").getTime() + 30_000));
    await owner.connectAnki();
    download.release();
    await ticking;

    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "connected" })]);
    expect(connectionProblems(s, owner)).toEqual([]);
    s.ankiSource.reconnect(owner.id);
    deckShows({}, TUE, "Tue 08:15");
    await s.advanceTo("Tue 08:20");
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
  });

  test("reconnecting starts a fresh check at the next tick, however recent the refused one", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    s.ankiSource.disconnect(owner.id);
    await s.advanceTo("Tue 08:00");
    const calls = s.ankiSource.countCalls.length;

    s.ankiSource.reconnect(owner.id);
    s.setClockTo("Tue 08:03");
    await owner.connectAnki();
    deckShows({}, TUE, "Tue 08:03");
    await s.advanceTo("Tue 08:04");

    expect(s.ankiSource.countCalls).toHaveLength(calls + 1);
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");
  });

  test("a failed check doesn't count as refused", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    await createPact({ days: ["tue"] });
    failOnCall(s.ankiSource, "deckCounts", 1, new Error("AnkiWeb timed out"));
    await s.advanceTo("Tue 08:00");
    expect(owner.profile().connections).toEqual([expect.objectContaining({ status: "connected" })]);
    expect(owner.today().alerts).toEqual([]);
    expect(connectionProblems(s, owner)).toEqual([]);
  });

  test("disconnected on Profile: an alert to connect again, no calls, and the day is Missed", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });
    await createPact({ days: ["wed"] });
    expect(owner.profile().connections).toEqual([expect.objectContaining({ service: "anki", activePacts: 2 })]);
    await owner.disconnectAnki();

    expect(owner.today().alerts).toEqual([{ kind: "connection", service: "anki", status: "not-connected" }]);
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { connectionProblem: "not-connected" } });
    await s.advanceTo("Tue 12:00");
    await s.advanceTo("Wed 00:00");
    expect(s.ankiSource.countCalls).toEqual([]);
    expect(statusOn(owner, pactId, TUE)).toBe("missed");
  });
});

describe("a deck gone from Anki", () => {
  test("shows an alert on the pact and Today, its day is Missed at the due time, and the owner can excuse it", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    s.ankiSource.removeDeck(owner.id, SPANISH);
    s.ankiSource.setAnkiDay(owner.id, TUE, s.at("Tue 20:00"));
    await s.advanceTo("Tue 20:00");
    expect(owner.pact(pactId)).toMatchObject({
      ok: true,
      pact: { anki: { deckId: SPANISH, deckName: "Spanish", deckMissing: true } },
    });
    expect(cards(owner, "to-do")).toEqual([
      expect.objectContaining({ pactId, deckName: "Spanish", deckMissing: true }),
    ]);

    await s.advanceTo("Wed 00:00");
    expect(statusOn(owner, pactId, TUE)).toBe("missed");

    s.setClockTo("Wed 09:00");
    const filed = ok(await owner.fileExcuse(pactId, { from: TUE, to: TUE, reason: "Deleted the deck by mistake" }, []));
    expect(await reviewer.decide(filed.excuseId, { kind: "approve" })).toEqual({ ok: true });
    expect(statusOn(owner, pactId, TUE)).toBe("excused");
  });

  test("the alert goes once a check finds the deck again", async () => {
    const s = scenario();
    const { owner, createPact, deckShows } = await ownerWithAnki(s);
    const pactId = await createPact({ days: ["tue"] });

    s.ankiSource.removeDeck(owner.id, SPANISH);
    s.ankiSource.setAnkiDay(owner.id, TUE, s.at("Tue 20:00"));
    await s.advanceTo("Tue 20:00");
    // The deck picker no longer lists it, but the alert still names it.
    await owner.ankiDecks();
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { anki: { deckName: "Spanish", deckMissing: true } } });

    deckShows({ review: 5 }, TUE, "Tue 20:10");
    await s.advanceTo("Tue 20:10");
    expect(owner.pact(pactId)).toMatchObject({ ok: true, pact: { anki: { deckName: "Spanish", deckMissing: false } } });
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, deckMissing: false })]);
  });
});

describe("changing an Anki pact's deck", () => {
  /** An owner with Spanish and Italian in their deck list, and a daily pact on Spanish. */
  async function spanishAndItalian(s: Scenario) {
    const setUp = await ownerWithAnki(s);
    s.ankiSource.setDeck(setUp.owner.id, { id: ITALIAN, name: "Italian" });
    await setUp.owner.ankiDecks();
    const pactId = await setUp.createPact();
    const change = (terms: Partial<PactChange> = {}): PactChange => ({
      name: "Spanish",
      description: "",
      schedule: { kind: "fixed-days", days: [...WEEKDAYS] },
      penaltyCents: 500,
      recipientId: setUp.sam.id,
      reviewerIds: [setUp.reviewer.id],
      ...terms,
    });
    const deckId = () => {
      const pact = pactOf(setUp.owner, pactId);
      return pact.evidenceKind === "anki" ? pact.anki.deckId : undefined;
    };
    return { ...setUp, pactId, change, deckId };
  }

  test("in the edit window, the deck changes freely", async () => {
    const s = scenario();
    const { owner, reviewer, sam, pactId, deckId } = await spanishAndItalian(s);
    expect(await owner.editPact(pactId, ankiPact(sam.id, reviewer, { ankiDeckId: ITALIAN }))).toEqual({ ok: true });
    expect(deckId()).toBe(ITALIAN);
    expect(await owner.editPact(pactId, ankiPact(sam.id, reviewer, { ankiDeckId: "999" }))).toEqual({
      ok: false,
      reason: "unknown-deck",
    });
  });

  test("after the edit window, it's a change request, and the pact keeps its deck until a reviewer approves", async () => {
    const s = scenario();
    const { owner, reviewer, pactId, change, deckId, deckShows } = await spanishAndItalian(s);
    await s.advanceTo("Tue 09:00");

    const deck = {
      term: "deck",
      before: { id: SPANISH, name: "Spanish" },
      after: { id: ITALIAN, name: "Italian" },
      effect: "needs-approval",
    };
    expect(owner.changePreview(pactId, change({ ankiDeckId: ITALIAN }))).toEqual({
      ok: true,
      preview: {
        changes: [deck],
        outcome: { kind: "needs-approval", reviewerNames: [reviewer.name], bundlesStricter: false },
      },
    });
    expect(await owner.changePact(pactId, change({ ankiDeckId: "999" }))).toEqual({
      ok: false,
      reason: "unknown-deck",
    });
    const sent = await owner.changePact(pactId, change({ ankiDeckId: ITALIAN }));
    if (!sent.ok || sent.outcome.kind !== "needs-approval") throw new Error("no change request");
    expect(deckId()).toBe(SPANISH);
    expect(owner.changeRequest(sent.outcome.changeRequestId)).toMatchObject({
      ok: true,
      changeRequest: { changes: [deck] },
    });
    expect(s.notifier.sentTo(reviewer).at(-1)?.payload.body).toBe("Deck");

    expect(await reviewer.decide(sent.outcome.changeRequestId, { kind: "approve" })).toEqual({ ok: true });
    expect(deckId()).toBe(ITALIAN);
    // Tuesday is open, so it keeps Spanish: Italian finished doesn't satisfy it, Spanish finished does.
    deckShows({}, TUE, "Tue 20:00", ITALIAN);
    await s.advanceTo("Tue 20:00");
    expect(statusOn(owner, pactId, TUE)).toBe("not-judged");
    expect(s.ankiSource.countCalls.at(-1)).toEqual({ account: owner.id, deckIds: [SPANISH] });
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, deckName: "Spanish" })]);
    deckShows({}, TUE, "Tue 20:10");
    await s.advanceTo("Tue 20:10");
    expect(statusOn(owner, pactId, TUE)).toBe("satisfied");

    // Wednesday is on Italian.
    deckShows({}, WED, "Wed 09:00", ITALIAN);
    await s.advanceTo("Wed 09:00");
    expect(s.ankiSource.countCalls.at(-1)).toEqual({ account: owner.id, deckIds: [ITALIAN] });
    expect(statusOn(owner, pactId, WED)).toBe("satisfied");
  });

  test("a change request that keeps the deck shows it among the terms as they stand", async () => {
    const s = scenario();
    const { owner, pactId, change } = await spanishAndItalian(s);
    await s.advanceTo("Tue 09:00");
    const sent = await owner.changePact(pactId, change({ penaltyCents: 300 }));
    if (!sent.ok || sent.outcome.kind !== "needs-approval") throw new Error("no change request");
    expect(owner.changeRequest(sent.outcome.changeRequestId)).toMatchObject({
      ok: true,
      changeRequest: { current: { anki: { deckId: SPANISH, deckName: "Spanish" } } },
    });
  });

  test("a deck change waits for approval with an earlier due-by time bundled in", async () => {
    const s = scenario();
    const { owner, pactId, change } = await spanishAndItalian(s);
    await s.advanceTo("Tue 09:00");
    expect(owner.changePreview(pactId, change({ ankiDeckId: ITALIAN, dueBy: "22:00" }))).toMatchObject({
      ok: true,
      preview: { outcome: { kind: "needs-approval", bundlesStricter: true } },
    });
  });

  test("an earlier due-by time is stricter and applies to the days not open yet", async () => {
    const s = scenario();
    const { owner, pactId, change } = await spanishAndItalian(s);
    await s.advanceTo("Tue 09:00");
    expect(await owner.changePact(pactId, change({ dueBy: "22:00" }))).toMatchObject({
      ok: true,
      outcome: { kind: "stricter", appliesFrom: WED },
    });
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, dueAt: s.at("Wed 00:00") })]);
    s.setClockTo("Wed 09:00");
    expect(cards(owner, "to-do")).toEqual([expect.objectContaining({ pactId, dueAt: s.at("Wed 22:00") })]);
  });
});
