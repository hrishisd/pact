# 01 Bedtime logic not tied to Oura

Status: ready-for-agent

Spec: `../spec.md`, "Shared bedtime logic".

## What to build

A refactor with no change in behaviour. Today the night model (window, close at 18:00, in-bed-by, the first long sleep deciding the night, the 15:00 no-data push, reminders, Today's Automatic and No Oura data cards, verdict facts) is typed and named for Oura: `OuraFact`, `OuraOffset`, `=== "oura"` checks across core, server and client, and `oura: boolean` props in the client that mean "bedtime".

Move it onto a **bedtime pact** concept so a second kind can share it:
- One predicate (e.g. `isBedtimeKind`) instead of `=== "oura"` wherever the code means "a bedtime pact", not "the Oura connection".
- The verdict and stored night facts speak of a bedtime start and when it arrived, not Oura.
- Judging a night takes sleep sessions (start, end, is-main) from a source, so Oura's `long_sleep` periods are one input and Apple Health sessions will be another.
- The night's clock comes from a function of the pact's kind: Oura's clock for Oura (unchanged), the account's timezone for anything else.
- Client props and helpers renamed where they mean bedtime.

Keep Oura-specific things Oura-named: the adapter, tokens, Needs reconnecting, check now, `oura_*` columns (renaming database columns is not needed).

## Acceptance criteria

- [ ] `npm run check` passes with no test changed except for renames.
- [ ] No `=== "oura"` (or equivalent) left where the meaning is "bedtime pact".
- [ ] `scripts/fuzz-deep.sh` passes (or a shorter run of fresh seeds if time is short; say which in Comments).

## Comments
