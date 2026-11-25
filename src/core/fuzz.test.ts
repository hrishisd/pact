// The randomised test of the core (testing/fuzz.ts): random runs of commands
// and ticks, with the invariants in testing/fuzz-invariants.ts checked after
// every one.
//
// `npm test` runs the fixed seeds below. To look for new failures, run more:
//
//   FUZZ_SEEDS=1000-1499 npx vitest run src/core/fuzz.test.ts
//   FUZZ_SEEDS=1234 FUZZ_STEPS=400 npx vitest run src/core/fuzz.test.ts
//
// A quarter of the seeds have people change their timezone during the run.
//
// A failure prints at once the seed, the invariant broken and the command to
// re-run it. Then it looks for the shortest run that still breaks it, for up
// to 2 minutes (FUZZ_SHRINK_SECONDS), and fails with that run, as what each
// action did. FUZZ_SHRINK=0 skips the shortening.

import { writeFileSync, writeSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { actionsOf, run, runBothWays, setupOf, shrink, STATS, type RunResult } from "./testing/fuzz.ts";

const FIXED_SEEDS = [1, 2, 3, 4];

function seeds(): number[] {
  const asked = process.env.FUZZ_SEEDS;
  if (asked === undefined || asked === "") return FIXED_SEEDS;
  return asked.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number) as [number, number | undefined];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
}

const steps = Number(process.env.FUZZ_STEPS ?? 100);
const shrinkSeconds = Number(process.env.FUZZ_SHRINK_SECONDS ?? 120);
const wallClockMs = () => performance.now(); // conventions-ok: caps shrinking by wall time, never decides a result

/** Runs a seed with `runner` and fails with the shortest run found that breaks the same invariant. */
async function keepsEveryInvariant(seed: number, runner: typeof run): Promise<void> {
  const setup = setupOf(seed);
  const actions = actionsOf(seed, steps);
  const result: RunResult = await runner(setup, actions);
  if (result.violation === null) return;
  const { invariant } = result.violation;
  const head = [
    `FUZZ seed ${seed} broke ${invariant} at step ${result.steps} of ${steps}`,
    `setup: ${JSON.stringify(setup)}`,
  ];
  const which = runner === run ? "one" : "both-ways";
  const rerun = `FUZZ_MODE=${which} FUZZ_SEEDS=${seed} FUZZ_STEPS=${result.steps} FUZZ_SHRINK=0`;
  // Straight to stderr, not through vitest's console, which holds output until
  // the test ends: a run killed while shrinking still leaves the seed.
  writeSync(
    2,
    [...head, result.violation.message, `re-run it: ${rerun} npx vitest run src/core/fuzz.test.ts`, ""].join("\n"),
  );
  const stopAt = wallClockMs() + shrinkSeconds * 1000;
  const short =
    process.env.FUZZ_SHRINK === "0"
      ? { actions: actions.slice(0, result.steps), result, stopped: false }
      : await shrink(setup, actions, result, runner, () => wallClockMs() > stopAt);
  expect.fail(
    [
      ...head,
      short.result.violation?.message ?? result.violation.message,
      `the shortest run found that breaks it (${short.actions.length} actions` +
        (short.stopped ? `; shrinking stopped after ${shrinkSeconds} s, the FUZZ_SHRINK_SECONDS cap` : "") +
        "):",
      ...short.result.log.map((line) => `  ${line}`),
    ].join("\n"),
  );
}

// FUZZ_MODE=both-ways runs only the second test, and FUZZ_MODE=one only the first.
const mode = process.env.FUZZ_MODE;

test.skipIf(mode === "both-ways").each(seeds())("seed %i keeps every invariant", { timeout: 600_000 }, (seed) =>
  keepsEveryInvariant(seed, run),
);

// With the fixed seeds, one is enough: each run is two scenarios.
test.skipIf(mode === "one").each(process.env.FUZZ_SEEDS ? seeds() : FIXED_SEEDS.slice(0, 1))(
  "seed %i answers the same after one tick or many",
  { timeout: 600_000 },
  (seed) => keepsEveryInvariant(seed, runBothWays),
);

afterAll(() => {
  const path = process.env.FUZZ_STATS;
  if (path !== undefined) writeFileSync(path, JSON.stringify([...STATS].sort(), null, 1));
});
