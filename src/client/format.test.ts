import { describe, expect, it, test } from "vitest";
import { clockText, inBedByName, parseCents } from "./format.ts";

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
