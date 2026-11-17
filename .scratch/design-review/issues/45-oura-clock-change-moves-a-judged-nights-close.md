# A bedtime night already judged changes its close when Oura later reports another clock

Status: done
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

- [x] A night judged at its close keeps that close when Oura later reports a sleep on another clock.
- [x] A scenario test covers the traveller above.
- [x] The entry for this ticket is removed from `KNOWN_MISMATCHES`, and seed 4019 with 300 steps passes.
- [x] `docs/behaviour.md` (Oura Ring) says which clock a night closes on.
- [x] `npm run check` passes (its parts; `shellcheck` is not installed where this was built).

## Outcome

Decided: the second direction, the model of ticket 39. A new Oura clock applies only to nights that have not opened; a night open or judged keeps the clock it opened on. Storing the clock on each judged night would have kept judged nights still but left an open night's close moving with each report, gaining or losing the owner hours, which ticket 39 removed for timezones.

Built as for the timezone. `noteOuraClock` (`bedtime.ts`), when the latest sleep Oura reports gives nights another clock, keeps the old one in a new table, `oura_earlier_clock` (migration 38), per account, with `until` the day after the latest night whose window (from 18:00) has started on the old clock or the new one, or after the last day open in a timezone the owner moved from (`keepEarlierClock`). The row holds the old latest bedtime_start, not an offset, so the rule that an offset equal to the timezone's own means the account's clock (`ouraOffsetOf`, `rows.ts`, was `ouraOffset`) still applies in whichever timezone a night is worked out in. A change whose `until` is not after one already kept adds nothing, so a second change before the next night opens keeps the first clock. `ouraClockOf` (`rows.ts`) gives each night its clock, and `occurrencesOverTime` (`occurrences.ts`) takes it in place of one offset for every night; `nightsWaiting` and `pushNoOuraData` read it too. `verdictOf` needs no change.

Differs from the plan, or beyond it:

- Whether the clock changed is checked in the account's timezone and in every timezone the owner moved from: the randomised test (seed 4019) found an owner who moved from Auckland to New York, where a sleep at `-04:00` is New York's own clock but not Auckland's, so an Auckland night's close moved.
- The clock is kept when the report arrives, at the tick or check that fetched it, so after a gap in ticks a night that opened during the gap keeps the old clock. Before this the same gap judged such a night at its old close too, and the offset then moved it.
- What a person saw before (the Problem's "not checked"): the stored judging time and the Missed card's time did not move, but anything read from the night's close (`closesAt`) did: the No Oura data card's close, and the rules in `ending.ts` and `occurrence-state.ts` that read it. Not checked further, as the fix removes it. They now read the clock the night opened on.
- Tests, written first: `bedtime.test.ts`, "a night judged at its close keeps that close when Oura later reports a sleep on another clock" (the traveller) and "a night open when Oura reports another clock keeps the clock it opened on".
- The entry for this ticket is removed from `KNOWN_MISMATCHES` (`verdict-check.ts`), which is now empty; seed 4019 with 300 steps passes.
