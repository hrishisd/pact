import { expect, test } from "vitest";
import { referenceDate, scenario } from "./scenario.ts";

test.each([
  ["Mon", "2026-01-05"],
  ["Tue", "2026-01-06"],
  ["Wed", "2026-01-07"],
  ["Thu", "2026-01-08"],
  ["Fri", "2026-01-09"],
  ["Sat", "2026-01-10"],
  ["Sun", "2026-01-11"],
  ["Tue+0", "2026-01-06"],
  ["Wed+1", "2026-01-14"],
  ["Sun+2", "2026-01-25"],
  // Past the end of January.
  ["Sun+3", "2026-02-01"],
  ["Mon+12", "2026-03-30"],
])("%s is %s", (day, date) => {
  expect(referenceDate(day)).toBe(date);
});

test.each(["mon", "Tuesday", "Tue+", "Tue-1", "Tue +1", "Tue+1.5", " Tue", "Tue 00:00", ""])(
  'a day that is not a day name with an optional "+N" throws, naming it: %j',
  (day) => {
    expect(() => referenceDate(day)).toThrow(`unreadable scenario day "${day}"`);
  },
);

test("s.date reads days as referenceDate does", () => {
  const s = scenario();
  expect(s.date("Thu")).toBe("2026-01-08");
  expect(s.date("Thu+1")).toBe("2026-01-15");
});

test("s.at reads the day as s.date does, at New York wall time", () => {
  const s = scenario();
  expect(s.at("Mon 09:00")).toEqual(new Date("2026-01-05T14:00:00Z"));
  expect(s.at("Wed+1 18:00")).toEqual(new Date("2026-01-14T23:00:00Z"));
  // 8 March 2026 is the first day of daylight saving time.
  expect(s.at("Sun+8 12:00")).toEqual(new Date("2026-03-08T16:00:00Z"));
});

test.each(["Mon 9:00", "mon 09:00", "Mon+ 09:00", "Mon"])("s.at throws on %j", (when) => {
  const s = scenario();
  expect(() => s.at(when)).toThrow(`unreadable scenario time "${when}"`);
});
