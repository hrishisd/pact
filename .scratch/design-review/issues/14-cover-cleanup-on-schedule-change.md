# 14 Delete cover when a change removes a day

Status: ready-for-agent
Blocked by: 08

Closes: F9 and rule R9 (`../interaction-audit.md` finding 9, probe P3); H2 step 4 (`../architecture-review.md`); the occurrence-key check from W4.

## Problem

`excuse_day` and `vacation_day` rows key a covered occurrence by `(pact_id, date)` and are read without checking the schedule (`src/core/occurrence-state.ts:67-109`, and after ticket 08 `coverOn` in `src/core/covers.ts`). When an approved change removes a day and a later change adds it back, the old row covers it again. Probe P3 (`../probes/audit-probes.test.ts.txt`, "probe 3"): Wednesday removed by a change and added back by a later change came out Excused. vac:61 says "A day a change adds isn't covered", and the same is implied for excuses.

The audit confirmed this for excuses only. It suspected it for vacations, because `vacationOn` reads its rows the same way (`occurrence-state.ts:97-109`), but did not probe it. Removal alone is already handled for display: `excuseDays` hides a removed day (`src/core/excuses.ts:277-288`), and `vacations.test.ts:1059` covers a vacation's removed day.

Occurrence identity is `(pact_id, date)` with no foreign key on cover rows, so any new fact table about occurrences must also be handled by `moveOneTimeOccurrence` (`src/core/pacts.ts:526-550`) and by this cleanup. Nothing enforces that.

## What to build

1. First, a failing scenario for vacations: an approved vacation covers next Wednesday on a Mon/Wed/Fri pact; an approved change drops Wednesday; a later change adds it back before that Wednesday opens; that Wednesday is judged as usual (Missed with no photo), not Excused. Record the result under Comments: if the scenario passes before the fix, vacations do not have the bug and say why.
2. In `applyTerms` (`src/core/change-requests.ts:437-480`), after the new terms are written: delete `excuse_day` and `vacation_day` rows for this pact's dates from `from` (the first day not open) onward that the new schedule, start date or end date no longer has, if the occurrence is not judged. For Weekly count, rows hold the week's Monday; a target change removes no week. `applyOneTimeTerms` already moves or deletes rows through `moveOneTimeOccurrence`; leave it.
3. An excuse or vacation left with no days stays waiting for now; ticket 20 withdraws it under R8. Note it in Comments.
4. A comment at the top of `occurrence-state.ts` (or `covers.ts`) stating occurrence identity and the two places a new occurrence fact table must be handled.
5. Conventions check: a migration that creates a table with both `pact_id` and `date` (or `occurrence_date`) columns must name that table in `moveOneTimeOccurrence` and in the cleanup, or be on an explicit allow list with a reason.

## Where to start

- `src/core/change-requests.ts:437-505`, `src/core/pacts.ts:520-550`.
- `excuses.test.ts` (no scenario covers this yet), `vacations.test.ts:1059`.

## Acceptance criteria

- [ ] The vacation scenario in step 1, with its before-the-fix result recorded.
- [ ] Probe P3 as a scenario in `excuses.test.ts`: an excuse for Wednesday, Wednesday removed by an approved change and added back by a later one, Wednesday judged Missed with a penalty.
- [ ] New scenario: a judged day's cover is untouched by a later change.
- [ ] New scenario: an excuse whose only day was removed shows no days on its page and in the Review Queue (it stays waiting until ticket 20).
- [ ] The occurrence-key check refuses a migration adding a new table with `pact_id` and `date` that is not named; shown by trying it.
- [ ] Update `docs/behaviour.md`: R9, and remove the F9 known-bug note.
- [ ] `npm run check` passes.

## Out of scope

- Withdrawing a cover left with no days (ticket 20).
- Merging the cover tables (not doing).
