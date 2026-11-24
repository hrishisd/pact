# When a Weekly count pact starts

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Settled in a grilling session on 2026-11-24. The layout was chosen from a prototype: branch `prototype/weekly-start` (local, not pushed), file `.scratch/weekly-start/prototype/start-choice.prototype.html` (layouts A, B and C; A was chosen).

## Problem statement

I made a pact to go to the gym 3× a week on a Monday evening. Pact started it the following Monday, so the week I made it in counted for nothing. A Weekly count pact always started on the Monday after creation. Made on a Monday, that wasted a whole week. Made midweek, I had no way to say "I can still do 3 this week, count it".

## Solution

Two parts.

1. **Made on a Monday, a Weekly count pact starts that week.** Built first, on its own (commit "Start a Weekly count pact made on a Monday that same week").
2. **The owner chooses the first week.** The Schedule step of a Weekly count pact replaces the start date field with a choice of weeks: this week, next week, or a later week. The start date of a Weekly count pact is always a Monday.

## Decisions

### The choice (prototype layout A)

- A **Starts** field with three option rows:
  - **This week · Nov 23 – 29**, with "3× by Sunday, with 4 days left (Thu–Sun)", or "3× by Sunday, with the whole week" on a Monday.
  - **Next week · Nov 30 – Dec 6**, with "3× by Sun Dec 6".
  - **A later week**, with "Pick the Monday it starts". Choosing it shows a list of the next 12 Mondays after next week's.
- The target in the rows follows the stepper above.
- The default is this week when the pact is made on a Monday and this week is offered; otherwise next week. Starting this week midweek is stricter (the same target in fewer days), so the owner has to choose it.

### When this week is offered

- Only when the days left for a photo, today included while its due time is still ahead, are at least the target, and the week ends at least an hour from now (the hour every first occurrence needs).
- Otherwise the row stays, greyed out, with the reason: "Only 2 days left, fewer than 3×." or "The week ends in less than an hour."
- The target is the same as a full week's. No prorating.
- The core decides this, counting from when the pact is created, or from when it was created for an edit in its edit window. A start this week the core refuses is `week-too-short`.

### Start dates are Mondays

- A Weekly count pact's start date is a Monday. Another day is refused (`start-not-monday`), when creating, editing in the window, or in a change request that changes it.
- The form offers a list, not a date picker: the iPhone's date picker can't grey out the other days.
- A start date stored before this rule stays as it is.

### End date

- Still a free date. Under it, for a Weekly count pact, the form shows the last whole week it gives: "Last week: Dec 28 – Jan 3". Only whole weeks count, as before.

### Request change

- Before the pact starts, the change form's start choice offers next week and later Mondays, never this week: a change applies from the first day not open, which for Weekly count is next Monday.
- After it starts, the start date can't change (`pact-started`), as before.

### Check it over

- This week: "Your first week is this week, with 4 days left (Thu–Sun). You need 3× by the end of Sun Nov 29, the same as a full week." On a Monday with the whole week left: "Your first week is this week. You need 3× by the end of Sun Nov 29."
- Another week: "Your first week starts Mon Nov 30 and ends on Sunday.", as before.

## Out of scope

- A practice week before the start, with evidence that has no penalty. Considered and dropped: evidence needs an open occurrence, and a decision that changes no outcome is withdrawn as moot.
- End dates limited to Sundays.
