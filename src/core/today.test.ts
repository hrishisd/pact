import { describe, expect, test } from "vitest";
import { scenario } from "./testing/scenario.ts";

describe("Today", () => {
  test("a new account has nothing to do right now", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await owner.setTimezone("America/New_York");

    expect(owner.today()).toEqual({ alerts: [], sections: [], waiting: [], yesterday: [] });
  });
});
