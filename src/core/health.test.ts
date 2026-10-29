import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("health", () => {
  test("is not ok before the first scheduler tick", () => {
    const s = scenario();

    expect(s.core.health()).toEqual({ ok: false, lastTick: null });
  });

  test("is ok right after a tick and up to 5 minutes later", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");
    expect(s.core.health()).toEqual({ ok: true, lastTick: new Date("2026-01-05T23:00:00Z") });

    s.setClockTo("Mon 18:05");
    expect(s.core.health().ok).toBe(true);
  });

  test("fails once the clock is more than 5 minutes past the last tick", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");

    s.setClockTo("2026-01-05T23:05:01Z");

    expect(s.core.health()).toEqual({ ok: false, lastTick: new Date("2026-01-05T23:00:00Z") });
  });

  test("recovers when ticks resume", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");
    s.setClockTo("Mon 18:30");
    expect(s.core.health().ok).toBe(false);

    await s.advanceTo("Mon 18:31");

    expect(s.core.health().ok).toBe(true);
  });
});
