# 25 Some .test.tsx files are never type-checked

Status: done
Blocked by: none

Found while building ticket 09.

## Problem

`npm run typecheck` (`tsc --noEmit`) leaves out a `.test.tsx` file whose folder also has a `.test.ts` with the same name: TypeScript treats `x.test.ts` and `x.test.tsx` as the same module and keeps only the `.ts` one. `tsc --listFiles` lists `src/client/history.test.ts`, `excuse-days.test.ts` and `ChangePact.test.ts`, but not their `.test.tsx` twins.

Vitest still runs those files, so their tests pass or fail, but a fixture can drift from the shared types without anyone noticing. Before ticket 09, `history.test.tsx` built `OccurrenceRecord`s with no `cover` or `phase`, which `tsc` refuses in any type-checked file. Ticket 09 fixed those fixtures; nothing stops the next drift.

## What to build

- Make every test file type-checked: rename or merge each `.test.ts`/`.test.tsx` pair (for example, move the `.test.ts` cases into the `.test.tsx` file), and fix whatever type errors appear.
- A conventions check in `scripts/check-conventions.ts` that refuses a `.test.ts` and a `.test.tsx` with the same name in one folder.

## Acceptance criteria

- [x] `tsc --listFiles` lists every `*.test.ts` and `*.test.tsx` under `src/`.
- [x] The conventions check refuses a new same-name pair; shown by trying it.
- [x] `npm run check` passes.

## Owner decision (2026-11-11)

Ready for an agent. Run it before ticket 10.
