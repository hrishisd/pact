# A cover approved at the exact due instant beats approved evidence

Status: ready-for-agent
Blocked by: none

## Problem

Found while building ticket 20. `verdictOf` (`src/core/verdict.ts`) orders the steps at one instant so that facts come before the due time (`STEP_ORDER`: `cover-approved` 1, `due` 2). When an excuse or vacation is approved at exactly an occurrence's due time, and the occurrence isn't judged yet, the `cover-approved` step judges it Excused (`outcome === null && past`) without looking at approved evidence. The `due` step then sees an outcome and does nothing. So a day whose evidence was approved before its due time comes out Excused, not Satisfied, against the rule "approved evidence beats an approved cover" stated on `verdictOf` and vac:78.

Scenario: Mon/Wed/Fri Gym; a vacation for Wed waits; Wed 10:00 the owner submits evidence and a reviewer approves it. If the vacation is approved at Thu 00:00:00.000 exactly, before the tick judges Wednesday, `settle` stores Excused. A millisecond later it would be Satisfied at the due time.

Ticket 20 met it through moot items: at a tick at exactly the due time, `decisionEffect` judged "approve the vacation now" as Excused and "reject it" as Satisfied, so the vacation was not yet moot. It is withdrawn at the next tick (`withdrawal.test.ts` ticks at Thu 01:00 for that reason).

## What to build

In the `cover-approved` step, judge an occurrence not judged yet as the `due` step would (approved evidence first; a Weekly count week through `judgeWeek`), so approved evidence wins at the due instant too. Add a case to `verdict.test.ts`.

## Acceptance criteria

- [ ] `verdict.test.ts`: approved evidence before the due time and a cover approved at the due instant give Satisfied.
- [ ] `npm run check` passes.

## Owner decision (2026-11-11)

Ready for an agent.
