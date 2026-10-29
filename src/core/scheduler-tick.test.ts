import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("advance to T (the scheduler tick)", () => {
  test("records the tick", async () => {
    const s = scenario();
    expect(s.core.lastTick()).toBeNull();

    await s.advanceTo("Mon 18:00");

    // Mon 18:00 in New York during the reference week.
    expect(s.core.lastTick()).toEqual(new Date("2026-01-05T23:00:00Z"));
  });

  test("the last tick survives a restart", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");
    await s.advanceTo("Mon 18:01");

    await s.restart();

    expect(s.core.lastTick()).toEqual(new Date("2026-01-05T23:01:00Z"));
  });
});
