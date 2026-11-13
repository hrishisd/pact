# The Request change form can send stale terms

Status: ready-for-agent
Blocked by: none

## Problem

Found while building ticket 36. The Request change form (`src/client/ChangePact.tsx`) loads the pact's terms once and sends all of them to `changePact` (`src/core/change-requests.ts`), changed or not. The core treats every difference from the current terms as part of the change. If a term changes elsewhere after the form loaded, for example a reviewer approves a change request on another device after the form's last preview, the form still holds the old value and sending puts it back: an approved lower penalty is raised again as a stricter change, with no review, and a reviewer whose removal was approved is added back at once. The preview only helps if it runs after the change elsewhere.

The edit-window form (`EditPact`, `editPact` in `src/core/pacts.ts`) also sends whole terms, but only the owner's own other devices can change a pact in its edit window, so it is left alone.

## What to build

The form sends the terms it loaded alongside the new terms. The core compares the loaded terms with the pact's current ones and refuses with a new reason, such as `terms-changed`, when they differ; the refusal changes nothing. The form then reloads the pact and says the terms changed since it opened, so the owner can check and send again. The preview gets the same check, so the verdict never describes a change from terms that no longer stand.

No version column: comparing the terms the form loaded is enough, and needs no migration.

Rejected: making `PactChange` a patch of only the terms touched. An optional term left out already means "none" (no due-by time, start date or end date), and the schedule's fields are checked together, so a patch would need a new way to say "remove" and would split rules the core checks as one.

## Acceptance criteria

- [ ] After a change request is approved, a change sent from the Request change form with the terms loaded before the approval is refused with the new reason and changes nothing; the approved terms stay.
- [ ] The preview refuses the same way.
- [ ] Sent with the current terms as loaded, a change works as it does now.
- [ ] The form reloads the pact on that refusal and says the terms changed since it opened.
- [ ] A scenario test covers the refusal, server tests cover the route's shape, and `ChangePact.test.tsx` covers the reload and its copy.
- [ ] `docs/behaviour.md` "Change requests" says so.
- [ ] `npm run check` passes.
