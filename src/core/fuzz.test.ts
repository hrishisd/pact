// The randomised test of the core (testing/fuzz.ts): random runs of commands
// and ticks, with the invariants in testing/fuzz-invariants.ts checked after
// every one.
//
// `npm test` runs the fixed seeds below. To look for new failures, run more:
//
//   FUZZ_SEEDS=1000-1499 npx vitest run src/core/fuzz.test.ts
//   FUZZ_SEEDS=1234 FUZZ_STEPS=400 npx vitest run src/core/fuzz.test.ts
//
// A failure prints the seed, the invariant broken, and the shortest run found
// that still breaks it, as what each action did. FUZZ_SHRINK=0 skips the
// shortening.

import { writeFileSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { actionsOf, run, setupOf, shrink, STATS } from "./testing/fuzz.ts";

const FIXED_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function seeds(): number[] {
  const asked = process.env.FUZZ_SEEDS;
  if (asked === undefined || asked === "") return FIXED_SEEDS;
  return asked.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number) as [number, number | undefined];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
}

const steps = Number(process.env.FUZZ_STEPS ?? 150);

test.each(seeds())("seed %i keeps every invariant", { timeout: 600_000 }, async (seed) => {
  const setup = setupOf(seed);
  const actions = actionsOf(seed, steps);
  const result = await run(setup, actions);
  if (result.violation === null) return;
  const { invariant } = result.violation;
  const short =
    process.env.FUZZ_SHRINK === "0"
      ? { actions: actions.slice(0, result.steps), result }
      : await shrink(setup, actions.slice(0, result.steps), invariant);
  expect.fail(
    [
      `FUZZ seed ${seed} broke ${invariant} at step ${result.steps} of ${steps}`,
      `setup: ${JSON.stringify(setup)}`,
      short.result.violation?.message ?? result.violation.message,
      `the shortest run found that breaks it (${short.actions.length} actions):`,
      ...short.result.log.map((line) => `  ${line}`),
    ].join("\n"),
  );
});

afterAll(() => {
  const path = process.env.FUZZ_STATS;
  if (path !== undefined) writeFileSync(path, JSON.stringify([...STATS].sort(), null, 1));
});
