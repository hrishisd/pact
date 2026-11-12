# A vacation test runs close to Vitest's 5-second timeout

Status: done
Blocked by: none

## Problem

Found while reviewing ticket 26. `src/core/vacations.test.ts`, "after a rejection" > "rejected on Fri+1, long after Mon+1's own 48 hours: an excuse for Mon+1 is accepted within 48 hours of the rejection and refused after (R3)", takes 3.5–4.2 s run on its own (two full scenarios, each advancing about a week). Under `npm run check`'s full parallel run it timed out once at 5000 ms and passed on a rerun, with no code change between. The same timing holds on the code before ticket 26.

## What to build

Make the test fast enough to stay well under the timeout: for example split the two cases (`Sun+1 07:59` accepted, `Sun+1 08:00` refused) into two tests, or find what in the scenario's week of ticks is slow (the verdict check, hourly ticks) and cut it. Don't raise the timeout to hide it.

## Acceptance criteria

- [x] The test (or its parts) runs in under 2 s on its own.
- [x] `npm run check` passes.

## Comments

2026-11-12: Split into two tests (`test.each`, one scenario per instant) and the scenario now ticks hourly from Mon+1 00:00, not Wed 13:00: Gym has nothing due before Mon+1, so one tick covers the idle days (`waitingOverGym` takes an optional `hourlyFrom`). The test also checks Mon+1 is Missed before the rejection. Run on its own: 3.7 s before, about 0.87 s per part after. Profiling the old run, the verdict check was minor (about 0.5 s of 3.7 s); `remindStale` was the largest part of each tick (about 1.4 s), filed as ticket 34.
