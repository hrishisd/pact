# A bedtime night already judged changes its close when Oura later reports another clock

Status: needs-triage
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`, seed 4019 with 300 steps) once timezone changes were on (ticket 39). A bedtime night with no sleep closes at 18:00 the next day "on Oura's clock": the UTC offset of the latest sleep Oura reported for the account (`ouraOffset`, `src/core/rows.ts`). That offset is one value per account and it applies to every night, also to nights already judged.

A traveller shows it. An owner in New York has a Monday night that closes Missed at Tuesday 18:00 New York time. Later Oura reports a sleep with the offset `+01:00`. `verdictOf` now puts Monday's close six hours earlier than the stored judging time. The outcome and the penalty do not change. What can change is anything read from the night's close after the fact.

Not checked: whether a screen or the excuse window reads the recomputed close instead of the stored judging time, and so whether the owner can see or gain anything.

The scenario check skips this mismatch through `KNOWN_MISMATCHES` in `src/core/testing/verdict-check.ts` until the fix.

## What to build

A night keeps the clock it closed on, as an occurrence keeps the timezone it opened in (ticket 39). Directions to weigh:

- Store the offset a night was judged on with the night, and read a judged night's close from it.
- Apply a new Oura offset only to nights that have not opened, as `pact_earlier_timezone` does for the account's timezone.

## Acceptance criteria

- [ ] A night judged at its close keeps that close when Oura later reports a sleep on another clock.
- [ ] A scenario test covers the traveller above.
- [ ] The entry for this ticket is removed from `KNOWN_MISMATCHES`, and seed 4019 with 300 steps passes.
- [ ] `docs/behaviour.md` (Oura Ring) says which clock a night closes on.
- [ ] `npm run check` passes.
