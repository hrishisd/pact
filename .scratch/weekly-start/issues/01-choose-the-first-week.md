# 01 Choose a Weekly count pact's first week

Status: done
Blocked by: none

Spec: `../spec.md`. Prototype: branch `prototype/weekly-start`, layout A.

## What to build

The Schedule step of a Weekly count pact offers this week, next week or a later Monday as its start, as in the spec.

- Core: a Weekly count start date must be a Monday (`start-not-monday`). This week's Monday as the start date is accepted when this week is offered, else refused (`week-too-short`). Made on a Monday with no start date, the pact starts that week when it's offered, else the Monday after. A change request is never refused for this week's rule, only for a start date it changes to a day other than Monday.
- Core query `weekStarts` for the form: this week (its Monday, days left, offered or why not), the next 12 Mondays, the default, and the last whole week an end date gives. With `changing`, no this week, and the Mondays start at the first week not open.
- The Check step names the days left when the first week is this week.
- Server: `POST /api/pacts/week-starts`.
- Client: the Starts option rows on the Schedule step, in Create pact, the edit window and Request change; the "Last week" line under the end date.

## Acceptance criteria

- [x] Made Thursday with 3×: this week offered with 4 days left; chosen, the first week is this week; default next week (`weekly-count.test.ts`).
- [x] Made Saturday with 3×: this week not offered, and choosing it is refused `week-too-short` (`weekly-count.test.ts`).
- [x] A due-by time already past today leaves today out of the days left (`weekly-count.test.ts`).
- [x] A start date that isn't a Monday is refused when creating and in a change request (`weekly-count.test.ts`, `change-requests.test.ts`).
- [x] A change request on a pact that started midweek isn't refused for this week's rule (`weekly-count.test.ts`).
- [x] The route passes the core's answer through (`app.test.ts`).
- [x] The Schedule step shows the three rows, greys out this week with its reason, and sends the chosen Monday (`CreatePact.test.tsx`).
- [x] `docs/behaviour.md` and `GLOSSARY.md` say how a Weekly count pact starts.
- [x] Checked in the browser at 390×844 next to the prototype.

## Comments

- 2026-11-24: Built on branch `claude/charming-ritchie-jkzk6u`. Checked in the browser on Monday, Thursday and Saturday of the week of Nov 23; the screens match prototype layout A.
