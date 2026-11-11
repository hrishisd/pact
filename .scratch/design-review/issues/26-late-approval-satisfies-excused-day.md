# 26 A late evidence approval turns an Excused occurrence Satisfied

Status: ready-for-agent
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

- [ ] A late approval of waiting evidence on an Excused day or week makes it Satisfied, tested through `scenario()`.
- [ ] The known-mismatch entry for this ticket is gone and the suite passes.
- [ ] `docs/behaviour.md` states the rule without the known-bug note.
- [ ] `npm run check` passes.

## Comments

- From ticket 11's review (2026-11-11): `settle` (`src/core/settle.ts`) now does the judging in `decideEvidence`, but it returns early for an occurrence already judged (`isJudged`), so a late approval on an Excused day still changes nothing. This ticket has to let `settle` rewrite a stored Excused outcome as Satisfied when `verdictOf` says so, unless ticket 12 has already widened `settle` to rewrite judged occurrences when it moves cover approvals onto it.

## Criterion moved from ticket 20 (owner decision, 2026-11-11)

- [ ] Case 5: a scenario where evidence for a day judged Excused stays in the queue and its approval makes the day Satisfied with no penalty.
