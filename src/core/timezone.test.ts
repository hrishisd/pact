import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("account timezone", () => {
  test("changing the timezone shows up in the profile", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.setTimezone("America/Chicago")).toEqual({ ok: true, timezone: "America/Chicago" });

    expect(owner.profile().timezone).toBe("America/Chicago");
  });

  test("a zone is stored, and answered, under its canonical name", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    expect(await owner.setTimezone("america/chicago")).toEqual({ ok: true, timezone: "America/Chicago" });

    expect(owner.profile().timezone).toBe("America/Chicago");
  });

  test("changing it later replaces it, and survives a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");

    await owner.setTimezone("Europe/London");
    await s.restart();

    expect(owner.profile().timezone).toBe("Europe/London");
  });

  test.each(["Mars/Olympus_Mons", "", "EST5EDT nonsense", "+05:00"])(
    "an invalid timezone (%j) is rejected and the old one kept",
    async (bad) => {
      const s = scenario();
      const owner = await s.signIn("owner");
      await owner.setTimezone("America/Chicago");

      expect(await owner.setTimezone(bad)).toEqual({ ok: false, reason: "invalid-timezone" });

      expect(owner.profile().timezone).toBe("America/Chicago");
    },
  );
});
