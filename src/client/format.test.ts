import { describe, expect, it } from "vitest";
import { parseCents } from "./format.ts";

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
