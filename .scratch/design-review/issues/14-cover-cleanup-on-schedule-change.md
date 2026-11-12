# 14 Delete cover when a change removes a day

Status: done
Blocked by: 08

Closes: F9 and rule R9 (`../interaction-audit.md` finding 9, probe P3); H2 step 4 (`../architecture-review.md`); the occurrence-key check from W4.

## Problem

`excuse_day` and `vacation_day` rows key a covered occurrence by `(pact_id, date)` and are read without checking the schedule (`src/core/occurrence-state.ts`, and after ticket 08 `coverOn` in `src/core/covers.ts`). When an approved change removes a day and a later change adds it back, the old row covers it again. Probe P3 (`../probes/audit-probes.test.ts.txt`, "probe 3"): Wednesday removed by a change and added back by a later change came out Excused. vac:61 says "A day a change adds isn't covered", and the same is implied for excuses.

The audit confirmed this for excuses only. It suspected it for vacations, because `vacationOn` reads its rows the same way (`occurrence-state.ts`), but did not probe it. Removal alone is already handled for display: `excuseDays` hides a removed day (`src/core/excuses.ts`), and `vacations.test.ts` covers a vacation's removed day.

Occurrence identity is `(pact_id, date)` with no foreign key on cover rows, so any new fact table about occurrences must also be handled by `moveOneTimeOccurrence` (`src/core/pacts.ts`) and by this cleanup. Nothing enforces that.

## What to build

1. First, a failing scenario for vacations: an approved vacation covers next Wednesday on a Mon/Wed/Fri pact; an approved change drops Wednesday; a later change adds it back before that Wednesday opens; that Wednesday is judged as usual (Missed with no photo), not Excused. Record the result under Comments: if the scenario passes before the fix, vacations do not have the bug and say why.
2. In `applyTerms` (`src/core/change-requests.ts`), after the new terms are written: delete `excuse_day` and `vacation_day` rows for this pact's dates from `from` (the first day not open) onward that the new schedule, start date or end date no longer has, if the occurrence is not judged. For Weekly count, rows hold the week's Monday; a target change removes no week. `applyOneTimeTerms` already moves or deletes rows through `moveOneTimeOccurrence`; leave it.
3. An excuse or vacation left with no days stays waiting for now; ticket 20 withdraws it under R8. Note it in Comments.
4. A comment at the top of `occurrence-state.ts` (or `covers.ts`) stating occurrence identity and the two places a new occurrence fact table must be handled.
5. Conventions check: a migration that creates a table with both `pact_id` and `date` (or `occurrence_date`) columns must name that table in `moveOneTimeOccurrence` and in the cleanup, or be on an explicit allow list with a reason.

## Where to start

- `src/core/change-requests.ts`, `src/core/pacts.ts`.
- `excuses.test.ts` (no scenario covers this yet), `vacations.test.ts`.

## Acceptance criteria

- [x] The vacation scenario in step 1, with its before-the-fix result recorded.
- [x] Probe P3 as a scenario in `excuses.test.ts`: an excuse for Wednesday, Wednesday removed by an approved change and added back by a later one, Wednesday judged Missed with a penalty.
- [x] New scenario: a judged day's cover is untouched by a later change.
- [x] New scenario: an excuse whose only day was removed shows no days on its page and in the Review Queue (it stays waiting until ticket 20).
- [x] The occurrence-key check refuses a migration adding a new table with `pact_id` and `date` that is not named; shown by trying it.
- [x] Update `docs/behaviour.md`: R9, and remove the F9 known-bug note.
- [x] `npm run check` passes.

## Out of scope

- Withdrawing a cover left with no days (ticket 20).
- Merging the cover tables (not doing).

## Comments

- Step 1, before the fix: the vacation scenario failed. Wednesday Wed+1 came out Excused, not Missed, so vacations had the same bug as excuses (`vacation_day` rows are read without the schedule, as `excuse_day` rows are). Both pass after the fix. Scenarios: `vacations.test.ts` and `excuses.test.ts`, "a change that removes a covered day".
- The cleanup is `uncoverRemovedDays` in `covers.ts` (the conventions check lets only `covers.ts`, `occurrence-state.ts` and each kind's own module touch the cover tables), called at the end of `applyTerms`. It deletes rows of every decision, rejected and withdrawn included, so a rejected excuse's page doesn't show a day added back either.
- The judged-day scenario passed before the fix too: `applyTerms` only looks at dates from the first day not open, and the cleanup also skips judged occurrences. It is a guard.
- Step 3: an excuse or vacation left with no days stays waiting, showing no days on its page and in the Review Queue. Ticket 20 withdraws it under R8.
- The occurrence-key check was shown by adding an `occurrence_note (pact_id, date, note)` table to a migration: it reported the table twice (move and cleanup) and exited 1. `occurrence`, `evidence`, `penalty` and `reminder_sent` are on its allow list with reasons.
- Review: the occurrence-key check read only `CREATE TABLE` bodies laid out one column a line, so a `date` added by `ALTER TABLE ... ADD COLUMN`, a one-line `CREATE TABLE`, or `IF NOT EXISTS` slipped past it. It now strips SQL comments and follows added and dropped columns; shown by a one-line `occurrence_note (pact_id, note)` table given `date` by `ADD COLUMN` (reported twice, exit 1). Added a Weekly count scenario to `vacations.test.ts` ("a change that removes a covered day"): a target change keeps both covered weeks, an earlier end date deletes the later week, and a later end date doesn't bring it back; it fails without the cleanup.
