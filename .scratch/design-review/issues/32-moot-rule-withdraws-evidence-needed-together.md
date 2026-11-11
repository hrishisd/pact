# The moot rule withdraws Weekly count evidence that only counts together

Status: ready-for-agent
Blocked by: none

## Problem

Found while building ticket 26. The moot rule (R8, ticket 20) judges each waiting item alone: evidence is withdrawn when approving it now and rejecting it now give every occurrence it touches the same final verdict and penalty (`mootReason`, `src/core/moot.ts`; `decisionEffect`, `src/core/verdict.ts`). It doesn't suppose the other waiting evidence for the same occurrence approved too.

On a Weekly count week judged Excused, two or more pieces of waiting evidence can together reach the target while neither does alone. Each is then judged moot and withdrawn after the next command or tick, so the week can never become Satisfied, against vac:78 and decision 4 in `../spec.md` ("Evidence for a day judged Excused is not moot: approving it turns the day Satisfied").

Scenario: Weekly count 3×; an approved excuse for Thu+1; Wed+1 evidence approved; evidence submitted Sat+1 22:00 and Sun+1 22:00 still waiting at Mon+2 00:00, so the week is Excused. Both waiting pieces are withdrawn `no-longer-needed`; a reviewer deciding either gets `withdrawn`. Approving both would have made the week Satisfied.

The same can happen on a week not judged yet only if something else makes its verdict final both ways, so the Excused week is the case that matters.

## What to build

When judging whether evidence on a Weekly count week is moot, suppose the other waiting evidence for the week approved as well (or, equivalently, call it moot only if approving all the week's waiting evidence would change nothing). Add the scenario above to `withdrawal.test.ts` ("items whose decision still matters stay"). Remove the two **Known bug** notes for this ticket in `docs/behaviour.md` (Evidence and "Withdrawn items").

## Acceptance criteria

- [ ] The scenario above: both pieces stay in the Review Queue and the waiting list, and approving both makes the week Satisfied with no penalty.
- [ ] Evidence that couldn't reach the target even with every waiting piece approved is still withdrawn.
- [ ] `docs/behaviour.md` "Withdrawn items" says so.
- [ ] `npm run check` passes.
