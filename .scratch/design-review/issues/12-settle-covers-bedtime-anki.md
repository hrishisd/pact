# 12 `settle` for covers, bedtime and Anki

Status: ready-for-agent
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

- [ ] `excuseApprovedDays` is gone; excuse and vacation approval call `settle`.
- [ ] `judgeNights` and `recordAnkiChecks` no longer write `occurrence` or `penalty` themselves.
- [ ] The billed-penalty guard throws, shown by its test.
- [ ] Existing tests pass unchanged, apart from `judged_at` values moved by a tick (noted in Comments) and any known mismatch from ticket 10 that this ticket fixes on purpose (named, with `docs/behaviour.md` updated).
- [ ] `npm run check` passes.

## Out of scope

- Ending a pact (ticket 13).
- Any rule change, including decision 4's sub-question about evidence for a day already Excused (ticket 20, or the ticket filed from ticket 10).
