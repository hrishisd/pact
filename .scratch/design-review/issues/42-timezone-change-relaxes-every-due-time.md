# A timezone change relaxes every due time with no approval, and no reviewer is told

Status: needs-info
Blocked by: 39

## Decision needed

Should a timezone change that makes due times later need a reviewer's approval, or only be told to the reviewers?

Recommended: tell the reviewers, with no approval. The spec below builds that. Also needed: a yes to the push's words and to the new notification setting, or a request to prototype them first.

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. A later due-by needs a reviewer's approval (`termDiffs`, `src/core/changes.ts`). But every Camera and Anki due time is read in the owner's timezone, and the owner changes that in Profile at once (`setTimezone`, `src/core/accounts.ts`). Nobody is told, and no screen shows a reviewer the owner's timezone.

An owner in London with a pact due by 21:00 sets Pacific/Honolulu. Every day is now due at 07:00 or 08:00 the next morning in London. The same move gives ten more hours on each Anki day and on each Weekly count week. Oura Ring nights are not affected: they use the offset Oura reports.

Ticket 39 stops a change from moving a day that is already open. It does not stop this: the gain here is on every later day.

## What ticket 39 changed

Ticket 39 is done. A timezone change now applies only to days that have not opened, so an owner no longer gains hours on a day that is open, and a judged day no longer moves. The loophole here remains, as that ticket said: every day from `until` (the first day that takes the new timezone, `setTimezone`, `src/core/accounts.ts`) is due later after a move west. The gain is one shift, not one that grows: at most 26 hours, between the furthest zones. It matters most for a pact about a time of day ("Gym by 9:00am").

One direction in the first version of this ticket cannot be built as written: "show the owner's timezone on the pact page a reviewer sees". A reviewer has no pact page. They see the Review Queue, the items in it and pushes; `pact` (`AccountView`, `src/core/core.ts`) answers `pact-not-found` to anyone but the owner. So the push is the only place to tell them, and it names both timezones.

## What to build

Rule: when an owner's timezone change makes due times later, each reviewer of an affected pact gets one push. Nothing waits for approval, and the change applies as it does now.

- In `setTimezone`, after the change is stored, work out the shift: the instant of 00:00 on `until` in the new timezone, less the instant of 00:00 on `until` in the old one (the timezone before this call), with `until` as this call works it out. This reads the offsets on the day the change starts, so it is right across a daylight-saving change. Tell nobody when the shift is zero or less: a move east makes every due time earlier, which is stricter, and stricter changes need no one's leave anywhere in the app.
- Affected pacts: the owner's Active pacts whose reviewers have been told of them (`reviewers_notified_at` is set), with evidence kind Camera or Anki, and no end date before `until`. Oura Ring pacts are left out: a night uses the offset Oura reports. All three schedules count: a Weekly count week ends later, and a One-time deadline that has not opened moves.
- One push per reviewer, however many of the owner's pacts they review, naming only the pacts that reviewer reviews (a reviewer must not learn of a pact they do not review). New notification kind `timezone-changed` (`NotificationKind` and `NotificationDetails`, `src/core/ports.ts`), details `{ ownerId, from, to }` with the two IANA names.
  - Title: "Jordan changed timezone".
  - Body: "London to Honolulu. Gym and Reading are due 10 hours later from Tue Jan 13." The date is `until`. Zones are shown by their city: the last part of the IANA name with `_` as a space ("America/Argentina/Buenos_Aires" is "Buenos Aires"; "UTC" stays "UTC"). Hours are rounded to the half hour ("1 hour", "5.5 hours"). Pacts by name, oldest first: one, "A and B", or "A, B and 2 more". One pact reads "Gym is due …".
  - It opens Review (`APP_PATHS.review`), as the picked-as-reviewer push does.
- A change to the same timezone tells nobody (it already returns early). Two moves west on one day send two pushes, each with its own shift; that is correct, and it is what a reviewer would want to see.
- No stored data changes and there is no migration. Past timezone changes are not told.
- Profile: under the timezone picker (`src/client/App.tsx`), one line: "Reviewers of your pacts are told when a change makes due times later." The owner should know before they change it.

The push follows a new notification setting, `reviewed-pact`, shared by tickets 42, 43 and 44; the first of the three to be built adds it. Add it to `NOTIFICATION_SETTINGS` (`src/shared/types.ts`), to `SETTING_OF_KIND` (`src/core/outbox.ts`) and to `SETTING_COPY` (`src/client/Notifications.tsx`) with the label "Pacts you review". Its hint lists what is built so far, for all three: "A friend added a reviewer, changed timezone, or had a vacation approved on a pact you review". It starts on, as every push setting does, and needs no migration (`notification_setting_off` holds only what is off). The randomised test keeps its own copy of the kind-to-setting map for `messages-follow-settings` (`src/core/testing/fuzz-invariants.ts`); add the new kind there.

`docs/behaviour.md`, Time and timezones, gains: "When a timezone change makes due times later, each reviewer of the owner's Active Camera and Anki pacts is told once, with both timezones, the pacts they review and the day it starts (`setTimezone`, `accounts.ts`). It needs no approval. A change that makes them earlier tells nobody." The Notifications section's list of settings gains the new one.

## The alternative

A move west waits for a reviewer's approval, like a later due-by. It closes the loophole fully. It is not recommended: travel is the common, honest reason for a timezone change, and nothing in the app expires, so a traveller with a slow reviewer would have days due at 04:00 local time until a friend acts. It also needs a waiting state for the account's timezone, which no review item has today. The app's model is that friends who know hold each other to account; a reviewer who reads "London to Honolulu" about a friend who is at home can say so.

## Tests to write first

Scenarios in `src/core/timezone.test.ts`:

- A move west tells each reviewer of an Active Camera pact once, with the words above.
- A reviewer of two of the owner's pacts gets one push naming both; a reviewer of one of them gets one naming only theirs.
- A move east, and a change between two timezones with the same offset, tell nobody.
- An Oura Ring pact, an Ended pact and a pact still in its edit window are not named, and a reviewer of only those is not told.
- With the setting off, the reviewer gets nothing (`src/core/notifications.test.ts`).

## Prototype

User-visible, but small: one push, one line in Profile and one row in notification settings, with no new screen. The words are all above. Recommended: approve or correct the words here and build directly. `docs/agents/prototype-first.md` makes this the human's choice.

## Acceptance criteria

- [ ] A reviewer is pushed when an owner's timezone change makes a pact they review due later, with both timezones, their pacts and the first day.
- [ ] A change that makes due times earlier, or leaves them, tells nobody.
- [ ] The push follows the "Pacts you review" setting.
- [ ] `docs/behaviour.md` (Time and timezones; Notifications and reminders) says so.
- [ ] The scenarios above pass, and the randomised test's kind-to-setting map has the new kind.
- [ ] `npm run check` passes.
