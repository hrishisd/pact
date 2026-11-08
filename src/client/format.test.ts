import { describe, expect, it, test } from "vitest";
import {
  ankiMissText,
  clockText,
  clockTime,
  dateIn,
  dateUnlessToday,
  dueClockText,
  formatDate,
  formatDay,
  formatDayTime,
  formatDueAt,
  inBedByName,
  parseCents,
  remindersText,
  timeLeft,
  weekdayName,
} from "./format.ts";

describe("parseCents", () => {
  it.each([
    ["5", 500],
    ["$2.50", 250],
    ["0.5", 50],
    ["0.50", 50],
    [".5", 50],
    [".50", 50],
    ["$.80", 80],
    ["0", 0],
  ])("reads %j as %d cents", (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });

  it.each(["", ".", "$", "1.234", "abc", "-1"])("refuses %j", (text) => {
    expect(parseCents(text)).toBeNull();
  });
});

describe("bedtimes", () => {
  test.each([
    ["00:00", "12:00am", "In bed by midnight"],
    ["23:30", "11:30pm", "In bed by 11:30pm"],
    ["01:00", "1:00am", "In bed by 1am"],
    ["22:00", "10:00pm", "In bed by 10pm"],
    ["12:00", "12:00pm", "In bed by 12pm"],
  ])("%s reads %s, and names the pact %s", (time, clock, name) => {
    expect(clockText(time)).toBe(clock);
    expect(inBedByName(time)).toBe(name);
  });
});

describe("formatDueAt", () => {
  test.each([
    ["2026-01-21T23:00:00.000Z", "America/New_York", "Wed Jan 21 at 6pm"],
    ["2026-01-21T23:30:00.000Z", "America/New_York", "Wed Jan 21 at 6:30pm"],
    ["2026-01-22T05:00:00.000Z", "America/New_York", "Thu Jan 22 at 12am"],
    ["2026-01-21T05:00:00.000Z", "Pacific/Auckland", "Wed Jan 21 at 6pm"],
  ])("%s in %s reads %s", (instant, timeZone, text) => {
    expect(formatDueAt(instant, timeZone)).toBe(text);
  });
});

describe("dueClockText", () => {
  test.each([
    ["2026-01-22T05:00:00.000Z", "America/New_York", "midnight"],
    ["2026-01-22T02:00:00.000Z", "America/New_York", "9:00pm"],
    ["2026-01-22T06:30:00.000Z", "America/New_York", "1:30am"],
    ["2026-01-22T05:00:00.000Z", "America/Los_Angeles", "9:00pm"],
  ])("%s in %s reads %s", (instant, timeZone, text) => {
    expect(dueClockText(instant, timeZone)).toBe(text);
  });
});

describe("Anki check times read in the profile's timezone", () => {
  const checkedAt = "2026-01-21T23:50:00.000Z";

  test.each([
    ["America/New_York", "6:50pm"],
    ["America/Los_Angeles", "3:50pm"],
  ])("in %s, %s", (timeZone, time) => {
    expect(clockTime(checkedAt, timeZone)).toBe(time);
    expect(ankiMissText({ cardsLeft: 12, checkedAt }, timeZone)).toBe(`12 cards left at ${time}`);
  });
});

describe("timeLeft", () => {
  const HOUR = 3_600_000;
  test.each([
    [45 * HOUR + 20 * 60_000, "1d 21h"],
    [24 * HOUR, "1d 0h"],
    [24 * HOUR - 60_000, "23h 59m"],
    [5 * HOUR, "5h 0m"],
    [-1, "0h 0m"],
  ])("%d ms reads %s", (ms, text) => {
    expect(timeLeft(ms)).toBe(text);
  });
});

describe("dateIn", () => {
  // 03:00 UTC on Jan 8 is still Jan 7 in New York, and already Jan 8 in Tokyo, whatever this device says.
  const instant = Date.parse("2026-01-08T03:00:00.000Z");

  test.each([
    ["America/New_York", "2026-01-07"],
    ["Asia/Tokyo", "2026-01-08"],
    ["UTC", "2026-01-08"],
  ])("in %s, %s", (timeZone, date) => {
    expect(dateIn(instant, timeZone)).toBe(date);
  });
});

describe("dateUnlessToday", () => {
  // Noon on Thu Nov 12 2026 in New York.
  const now = Date.parse("2026-11-12T17:00:00.000Z");

  test("is null for today in the profile's timezone, and the date otherwise", () => {
    expect(dateUnlessToday("2026-11-12", now, "America/New_York")).toBeNull();
    expect(dateUnlessToday("2026-11-13", now, "America/New_York")).toBe("Fri Nov 13");
    // Already Fri Nov 13 in Tokyo.
    expect(dateUnlessToday("2026-11-12", now, "Asia/Tokyo")).toBe("Thu Nov 12");
  });

  test("names the same weekday and day of another year, which reads the same", () => {
    // Nov 12 2020 was a Thursday too.
    expect(dateUnlessToday("2020-11-12", now, "America/New_York")).toBe("Thu Nov 12");
  });
});

describe("days as written", () => {
  test.each([
    ["2026-01-07", "Wed Jan 7", "Wednesday"],
    ["2026-01-01", "Thu Jan 1", "Thursday"],
    ["2028-02-29", "Tue Feb 29", "Tuesday"],
    ["2026-03-08", "Sun Mar 8", "Sunday"],
  ])("%s reads %s, a %s", (date, text, weekday) => {
    expect(formatDate(date)).toBe(text);
    expect(weekdayName(date)).toBe(weekday);
  });
});

describe("instants in the profile's timezone", () => {
  test.each([
    ["2026-01-22T05:00:00.000Z", "America/New_York", "Thu Jan 22", "Thu Jan 22, 12:00am", "12:00am"],
    ["2026-01-22T04:59:00.000Z", "America/New_York", "Wed Jan 21", "Wed Jan 21, 11:59pm", "11:59pm"],
    ["2026-01-22T17:05:00.000Z", "America/New_York", "Thu Jan 22", "Thu Jan 22, 12:05pm", "12:05pm"],
    ["2026-01-22T14:09:00.000Z", "America/New_York", "Thu Jan 22", "Thu Jan 22, 9:09am", "9:09am"],
    // 2am on Mar 8 2026 is skipped in New York: 07:00 UTC is 3am.
    ["2026-03-08T07:00:00.000Z", "America/New_York", "Sun Mar 8", "Sun Mar 8, 3:00am", "3:00am"],
    ["2026-01-22T05:00:00.000Z", "Asia/Kolkata", "Thu Jan 22", "Thu Jan 22, 10:30am", "10:30am"],
  ])("%s in %s is %s, %s", (instant, timeZone, day, dayTime, clock) => {
    expect(formatDay(instant, timeZone)).toBe(day);
    expect(formatDayTime(instant, timeZone)).toBe(dayTime);
    expect(clockTime(instant, timeZone)).toBe(clock);
  });

  test.each([
    ["2026-03-08T04:59:00.000Z", "2026-03-07"],
    ["2026-03-08T05:00:00.000Z", "2026-03-08"],
    ["2026-11-01T03:59:00.000Z", "2026-10-31"],
    ["2026-11-01T04:00:00.000Z", "2026-11-01"],
  ])("around a clock change, %s is %s in New York", (instant, date) => {
    expect(dateIn(Date.parse(instant), "America/New_York")).toBe(date);
  });
});

describe("remindersText", () => {
  test.each([
    [[], "None"],
    [["18:00", "20:30"], "6:00pm, 8:30pm"],
    [["00:00"], "12:00am"],
    [["2026-01-07T09:00", "2026-01-07T23:45"], "Wed Jan 7, 9:00am, Wed Jan 7, 11:45pm"],
  ])("%j reads %s", (reminders, text) => {
    expect(remindersText(reminders)).toBe(text);
  });
});
