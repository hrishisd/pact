import { describe, expect, it, test } from "vitest";
import {
  ankiMissText,
  clockText,
  clockTime,
  dueClockText,
  formatDueAt,
  inBedByName,
  parseCents,
  timeLeft,
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
