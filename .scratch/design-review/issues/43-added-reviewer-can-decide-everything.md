# An owner can add a reviewer at once, and that reviewer alone can approve anything

Status: needs-triage
Blocked by: none

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. Removing a reviewer needs approval. Adding one applies at once (`addReviewers`, `src/core/change-requests.ts`), and only the added reviewer is told (`tellPickedAsReviewer`). Any one reviewer decides an item, and the first decision is final (`decide`, `src/core/review.ts`).

So an owner whose pact is reviewed by a strict friend can add a lenient friend, or a second account of their own (an invite and a second Google account are enough). That reviewer can then approve the owner's evidence, excuses, a lower penalty, an end request, and payments to the pact's recipient. The strict reviewer is never told that a reviewer was added, and sees only that items left their queue decided.

The owner picks the reviewers at creation, so the app never guards against an owner with no honest reviewer. This ticket is about the narrower case: a reviewer who agreed to hold the owner to a pact can be routed around without knowing.

## What to build

Directions to weigh:

- Tell the pact's other reviewers when a reviewer is added, and show on the pact page who reviews it and since when. Also tell a pact's other reviewers who decided each item (check what they see today).
- Make adding a reviewer need the approval of a current reviewer, as removing one does. Stronger; it reverses the decision that added reviewers apply at once.

The first is recommended as the minimum. The second is worth it if a penalty is ever paid to anyone but a charity the owner chose.

## Acceptance criteria

- [ ] A pact's reviewers learn when another reviewer is added.
- [ ] `docs/behaviour.md` (Change requests) says so.
- [ ] A scenario test covers it.
- [ ] `npm run check` passes.
