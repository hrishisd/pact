# A vacation's "Sent to" names who decides it now

Status: done
Blocked by: none

## Problem

Found while building ticket 19 (rule R5). A vacation's deciders now follow the covered pacts' reviewers (`vacationDeciders`, `src/core/vacations.ts`), but `vacationSummary` still fills `reviewerNames` from `pickedReviewers`, the reviewers picked at filing. So once a picked reviewer is removed from every covered pact:

- the Profile card's "Sent to …" (`VacationSection.tsx:148`) and the review item still name them;
- the owner's reply toast says "It's back with …" naming them (`VacationSection.tsx:50`), though the reply push went to the current deciders.

Scenario: Gym reviewed by Alex and Sam; the vacation is sent to Alex only. A change removing Alex is approved. Sam now decides it and got its push, but Profile still says "Sent to Alex".

## What to decide

Whether `reviewerNames` should name the current deciders (`vacationDeciders`), or keep naming who it was sent to and add who decides it now.

## Acceptance criteria

- [x] A scenario: after the last picked reviewer is removed, the owner's vacation card names the current deciders (or whatever is decided).
- [x] `docs/behaviour.md` matches.

## Owner decision (2026-11-11)

Ready for an agent.

Decided by the implementing agent: `reviewerNames` names the current deciders (`vacationDeciders`), as a change request's already do.
