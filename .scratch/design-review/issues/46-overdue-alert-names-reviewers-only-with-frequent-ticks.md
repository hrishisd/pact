# After a gap in ticks, the overdue alert does not name the reviewers who would have been told

Status: needs-triage
Blocked by: none

## Problem

Found by the randomised test of the core (`src/core/fuzz.test.ts`), in the mode that runs the same actions once with single ticks and once with many small ticks and expects every query to answer the same. Seed 6020 with 200 steps differs: at the end, the third person's Today shows an overdue bill alert. With many ticks the alert names a reviewer who was told ("bea"); with single ticks, to the same final time, it names none.

The run has no timezone change, so this does not come from ticket 39. Reviewers are told when an Overdue spell starts and weekly after (`remindOverdue`, `src/core/money.ts`), and the alert names reviewers only once they have been told in this spell (`billsForToday`, `money.ts`). So after a gap in ticks (downtime of the scheduler), either the reviewers are not told of a spell they would have been told of, or they are told and the alert does not say so.

The cause is not found yet. Which of the two it is decides how much it matters: a reviewer never told about an overdue bill is a real fault; a wrong name on an alert is small.

Reproduce (the run shrinks to 16 actions and prints them):

```
FUZZ_MODE=both-ways FUZZ_STEPS=200 FUZZ_SEEDS=6020 npx vitest run src/core/fuzz.test.ts
```

## What to build

Find which tick tells the reviewers in the many-ticks run and why the single tick at the same final time does not. Then make catching up after a gap tell the reviewers, as bills already catch up (`makeBills`, `money.ts`).

## Acceptance criteria

- [ ] After any gap in ticks, the reviewers told of an Overdue spell and the names on the owner's alert are the same as with a tick every minute.
- [ ] A scenario test covers it.
- [ ] Seed 6020 passes in both-ways mode.
- [ ] `npm run check` passes.
