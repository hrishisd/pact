# 19 Vacation deciders follow the pacts

Status: done
Blocked by: 17

Closes: F5 and rule R5 (`../interaction-audit.md` finding 5). Low priority.

## Decision

Decision 3 in `../spec.md` (rule R5), decided 2026-11-11: a vacation is decided by the reviewers picked at filing who still review at least one covered pact. If none remain, any current reviewer of a covered pact may decide it. This changes vac:69 ("The picked reviewers are fixed when the vacation is filed") and vac:70.

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

- [x] Rewritten `vacations.test.ts:1372` to the new rule. (No test at that line, or anywhere, pinned frozen deciders after a reviewer change; the closest, "a reviewer of a covered pact who wasn't picked can't decide or ask about it", is renamed to say it holds while a picked reviewer still reviews a covered pact.)
- [x] New scenario: a picked reviewer removed from every covered pact can no longer decide or see the vacation; another picked reviewer still can.
- [x] New scenario: the only picked reviewer is removed; a current reviewer of a covered pact gets the push, sees the item and can decide it.
- [x] New scenario: a reviewer added to a covered pact while a picked reviewer remains does not see it.
- [x] Update `docs/behaviour.md`.
- [x] `npm run check` passes.

## Out of scope

- The known gap of a lenient reviewer approving pacts they do not review (vac:148).

## Notes from the agent that built it

- `vacationDeciders` and `tellNewVacationDeciders` (`src/core/vacations.ts`); the removal in `decideChangeRequest` runs inside `tellNewVacationDeciders`. "Covered pact" means a pact ticked on the vacation (`vacation_pact`).
- A reviewer added to a covered pact after no picked reviewer remains becomes a decider and sees the vacation in the queue, but gets no push (the ticket asks for a push only on removal).
- Scenarios: `vacations.test.ts`, "who decides a vacation when a covered pact's reviewers change", including a picked reviewer who still reviews another covered pact.
- The vacation card's "Sent to" still names the picked reviewers: ticket 30.
