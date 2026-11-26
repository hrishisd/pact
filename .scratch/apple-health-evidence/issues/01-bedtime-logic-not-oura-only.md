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

- [x] `npm run check` passes with no test changed except for renames.
- [x] No `=== "oura"` (or equivalent) left where the meaning is "bedtime pact".
- [x] `scripts/fuzz-deep.sh` passes (or a shorter run of fresh seeds if time is short; say which in Comments).

## Comments

### 2026-11-26, agent

Done as a behaviour-preserving refactor; Status left as it was for the human to move.

What changed:
- `BEDTIME_KINDS` and `BedtimeKind` (`src/shared/types.ts`, `["oura"]` for now) and `isBedtimeKind` / `isBedtimePact` (new `src/shared/evidence-kinds.ts`, the object form narrows a `TermsByKind` union). Every check that meant "bedtime pact" in core, shared, client and the fuzz harness uses them (settle, history, reminders, today, pacts, pact-rules, verdict, rows, terms.ts, the pact form, change terms, excuse sheet, history, PactPage, vacation text). `TermsByKind`'s bedtime member is `evidenceKind: BedtimeKind`. `endedBedtimePacts` reads `evidence_kind IN (BEDTIME_KINDS)`. Switches that meant bedtime now test the predicate first and switch over the rest.
- Verdict: `OuraFact` is `BedtimeFact` (`kind: "bedtime"`, `bedtimeStart`, `arrivedAt`); the step is `bedtime-arrived`; waiting is `on: "sleep"`.
- Night judging: `judgeNights(ctx, kind, t, sessions, owner?)` (`bedtime.ts`) takes `Map<AccountId, SleepSession[]>`, `SleepSession = { start, end, isMain }`. Oura's periods go through `ouraSessions` (long_sleep is main). `nightsWaiting` takes `{ kind?, owner? }` and hands back each night's zone and night clock.
- Night clock: `nightClockOf(ctx, kind, account): NightClock` (`rows.ts`), `NightClock = { offsets: NightOffsets; read(start, timezone): string }`. Oura: `offsets` is `ouraClockOf` (now private to rows.ts), `read` is the timestamp as Oura wrote it. `occurrencesOf`, `nightsWaiting` and the 15:00 push all get the clock from it. `OuraOffset`/`OuraClock` are `NightOffset`/`NightOffsets` (`occurrences.ts`); `noOuraDataPushAt` is `noSleepDataPushAt`; `oura-clock.ts` is `night-clock.ts`.
- `pushNoOuraData` is `pushNoSleepData`, worded per kind by `syncText` (`bedtime.ts`). `fetchSleep` is `fetchOuraSleep` (it is Oura's).
- Today wire type: section `"no-oura-data"` is `"no-sleep-data"`, `TodayNoOuraDataCard` is `TodayNoSleepDataCard`; the client card is `NoSleepDataCard`. Copy unchanged.
- Client props `oura: boolean` meaning bedtime are `bedtime` (`presentOccurrence`'s option, `DayCard`, `DayList`, `DayChip`, history).
- Kept Oura-named: the adapter, tokens, connection, Needs reconnecting, check now, `noteOuraClock`/`keepEarlierClock`/`ouraOffsetOf`, `oura_*` and `no_oura_data_push_sent` (no migration).
- `GLOSSARY.md`: added Bedtime pact and Main sleep. `docs/behaviour.md` points at the new names.
- `verdict-check.ts` (harness) now overrides the stored bedtime only for Oura pacts, since its watch is of Oura.

Seam for ticket 02 (adding `apple_health`):
1. Add it to `EVIDENCE_KINDS` and `BEDTIME_KINDS` (`src/shared/types.ts`). `isBedtimeKind` then covers it everywhere; tsc flags the exhaustive switches that need a case (`nightClockOf`, `syncText`, `evidenceSource`, `SERVICE_OF_KIND`, names records in the client).
2. `nightClockOf` (`rows.ts`): `case "apple_health": return { offsets: () => null, read: (start, timezone) => <start re-written with timezone's UTC offset at that instant> }`. `offsets` null means every night is read in the timezone it's worked out in, with the existing timezone-change rules; `read` makes `nightOf`/`wallClock` and the verdict's in-bed-by comparison read the account's clock. `zoneOffsetAt` (`calendar.ts`) gives the offset.
3. Build `SleepSession[]` from stored samples (merge, main if 3 h+) and call `judgeNights(ctx, "apple_health", t, sessions, owner?)` from the upload command and from the tick (so nights close with no upload).
4. `syncText` (`bedtime.ts`): the Apple Health push wording.

Left for ticket 02 (copy and Oura-only paths on bedtime screens, unchanged here because copy must not change): "No Oura data" in `presentOccurrence` (`excuse-days.tsx`) and Today's `NoSleepDataCard` (which also runs Oura's check now and needs the card's evidence kind, a new field on `TodayNoSleepDataCard`); "judged from your ring" in PactPage's `StageLine`; the kind step's hint in `pact-form-steps.tsx` (still `kind === "oura"`, as it names the ring). `tellReviewersOfLaterDueTimes` (`accounts.ts`) still lists `('camera', 'anki')`: Oura nights close on Oura's clock, but Apple Health nights follow the timezone, so ticket 02 should decide whether to add it. The source of a night's sleep (spec) needs a column and a field on `SleepSession`.

Verification: `npm run check` passes (88 files, 1700 tests). `scripts/fuzz-deep.sh` passes in full: seeds 1000–1199, 300 steps, 4 jobs, about 21 minutes. (Two harness-only edits came after the fuzz run started, making `ouraClockOf` private and scoping `verdict-check.ts`'s Oura override; `npm run check` ran after them.)
