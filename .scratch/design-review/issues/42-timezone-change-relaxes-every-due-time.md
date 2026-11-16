# A timezone change relaxes every due time with no approval, and no reviewer is told

Status: needs-triage
Blocked by: 39

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. A later due-by needs a reviewer's approval (`termDiffs`, `src/core/changes.ts`). But every Camera and Anki due time is read in the owner's timezone, and the owner changes that in Profile at once (`setTimezone`, `src/core/accounts.ts`). Nobody is told, and no screen shows a reviewer the owner's timezone.

An owner in London with a pact due by 21:00 sets Pacific/Honolulu. Every day is now due at 07:00 or 08:00 the next morning in London. The same move gives ten more hours on each Anki day and on each Weekly count week. Oura Ring nights are not affected: they use the offset Oura reports.

Ticket 39 stops a change from moving a day that is already open. It does not stop this: the gain here is on every later day.

## What to build

Directions to weigh:

- Tell the reviewers of the owner's Active pacts when the timezone changes ("Jordan changed timezone from London to Honolulu. Gym is now due 10 hours later."), and show the owner's timezone on the pact page a reviewer sees. Cheap, and it fits how the app works: friends keep each other honest.
- Treat a move west as a relaxation that a reviewer approves, like a later due-by. Stronger, but a person who really travels must wait for a friend before their days fit their clock.

The first is recommended. A real trip is common and an approval step would punish it.

## Acceptance criteria

- [ ] A reviewer learns of an owner's timezone change that makes a due time later, and can see the owner's timezone.
- [ ] `docs/behaviour.md` (Time and timezones) says so.
- [ ] A scenario test covers it.
- [ ] `npm run check` passes.
