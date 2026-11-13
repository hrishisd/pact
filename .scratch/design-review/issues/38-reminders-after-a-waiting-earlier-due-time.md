# A reminder can end up at or after the due time once a waiting change request is approved

Status: needs-triage
Blocked by: none

## Problem

Found while reviewing ticket 36. Reminders must fall before the pact's due time (`reminder-after-due-time`). `setReminders` (`src/core/change-requests.ts`) checks them only against the due time in force now (`remindersInTimeNow`). While a change request waits that makes the due time or the in-bed-by time earlier, the owner can set a reminder that is before the current due time but at or after the requested one. When the reviewer approves, `applyTerms` changes the due time and leaves the reminders alone. The reminder then sits at or after the due time and never goes off. For example: due by 21:00, a request to make it 18:00 waits, the owner sets a reminder for 19:00, the reviewer approves.

This is not a regression from ticket 36: the pact page's Reminders sheet behaved the same when it went through `changePact`.

The same end state may be reachable in the other order, with no waiting request involved in the check: reminders are set first, and a later change makes the due time earlier than an existing reminder. To check during triage: whether `changePact` validates the reminders it is sent against the new due time or the current one, for both a stricter change that applies at once and a change that waits.

## What to build

No reminder is left at or after the due time in force. Directions to weigh:

- `setReminders` also refuses a reminder that is at or after the due time in a waiting change request's terms. Simple, but it refuses a reminder that is valid today for a change that may be rejected.
- When new terms take effect (`applyTerms`), drop or refuse reminders that no longer fall before the due time. This covers every order of events in one place, but approval then changes reminders the owner set.

## Acceptance criteria

- [ ] With a change request waiting that makes the due time earlier, a reminder set between the requested and the current due time does not survive approval as a reminder that never goes off.
- [ ] The same holds for the in-bed-by time and for a One-time pact's deadline.
- [ ] A scenario test covers it.
- [ ] `docs/behaviour.md` says what happens.
- [ ] `npm run check` passes.
