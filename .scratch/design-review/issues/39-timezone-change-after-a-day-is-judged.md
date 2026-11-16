# After a timezone change, judged days and stale-item pushes disagree with the rules

Status: needs-triage
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`) run with `FUZZ_TIMEZONE_CHANGES=1`. A person can change their timezone in Profile (`setTimezone`, `accounts.ts`). Every due time is then worked out again in the new timezone, also for days already judged. The stored outcome and penalty stay as they were. The two can then disagree, and `verdictOf` (`src/core/verdict.ts`), which every scenario test holds stored outcomes to, no longer matches what is stored. No rule in `docs/behaviour.md` says which one is right. In 80 runs of 200 steps (seeds 2000 to 2079), 6 broke an invariant. They are three cases.

1. A Missed day becomes open again. An owner in UTC has an Anki pact for Friday 3 April. The day is judged Missed at Saturday 00:00 UTC, with its penalty. At 01:35 UTC the owner moves to Pacific/Honolulu, where it is still Friday afternoon. `verdictOf` now says the day is open; the store says Missed with a penalty. Reproduce: `FUZZ_TIMEZONE_CHANGES=1 FUZZ_STEPS=200 FUZZ_SEEDS=2000 npx vitest run src/core/fuzz.test.ts` (shrinks to 5 actions).
2. A Missed day is no longer one of the pact's days. An owner in Pacific/Auckland has a One-time pact by 5 April. It is judged Missed at its due time, 12:00 UTC on 5 April, and the pact Ends then. The owner moves to America/New_York. `verdictOf` now says 5 April is not the pact's day; the store keeps the Missed outcome and the penalty. Reproduce with seed 2044 (shrinks to 3 actions and the move).
3. A second stale-items push on one local date. `docs/behaviour.md` says a reviewer gets the 09:00 push about waiting review items once a day at most. `remindStale` (`src/core/stale-items.ts`) compares dates in the reviewer's current timezone, so a reviewer who moves west after the push (Asia/Kolkata to America/New_York) can get a second one dated the same local day. Reproduce with seed 2029.

A fourth pattern is not a bug: a move east can put a due time in the past, and the day is judged at the next tick, at most a minute later (seeds 2001, 2038, 2064). The check in `src/core/testing/verdict-check.ts` reports it because it does not expect a due time to pass without the clock moving.

Not checked: what the pact page, Today and the ledger show the owner in cases 1 and 2, and whether the owner can still send evidence for the day in case 1. Money looks safe: `settle` (`src/core/settle.ts`) only ever changes a Missed day to Excused.

## What to build

Decide the rule, then make the code and `verdictOf` follow it. Directions to weigh:

- A day once judged stays judged, with the due time it was judged at. `verdictOf` then needs the stored judging time as a fact, or the occurrence stores the timezone it was judged in. Screens show a judged day as judged.
- A timezone change applies only to days that have not opened yet. Days open at the change keep the old due time. This also closes a way to gain hours on an open day by moving west.
- For the stale-items push, keep the last push's instant and require 24 hours less a margin, or accept one repeat and correct the doc.

## Acceptance criteria

- [ ] `docs/behaviour.md` states what a timezone change does to judged days and to open days.
- [ ] `verdictOf` agrees with stored outcomes after any timezone change; the `judgingTimesMayMove` option of `scenario()` is removed.
- [ ] `FUZZ_TIMEZONE_CHANGES=1 FUZZ_SEEDS=2000-2079 FUZZ_STEPS=200 npx vitest run src/core/fuzz.test.ts` passes, and timezone changes are on by default in `setupOf` (`src/core/testing/fuzz.ts`).
- [ ] `npm run check` passes.
