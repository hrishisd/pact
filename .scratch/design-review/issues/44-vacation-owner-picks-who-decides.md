# The owner picks which reviewers decide a vacation, and the others are never told

Status: needs-triage
Blocked by: none

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. A vacation covers several pacts for up to 62 days. The owner picks its deciders from the pacts' reviewers, and only those are told or can see it (`fileVacation`, `vacationDeciders`, `src/core/vacations.ts`; rule R5 in `.scratch/design-review/spec.md`). One approval excuses every covered day of every covered pact.

An owner with one lenient reviewer on one pact can pick only that reviewer. The reviewers of the other covered pacts never learn that two months of their pact were excused. An excuse does not have this gap: every reviewer of its pact is told and may decide it.

## What to build

Directions to weigh:

- Keep the picked deciders, and tell every other reviewer of a covered pact when the vacation is approved ("Jordan's vacation Jan 5 to Jan 19 covers Gym. Sam approved it."). They cannot undo it, but they know.
- A vacation covers a pact only once one of that pact's own reviewers approved it. The fairest, and the most work: a vacation would be approved pact by pact.

The first is recommended.

## Acceptance criteria

- [ ] Every reviewer of a pact a vacation covers learns of it at the latest when it is approved.
- [ ] `docs/behaviour.md` (Vacations) says so.
- [ ] A scenario test covers it.
- [ ] `npm run check` passes.
