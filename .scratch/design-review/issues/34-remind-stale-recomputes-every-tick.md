# Stale-item reminders recompute every account's queue on every tick

Status: wontfix
Blocked by: none

## Problem

Found while working on ticket 33. `remindStale` (`src/core/stale-items.ts`) runs on every scheduler tick and, for every account not yet reminded since its latest 09:00, calls `reviewQueueWaits` and `questionAlerts`, even though a reminder can only go out once a day. An account with nothing waiting (most of them) is recomputed every tick, all day. Profiling the old two-scenario version of the R3 test in `vacations.test.ts` (about 420 hourly ticks, three accounts each), `remindStale` took about 1.4 s of the run's 3.7 s, more than settling, reminders and bills together. Production ticks every minute, so the cost grows with accounts times ticks, and it makes every scenario that ticks through days slower.

## What to build

Skip the queue and question reads when they can't produce a reminder, for example by recording that an account was checked since its latest 09:00 and found nothing stale, or by a cheap SQL check for any item older than `staleBefore` before building the queue. Behaviour must not change: `stale-items.test.ts` stays green unchanged.

## Acceptance criteria

- [ ] `remindStale` does not build an account's review queue or question alerts more than once per 09:00 period when nothing was stale.
- [ ] `stale-items.test.ts` passes unchanged.
- [ ] `npm run check` passes.

## Comments

2026-11-12: Measured on a simulated 90-day database (10 accounts, 38 pacts), `remindStale` is 7–9 ms of a 96 ms idle tick (about 7%), and about 4 ms of a 19–20 ms tick once `src/core/calendar.ts` keeps one date formatter per timezone (ticket 35). The 1.4 s above was mostly making a new `Intl.DateTimeFormat` inside `latestReminderTime` and the queue reads, which ticket 35 fixes. Skipping the reads isn't worth the extra state: won't fix.
