# 12 `settle` for covers, bedtime and Anki

Status: done
Blocked by: 11

Closes: H3 steps 4 and 5 (`../architecture-review.md`, H3), and the billed-penalty guard ("More important than the four", last point). Second of three `settle` tickets.

## Problem

Three more paths write outcomes and penalties with their own copy of the rules:

- `excuseApprovedDays` (`src/core/excuses.ts:369-399`), used by excuse and vacation approval (`src/core/vacations.ts:561-564`), rewrites Missed to Excused and deletes the penalty directly.
- `judgeNights` (`src/core/bedtime.ts:180-215`) has its own excuse precedence, and writes the observed bedtime only after judging (`bedtime.ts:201-203`).
- `recordAnkiChecks` (`src/core/anki-days.ts:170-220`) judges Satisfied without consulting covers.

Separately, the rule "an excuse never reaches a billed penalty" rests on 48-hour arithmetic: bills take penalties older than 48 hours (`src/core/money.ts:396-420`) and the excuse window is 48 hours. If it ever breaks, owed is clamped at zero (`money.ts:281`) and the violation is invisible (F13). Ticket 15 (R3) would break it unless it is careful.

## What to build

- Replace `excuseApprovedDays` with `settle` over the cover's days, for excuse and vacation approval. Cover rejection and withdrawal also call `settle` for their days (today they change nothing stored; the call should be a no-op, and the hook from ticket 10 confirms it).
- Store the first qualifying sleep period as a fact when it arrives, before judging (a column or table; a small migration if needed), and move `judgeNights` onto `settle`. The verdict then reads the stored fact.
- Move `recordAnkiChecks` onto `settle`. Anki's in-memory running checks are passed in as now.
- `settle` throws if it would delete or change a penalty that has a `bill_id`. Add a scenario-level test that forces the case (for example by billing a penalty and then approving a cover written straight to the database in the test) and expects the throw, so the guard is proven.
- Any other site that inserts or deletes `penalty` or updates `occurrence.outcome` outside `settle.ts` is listed in Comments for ticket 13, which adds the check.

## Where to start

- `src/core/excuses.ts:334-399`, `src/core/vacations.ts:548-580`, `src/core/bedtime.ts:147-215`, `src/core/anki-days.ts:170-220`.
- `bedtime.test.ts:237-330` (excuse precedence for nights), `anki-days.test.ts`, `excuses.test.ts:446-577`, `vacations.test.ts` "deciding a vacation after its first day".

## Acceptance criteria

- [x] `excuseApprovedDays` is gone; excuse and vacation approval call `settle`.
- [x] `judgeNights` and `recordAnkiChecks` no longer write `occurrence` or `penalty` themselves.
- [x] The billed-penalty guard throws, shown by its test.
- [x] Existing tests pass unchanged, apart from `judged_at` values moved by a tick (noted in Comments) and any known mismatch from ticket 10 that this ticket fixes on purpose (named, with `docs/behaviour.md` updated).
- [x] `npm run check` passes.

## Out of scope

- Ending a pact (ticket 13).
- Any rule change, including decision 4's rule that approved evidence turns a day already Excused into Satisfied (ticket 20, or the ticket filed from ticket 10).

## Comments

From ticket 10 (2026-11-11): two facts `verdictOf` needs are not stored, so the scenario check (`src/core/testing/verdict-check.ts`, `SourceWatch`) watches them itself and `occurrenceFacts` reads only what's stored:

- A bedtime night's first long_sleep period and when it arrived. `occurrence.bedtime_start` is written only when a period judges the night Satisfied or Missed, so a night judged Excused by a late period reads as having none. Store it when it arrives.
- When an Anki check's answer was recorded. `anki_check.checked_at` is when the check started; a check answered after judging gave up on it (`ANKI_CHECK_HOLDS_JUDGING_MS`) doesn't count, which the stored row can't show. The running checks are in memory, passed in as `ankiChecks`.

From ticket 11 (2026-11-11): `settle` writes only an occurrence that isn't judged yet (`isJudged` returns early). Moving `excuseApprovedDays` onto it means letting it rewrite a stored Missed outcome as Excused and delete the penalty. Keep Excused to Satisfied out (ticket 26).

From ticket 12 (2026-11-11): built. `settle` now lets a stored Missed outcome become Excused (and only that), deleting the penalty through `deletePenalties`, which throws on a billed one (test: `bills.test.ts` "a billed penalty"). Cover approval, rejection and vacation withdrawal call `settleCoverDays`. A bedtime night's first long_sleep period is stored as it arrives, in `occurrence.bedtime_start` and the new `occurrence.bedtime_arrived_at` (migration 31, which backfills `judged_at` for nights that had one), and `occurrenceFacts` reads it. `judge` and `judgingReached` are gone. No existing test changed and no `judged_at` moved; no known mismatch was fixed.

For ticket 13, the writes to `occurrence` and `penalty` left outside `settle.ts`, none of which sets an outcome, judging time or penalty amount:

- `src/core/pacts.ts` `moveOneTimeOccurrence`: copies an occurrence row, not judged yet, to its new date (`INSERT INTO occurrence ... SELECT outcome, judged_at ...`) and deletes the old row.
- `src/core/pacts.ts` `removeEvidence`: deletes occurrence rows, none judged, with their evidence.
- `src/core/evidence.ts` `submitEvidence`: inserts a bare occurrence row for evidence to reference.
- `src/core/bedtime.ts` `noteFirstSleep`: inserts a bare occurrence row and sets `bedtime_start` and `bedtime_arrived_at` (a fact).
- `src/core/judging.ts` `noteAnkiResult`: sets `anki_cards_left` and `anki_checked_at`.
- `miss_accepted_at` updates in `evidence.ts`, `excuses.ts` and `vacations.ts` (Take the L).
- `src/core/money.ts` (`UPDATE penalty SET bill_id`): billing, not judging.

From ticket 12's review (2026-11-11): two behaviour changes fixed, each with a new scenario test.

- `settleCoverDays` settled without the checks of AnkiWeb still running, so rejecting a cover (or withdrawing a vacation) for an Anki day past its due time, while a check from before then was still running, judged it Missed at once with a Missed push; before, the day waited for the check. The running checks are now passed through `decideExcuse`, `decideVacation` and `withdrawVacation` (test: `anki-days.test.ts` "an excuse rejected while a check from before the due time is still running leaves the day to that check").
- `settleCoverDays` judged a bedtime night not judged yet once it had closed, before judging's first look at Oura after the close; before, such a night was left to `judgeNights`, where a period on that look still decides it. It skips those nights again (test: `bedtime.test.ts` "an excuse approved as the night closes, before Oura's next look, leaves the night to that look").
- Migration 31's comment now says a Missed night a cover excused takes the approval's time as its arrival (the true arrival wasn't kept); the verdict is Excused then either way.
