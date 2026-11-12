# 05 A failed friends load says so

Status: done
Blocked by: 01

Closes: C3 (`../code-structure-review.md`, section 1).

## Problem

`AddReviewerSheet` loads friends with `api.friends().then(setFriends, () => setFriends([]))` (`src/client/PactPage.tsx`). On a failed load the empty list renders "Only friends can review your pacts. Invite another, and they show up here once they accept." (`PactPage.tsx`). On a bad connection the owner is told something false and prompted to invite a friend they already have. It breaks the standard that error copy says what failed (`CODING_STANDARDS.md`, "Results and errors").

## What to build

Load with `useLoad(api.friends)` and show `loadFailure` on failure, as `src/client/pact-form-steps.tsx` does.

## Where to start

- `src/client/PactPage.tsx`.
- `src/client/pact-form-steps.tsx` for the pattern; `useLoad` in `src/client/ui.tsx`.

## Acceptance criteria

- [x] `PactPage.test.tsx`: with `api.friends` failing, the Add reviewer sheet shows the load failure text and not the "Only friends can review" copy.
- [x] The existing Add reviewer tests still pass. (There were none in `PactPage.test.tsx`; a test for the no-other-friends copy was added alongside, and the full suite passes.)
- [x] `npm run check` passes.

## Out of scope

- Other loaders (the review found this the only one that hides a failure).
