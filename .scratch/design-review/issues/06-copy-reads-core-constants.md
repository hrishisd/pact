# 06 Copy reads the core's time constants

Status: done
Blocked by: 01

Closes: C4 (`../code-structure-review.md`, section 1).

## Problem

The edit window and excuse window are `EDIT_WINDOW_MS` and `EXCUSE_WINDOW_MS` in `src/core/pact-rules.ts:36,42`, and a bedtime night closes at 18:00 in `src/core/bedtime.ts`. The client hard-codes "10 minutes" six times (`ChangePact.tsx:61`, `CreatePact.tsx:243,489`, `ExcuseSheet.tsx:105,596`, `PactPage.tsx:143`, `pact-form-steps.tsx:69`), "6pm" four times (`Today.tsx:524,626`, `history.tsx:78`, `pact-form-steps.tsx:444`) and "48 hours" in `excuse-days.tsx:91`. Changing a window in the core leaves the copy wrong and no test notices. `MAX_EXCUSE_SPAN_DAYS` and `MAX_EVIDENCE_PHOTOS` already show the right pattern.

## What to build

- Export `EDIT_WINDOW_MINUTES`, `EXCUSE_WINDOW_HOURS` and `NIGHT_CLOSES_AT` (hour) from `src/shared/types.ts`. The core derives its millisecond constants from them; the copy formats them.
- Replace every hard-coded occurrence listed above. Search for others (`grep -rn "10 minutes\|48 hours\|6pm\|18:00" src/client`).

## Where to start

- `src/core/pact-rules.ts:36,42`, the night close in `src/core/bedtime.ts` and `src/core/oura-clock.ts`.
- The client lines above.

## Acceptance criteria

- [x] No client file contains the literal "10 minutes", "48 hours" or "6pm" as window copy.
- [x] Existing client tests pass unchanged (the copy reads the same).
- [x] `npm run check` passes.

## Out of scope

- Changing any window's length.
