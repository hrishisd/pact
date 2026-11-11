# 09 One client presentation of an occurrence

Status: ready-for-agent
Blocked by: 08

Closes: C1 (`../code-structure-review.md`, section 1); the client half of architecture ranked item 1; the layer import check from W4.

## Problem

The core sends an `OccurrenceStatus` with raw fields, and each screen decides what to call the occurrence by comparing `opensAt` and `dueAt` with the browser clock in its own order:

- `squareOf` (`src/client/history.tsx:31-39`): vacation, outcome, approved excuse, then ahead/open/not judged. Ignores a waiting excuse and waiting evidence.
- `DayChip` (`src/client/excuse-days.tsx:20-58`): approved excuse, waiting excuse, waiting evidence, then ahead/open/not judged.
- `dayNote` (`excuse-days.tsx:70-83`): ahead/open/not judged only, with its own "Due by Sunday".
- `OccurrenceChip` (`history.tsx:51-65`): vacation first, then `DayChip`.
- `missedLine` (`src/client/Today.tsx:615-630`) and `recentNote` (`src/client/ExcuseSheet.tsx:578-583`).
- `DayCard` decides which Weekly count week a day belongs to by Monday plus six days (`ExcuseSheet.tsx:510`), a rule the core owns.

So the heat map square and the chip beside it can disagree: a day with a waiting excuse is a plain open square with an "Excuse waiting for approval" chip. And `DayChip` can only say "Excuse waiting for approval" (`excuse-days.tsx:50`) for a waiting vacation too, because the old `excuse` field could not tell them apart.

## What to build

- One `presentOccurrence(view, now)` in `src/client/excuse-days.tsx` that returns the chip, the heat map square and the note together, from the core's view (ticket 08: `phase`, `cover`, outcome, `evidenceWaiting`). The countdown stays client-side; the ordering does not.
- Replace the six functions above with it. `DayCard` takes the week from the core (add the week's Monday and Sunday to the view or to the excuse preview if they are not there).
- A waiting vacation reads "Vacation waiting for approval" where a waiting excuse reads "Excuse waiting for approval".
- Conventions check in `scripts/check-conventions.ts`: `src/client/` imports only `src/client/` and `src/shared/`, and `src/core/` never imports `src/server/` or `src/client/`. Both hold today.

## Where to start

- `src/client/excuse-days.tsx`, `src/client/history.tsx:31-65`, `src/client/Today.tsx:615-630`, `src/client/ExcuseSheet.tsx:505-583`.
- The tests: `src/client/history.test.tsx`, `src/client/excuse-days.test.tsx`.

## Acceptance criteria

- [ ] The six functions are gone or are thin calls to `presentOccurrence`.
- [ ] New `excuse-days.test.tsx` cases: a waiting excuse and a waiting vacation on a day not judged yet give the same square and different chip text; a Missed day under a waiting vacation reads "Missed · vacation waiting for approval".
- [ ] New `history.test.tsx` case: the square and the chip agree for a day with a waiting excuse.
- [ ] Existing client tests pass, changed only where the copy is fixed on purpose.
- [ ] The import check refuses an import of `src/core/` from `src/client/`; shown by trying it.
- [ ] Update `docs/behaviour.md` if any label changes.
- [ ] `npm run check` passes.

## Out of scope

- The waiting list rows (ticket 18).
- Visual redesign of the chips or squares.
