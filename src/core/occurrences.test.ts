// Occurrence timing, tested at its own interface: these are the calendar
// cases a scenario can't express, such as days that daylight saving time
// makes 23 or 25 hours long. Scenarios cover how the core uses it.

import { describe, expect, test } from "vitest";
import type { Weekday } from "../shared/types.ts";
import { newOccurrenceTerms, occurrences, type OccurrenceTerms } from "./occurrences.ts";

const NEW_YORK = "America/New_York";
// Chile moves its clocks at midnight, so some days have no midnight and some have it twice.
const SANTIAGO = "America/Santiago";

function fixedDays(...days: Weekday[]) {
  return { kind: "fixed-days" as const, days };
}

describe("a new pact's first occurrence", () => {
  test.each([
    { createdAt: "2026-01-05T23:00:00-05:00", first: "2026-01-05", why: "due exactly an hour later" },
    { createdAt: "2026-01-05T23:01:00-05:00", first: "2026-01-06", why: "due less than an hour later" },
  ])("a daily pact created at $createdAt starts $first: Monday is $why", ({ createdAt, first }) => {
    const daily = fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun");

    expect(newOccurrenceTerms(daily, new Date(createdAt), NEW_YORK)).toMatchObject({
      ok: true,
      terms: { firstOccurrence: first },
    });
  });

  test("a Monday-only pact created late on a Monday starts 7 days later", () => {
    expect(newOccurrenceTerms(fixedDays("mon"), new Date("2026-01-05T23:30:00-05:00"), NEW_YORK)).toEqual({
      ok: true,
      terms: { schedule: fixedDays("mon"), firstOccurrence: "2026-01-12" },
      first: {
        date: "2026-01-12",
        opensAt: new Date("2026-01-12T00:00:00-05:00"),
        dueAt: new Date("2026-01-13T00:00:00-05:00"),
      },
    });
  });

  test("the schedule is stored with its days Monday first and without repeats", () => {
    const result = newOccurrenceTerms(fixedDays("fri", "mon", "fri"), new Date("2026-01-05T09:00:00-05:00"), NEW_YORK);

    expect(result).toMatchObject({ ok: true, terms: { schedule: fixedDays("mon", "fri") } });
  });

  test("a schedule with no days is refused", () => {
    expect(newOccurrenceTerms(fixedDays(), new Date("2026-01-05T09:00:00-05:00"), NEW_YORK)).toEqual({
      ok: false,
      reason: "no-days",
    });
  });
});

describe("the occurrence open at a time", () => {
  // Mon/Wed/Fri, first occurrence Wed 7 Jan 2026.
  const terms: OccurrenceTerms = { schedule: fixedDays("mon", "wed", "fri"), firstOccurrence: "2026-01-07" };
  const pact = occurrences(terms, NEW_YORK);

  test("on a scheduled day, it's that day's, open all day and due at the midnight ending it", () => {
    const wednesday = {
      date: "2026-01-07",
      opensAt: new Date("2026-01-07T00:00:00-05:00"),
      dueAt: new Date("2026-01-08T00:00:00-05:00"),
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
    });
  });

  test("days are the owner's: 01:00 Thursday in Auckland is still Wednesday in New York", () => {
    expect(occurrences(terms, "Pacific/Auckland").openAt(new Date("2026-01-07T12:00:00Z"))).toBeNull();
    expect(pact.openAt(new Date("2026-01-07T12:00:00Z"))?.date).toBe("2026-01-07");
  });
});

describe("daylight saving time", () => {
  const daily: OccurrenceTerms = {
    schedule: fixedDays("mon", "tue", "wed", "thu", "fri", "sat", "sun"),
    firstOccurrence: "2026-01-01",
  };

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
    });
  });

  test("a pact created late on Santiago's short Saturday gets the full hour before its jump", () => {
    // 22:30 Saturday is 90 minutes before the day ends at the jump, not 30.
    const result = newOccurrenceTerms(daily.schedule, new Date("2026-09-05T22:30:00-04:00"), SANTIAGO);

    expect(result).toMatchObject({ ok: true, terms: { firstOccurrence: "2026-09-05" } });
  });
});
