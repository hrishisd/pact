# 24 A bedtime night judged before its reminder: R7 or "always reminded"?

Status: done
Blocked by: none

Found while building ticket 08.

## Problem

Rule R7 (`../spec.md`) says a reminder fires for an occurrence if and only if Today shows it as the owner's to do, which for a bedtime night means the Automatic or No Oura data card. But the reminders spec, and the test `reminders.test.ts` "fire every scheduled night, even when the owner is already in bed", say a bedtime night is reminded every scheduled night, even when Oura has already reported the owner in bed. When the ring syncs before the reminder time, the night is judged Satisfied, so Today shows no Automatic card while the reminder still fires.

Ticket 08 kept the current rule: `OccurrenceView.remind` for a bedtime night ignores judging (`occurrence-state.ts`, `occurrenceView`), and `docs/behaviour.md` says so. The two rules disagree only in that one case. Cover follows R7 for bedtime nights too: a waiting excuse stops both the card and the reminder.

## Decision needed

Either:

1. Keep "always reminded" and narrow R7's wording to cover, judging aside for bedtime nights (no code change), or
2. Follow R7 strictly: no reminder for a night already judged. Change `remind` for bedtime nights to `owed` and update the test and the reminders spec.

## Acceptance criteria

- [x] The owner picks 1 or 2.
- [x] `../spec.md` R7 and `docs/behaviour.md` say the same thing as the code.

## Owner decision (2026-11-11)

Follow R7: once Oura has judged a bedtime night, that night gets no reminder. Change the code to match, and update the reminders spec so it no longer says otherwise.
