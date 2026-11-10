# 19 Vacation deciders follow the pacts

Status: needs-info
Blocked by: 17

Closes: F5 and rule R5 (`../interaction-audit.md` finding 5). Low priority.

## Decision needed

Decision 3 in `../spec.md` (rule R5). It changes vac:69 ("The picked reviewers are fixed when the vacation is filed") and vac:70.

## Problem

`vacationToDecide` checks only `vacation_reviewer` (`src/core/vacations.ts:524-539`), while evidence, excuses and change requests use the pact's current reviewers (`src/core/review.ts:177-217`). A reviewer removed from every covered pact can still decide the vacation, and one added later cannot see it. Scenario: the only picked reviewer goes quiet. The owner adds a second reviewer, who cannot see the vacation. Withdrawing and refiling cannot cover days already open (`vacations.ts:186-187`), and by then those days may be past their excuse window. Pinned by `vacations.test.ts:1372`.

## What to build

- Rule R5 in the vacation handler's `deciders` (ticket 17): the reviewers picked at filing who still review at least one covered pact. If none remain, any current reviewer of a covered pact.
- The queue query, the review-item push on filing, the reply push (`ownItem`) and the Review Queue all use the same deciders.
- When the deciders change because the last picked reviewer was removed, the new deciders get the usual "review-item" push for the vacation, once.

## Where to start

- `src/core/vacations.ts:383-395` (`pickedReviewers`), `:468-545`.
- `vacations.test.ts:1372`, and the picked-reviewers scenarios in `vacations.test.ts` (search "picked").

## Acceptance criteria

- [ ] Rewritten `vacations.test.ts:1372` to the new rule.
- [ ] New scenario: a picked reviewer removed from every covered pact can no longer decide or see the vacation; another picked reviewer still can.
- [ ] New scenario: the only picked reviewer is removed; a current reviewer of a covered pact gets the push, sees the item and can decide it.
- [ ] New scenario: a reviewer added to a covered pact while a picked reviewer remains does not see it.
- [ ] Update `docs/behaviour.md`.
- [ ] `npm run check` passes.

## Out of scope

- The known gap of a lenient reviewer approving pacts they do not review (vac:148).
