import { expect, test } from "vitest";
import { sleep } from "./bedtime-pact.ts";

// The dates sleep() named before it shared the scenario's day parser.
test.each([
  ["Mon", "2026-01-05"],
  ["Tue", "2026-01-06"],
  ["Wed", "2026-01-07"],
  ["Thu", "2026-01-08"],
  ["Fri", "2026-01-09"],
  ["Sat", "2026-01-10"],
  ["Sun", "2026-01-11"],
])('sleep("%s 23:40") is the period starting %sT23:40 New York', (day, date) => {
  expect(sleep(`${day} 23:40`)).toEqual(sleep(`${date}T23:40:00-05:00`));
});

test('a night is put on the day it ends, and "+N" moves it N weeks on', () => {
  expect(sleep("Tue 23:40")).toMatchObject({
    day: "2026-01-07",
    bedtime_start: "2026-01-06T23:40:00-05:00",
    bedtime_end: "2026-01-07T06:40:00-05:00",
  });
  expect(sleep("Tue+1 01:00", "sleep")).toMatchObject({
    id: "sleep-sleep-2026-01-13T01:00:00-05:00",
    day: "2026-01-13",
    bedtime_start: "2026-01-13T01:00:00-05:00",
    bedtime_end: "2026-01-13T08:00:00-05:00",
    type: "sleep",
  });
});

test.each([
  ["Tue 23:40:00", 'unreadable sleep start "Tue 23:40:00"'],
  ["Tue 9:00", 'unreadable sleep start "Tue 9:00"'],
  ["2026-01-06T23:40:00Z", 'unreadable sleep start "2026-01-06T23:40:00Z"'],
  ["Tuesday 23:40", 'unreadable scenario day "Tuesday"'],
])("sleep(%j) throws", (start, message) => {
  expect(() => sleep(start)).toThrow(message);
});

test("a night after the clocks go forward is written with New York's summer offset", () => {
  // The reference week's Mon+10 is 2026-03-16, after the change on 2026-03-08.
  expect(sleep("Mon+10 23:40")).toMatchObject({
    day: "2026-03-17",
    bedtime_start: "2026-03-16T23:40:00-04:00",
    bedtime_end: "2026-03-17T06:40:00-04:00",
  });
  // The night of the change starts in winter time and is written so.
  expect(sleep("Sat+8 23:00").bedtime_start).toBe("2026-03-07T23:00:00-05:00");
});

test("a start the clocks skip throws", () => {
  // Sun+8 is 2026-03-08, when 02:00 jumps to 03:00 in New York.
  expect(() => sleep("Sun+8 02:30")).toThrow('sleep start "Sun+8 02:30" is skipped by the clocks in America/New_York');
});
