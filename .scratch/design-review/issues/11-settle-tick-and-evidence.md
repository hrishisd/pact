# 11 `settle` for the tick and evidence decisions

Status: done
Blocked by: 10

Closes: F4 and rule R4 (`../interaction-audit.md` finding 4, probe P2); H3 steps 2 and 3 (`../architecture-review.md`, H3). First of three tickets that make `settle` the only writer of outcomes and penalties; 12 and 13 finish it. Split here because the whole of H3 is two to three days of work.

## Problem

A Weekly count week judged Missed by a late evidence decision gets no Missed push. `decideEvidence` judges the week with `tell=false` (`src/core/evidence.ts`) on the assumption in the comment at `src/core/judging.ts` that the decision push tells the owner enough. Scenario: the owner did 2 of 3 sessions; the reviewer approves the second photo late. The owner sees "Sam approved your evidence" and never learns the week cost $10 until the bill. Probe P2 (`../probes/audit-probes.test.ts.txt`, "probe 2") showed exactly that push and a $10 penalty.

The cause is structural: four judging paths each decide for themselves whether the owner hears about a Missed outcome (`judging.ts`, `judging.ts`, `src/core/bedtime.ts` and `207`), and two decide nothing (`decideEvidence`, `excuseApprovedDays`).

## What to build

- `src/core/settle.ts`: `settle(ctx, pactId, date, now): Transition | null` loads the facts (ticket 10's loader), computes `verdictOf`, compares it with the stored row, and applies the difference: insert or update the `occurrence` row, insert or delete the `penalty`. It returns the transition, and enqueues the Missed push from it (rule R4 below). `settleAll(ctx, t, anki)` replaces the tick's judging for Fixed days, One-time and Weekly count.
- Rule R4: the owner gets the Missed push whenever an occurrence or week becomes Missed, whatever caused it, with two exceptions that stay as they are: a Fixed-day or One-time rejection tells the owner through the rejection push alone (v0:324), and nobody is told about an occurrence on a waiting cover (`.scratch/pact-v0/issues/07-excuses.md`, and vac:80). The `tell` flag disappears.
- Replace `judgeAtDueTime` and `judgeWeek` in the tick (`judging.ts`) with `settleAll`. One-time's end (`judging.ts`) is still called from `settle` for now; ticket 13 moves it.
- Replace the judging in `decideEvidence` (`evidence.ts`) with `settle`. `excusedAhead`, `judgingReached` and the `isWeekly` branch go.
- `judged_through` stays as the tick's cursor.
- The ticket-10 scenario hook stays on and its known-mismatch list should not grow.

## Where to start

- `src/core/judging.ts`, `src/core/evidence.ts`.
- `../architecture-review.md`, H3 "Target design" and "What it makes worse" (every fact change must call `settle`).
- `weekly-count.test.ts` (a week waiting on evidence), `rejection.test.ts`.

## Acceptance criteria

- [x] New scenario in `weekly-count.test.ts` (probe P2): a 3× week with two approved sessions and the third approved after Sunday's end is Satisfied with no Missed push; with only two sessions in total, a late approval of the second leaves the week Missed with one "Piano is Missed" push after the decision push and one $10 penalty.
- [x] New scenario: a late rejection on a Weekly count week that leaves it short sends the Missed push.
- [x] A Fixed-day rejection still sends only the rejection push (`rejection.test.ts` unchanged).
- [x] No other existing test changes, except a `judged_at` that moves by a tick, each noted in Comments.
- [x] `judgeAtDueTime` and the `tell` parameter no longer exist.
- [x] Update `docs/behaviour.md`: R4, and remove the F4 known-bug note.
- [x] `npm run check` passes.

## Out of scope

- Covers, bedtime and Anki (ticket 12).
- Ending a pact and the change-request catch-up (ticket 13).

## Comments

- `settle` (`src/core/settle.ts`) only writes an occurrence that isn't judged yet: the tick and evidence decisions never changed a stored outcome, and changing one here would also fix ticket 26 (Excused to Satisfied), which is that ticket's to do. Ticket 12 widens it when cover approvals move onto it.
- The Missed push skips a Fixed-day or One-time occurrence whose evidence was rejected, read from the facts, so no flag is passed in.
- `judge` and `enqueueMissed` stay in `judging.ts` for excuses, vacations, bedtime and Anki until ticket 12. The change-request catch-up in `review.ts` now calls `settlePactDueBy`; ticket 13 removes it.
- No existing test changed, and no `judged_at` moved. The known-mismatch list is unchanged.
- Review (2026-11-11): dropping `judgingReached` from `decideEvidence` left a day stuck unjudged when an owner's move west put a due time the cursor had passed back ahead and the decision came before it: the tick never went back. The tick now also settles days behind the cursor that evidence still holds (`settleBehindCursor`), judging such a day at its new due time, as `verdictOf` says. New test in `judging.test.ts`. Unused imports left in `evidence.ts` removed.
