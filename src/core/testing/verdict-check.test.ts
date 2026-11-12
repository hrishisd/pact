// The check every scenario runs after each command and tick: stored outcomes
// must be what verdictOf says. This proves it catches a stored outcome that
// differs.

import { expect, test } from "vitest";
import { openWithPragmas } from "../db.ts";
import { EVERY_DAY, ownerWithReviewers } from "./camera-pact.ts";
import { statusOn } from "./queries.ts";
import { scenario, type Scenario } from "./scenario.ts";
import { SourceWatch, VerdictCheck } from "./verdict-check.ts";

/** A check of the scenario's database of its own, apart from the one the scenario runs. */
function checkOf(s: Scenario): VerdictCheck {
  const check = new VerdictCheck(s.dbPath, s.clock, new SourceWatch(s.clock));
  return check;
}

test("a stored outcome that isn't the verdict fails the check", async () => {
  const s = scenario();
  const { owner, createPact } = await ownerWithReviewers(s);
  const gym = await createPact("Gym", EVERY_DAY);
  await s.advanceTo("Wed 00:00");
  expect(statusOn(owner, gym, s.date("Tue"))).toBe("missed");

  // Only this test writes to storage behind the core's back, to make judging look wrong.
  const db = openWithPragmas(s.dbPath);
  db.prepare(`UPDATE occurrence SET outcome = 'satisfied' WHERE pact_id = ? AND date = ?`).run(gym, s.date("Tue"));
  db.close();

  const check = checkOf(s);
  expect(() => check.check()).toThrow(`pact ${gym} ${s.date("Tue")}: stored {"outcome":"satisfied"`);
  check.close();
});
