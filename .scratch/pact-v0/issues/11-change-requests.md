# 11 Change requests and adding reviewers

Status: ready-for-agent
Blocked by: 06

Spec stories: 62–67, 83 (Ended), 95. Rules: Creation and change.

## What to build

After the edit window, an owner can change an Active pact: stricter changes apply at once, relaxing ones wait for a reviewer.

- **Request change** on the pact page, through the create form pre-filled (no Source step; evidence kind never changes).
- **Classification** in the core, covering the fields that exist so far:
  - Relaxes (creates a change request): deleting or ending the pact, lowering the penalty, easing the schedule (fewer days), removing a reviewer, any change of recipient, any change of description.
  - Stricter (takes effect at once): a higher penalty, more days.
  - Name changes take effect at once with no review.
  - A change that both relaxes and tightens is reviewed as a whole.
  - Tickets 13–16 add their own fields to this classification.
- **When it applies:** from when it's made (stricter) or approved (relaxing), to every occurrence that hasn't opened yet. Open occurrences keep the old terms; judged occurrences, their penalties and bills never change.
- **Change request review item** (amber pencil), shown first in the Review tab, with a before/after comparison. Same Approve / Reject-with-reason flow.
- **Ending:** an approved delete or end makes the pact **Ended**; it stops producing occurrences. Ended pacts sit collapsed at the bottom of Pacts.
- **Adding a reviewer** is immediate and notifies the new reviewer. Removing one is a change request. A pact can never have zero reviewers.
- **Pact page:** once a change is in force but not yet applied, say when the new terms start, e.g. "New terms start Fri Oct 30. Today keeps $5 per miss." The Waiting on list includes change requests.

## Acceptance criteria (core scenarios)

- [x] Spec example: raising the penalty at 3pm Thursday on a daily pact → Thursday still costs the old amount, Friday the new.
- [x] Lowering the penalty → change request; old amount applies until approved, then from the next occurrence not yet open.
- [x] Recipient change, description change and reviewer removal each create a change request.
- [x] Penalty raised and a day removed in one change → one change request; nothing applies until approved.
- [x] Rejected change → terms unchanged.
- [x] Removing the only reviewer is refused; adding one notifies them at once.
- [x] Approved end → Ended, no further occurrences; already-judged penalties stay on the ledger.
- [x] A pending change request survives a restart.

## Notes

- Trap: `#pactsToJudge` in `src/core/core.ts` selects every pact with no filter on `stage`, so judging keeps adding a penalty for an Ended pact, and setting `stage = 'ended'` alone doesn't stop it. `#judgingReached` also calls it and throws if the pact is missing, so a filter inside it isn't enough on its own.

## Comments

**Prototype round 1 (2026-11-03):** `.scratch/pact-v0/prototype/changes.prototype.html`, Change tab. Option B (open on Check, Change per row) was chosen. Also settled: one waiting change request per pact, withdrawable; no stricter change while one waits (withdraw first); an optional "Why?" note; name, reminders and adding a reviewer apply at once even inside a waiting change; End pact is its own button and sheet, and there's no Delete after the edit window. The spec's Screens (Request change, Waiting change request, End pact, Change request review item) and Rules (Creation and change) hold the details.

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/change-requests.test.ts. Earlier terms are kept per pact, so an occurrence judged after a change costs its own day's penalty and goes to its own day's recipient. Ending a pact is a change request and is blocked while another waits. Known gap: while a change request waits, the core allows renaming and adding a reviewer, but the pact page has no button for them yet (the spec screen replaces Request change entirely).
