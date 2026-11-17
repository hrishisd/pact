# A reminder can end up at or after the due time once a waiting change request is approved

Status: done
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

- [x] With a change request waiting that makes the due time earlier, a reminder set between the requested and the current due time does not survive approval as a reminder that never goes off.
- [x] The same holds for the in-bed-by time and for a One-time pact's deadline.
- [x] A scenario test covers it.
- [x] `docs/behaviour.md` says what happens.
- [x] `npm run check` passes (its parts; `shellcheck` is not installed where this was built).

## Outcome

Decided: the first direction. A reminder must go off before the due time in force now and before the one a waiting change request asks for, so approval never has to touch the reminders. This is the rule `checkedChange` already had for a change sent with new reminders ("they go off before the due time in force now as well as the new one"); only a change request already waiting was missed. Dropping reminders at approval was the other choice, but nothing else in the app changes reminders the owner set, and the owner would not be told.

The other order of events was already safe: `changePact` checks the reminders it is sent against the new terms (`checkedPact`), for a stricter change that applies at once and for one that waits, so a change to a due time at or before an existing reminder is refused with `reminder-after-due-time`.

The fix: `remindersInTimeNow` (`change-requests.ts`), which both `setReminders` and `checkedChange` use, also checks the reminders against the waiting change request's terms (`firstOccurrenceUnder`, which `deadlineFarEnough` now shares). It covers the due-by time, the in-bed-by time and a One-time deadline. A reminder valid today can be refused for a change that is later rejected; once the request is decided or withdrawn, it can be set. The refusal is the same `reminder-after-due-time`, with the same words on the Reminders sheet ("A reminder is at or after the due time, so it would never go off"); they don't say that the due time is the waiting change's.

- Tests, written first: `change-requests.test.ts`, "reminders go off before the due time a waiting change request asks for, too" (due-by, in-bed-by, One-time deadline, and reminders set first).
- The entry for this ticket is removed from `KNOWN` (`fuzz-invariants.ts`), which is now empty; seeds 3000 to 3059 at 300 steps pass.
