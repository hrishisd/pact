// Oura Ring bedtime pacts: connecting Oura, creating an in-bed-by pact, and
// judging each night from the first `long_sleep` Oura reports for it, or as
// Missed at 18:00 the next day. Oura is polled on each tick only while a
// night isn't judged yet, before the tick's write transaction.

import { describe, expect, test } from "vitest";
import { bedtimePact, ownerWithOura, sleep } from "./testing/bedtime-pact.ts";
import { photo } from "./testing/camera-pact.ts";
import { failOnCall } from "./testing/fakes.ts";
import { scenario, type AccountHandle } from "./testing/scenario.ts";
import { cards, ok, sectionKinds, statusOn } from "./testing/queries.ts";

/** How the night of `date` stands, as an excuse for it would see it. */
function night(owner: AccountHandle, pactId: string, date: string) {
  const preview = ok(owner.excusePreview(pactId, { from: date, to: date }));
  const skipped = preview.preview.skipped[0];
  if (skipped) return skipped.reason;
  return preview.preview.covered[0]!.status.kind;
}

describe("connecting Oura", () => {
  test("a Connection exists only once the owner connects, and Profile lists it", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    expect(owner.profile().connections).toEqual([]);

    s.setClockTo("Mon 09:30");
    await owner.connectOura();

    expect(owner.profile().connections).toEqual([
      { service: "oura", status: "connected", connectedAt: s.at("Mon 09:30"), activePacts: 0 },
    ]);
  });

  test("connecting again keeps one connection", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.connectOura();
    await owner.connectOura();
    expect(owner.profile().connections).toHaveLength(1);
  });
});

describe("creating a bedtime pact", () => {
  test("needs an Oura connection", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");
    const reviewer = await s.befriend(owner, "reviewer");
    const added = ok(await owner.addRecipient({ name: "Sam" }));

    expect(await owner.createPact(bedtimePact(added.recipient.id, reviewer))).toEqual({
      ok: false,
      reason: "oura-not-connected",
    });
  });

  test("needs an in-bed-by time, as HH:MM", async () => {
    const s = scenario();
    const { owner, reviewer, sam } = await ownerWithOura(s);
    for (const inBedBy of [undefined, "", "24:00", "7pm", "23:5"]) {
      const pact = { ...bedtimePact(sam.id, reviewer), inBedBy };
      expect(await owner.createPact(pact)).toEqual({ ok: false, reason: "invalid-in-bed-by" });
    }
  });

  test("has no photo description; its terms carry the in-bed-by time", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("23:30");
    expect(owner.pact(pactId)).toMatchObject({
      ok: true,
      pact: { evidenceKind: "oura", description: "", inBedBy: "23:30" },
    });
    expect(owner.pact(pactId)).not.toHaveProperty("pact.dueBy");
    expect(owner.pact(pactId)).not.toHaveProperty("pact.anki");
  });

  test("the first night is the first whose in-bed-by time is at least an hour after creation", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    s.setClockTo("Mon 22:50");
    const inTime = await createPact("00:00");
    s.setClockTo("Mon 23:10");
    const late = await createPact("00:00");

    expect(owner.pact(late)).toMatchObject({
      pact: { firstOccurrence: { date: s.date("Tue"), dueAt: s.at("Wed 00:00") } },
    });
    expect(owner.pact(inTime)).toMatchObject({
      pact: { firstOccurrence: { date: s.date("Mon"), dueAt: s.at("Tue 00:00") } },
    });
    expect(owner.firstOccurrence({ schedule: { kind: "fixed-days", days: ["mon"] }, inBedBy: "23:30" })).toEqual({
      ok: true,
      firstOccurrence: { date: "2026-01-12", dueAt: s.at("2026-01-13T04:30:00Z") },
    });
  });

  test("an evening in-bed-by time is due that evening", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("22:30");
    expect(owner.pact(pactId)).toMatchObject({
      pact: { firstOccurrence: { date: s.date("Mon"), dueAt: s.at("Mon 22:30") } },
    });
  });
});

describe("judging a night", () => {
  test("in bed by 00:00, long_sleep starting 23:40 Tue: Tue night Satisfied as soon as the period arrives", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    await s.advanceTo("Tue 18:00");

    s.ouraSource.addSleep(owner.id, sleep("Tue 23:40"));
    await s.advanceTo("Wed 07:00");

    expect(night(owner, pactId, s.date("Tue"))).toBe("satisfied");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]); // Mon night: no data by Tue 18:00
  });

  test("long_sleep starting 01:00 Wed counts for Tue night: Missed, $5 owed, and the card says when", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    await s.advanceTo("Tue 18:00");

    s.ouraSource.addSleep(owner.id, sleep("Wed 01:00"));
    await s.advanceTo("Wed 07:00");

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
    expect(cards(owner, "missed")).toEqual([
      {
        pactId,
        name: "In bed by midnight",
        penaltyCents: 500,
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 07:00"),
        excusableUntil: s.at("Fri 07:00"),
        detail: { kind: "night", inBedAt: "01:00" },
      },
    ]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toHaveLength(1);
  });

  test("a nap at 19:00 Tue is ignored; the long_sleep at 23:30 decides the night", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"), sleep("Tue 19:00", "late_nap"));
    await s.advanceTo("Tue 21:00");
    expect(night(owner, pactId, s.date("Tue"))).toBe("not-judged");

    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    await s.advanceTo("Wed 07:00");
    expect(night(owner, pactId, s.date("Tue"))).toBe("satisfied");
  });

  test("first long_sleep at 01:10 (Missed), a second at 03:00 arrives later: stays Missed", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    await s.advanceTo("Tue 18:00");

    s.ouraSource.addSleep(owner.id, sleep("Wed 01:10"));
    await s.advanceTo("Wed 02:00");
    s.ouraSource.addSleep(owner.id, sleep("Wed 03:00"));
    await s.advanceTo("Wed 10:00");

    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 02:00"),
        detail: { kind: "night", inBedAt: "01:10" },
      }),
    ]);
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 500 })]);
  });

  test("two long_sleeps in one sync: the earlier start decides", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Tue 03:00"), sleep("Mon 23:50"));
    await s.advanceTo("Tue 08:00");
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
  });

  test("no period by 18:00 Wed: Tue night Missed at 18:00, with no bedtime", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    await s.advanceTo("Wed 17:59");
    expect(night(owner, pactId, s.date("Tue"))).toBe("not-judged");

    await s.advanceTo("Wed 18:00");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 18:00"),
        detail: { kind: "night", inBedAt: null },
      }),
    ]);
  });

  test("a period that arrives after the 18:00 cutoff changes nothing", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    await s.advanceTo("Tue 18:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    await s.advanceTo("Tue 18:01");
    expect(night(owner, pactId, s.date("Mon"))).toBe("missed");
  });

  test("Oura timestamps in a timezone other than the account's are judged in Oura's timezone", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    // 23:40 in Los Angeles is 02:40 in New York: Satisfied by Oura's clock.
    s.ouraSource.addSleep(owner.id, sleep("2026-01-05T23:40:00-08:00"));
    // 00:10 in Paris is 18:10 Mon in New York: Missed by Oura's clock.
    s.ouraSource.addSleep(owner.id, sleep("2026-01-07T00:10:00+01:00"));
    await s.advanceTo("Wed 07:00");

    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({ occurrenceDate: s.date("Tue"), detail: { kind: "night", inBedAt: "00:10" } }),
    ]);
  });

  test("a night with an approved excuse and no sleep is Excused at 6pm the next day", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    s.setClockTo("Mon 10:00");
    const filed = ok(
      await owner.fileExcuse(pactId, { from: s.date("Tue"), to: s.date("Tue"), reason: "Red-eye flight" }, []),
    );
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    await s.advanceTo("Wed 00:00");
    await s.advanceTo("Wed 17:59");
    expect(statusOn(owner, pactId, s.date("Tue"))).toBe("not-judged");
    await s.advanceTo("Wed 18:00");
    expect(statusOn(owner, pactId, s.date("Tue"))).toBe("excused");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });

  test("an on-time bedtime that syncs the morning after beats an approved excuse", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    s.setClockTo("Mon 10:00");
    const filed = ok(
      await owner.fileExcuse(pactId, { from: s.date("Tue"), to: s.date("Tue"), reason: "Might be late" }, []),
    );
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    await s.advanceTo("Wed 00:00");
    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    await s.advanceTo("Wed 07:00");

    expect(statusOn(owner, pactId, s.date("Tue"))).toBe("satisfied");
  });

  test("an excuse approved after the in-bed-by time leaves the night for Oura until 6pm", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    s.setClockTo("Tue 10:00");
    const filed = ok(
      await owner.fileExcuse(pactId, { from: s.date("Tue"), to: s.date("Tue"), reason: "Might be late" }, []),
    );
    await s.advanceTo("Wed 01:00");
    await reviewer.decide(filed.excuseId, { kind: "approve" });
    expect(statusOn(owner, pactId, s.date("Tue"))).toBe("not-judged");

    s.ouraSource.addSleep(owner.id, sleep("Tue 23:30"));
    await s.advanceTo("Wed 07:00");

    expect(statusOn(owner, pactId, s.date("Tue"))).toBe("satisfied");
  });

  test("an approved excuse beats a late bedtime Oura reports afterwards; an on-time one is still Satisfied", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    s.setClockTo("Tue 10:00");
    const filed = ok(
      await owner.fileExcuse(pactId, { from: s.date("Tue"), to: s.date("Wed"), reason: "Night shifts" }, []),
    );
    await reviewer.decide(filed.excuseId, { kind: "approve" });

    s.ouraSource.addSleep(owner.id, sleep("Wed 02:00"), sleep("Wed 23:00"));
    await s.advanceTo("Thu 07:00");

    expect(night(owner, pactId, s.date("Tue"))).toBe("excused");
    expect(night(owner, pactId, s.date("Wed"))).toBe("satisfied");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
  });

  test("a Missed night on an excuse waiting for approval holds its penalty and sends no Missed push", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    s.setClockTo("Tue 10:00");
    ok(await owner.fileExcuse(pactId, { from: s.date("Tue"), to: s.date("Tue"), reason: "Ring is charging" }, []));

    await s.advanceTo("Wed 18:00");
    expect(owner.ledgers()).toEqual([expect.objectContaining({ owedCents: 0 })]);
    expect(s.notifier.sentTo(owner, "missed-occurrence")).toEqual([]);
  });
});

describe("a traveller's night closes at 18:00 on Oura's clock", () => {
  // The account is in New York. With no period for the night yet, Oura's clock
  // is the UTC offset of the latest sleep it reported.

  test("west of the account (Honolulu): a late-afternoon long_sleep that Oura puts in Tue night judges it", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    // Mon night in Honolulu, 23:00 there (04:00 Tue in New York): Satisfied by Oura's clock.
    s.ouraSource.addSleep(owner.id, sleep("2026-01-05T23:00:00-10:00"));
    await s.advanceTo("Tue 12:00");
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");

    // 18:00 Wed in New York is 13:00 in Honolulu: Tue night has until 18:00 there.
    await s.advanceTo("Wed 18:00");
    expect(night(owner, pactId, s.date("Tue"))).toBe("not-judged");
    expect(owner.today().sections[0]).toEqual({
      kind: "no-oura-data",
      cards: [expect.objectContaining({ occurrenceDate: s.date("Tue"), closesAt: s.at("Wed 23:00") })],
    });

    // Asleep at 15:00 Wed in Honolulu (20:00 in New York), which Oura's clock puts in Tue night.
    s.ouraSource.addSleep(owner.id, sleep("2026-01-07T15:00:00-10:00"));
    await s.advanceTo("Wed 22:30");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 22:30"),
        detail: { kind: "night", inBedAt: "15:00" },
      }),
    ]);
  });

  test("east of the account (Paris): no period by 18:00 Wed there is Missed then, 12:00 in New York", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, sleep("2026-01-05T23:00:00+01:00"));
    await s.advanceTo("Tue 07:00");
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");

    await s.advanceTo("Wed 11:59");
    expect(night(owner, pactId, s.date("Tue"))).toBe("not-judged");
    await s.advanceTo("Wed 12:00");
    expect(cards(owner, "missed")).toEqual([
      expect.objectContaining({
        occurrenceDate: s.date("Tue"),
        missedAt: s.at("Wed 12:00"),
        detail: { kind: "night", inBedAt: null },
      }),
    ]);
  });

  test("at home across a daylight saving change, the night closes at 18:00 on the account's clock", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    s.setClockTo("2026-10-30T12:00:00-04:00");
    const pactId = await createPact("00:00");
    // Fri and Sat nights in New York, before the clocks go back at 02:00 Sun Nov 1.
    s.ouraSource.addSleep(owner.id, sleep("2026-10-30T23:00:00-04:00"), sleep("2026-10-31T23:00:00-04:00"));
    await s.advanceTo("2026-11-01T12:00:00-05:00");
    expect(night(owner, pactId, "2026-10-31")).toBe("satisfied");

    // Sun night has no data: it closes at 18:00 EST Mon, not 18:00 at Sat night's -04:00.
    await s.advanceTo("2026-11-02T17:59:00-05:00");
    expect(night(owner, pactId, "2026-11-01")).toBe("not-judged");
    await s.advanceTo("2026-11-02T18:00:00-05:00");
    expect(night(owner, pactId, "2026-11-01")).toBe("missed");
  });

  test("Oura timestamps with no UTC offset close the night on the account's clock", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    s.ouraSource.addSleep(owner.id, { ...sleep("Mon 23:00"), bedtime_start: "2026-01-05T23:00:00" });
    await s.advanceTo("Tue 07:00");
    expect(night(owner, pactId, s.date("Mon"))).toBe("satisfied");

    await s.advanceTo("Wed 17:59");
    expect(night(owner, pactId, s.date("Tue"))).toBe("not-judged");
    await s.advanceTo("Wed 18:00");
    expect(night(owner, pactId, s.date("Tue"))).toBe("missed");
  });
});

describe("polling Oura", () => {
  test("no calls while every night is judged; a call every tick while one isn't", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00");
    // Mon night's window opens at 18:00 Mon.
    await s.advanceTo("Mon 17:59");
    expect(s.ouraSource.calls).toEqual([]);

    await s.advanceTo("Mon 18:00");
    await s.advanceTo("Mon 18:01");
    expect(s.ouraSource.calls).toEqual([
      { account: owner.id, startDate: s.date("Mon"), endDate: s.date("Wed") },
      { account: owner.id, startDate: s.date("Mon"), endDate: s.date("Wed") },
    ]);

    s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    await s.advanceTo("Tue 07:00");
    expect(s.ouraSource.calls).toHaveLength(3);
    await s.advanceTo("Tue 07:01");
    await s.advanceTo("Tue 17:59");
    expect(s.ouraSource.calls).toHaveLength(3);
  });

  test("an account with no bedtime pact causes no calls", async () => {
    const s = scenario();
    await ownerWithOura(s);
    await s.advanceTo("Tue 20:00");
    expect(s.ouraSource.calls).toEqual([]);
  });

  test("the Oura source failing on its third call during advance to T: that account has no data this tick, the rest is judged, and the next tick finishes", async () => {
    const s = scenario();
    const first = await ownerWithOura(s);
    const owners = [
      first,
      await ownerWithOura(s, await s.befriend(first.owner, "bob")),
      await ownerWithOura(s, await s.befriend(first.owner, "cat")),
    ];
    const pacts: string[] = [];
    for (const { owner, createPact } of owners) {
      pacts.push(await createPact("00:00"));
      s.ouraSource.addSleep(owner.id, sleep("Mon 23:00"));
    }
    s.setClockTo("Tue 07:00");
    failOnCall(s.ouraSource, "sleepPeriods", 3);

    await s.core.advanceTo(s.at("Tue 07:00"));
    expect(owners.map(({ owner }, i) => night(owner, pacts[i]!, s.date("Mon"))).sort()).toEqual([
      "not-judged",
      "satisfied",
      "satisfied",
    ]);
    expect(s.core.lastTick()).toEqual(s.at("Tue 07:00"));
    expect(s.logs.filter((line) => line.includes("Oura"))).toEqual([
      expect.stringMatching(/^Oura sleep for account .+ failed, no data this tick: Error: injected failure/),
    ]);

    await s.advanceTo("Tue 07:01");
    owners.forEach(({ owner }, i) => expect(night(owner, pacts[i]!, s.date("Mon"))).toBe("satisfied"));
  });

  test("an account whose Oura fails on every call holds up nobody else's judging", async () => {
    const s = scenario();
    const { owner, reviewer, createPact } = await ownerWithOura(s);
    await createPact("00:00");
    const theirs = await ownerWithOura(s, reviewer);
    const theirPact = await theirs.createPact("00:00");
    s.ouraSource.addSleep(reviewer.id, sleep("Mon 23:00"));
    const working = s.ouraSource.sleepPeriods.bind(s.ouraSource);
    s.ouraSource.sleepPeriods = async (account, range) => {
      if (account === owner.id) throw new Error("Oura sleep request failed: HTTP 503");
      return working(account, range);
    };

    await s.advanceTo("Tue 07:00");

    expect(night(reviewer, theirPact, s.date("Mon"))).toBe("satisfied");
  });
});

describe("Today", () => {
  test("Automatic: a bedtime pact that runs tonight, with tonight's deadline", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    const pactId = await createPact("00:00");
    // From creation, in the edit window too, it is under Automatic and never To do.
    expect(sectionKinds(owner)).toEqual(["automatic"]);
    await s.advanceTo("Mon 20:00");

    expect(owner.today().sections).toEqual([
      {
        kind: "automatic",
        cards: [
          {
            pactId,
            name: "In bed by midnight",
            penaltyCents: 500,
            editWindowClosesAt: null,
            occurrenceDate: s.date("Mon"),
            dueAt: s.at("Tue 00:00"),
            inBedBy: "00:00",
          },
        ],
      },
    ]);
  });

  test("after midnight, an in-bed-by time of 01:00 is still tonight's", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("01:00");
    await s.advanceTo("Tue 00:30");
    expect(owner.today().sections).toEqual([
      {
        kind: "automatic",
        cards: [expect.objectContaining({ occurrenceDate: s.date("Mon"), dueAt: s.at("Tue 01:00") })],
      },
    ]);
  });

  test("a night already Satisfied isn't shown; a night on a day the schedule skips isn't either", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00", ["mon", "wed"]);
    s.ouraSource.addSleep(owner.id, sleep("Mon 22:00"));
    await s.advanceTo("Mon 23:00");
    expect(owner.today().sections).toEqual([]);

    await s.advanceTo("Tue 12:00");
    expect(owner.today().sections).toEqual([]);
  });

  test("Automatic comes after Missed and before Coming up", async () => {
    const s = scenario();
    const { owner, createPact } = await ownerWithOura(s);
    await createPact("00:00", ["mon", "tue"]);
    s.setClockTo("Mon 23:30");
    await createPact("00:00", ["wed"]);
    await s.advanceTo("Tue 18:00");
    expect(sectionKinds(owner)).toEqual(["missed", "automatic", "coming-up"]);
  });
});

test("photo evidence can't be submitted for a bedtime pact", async () => {
  const s = scenario();
  const { owner, createPact } = await ownerWithOura(s);
  const pactId = await createPact("00:00");
  expect(await owner.submitEvidence(pactId, [photo()])).toEqual({
    ok: false,
    reason: "not-open",
  });
});
