# A pact page left open can undo an approved change when the owner renames the pact

Status: needs-triage
Blocked by: none

## Problem

Found while reviewing ticket 35. The pact page's at-once changes (the Name, Add a reviewer and Reminders sheets, `useChangeAtOnce` in `src/client/PactPage.tsx`) send the pact's whole terms with the one field changed: `api.changePact(pact.id, { ...termsOf(pact), ...change })`. The terms are the ones the page loaded. If a reviewer approves a change request on another device while the owner's page is open, the page still holds the terms from before the approval. When the owner then renames the pact, adds a reviewer or edits reminders, the core's `changePact` (`src/core/change-requests.ts`) gets the old terms alongside the new name. It treats the difference from the current terms as part of the change. For example, after a reviewer approves lowering the penalty from $5 to $2, a rename sent from the stale page puts the penalty back to $5 at once, with no review. This happens on `main` today; ticket 35 doesn't make it worse, because the pact page loads afresh each time it opens.

## What to build

Make an at-once change unable to carry terms the owner didn't touch. One direction: the client sends only the changed field (name, reviewers or reminders), and the core applies it to the pact's current terms. Another: the core refuses an at-once change whose unchanged terms differ from the current ones, and the page reloads and asks the owner to try again.

## Acceptance criteria

- [ ] After a change request is approved, a rename, reviewer addition or reminders edit sent with the terms from before the approval leaves the approved terms in place.
- [ ] A scenario test covers it.
- [ ] `npm run check` passes.
