# Evidence kept through an edit can judge a day Missed before it opens

Status: done
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`, seed 3107). In the edit window, `editPact` (`src/core/pacts.ts`) keeps evidence already sent when the new schedule still includes the date the evidence is stored under, and removes the rest (`removeEvidence`). Evidence for a One-time pact is stored under the deadline's date, whenever it was sent. If the owner edits the pact to Fixed days and the old deadline is one of them, the evidence becomes evidence for that Fixed day, which can be days ahead. When the reviewer rejects it, the rejection judges that day Missed at once, with the new terms' penalty.

The run, shrunk to 4 actions:

1. Thursday 31 December: cal creates a Camera One-time pact, by Thursday 7 January, penalty 100c, and sends evidence at once.
2. Still in the edit window, cal edits it to Wednesday, Thursday and Saturday, penalty 500c. The evidence stays, now on the Fixed day 7 January.
3. The edit window closes. The reviewer rejects the evidence the same day.
4. 7 January is Missed with a 500c penalty, a week before the day opens. The pact page does not show the miss, and cal can do nothing on the day itself.

Reproduce: `FUZZ_STEPS=300 FUZZ_SEEDS=3107 npx vitest run src/core/fuzz.test.ts` with the entry for this ticket removed from `KNOWN` in `src/core/testing/fuzz-invariants.ts`.

Not checked: the same with approval (the future day would be Satisfied by a photo taken a week before), and an edit from Fixed days or Weekly count to another schedule whose day or week takes in evidence sent for a different occurrence.

## What to build

Evidence survives an edit only if it still answers the occurrence it was sent for. Directions to weigh:

- An edit that changes the schedule removes all evidence sent so far. Simple; the owner sends it again.
- Keep evidence only when the occurrence under the new terms is open at the time the evidence was sent.

## Acceptance criteria

- [x] After an edit, no evidence is attached to an occurrence that had not opened when the evidence was sent.
- [x] A scenario test covers the run above, for a rejection and for an approval.
- [x] `docs/behaviour.md` (Edit window) says what an edit does to evidence already sent.
- [x] The entry for this ticket is removed from `KNOWN` in `src/core/testing/fuzz-invariants.ts`, and seed 3107 passes.
- [x] `npm run check` passes.

## Outcome

`editPact` keeps evidence only on a day the new schedule has and that has opened. The scenario test covers the removal; with the evidence gone there is nothing to reject or approve, so one test serves both.
