# 26 A late evidence approval turns an Excused occurrence Satisfied

Status: done
Blocked by: 10

Found by ticket 10's verdict check. Expected there (interaction audit probe P5a).

## Problem

The vacation spec (vac:78) says approved evidence still makes a covered occurrence Satisfied, and decision 4 in `../spec.md` (2026-11-11) keeps that rule. The code doesn't follow it when the evidence was still waiting when the cover made the day Excused:

- At the due time, a day with waiting evidence and an approved cover is judged Excused (`judgeAtDueTime`, `src/core/judging.ts`); a cover approved later judges it Excused at once (`excuseApprovedDays`, `src/core/excuses.ts`).
- A later approval of that evidence changes nothing, because the day is already judged (`decideEvidence`, `src/core/evidence.ts`, the `isJudged` checks). The same holds for a Weekly count week whose late approvals reach its target.

`verdictOf` (`src/core/verdict.ts`) states the spec's rule: Excused, then Satisfied as of the approval. The scenario check lists this as a known mismatch (`KNOWN_MISMATCHES` in `src/core/testing/verdict-check.ts`), shown by `verdict-check.test.ts` "evidence approved after an excuse made its day Excused is a known mismatch".

## What to build

- An evidence approval on an occurrence judged Excused makes it Satisfied as of the approval (a Weekly count week: once its approved days reach the target). Best done through `settle` (ticket 11), which replaces the judging in `decideEvidence`.
- Remove the known-mismatch entry and the **Known bug** note in `docs/behaviour.md`, and turn the harness test into a scenario test of the new rule.

## Acceptance criteria

- [x] A late approval of waiting evidence on an Excused day or week makes it Satisfied, tested through `scenario()`.
- [x] The known-mismatch entry for this ticket is gone and the suite passes.
- [x] `docs/behaviour.md` states the rule without the known-bug note.
- [x] `npm run check` passes.

## Comments

- From ticket 11's review (2026-11-11): `settle` (`src/core/settle.ts`) now does the judging in `decideEvidence`, but it returns early for an occurrence already judged (`isJudged`), so a late approval on an Excused day still changes nothing. This ticket has to let `settle` rewrite a stored Excused outcome as Satisfied when `verdictOf` says so, unless ticket 12 has already widened `settle` to rewrite judged occurrences when it moves cover approvals onto it.

## Criterion moved from ticket 20 (owner decision, 2026-11-11)

- [x] Case 5: a scenario where evidence for a day judged Excused stays in the queue and its approval makes the day Satisfied with no penalty.

## Built (2026-11-11)

- `settle` (`src/core/settle.ts`) now rewrites a stored Excused outcome as Satisfied, as of the approval, when `verdictOf` says so; it never re-ends a One-time pact (it Ended at the Excused judging). Ticket 12 had already widened it for Missed to Excused, so this is the second exception.
- Scenarios: `evidence.test.ts`, "a late approval on an Excused occurrence" (a day Excused by an excuse approved after the due time, a day excused ahead with a rejection that leaves its other day Excused, a Weekly count week, a One-time pact). Case 5: `withdrawal.test.ts`, "evidence for a day an approved excuse already made Excused stays, and approving it makes the day Satisfied with no penalty".
- `KNOWN_MISMATCHES` is empty, and the harness test that showed this mismatch is gone; `knownMismatchTicket` is no longer exported.
- Differs from the ticket: a Weekly count week that needs two or more late approvals to reach its target can't get there, because the moot rule withdraws each waiting piece on its own. Filed [ticket 32](32-moot-rule-withdraws-evidence-needed-together.md). The scenario covers a week that one late approval brings to its target.
