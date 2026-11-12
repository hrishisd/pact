# The scheduler's tick, the pact query and the test suite are slower than they need to be

Status: ready-for-agent
Blocked by: none

## Problem

Measured on a simulated 90-day database (10 accounts, 38 pacts): an idle scheduler tick takes about 96 ms, and the core's `pact(id)` query 17–23 ms (median). `npx vitest run` takes about 65 s, 57 s of it in `src/core/vacations.test.ts`, and its slowest test takes 4.25 s against Vitest's 5 s timeout.

A CPU profile of the tick puts `offsetMs` at 47% of its own time and `localDateOf` at 19% (`src/core/calendar.ts`). Both make a new `Intl.DateTimeFormat` on every call, and they run for every occurrence on every tick. A scratch experiment that kept one formatter per timezone cut the idle tick from 96 to 19 ms, `pact(id)` from 17 to 8 ms and the suite from 65 to 29 s.

Two smaller costs show in the same profile. `billsOf` (`src/core/money.ts`) reads `SELECT ... FROM penalty WHERE bill_id = ?` once per bill, 144 times in an idle tick's `remindOverdue` at day 90, and each read scans the whole `penalty` table, which only grows: its one index is `penalty_ledger` (owner, recipient). And `ctx.one` and `ctx.all` (`src/core/context.ts`) prepare their statement on every call: 683 prepares an idle tick, 11% of its own time, and the largest cost left once the formatters are kept.

The client refetches a tab's data on every visit; the next agent describes that item and its fix below.

## What to build

- Keep one `Intl.DateTimeFormat` per timezone in `src/core/calendar.ts` for `offsetMs` and `localDateOf`. Behaviour doesn't change and no test changes.
- Add an index on `penalty (bill_id)` in a new migration.
- Try reusing a prepared statement per SQL string in `ctx.one` and `ctx.all`. Keep it only if it cuts the suite by at least 3 s, or `vacations.test.ts` by at least 15%, measured twice each after the formatter cache; otherwise revert it and record what was measured. `CODING_STANDARDS.md` says statements are cached only when profiling says so.
- The client's tab cache: to be filled in by the next agent.

## Acceptance criteria

- [x] `offsetMs` and `localDateOf` reuse one formatter per timezone; every existing test passes unchanged.
- [x] `SELECT ... FROM penalty WHERE bill_id = ?` uses an index (`EXPLAIN QUERY PLAN`).
- [x] The statement cache is kept or reverted on the measured numbers, recorded below.
- [ ] The client tab cache (next agent).
- [ ] `npm run check` passes.

## Comments

2026-11-12: The server side is done; the client tab cache and `npm run check` for the whole ticket are left for the next agent.

- Formatter cache (`src/core/calendar.ts`): `offsetMs` and `localDateOf` each keep one formatter per zone in a module-level `Map`. `partsIn` (`src/shared/format.ts`) and `canonicalTimezone` (`accounts.ts`) still make one per call: they run when a notification's text is written or a timezone is set, not per occurrence on every tick, and weren't in the profile.
- Penalty index: migration 35 adds `penalty_bill` on `penalty (bill_id)`. `EXPLAIN QUERY PLAN` for `billsOf`'s read went from `SCAN penalty` to `SEARCH penalty USING INDEX penalty_bill (bill_id=?)`.
- Statement cache (`src/core/context.ts`): kept. `ctx.one` and `ctx.all` keep one prepared statement per SQL text; every SQL text they get is built from constants, so the map stays small. The context is made after `openDatabase` runs migrations, and nothing in the core changes the schema or calls `.iterate()`. Measured twice each against the formatter cache alone: the suite took 32.0 and 33.3 s without it and 26.4 and 27.5 s with it; `vacations.test.ts` 20.4 and 20.8 s without, 10.5 and 11.8 s with. `CODING_STANDARDS.md`'s settled decision says so.

Timings from `npx vitest run`, wall time on this machine:

| | Suite | `vacations.test.ts` |
| --- | --- | --- |
| Before | 67.7 s | 59.8 s |
| Formatter cache | 30.2 s | 20.2 s |
| And the statement cache | 26.4–27.5 s | 10.5–11.8 s |

The slowest test in `vacations.test.ts` was 4.25 s; it is now 0.51 s, and none is over 2 s.

On the simulated 90-day database, with the formatter cache (the scratch experiment's numbers, not measured again): an idle tick 96 ms to 19 ms, `pact(id)` 17 ms to 8 ms (median).

`docs/behaviour.md` needs no change: nothing a user sees changes.
