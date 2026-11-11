// The check every scenario runs after each command and tick: stored outcomes
// must be what verdictOf says. These prove it catches a stored outcome that
// differs, and that it lets through only the mismatches listed as known.

import { expect, test } from "vitest";
import { openWithPragmas } from "../db.ts";
import { EVERY_DAY, ownerWithReviewers, submit } from "./camera-pact.ts";
import { ok, statusOn } from "./queries.ts";
import { scenario, type Scenario } from "./scenario.ts";
import { knownMismatchTicket, SourceWatch, VerdictCheck } from "./verdict-check.ts";

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

test("evidence approved after an excuse made its day Excused is a known mismatch: the day stays Excused (ticket 26)", async () => {
  const s = scenario();
  const { owner, reviewer, createPact } = await ownerWithReviewers(s);
  const gym = await createPact("Gym", EVERY_DAY);
  await s.advanceTo("Thu 20:00");
  const evidenceId = await submit(owner, gym);
  await s.advanceTo("Fri 01:00");
  const excuse = ok(await owner.fileExcuse(gym, { from: s.date("Thu"), to: s.date("Thu"), reason: "Ran late" }, []));
  ok(await reviewer.decide(excuse.excuseId, { kind: "approve" }));

  ok(await reviewer.decide(evidenceId, { kind: "approve" }));

  expect(statusOn(owner, gym, s.date("Thu"))).toBe("excused");
  const check = checkOf(s);
  const mismatches = check.mismatches();
  check.close();
  expect(mismatches).toEqual([
    expect.objectContaining({
      pactId: gym,
      date: s.date("Thu"),
      stored: expect.objectContaining({ outcome: "excused" }),
      verdict: { kind: "satisfied", at: s.at("Fri 01:00") },
    }),
  ]);
  expect(knownMismatchTicket(mismatches[0]!)).toBe("26-late-approval-satisfies-excused-day.md");
});
