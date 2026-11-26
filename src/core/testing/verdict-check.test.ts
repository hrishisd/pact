// The check every scenario runs after each command and tick: stored outcomes
// must be what verdictOf says. This proves it catches a stored outcome that
// differs.

import { expect, test } from "vitest";
import { openWithPragmas } from "../db.ts";
import { EVERY_DAY, ownerWithReviewers } from "./camera-pact.ts";
import { bedtimePact } from "./bedtime-pact.ts";
import { ok, statusOn } from "./queries.ts";
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

test("an Apple Health night's bedtime is checked against the samples uploaded, not what's stored", async () => {
  const s = scenario();
  const owner = await s.signIn("owner");
  const reviewer = await s.befriend(owner, "reviewer");
  const sam = ok(await owner.addRecipient({ name: "Sam" })).recipient;
  await owner.makeAppleHealthKey();
  const pact = { ...bedtimePact(sam.id, reviewer, "00:00", ["mon"]), evidenceKind: "apple_health" as const };
  const pactId = ok(await owner.createPact(pact)).pactId;
  s.setClockTo("Tue 08:00");
  const sleep = { type: "sleep", start: "2026-01-05T23:00:00-05:00", end: "2026-01-06T07:00:00-05:00" };
  await owner.uploadAppleHealth({ samples: [{ ...sleep, value: "Asleep", source: "Oura" }], unreadableLines: 0 });
  expect(statusOn(owner, pactId, s.date("Mon"))).toBe("satisfied");

  // Judged before the upload, as if the sleep had arrived then: the stored facts alone agree with the outcome.
  const earlier = s.at("Tue 07:55").toISOString();
  const db = openWithPragmas(s.dbPath);
  db.prepare(`UPDATE occurrence SET bedtime_arrived_at = ?, judged_at = ? WHERE pact_id = ? AND date = ?`).run(
    earlier,
    earlier,
    pactId,
    s.date("Mon"),
  );
  db.close();

  await expect(owner.setTimezone("America/New_York")).rejects.toThrow(`pact ${pactId} ${s.date("Mon")}`);
});
