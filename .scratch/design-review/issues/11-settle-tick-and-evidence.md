# 11 `settle` for the tick and evidence decisions

Status: ready-for-agent
Blocked by: 10

Closes: F4 and rule R4 (`../interaction-audit.md` finding 4, probe P2); H3 steps 2 and 3 (`../architecture-review.md`, H3). First of three tickets that make `settle` the only writer of outcomes and penalties; 12 and 13 finish it. Split here because the whole of H3 is two to three days of work.

## Problem

A Weekly count week judged Missed by a late evidence decision gets no Missed push. `decideEvidence` judges the week with `tell=false` (`src/core/evidence.ts:245-252`) on the assumption in the comment at `src/core/judging.ts:142-147` that the decision push tells the owner enough. Scenario: the owner did 2 of 3 sessions; the reviewer approves the second photo late. The owner sees "Sam approved your evidence" and never learns the week cost $10 until the bill. Probe P2 (`../probes/audit-probes.test.ts.txt`, "probe 2") showed exactly that push and a $10 penalty.

The cause is structural: four judging paths each decide for themselves whether the owner hears about a Missed outcome (`judging.ts:138`, `judging.ts:156`, `src/core/bedtime.ts:203` and `207`), and two decide nothing (`decideEvidence`, `excuseApprovedDays`).

## What to build

- `src/core/settle.ts`: `settle(ctx, pactId, date, now): Transition | null` loads the facts (ticket 10's loader), computes `verdictOf`, compares it with the stored row, and applies the difference: insert or update the `occurrence` row, insert or delete the `penalty`. It returns the transition, and enqueues the Missed push from it (rule R4 below). `settleAll(ctx, t, anki)` replaces the tick's judging for Fixed days, One-time and Weekly count.
- Rule R4: the owner gets the Missed push whenever an occurrence or week becomes Missed, whatever caused it, with two exceptions that stay as they are: a Fixed-day or One-time rejection tells the owner through the rejection push alone (v0:324), and nobody is told about an occurrence on a waiting cover (`.scratch/pact-v0/issues/07-excuses.md`, and vac:80). The `tell` flag disappears.
- Replace `judgeAtDueTime` and `judgeWeek` in the tick (`judging.ts:38-157`) with `settleAll`. One-time's end (`judging.ts:210`) is still called from `settle` for now; ticket 13 moves it.
- Replace the judging in `decideEvidence` (`evidence.ts:240-259`) with `settle`. `excusedAhead`, `judgingReached` and the `isWeekly` branch go.
- `judged_through` stays as the tick's cursor.
- The ticket-10 scenario hook stays on and its known-mismatch list should not grow.

## Where to start

- `src/core/judging.ts:38-245`, `src/core/evidence.ts:224-275`.
- `../architecture-review.md`, H3 "Target design" and "What it makes worse" (every fact change must call `settle`).
- `weekly-count.test.ts:310` (a week waiting on evidence), `rejection.test.ts:46`.

## Acceptance criteria

- [ ] New scenario in `weekly-count.test.ts` (probe P2): a 3× week with two approved sessions and the third approved after Sunday's end is Satisfied with no Missed push; with only two sessions in total, a late approval of the second leaves the week Missed with one "Piano is Missed" push after the decision push and one $10 penalty.
- [ ] New scenario: a late rejection on a Weekly count week that leaves it short sends the Missed push.
- [ ] A Fixed-day rejection still sends only the rejection push (`rejection.test.ts` unchanged).
- [ ] No other existing test changes, except a `judged_at` that moves by a tick, each noted in Comments.
- [ ] `judgeAtDueTime` and the `tell` parameter no longer exist.
- [ ] Update `docs/behaviour.md`: R4, and remove the F4 known-bug note.
- [ ] `npm run check` passes.

## Out of scope

- Covers, bedtime and Anki (ticket 12).
- Ending a pact and the change-request catch-up (ticket 13).
