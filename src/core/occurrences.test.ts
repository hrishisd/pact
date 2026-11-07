// Occurrence timing, tested at its own interface: these are the calendar
// cases a scenario can't express, such as days that daylight saving time
// makes 23 or 25 hours long. Scenarios cover how the core uses it.

import { describe, expect, test } from "vitest";
import type { Weekday } from "../shared/types.ts";
import {
  ankiDueByOrder,
  minutesFrom,
  newOccurrenceTerms,
  NIGHT_STARTS_HOUR,
  nightStartsAt,
  noOuraDataPushAt,
  occurrences,
  occurrencesOverTime,
  type NewOccurrenceOptions,
  type OccurrenceTerms,
} from "./occurrences.ts";

const NEW_YORK = "America/New_York";
// Chile moves its clocks at midnight, so some days have no midnight and some have it twice.
const SANTIAGO = "America/Santiago";

function fixedDays(...days: Weekday[]) {
  return { kind: "fixed-days" as const, days };
}

/** A pact's occurrence terms: `terms`, and none of the optional times or dates it leaves out. */
function termsOf(terms: Pick<OccurrenceTerms, "schedule" | "firstOccurrence"> & Partial<OccurrenceTerms>) {
  return { inBedBy: null, dueBy: null, ankiRollover: null, endDate: null, createdAt: null, ...terms };
}

/** A new pact's options: `options`, and none of the others. */
function optionsOf(options: Partial<NewOccurrenceOptions> = {}): NewOccurrenceOptions {
  return { inBedBy: null, dueBy: null, ankiRollover: null, startDate: null, ...options };
}

describe("a new pact's first occurrence", () => {
  test.each([
    { createdAt: "2026-01-05T23:00:00-05:00", first: "2026-01-05", why: "due exactly an hour later" },
    { createdAt: "2026-01-05T23:01:00-05:00", first: "2026-01-06", why: "due less than an hour later" },
  ])("a daily pact created at $createdAt starts $first: Monday is $why", ({ createdAt, first }) => {
    const daily = fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun");

    expect(newOccurrenceTerms(daily, new Date(createdAt), NEW_YORK, optionsOf())).toMatchObject({
      ok: true,
      terms: { firstOccurrence: first },
    });
  });

  test("a Monday-only pact created late on a Monday starts 7 days later", () => {
    const createdAt = new Date("2026-01-05T23:30:00-05:00");

    expect(newOccurrenceTerms(fixedDays("mon"), createdAt, NEW_YORK, optionsOf())).toEqual({
      ok: true,
      terms: termsOf({ schedule: fixedDays("mon"), firstOccurrence: "2026-01-12", createdAt }),
      first: {
        date: "2026-01-12",
        opensAt: new Date("2026-01-12T00:00:00-05:00"),
        dueAt: new Date("2026-01-13T00:00:00-05:00"),
        closesAt: new Date("2026-01-13T00:00:00-05:00"),
      },
    });
  });

  test("the schedule is stored with its days Monday first and without repeats", () => {
    const result = newOccurrenceTerms(
      fixedDays("fri", "mon", "fri"),
      new Date("2026-01-05T09:00:00-05:00"),
      NEW_YORK,
      optionsOf(),
    );

    expect(result).toMatchObject({ ok: true, terms: { schedule: fixedDays("mon", "fri") } });
  });

  test("a schedule with no days is refused", () => {
    expect(newOccurrenceTerms(fixedDays(), new Date("2026-01-05T09:00:00-05:00"), NEW_YORK, optionsOf())).toEqual({
      ok: false,
      reason: "no-days",
    });
  });
});

describe("the occurrence open at a time", () => {
  // Mon/Wed/Fri, first occurrence Wed 7 Jan 2026.
  const terms = termsOf({ schedule: fixedDays("mon", "wed", "fri"), firstOccurrence: "2026-01-07" });
  const pact = occurrences(terms, NEW_YORK);

  test("on a scheduled day, it's that day's, open all day and due at the midnight ending it", () => {
    const wednesday = {
      date: "2026-01-07",
      opensAt: new Date("2026-01-07T00:00:00-05:00"),
      dueAt: new Date("2026-01-08T00:00:00-05:00"),
      closesAt: new Date("2026-01-08T00:00:00-05:00"),
    };

    expect(pact.openAt(new Date("2026-01-07T00:00:00-05:00"))).toEqual(wednesday);
    expect(pact.openAt(new Date("2026-01-07T23:59:59-05:00"))).toEqual(wednesday);
  });

  test("there's none on a day the schedule skips", () => {
    expect(pact.openAt(new Date("2026-01-08T12:00:00-05:00"))).toBeNull();
  });

  test("there's none before the first occurrence, even on a scheduled day", () => {
    expect(pact.openAt(new Date("2026-01-05T12:00:00-05:00"))).toBeNull();
    expect(pact.first).toEqual({
      date: "2026-01-07",
      opensAt: new Date("2026-01-07T00:00:00-05:00"),
      dueAt: new Date("2026-01-08T00:00:00-05:00"),
      closesAt: new Date("2026-01-08T00:00:00-05:00"),
    });
  });

  test("days are the owner's: 01:00 Thursday in Auckland is still Wednesday in New York", () => {
    expect(occurrences(terms, "Pacific/Auckland").openAt(new Date("2026-01-07T12:00:00Z"))).toBeNull();
    expect(pact.openAt(new Date("2026-01-07T12:00:00Z"))?.date).toBe("2026-01-07");
  });
});

describe("the occurrences due after a date, by a time", () => {
  // Mon/Wed/Fri, first occurrence Wed 7 Jan 2026.
  const terms = termsOf({ schedule: fixedDays("mon", "wed", "fri"), firstOccurrence: "2026-01-07" });
  const pact = occurrences(terms, NEW_YORK);
  const dates = (after: string | null, t: string) => pact.dueAfter(after, new Date(t)).map((o) => o.date);

  test("with no date yet, they start at the first occurrence, oldest first", () => {
    expect(dates(null, "2026-01-13T12:00:00-05:00")).toEqual(["2026-01-07", "2026-01-09", "2026-01-12"]);
  });

  test("an occurrence counts once its due time has come, not before", () => {
    expect(dates(null, "2026-01-07T23:59:59-05:00")).toEqual([]);
    expect(pact.dueAfter(null, new Date("2026-01-08T00:00:00-05:00"))).toEqual([
      {
        date: "2026-01-07",
        opensAt: new Date("2026-01-07T00:00:00-05:00"),
        dueAt: new Date("2026-01-08T00:00:00-05:00"),
        closesAt: new Date("2026-01-08T00:00:00-05:00"),
      },
    ]);
  });

  test("only those dated after the date given", () => {
    expect(dates("2026-01-07", "2026-01-13T00:00:00-05:00")).toEqual(["2026-01-09", "2026-01-12"]);
    expect(dates("2026-01-12", "2026-01-13T00:00:00-05:00")).toEqual([]);
  });

  test("never one before the first occurrence, whatever the date given", () => {
    expect(dates("2026-01-01", "2026-01-08T00:00:00-05:00")).toEqual(["2026-01-07"]);
  });
});

describe("daylight saving time", () => {
  const daily = termsOf({
    schedule: fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun"),
    firstOccurrence: "2026-01-01",
  });

  test.each([
    // New York changes at 02:00, so midnight stays put and the day is 23 or 25 hours long.
    { zone: NEW_YORK, at: "2026-03-08T12:00:00-04:00", opensAt: "2026-03-08T05:00:00Z", dueAt: "2026-03-09T04:00:00Z" },
    { zone: NEW_YORK, at: "2026-11-01T12:00:00-05:00", opensAt: "2026-11-01T04:00:00Z", dueAt: "2026-11-02T05:00:00Z" },
    // Santiago skips from 00:00 to 01:00 on Sun 6 Sep: Saturday runs until the jump.
    { zone: SANTIAGO, at: "2026-09-05T12:00:00-04:00", opensAt: "2026-09-05T04:00:00Z", dueAt: "2026-09-06T04:00:00Z" },
    { zone: SANTIAGO, at: "2026-09-06T12:00:00-03:00", opensAt: "2026-09-06T04:00:00Z", dueAt: "2026-09-07T03:00:00Z" },
    // Santiago goes back from 00:00 to 23:00 on Sun 5 Apr: Saturday gets its last hour twice.
    { zone: SANTIAGO, at: "2026-04-04T12:00:00-03:00", opensAt: "2026-04-04T03:00:00Z", dueAt: "2026-04-05T04:00:00Z" },
  ])("in $zone, the day holding $at opens at $opensAt and is due at $dueAt", ({ zone, at, opensAt, dueAt }) => {
    expect(occurrences(daily, zone).openAt(new Date(at))).toMatchObject({
      opensAt: new Date(opensAt),
      dueAt: new Date(dueAt),
      closesAt: new Date(dueAt),
    });
  });

  test("over the week New York falls back, each day is due at its own midnight, the 25-hour Sunday included", () => {
    const fallBackWeek = occurrences({ ...daily, firstOccurrence: "2026-10-30" }, NEW_YORK);

    expect(fallBackWeek.dueAfter(null, new Date("2026-11-03T00:00:00-05:00"))).toEqual([
      {
        date: "2026-10-30",
        opensAt: new Date("2026-10-30T04:00:00Z"),
        dueAt: new Date("2026-10-31T04:00:00Z"),
        closesAt: new Date("2026-10-31T04:00:00Z"),
      },
      {
        date: "2026-10-31",
        opensAt: new Date("2026-10-31T04:00:00Z"),
        dueAt: new Date("2026-11-01T04:00:00Z"),
        closesAt: new Date("2026-11-01T04:00:00Z"),
      },
      {
        date: "2026-11-01",
        opensAt: new Date("2026-11-01T04:00:00Z"),
        dueAt: new Date("2026-11-02T05:00:00Z"),
        closesAt: new Date("2026-11-02T05:00:00Z"),
      },
      {
        date: "2026-11-02",
        opensAt: new Date("2026-11-02T05:00:00Z"),
        dueAt: new Date("2026-11-03T05:00:00Z"),
        closesAt: new Date("2026-11-03T05:00:00Z"),
      },
    ]);
    // An hour before Sunday's midnight is still Sunday: 25 hours after it opened, not 24.
    expect(fallBackWeek.dueAfter("2026-10-31", new Date("2026-11-02T04:00:00Z"))).toEqual([]);
  });

  test("a pact created late on Santiago's short Saturday gets the full hour before its jump", () => {
    // 22:30 Saturday is 90 minutes before the day ends at the jump, not 30.
    const result = newOccurrenceTerms(daily.schedule, new Date("2026-09-05T22:30:00-04:00"), SANTIAGO, optionsOf());

    expect(result).toMatchObject({ ok: true, terms: { firstOccurrence: "2026-09-05" } });
  });
});

describe("bedtime nights", () => {
  const mondays = termsOf({ schedule: fixedDays("mon"), firstOccurrence: "2026-01-05" });

  test.each([
    { inBedBy: "22:30", dueAt: "2026-01-05T22:30:00-05:00" },
    { inBedBy: "00:00", dueAt: "2026-01-06T00:00:00-05:00" },
    { inBedBy: "01:30", dueAt: "2026-01-06T01:30:00-05:00" },
  ])("in bed by $inBedBy: Monday night is due at $dueAt and closes at 18:00 Tuesday", ({ inBedBy, dueAt }) => {
    expect(occurrences({ ...mondays, inBedBy }, NEW_YORK).first).toEqual({
      date: "2026-01-05",
      opensAt: new Date("2026-01-05T00:00:00-05:00"),
      dueAt: new Date(dueAt),
      closesAt: new Date("2026-01-06T18:00:00-05:00"),
    });
  });

  test.each([
    { ouraOffset: "+01:00", closesAt: "2026-01-06T18:00:00+01:00" },
    { ouraOffset: "-10:00", closesAt: "2026-01-06T18:00:00-10:00" },
    { ouraOffset: null, closesAt: "2026-01-06T18:00:00-05:00" },
  ])("on Oura's clock at $ouraOffset, Monday night closes at 18:00 Tuesday there", ({ ouraOffset, closesAt }) => {
    const night = occurrences({ ...mondays, inBedBy: "00:00" }, NEW_YORK, ouraOffset).first;
    expect(night.closesAt).toEqual(new Date(closesAt));
    // Only the close moves: the night still opens and falls due on the account's clock.
    expect(night.dueAt).toEqual(new Date("2026-01-06T00:00:00-05:00"));
    expect(nightStartsAt("2026-01-05", NEW_YORK, ouraOffset)).toEqual(
      new Date(closesAt.replace("2026-01-06", "2026-01-05")),
    );
    expect(noOuraDataPushAt("2026-01-05", NEW_YORK, ouraOffset)).toEqual(new Date(closesAt.replace("T18", "T15")));
  });

  test("a night's 18:00 on the account's clock follows its daylight saving change", () => {
    // Clocks go back at 02:00 Sun Nov 1 2026 in New York.
    const sundays = termsOf({ schedule: fixedDays("sun"), firstOccurrence: "2026-11-01" });
    expect(occurrences({ ...sundays, inBedBy: "00:00" }, NEW_YORK).first.closesAt).toEqual(
      new Date("2026-11-02T18:00:00-05:00"),
    );
    expect(nightStartsAt("2026-10-31", NEW_YORK)).toEqual(new Date("2026-10-31T18:00:00-04:00"));
  });

  test("the first night is the first whose in-bed-by time is at least an hour after creation", () => {
    const created = new Date("2026-01-05T23:10:00-05:00");
    const schedule = { kind: "fixed-days" as const, days: ["mon" as const, "tue" as const] };
    expect(newOccurrenceTerms(schedule, created, NEW_YORK, optionsOf({ inBedBy: "00:00" }))).toMatchObject({
      terms: { firstOccurrence: "2026-01-06", inBedBy: "00:00" },
    });
    // Exactly an hour is enough.
    expect(newOccurrenceTerms(schedule, created, NEW_YORK, optionsOf({ inBedBy: "00:10" }))).toMatchObject({
      terms: { firstOccurrence: "2026-01-05" },
    });
  });
});

describe("due-by times", () => {
  const daily = fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun");

  test("a day is due at its due-by time on its own date, whatever the clocks do that night", () => {
    // New York springs forward at 02:00 on Sun Mar 8 2026: 09:00 that day is EDT.
    const pact = occurrences(termsOf({ schedule: daily, firstOccurrence: "2026-03-07", dueBy: "09:00" }), NEW_YORK);

    expect(pact.between("2026-03-07", "2026-03-08").map((o) => o.dueAt)).toEqual([
      new Date("2026-03-07T09:00:00-05:00"),
      new Date("2026-03-08T09:00:00-04:00"),
    ]);
  });

  test("no day after the end date is an occurrence, or ever falls due", () => {
    const pact = occurrences(
      termsOf({ schedule: daily, firstOccurrence: "2026-01-05", endDate: "2026-01-07" }),
      NEW_YORK,
    );

    expect(pact.includes("2026-01-07")).toBe(true);
    expect(pact.includes("2026-01-08")).toBe(false);
    expect(pact.dueAfter(null, new Date("2026-02-01T00:00:00Z")).map((o) => o.date)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
  });
});

describe("Weekly count weeks", () => {
  const twice = termsOf({ schedule: { kind: "weekly-count", target: 2 }, firstOccurrence: "2026-10-26" });

  test("the week New York falls back runs from Monday's midnight to the next, 169 hours", () => {
    const week = occurrences(twice, NEW_YORK).openAt(new Date("2026-11-01T12:00:00-05:00"));

    expect(week).toEqual({
      date: "2026-10-26",
      opensAt: new Date("2026-10-26T04:00:00Z"),
      dueAt: new Date("2026-11-02T05:00:00Z"),
      closesAt: new Date("2026-11-02T05:00:00Z"),
    });
  });

  test("covers each of its days, each due at its own due-by time", () => {
    const pact = occurrences({ ...twice, dueBy: "21:00" }, NEW_YORK);

    expect(pact.covering("2026-11-01")?.date).toBe("2026-10-26");
    expect(pact.covering("2026-10-25")).toBeNull();
    expect(pact.dayDueAt("2026-11-01")).toEqual(new Date("2026-11-01T21:00:00-05:00"));
    expect(pact.dayDueAt("2026-10-31")).toEqual(new Date("2026-10-31T21:00:00-04:00"));
    expect(pact.overlapping("2026-10-29", "2026-11-03").map((o) => o.date)).toEqual(["2026-10-26", "2026-11-02"]);
  });

  test("an end date keeps only the weeks that end by it", () => {
    const pact = occurrences({ ...twice, endDate: "2026-11-11" }, NEW_YORK);

    expect(pact.between("2026-10-26", "2026-11-30").map((o) => o.date)).toEqual(["2026-10-26", "2026-11-02"]);
  });

  test("a pact made late on Sunday starts the next day", () => {
    const result = newOccurrenceTerms(twice.schedule, new Date("2026-11-01T23:30:00-05:00"), NEW_YORK, optionsOf());

    expect(result).toMatchObject({ ok: true, terms: { firstOccurrence: "2026-11-02" } });
  });
});

describe("a One-time occurrence", () => {
  const createdAt = new Date("2026-03-02T10:00:00-05:00");
  const oneTime = (submitAnytime: boolean) => ({ kind: "one-time" as const, deadline: "2026-03-08", submitAnytime });

  test("on the day New York springs forward, a 9:00am deadline is 9:00am daylight time", () => {
    const made = newOccurrenceTerms(oneTime(false), createdAt, NEW_YORK, optionsOf({ dueBy: "09:00" }));

    expect(made).toMatchObject({
      ok: true,
      first: {
        date: "2026-03-08",
        opensAt: new Date("2026-03-08T00:00:00-05:00"),
        dueAt: new Date("2026-03-08T09:00:00-04:00"),
      },
    });
  });

  test("with Submit anytime it covers every day from the pact's creation to the deadline", () => {
    const made = newOccurrenceTerms(oneTime(true), createdAt, NEW_YORK, optionsOf());
    if (!made.ok) throw new Error(made.reason);
    const { first, openAt, covering, includes } = occurrences(made.terms, NEW_YORK);

    expect(first.opensAt).toEqual(createdAt);
    expect(openAt(new Date("2026-03-02T09:59:00-05:00"))).toBeNull();
    expect(covering("2026-03-04")).toEqual(first);
    expect(covering("2026-03-09")).toBeNull();
    expect([includes("2026-03-04"), includes("2026-03-08")]).toEqual([false, true]);
  });
});

describe("an Anki due-by time that can't fit its Anki day", () => {
  // 09:00 with a 4am rollover is neither that evening nor the morning after.
  // Pacts refuse it before storing it, so meeting one is a bug: it throws rather than guess a time.
  test("throws when it's read as a due time, or sorted against another", () => {
    const terms = termsOf({
      schedule: fixedDays("mon"),
      firstOccurrence: "2026-01-05",
      dueBy: "09:00",
      ankiRollover: 4,
    });

    expect(() => occurrences(terms, NEW_YORK).covering("2026-01-05")).toThrow("can't be due by 09:00");
    expect(() => ankiDueByOrder("09:00", 4)).toThrow("can't be due by 09:00");
  });
});

describe("times of day in a day that starts at an hour", () => {
  test.each([
    { time: "18:00", startHour: NIGHT_STARTS_HOUR, minutes: 0, why: "a night starts at 18:00" },
    { time: "17:59", startHour: NIGHT_STARTS_HOUR, minutes: 1439, why: "17:59 is the night's last minute" },
    { time: "23:59", startHour: NIGHT_STARTS_HOUR, minutes: 359, why: "23:59 is before midnight" },
    { time: "00:00", startHour: NIGHT_STARTS_HOUR, minutes: 360, why: "midnight is the night's seventh hour" },
    { time: "04:00", startHour: 4, minutes: 0, why: "an Anki day starts at its rollover hour" },
    { time: "03:59", startHour: 4, minutes: 1439, why: "the minute before is the Anki day's last" },
    { time: "00:00", startHour: 0, minutes: 0, why: "a day from midnight starts at it" },
    { time: "23:59", startHour: 0, minutes: 1439, why: "and ends a minute before the next" },
  ])("$time is $minutes minutes into a day from $startHour:00: $why", ({ time, startHour, minutes }) => {
    expect(minutesFrom(time, startHour)).toBe(minutes);
  });
});

describe("how Anki due-by times sort", () => {
  test.each([
    // The usual 4am rollover: noon that day is the earliest, the rollover hour the morning after the latest.
    { dueBy: "12:00", rollover: 4, order: 8 * 60 },
    { dueBy: "23:59", rollover: 4, order: 20 * 60 - 1 },
    { dueBy: null, rollover: 4, order: 20 * 60 },
    { dueBy: "00:01", rollover: 4, order: 20 * 60 + 1 },
    { dueBy: "04:00", rollover: 4, order: 24 * 60 },
    // A midnight rollover: the midnight ending the day is the latest.
    { dueBy: "23:59", rollover: 0, order: 24 * 60 - 1 },
    { dueBy: null, rollover: 0, order: 24 * 60 },
    // A noon rollover: noon itself is the morning after's, a minute later that day's.
    { dueBy: "12:01", rollover: 12, order: 1 },
    { dueBy: "12:00", rollover: 12, order: 24 * 60 },
  ])("$dueBy with a $rollover:00 rollover sorts $order minutes after the day opens", ({ dueBy, rollover, order }) => {
    expect(ankiDueByOrder(dueBy, rollover)).toBe(order);
  });

  test("no due-by time sorts as midnight", () => {
    for (const rollover of [0, 4, 12, 23])
      expect(ankiDueByOrder(null, rollover)).toBe(ankiDueByOrder("00:00", rollover));
  });
});

describe("Anki days", () => {
  const mondays = termsOf({ schedule: fixedDays("mon"), firstOccurrence: "2026-01-05", ankiRollover: 4 });

  test.each([
    { dueBy: null, dueAt: "2026-01-06T00:00:00-05:00", why: "with no due-by time, at the midnight ending its date" },
    { dueBy: "20:00", dueAt: "2026-01-05T20:00:00-05:00", why: "an evening time on its own date" },
    { dueBy: "04:00", dueAt: "2026-01-06T04:00:00-05:00", why: "the rollover hour the morning after" },
  ])("open from the rollover hour, an Anki day is due $why", ({ dueBy, dueAt }) => {
    expect(occurrences({ ...mondays, dueBy }, NEW_YORK).first).toEqual({
      date: "2026-01-05",
      opensAt: new Date("2026-01-05T04:00:00-05:00"),
      dueAt: new Date(dueAt),
      closesAt: new Date(dueAt),
    });
  });
});

describe("terms that changed over time", () => {
  // Fixed days from Mon 5 Jan: Mondays due 09:00 until the 12th, then Mon/Wed due at midnight until the
  // 19th, then every day due 20:00, ending on Thu 22 Jan.
  const current = termsOf({
    schedule: fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun"),
    firstOccurrence: "2026-01-05",
    dueBy: "20:00",
    endDate: "2026-01-22",
  });
  const earlier = [
    { until: "2026-01-12", schedule: fixedDays("mon"), inBedBy: null, dueBy: "09:00" },
    { until: "2026-01-19", schedule: fixedDays("mon", "wed"), inBedBy: null, dueBy: null },
  ];

  test("each date follows the terms it's dated under; the first occurrence and end date are the current terms'", () => {
    const pact = occurrencesOverTime(current, earlier, NEW_YORK);

    expect(pact.between("2026-01-01", "2026-01-31").map((o) => [o.date, o.dueAt])).toEqual([
      ["2026-01-05", new Date("2026-01-05T09:00:00-05:00")],
      ["2026-01-12", new Date("2026-01-13T00:00:00-05:00")],
      ["2026-01-14", new Date("2026-01-15T00:00:00-05:00")],
      ["2026-01-19", new Date("2026-01-19T20:00:00-05:00")],
      ["2026-01-20", new Date("2026-01-20T20:00:00-05:00")],
      ["2026-01-21", new Date("2026-01-21T20:00:00-05:00")],
      ["2026-01-22", new Date("2026-01-22T20:00:00-05:00")],
    ]);
  });

  test("an end date ends the pact even on a date earlier terms schedule", () => {
    const ended = occurrencesOverTime({ ...current, endDate: "2026-01-13" }, earlier, NEW_YORK);

    expect(ended.between("2026-01-01", "2026-01-31").map((o) => o.date)).toEqual(["2026-01-05", "2026-01-12"]);
  });
});
