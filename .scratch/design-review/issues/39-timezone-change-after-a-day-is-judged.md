# After a timezone change, judged days and stale-item pushes disagree with the rules

Status: done
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`) run with `FUZZ_TIMEZONE_CHANGES=1`. A person can change their timezone in Profile (`setTimezone`, `accounts.ts`). Every due time is then worked out again in the new timezone, also for days already judged. The stored outcome and penalty stay as they were. The two can then disagree, and `verdictOf` (`src/core/verdict.ts`), which every scenario test holds stored outcomes to, no longer matches what is stored. No rule in `docs/behaviour.md` says which one is right. In 80 runs of 200 steps (seeds 2000 to 2079), 6 broke an invariant. They are three cases.

1. A Missed day becomes open again. An owner in UTC has an Anki pact for Friday 3 April. The day is judged Missed at Saturday 00:00 UTC, with its penalty. At 01:35 UTC the owner moves to Pacific/Honolulu, where it is still Friday afternoon. `verdictOf` now says the day is open; the store says Missed with a penalty. Reproduce: `FUZZ_TIMEZONE_CHANGES=1 FUZZ_STEPS=200 FUZZ_SEEDS=2000 npx vitest run src/core/fuzz.test.ts` (shrinks to 5 actions).
2. A Missed day is no longer one of the pact's days. An owner in Pacific/Auckland has a One-time pact by 5 April. It is judged Missed at its due time, 12:00 UTC on 5 April, and the pact Ends then. The owner moves to America/New_York. `verdictOf` now says 5 April is not the pact's day; the store keeps the Missed outcome and the penalty. Reproduce with seed 2044 (shrinks to 3 actions and the move).
3. A second stale-items push on one local date. `docs/behaviour.md` says a reviewer gets the 09:00 push about waiting review items once a day at most. `remindStale` (`src/core/stale-items.ts`) compares dates in the reviewer's current timezone, so a reviewer who moves west after the push (Asia/Kolkata to America/New_York) can get a second one dated the same local day. Reproduce with seed 2029.

A fourth pattern is not a bug: a move east can put a due time in the past, and the day is judged at the next tick, at most a minute later (seeds 2001, 2038, 2064). The check in `src/core/testing/verdict-check.ts` reports it because it does not expect a due time to pass without the clock moving.

Not checked: what the pact page, Today and the ledger show the owner in cases 1 and 2, and whether the owner can still send evidence for the day in case 1. Money looks safe: `settle` (`src/core/settle.ts`) only ever changes a Missed day to Excused.

## What to build

Decided: a timezone change applies only to occurrences that have not opened. An occurrence that is open or past keeps the timezone it opened in, so its due time, its excuse window and its judging do not move. This keeps judged days as they were judged, and it removes the hours an owner gains today on an open day by moving west.

Build it the way changed terms are already built. `pact_earlier_terms` keeps the terms a pact had `until` a date, and `occurrencesOverTime` (`src/core/occurrences.ts`) reads each date on the terms it opened with. Do the same for the timezone:

- `setTimezone` (`src/core/accounts.ts`) records the old timezone with `until`: the day after today in the old timezone. A change to the same timezone records nothing. Two changes on one day keep the first one's `until`.
- `occurrencesOf` (`src/core/rows.ts`) passes the account's earlier timezones on, and each occurrence is worked out in the first earlier timezone its date is before, else the current one. A Weekly count week follows its Monday, so a week that is open keeps its timezone to its end. A One-time occurrence that has opened keeps the timezone too; one not open yet moves, as `docs/behaviour.md` says now.
- After a move east, the last old day and the first new day are open together for some hours. `openAt` answers the older one until it is due.
- Everything that is not an occurrence stays on the current timezone: reminders for days not open yet, bills (Wednesday 18:00), the 09:00 pushes and the daily summary, and what "today" is on screens. Oura nights keep their own rule (`ouraOffset`, `rows.ts`).
- The stale-items pushes and the daily summary (`remindStale`, `src/core/stale-items.ts`) also skip a recipient whose last one went less than 12 hours ago, so a move west cannot repeat the 09:00 push.

`verdictOf` then needs no change: it reads occurrences through `occurrencesOf`.

Not decided here, to check while building: a bill is made per Wednesday in the owner's timezone; confirm a move across midnight on a Wednesday cannot make two bills or skip one, and add a test.

## Acceptance criteria

- [x] `docs/behaviour.md` states what a timezone change does to judged days and to open days.
- [x] Scenario tests cover: a Missed day stays Missed and off the to-do list after a move west; an open day keeps its due time after a move in each direction; the first day after the change uses the new timezone; a Weekly count week that is open keeps its end; a move west sends no second 09:00 push.
- [x] `verdictOf` agrees with stored outcomes after any timezone change; the `judgingTimesMayMove` option of `scenario()` is removed.
- [x] `FUZZ_TIMEZONE_CHANGES=1 FUZZ_SEEDS=2000-2079 FUZZ_STEPS=200 npx vitest run src/core/fuzz.test.ts` passes, and timezone changes are on by default in `setupOf` (`src/core/testing/fuzz.ts`).
- [x] `npm run check` passes.

## Outcome

Built as planned. `setTimezone` (`accounts.ts`) records the old timezone per pact in a new table, `pact_earlier_timezone` (migration 37), with `until` the day after today in the old timezone, or after today in the new one if that is later (see below); a change to the same timezone records nothing, and a change whose `until` is not after one already recorded adds nothing. `occurrencesOverTime` (`occurrences.ts`) takes the earlier timezones (`earlierTimezonesOf`, `rows.ts`) and works each date out in its own; `occurrencesOf` passes them, so every reader goes through it. `openAt` answers the older of two open days until it is due. `remindStale` skips a 09:00 that comes less than 12 hours after the last one.

Differs from the plan, or beyond it:

- `until` is the day after the later of today in the old timezone and today in the new one. With the old timezone's alone, a move east gave today in the new timezone to the new timezone: it opened before the move and could already be past its due time, so it was judged Missed at the next tick without the owner having had it (randomised test, seed 4019 with 300 steps). Now no day opens before the move; that day keeps the old timezone, and the next day is the new timezone's. For a Weekly count pact moved east on a Sunday evening, the week that starts next keeps the old timezone too.
- Rows are per pact, not per account, so a pact made after a change never takes an earlier timezone, and a One-time pact with Submit anytime keeps the timezone it was made in.
- `dueAfter` no longer stops at the first occurrence not due: after a move east a newer day can be due first. The tick judges it then, and the `judged_through` cursor waits before the older day. `settleBehindCursor` (`settle.ts`) became unreachable, since no due time moves once its day has opened, and is removed.
- After a move west the day still open in the old timezone can be tomorrow in the new one. A change applies from the day after it (`lastDayOpened`, `rows.ts`, used for `firstDayNotOpen` in `change-requests.ts`), so it never changes an open day's terms. Today, vacations and the heat map keep the current timezone's today.
- The bill check found both faults: a move west after a Wednesday's bill billed that Wednesday again, and a move east past its 18:00 skipped it. `setTimezone` now carries the billing cursor on from the last Wednesday billed (`lastBillDay`, `bill-math.ts`). Tests in `bills.test.ts`.
- Timezone changes are on in the randomised test's `setupOf` for a quarter of the seeds; `FUZZ_TIMEZONE_CHANGES` is gone, and so are `judgingTimesMayMove` (`scenario()`) and `timesMayMove` (`verdict-check.ts`).
- `npm run check` was run in its parts (shellcheck isn't installed where this was built, so its lint step wasn't run): `tsc`, Prettier, knip, `check-conventions.ts`, the tests and the build.
- Seed 4019 (300 steps) still breaks `outcomes-match-verdict`, for a reason apart from this ticket: a bedtime night judged at its close changes its close when Oura later reports a sleep on another clock (`ouraOffset`, `rows.ts`), with or without a timezone change. A traveller shows it: an owner in New York whose Monday night closed Missed at Tuesday 18:00, then a Tuesday-night sleep reported at `+01:00`, gives `verdictOf` a close six hours earlier than the stored judging time. Left for its own ticket.
