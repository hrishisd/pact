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

- [ ] `offsetMs` and `localDateOf` reuse one formatter per timezone; every existing test passes unchanged.
- [ ] `SELECT ... FROM penalty WHERE bill_id = ?` uses an index (`EXPLAIN QUERY PLAN`).
- [ ] The statement cache is kept or reverted on the measured numbers, recorded below.
- [ ] The client tab cache (next agent).
- [ ] `npm run check` passes.

## Comments
