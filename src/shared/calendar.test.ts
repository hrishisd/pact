import { describe, expect, test } from "vitest";
import { addDays, parseClockTime, parseDatedReminder, parseLocalDate } from "./calendar.ts";

describe("parseLocalDate", () => {
  test.each([
    ["2026-01-05", { year: 2026, month: 1, day: 5 }],
    ["2026-12-31", { year: 2026, month: 12, day: 31 }],
    ["0024-02-09", { year: 24, month: 2, day: 9 }],
    // It reads the numbers only: whether the day exists is the caller's to check.
    ["2026-13-40", { year: 2026, month: 13, day: 40 }],
  ])("%s reads %j", (date, parts) => {
    expect(parseLocalDate(date)).toEqual(parts);
  });

  test.each(["2026-01", "", "2026-01-xx"])("%j has no day", (date) => {
    expect(parseLocalDate(date).day).toBeNaN();
  });
});

describe("parseClockTime", () => {
  test.each([
    ["00:00", { hour: 0, minute: 0 }],
    ["07:05", { hour: 7, minute: 5 }],
    ["12:30", { hour: 12, minute: 30 }],
    ["23:59", { hour: 23, minute: 59 }],
    // Like parseLocalDate, it doesn't check the range.
    ["24:00", { hour: 24, minute: 0 }],
  ])("%s reads %j", (time, parts) => {
    expect(parseClockTime(time)).toEqual(parts);
  });

  test("a time with no minutes has none", () => {
    expect(parseClockTime("7").minute).toBeNaN();
  });
});

describe("parseDatedReminder", () => {
  test("splits the day from the clock time", () => {
    expect(parseDatedReminder("2026-01-07T09:00")).toEqual({ date: "2026-01-07", time: "09:00" });
  });

  test.each([
    ["09:00", { date: "09:00", time: "" }],
    ["2026-01-07T", { date: "2026-01-07", time: "" }],
    ["", { date: "", time: "" }],
  ])("%j, with no clock time after a T, reads %j", (reminder, parts) => {
    expect(parseDatedReminder(reminder)).toEqual(parts);
  });
});

describe("addDays", () => {
  test.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-02-01", -1, "2026-01-31"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-01-05", 6, "2026-01-11"],
    ["2026-01-05", -7, "2025-12-29"],
    ["2026-01-01", 365, "2027-01-01"],
    ["2028-01-01", 366, "2029-01-01"],
    // Days on which clocks change in New York and London still step by one day.
    ["2026-03-07", 1, "2026-03-08"],
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-11-01", -1, "2026-10-31"],
    ["2026-03-29", 1, "2026-03-30"],
  ])("%s plus %d is %s", (date, days, after) => {
    expect(addDays(date, days)).toBe(after);
  });

  test.each([
    ["2026-01-05", "2026-01-05"],
    // A day that doesn't exist rolls over, so isLocalDate can refuse it by comparing.
    ["2026-02-30", "2026-03-02"],
    ["2026-04-31", "2026-05-01"],
    ["2026-01-00", "2025-12-31"],
  ])("%s plus 0 is %s", (date, after) => {
    expect(addDays(date, 0)).toBe(after);
  });

  test("a date it can't read throws", () => {
    expect(() => addDays("2026-01", 1)).toThrow(RangeError);
  });
});
