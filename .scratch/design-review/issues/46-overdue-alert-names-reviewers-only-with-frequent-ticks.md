# After a gap in ticks, the overdue alert does not name the reviewers who would have been told

Status: done
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

- [x] After any gap in ticks, the reviewers told of an Overdue spell and the names on the owner's alert are the same as with a tick every minute.
- [x] A scenario test covers it.
- [x] Seed 6020 passes in both-ways mode.
- [x] `npm run check` passes (its parts; `shellcheck` is not installed where this was built).

## Outcome

Neither guess in the Problem was the cause, and no reviewer went untold. The fault was in what counts as one Overdue spell.

`overdueOf` (`src/core/bill-math.ts`) took the spell to start at the due time of the oldest bill past due and still unpaid. `overdueNotice` (`src/core/money.ts`) drops a notice made before that time, as one from an earlier spell. So when an approved payment paid off the first of two overdue bills, the start jumped forward to the second bill's due time, and the word already given to the reviewers stopped counting, though the owner had been Overdue all along. `docs/behaviour.md` says a spell ends only when approved payments have paid every bill past due, so this was against the rule. What a person saw: the owner's alert stopped naming the reviewers, and the next tick told the reviewers again, off the weekly time.

Why it showed only after a gap in ticks: with a tick every minute, the reviewers are told at the first bill's due time and again exactly a week later, which is the second bill's due time. That second word is not before the new start, so it still counted and hid the fault. In seed 6020 a gap moved the first word to two days after the due time, the next was not yet due, and the payment then left the alert naming nobody.

The fix: `billsOf` (`money.ts`) marks a bill as having joined a spell when the payments approved by its due time had not paid every bill before it (`joinedSpell`, `BillState`), and `overdueOf` walks back over such bills to the bill that started the spell. A payment approved at a bill's due time counts as before it. No migration; nothing is stored.

The weekly word still counts from when the reviewers were last told, so after a gap it comes at another time than with a tick every minute. That is the rule as written ("weekly after") and no query shows it.

- Test, written first: `bills.test.ts`, "paying off the oldest of two overdue bills doesn't end the spell".
- Seed 6020 passes in both-ways mode, with seeds 6000 to 6029.
