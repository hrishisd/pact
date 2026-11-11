# A vacation test runs close to Vitest's 5-second timeout

Status: ready-for-agent
Blocked by: none

## Problem

Found while reviewing ticket 26. `src/core/vacations.test.ts`, "after a rejection" > "rejected on Fri+1, long after Mon+1's own 48 hours: an excuse for Mon+1 is accepted within 48 hours of the rejection and refused after (R3)", takes 3.5–4.2 s run on its own (two full scenarios, each advancing about a week). Under `npm run check`'s full parallel run it timed out once at 5000 ms and passed on a rerun, with no code change between. The same timing holds on the code before ticket 26.

## What to build

Make the test fast enough to stay well under the timeout: for example split the two cases (`Sun+1 07:59` accepted, `Sun+1 08:00` refused) into two tests, or find what in the scenario's week of ticks is slow (the verdict check, hourly ticks) and cut it. Don't raise the timeout to hide it.

## Acceptance criteria

- [ ] The test (or its parts) runs in under 2 s on its own.
- [ ] `npm run check` passes.
