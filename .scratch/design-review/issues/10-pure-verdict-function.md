# 10 A pure verdict function

Status: done
Blocked by: 08

Closes: architecture ranked item 2, H3 step 1 (`../architecture-review.md`, H3). No behaviour change.

## Problem

Seven call sites decide whether and how to judge an occurrence, each with its own copy of the precedence rules (approved evidence beats an approved cover, which beats a miss; waiting evidence defers):

1. `judgeAtDueTime` (`src/core/judging.ts:124-139`).
2. `judgeWeek`, with a `tell` flag (`judging.ts:149-157`).
3. `decideEvidence`, with its own `excusedAhead`, `judgingReached` and `dueAfterEnd` checks (`src/core/evidence.ts:231-275`).
4. `excuseApprovedDays`, for excuses and vacations (`src/core/excuses.ts:369-399`).
5. `judgeNights` for bedtime (`src/core/bedtime.ts:180-215`).
6. `recordAnkiChecks` (`src/core/anki-days.ts:170-220`).
7. The change-request branch of `decide`, which catches judging up first (`src/core/review.ts:151-160`).

Before replacing them (tickets 11 to 13), state the rules once and find where the seven copies disagree.

## What to build

- `src/core/verdict.ts`: pure, no `ctx`. `OccurrenceFacts` and `Verdict` as sketched in H3 "Target design", and `verdictOf(facts, now): Verdict`. Facts include the occurrence's times, `termsOn`, `pactEndedAt`, all evidence with decisions and times, the automatic source (Oura's first qualifying sleep and when it arrived; Anki's finish time and whether a check is running), and the cover from `coverOn` (ticket 08).
- A facts loader, `occurrenceFacts(ctx, pactId, date)`, in `src/core/settle.ts` or beside `verdict.ts`.
- `src/core/verdict.test.ts`: a table-driven test at the function's own interface. Rows at least for: no evidence at due; waiting evidence at due; approved and rejected evidence before and after due; an approved cover before and after due, with and without approved evidence; a waiting cover; a Weekly count week at, above and below target with waiting evidence; a pact ended mid-occurrence; an Oura night with an on-time, late, missing and late-arriving period, each with and without an approved cover; an Anki day finished, unfinished and with a check running.
- A test-time check: a hook in `scenario()` (`src/core/testing/scenario.ts`) that after every command and every `advanceTo` compares the stored outcome of every occurrence the command touched (or, more simply, every occurrence of every pact in the scenario) with `verdictOf` and fails the test on a mismatch. Keep it permanently.
- Bedtime needs the first qualifying sleep period as a stored fact. Today it is written to `occurrence.bedtime_start` only after judging (`bedtime.ts:201-203`). If the verdict cannot be computed for bedtime without it, read it from what is stored and note the gap for ticket 12.
- A sentence in `CODING_STANDARDS.md` under "Tests": `verdictOf` is the second exception to testing through `scenario()`, tested at its own interface because the combinations are many.

## Mismatches

Run the full suite with the check on. Each mismatch is either a current bug or a rule the function has wrong. Do not fix a bug here. For each real bug, file a new ticket in `.scratch/design-review/issues/` (numbered after the last one), add an entry to the known mismatches list the check skips, and link it here under Comments. Fix the function when it is the function that is wrong.

One mismatch is expected. The vacation spec (vac:78) says approved evidence still makes a covered occurrence Satisfied. The code judges a day with waiting evidence Excused as soon as an approved cover exists (`judging.ts:132-133`, and `excuses.ts:389-395` for a cover approved later), and a later evidence approval then changes nothing because the day is judged (`evidence.ts:254-258`). Probe P5a in `../probes/audit-probes.test.ts.txt` shows it. Write the function to the spec and file the ticket. Decision 4 in `../spec.md` (2026-11-11) keeps the spec: the filed ticket changes the code so that a late evidence approval turns an Excused occurrence into Satisfied.

## Where to start

- `../architecture-review.md`, H3 "Evidence" and "Target design".
- `src/core/judging.ts:38-245`, `src/core/occurrence-state.ts:148-230`, `src/core/occurrences.ts` (occurrence timing, already tested at its own interface in `occurrences.test.ts`).

## Acceptance criteria

- [x] `verdictOf` and its table test exist and pass.
- [x] The scenario hook runs in every core test and the suite passes, with every known mismatch listed and linked to a new ticket.
- [x] No production code path calls `verdictOf` yet.
- [x] The `CODING_STANDARDS.md` sentence is added.
- [x] `npm run check` passes.

## Out of scope

- Writing outcomes or penalties from the verdict (tickets 11 to 13).
- Fixing any mismatch it finds.

## Comments

- Mismatches found: one, the expected vac:78 case, filed as [ticket 26](26-late-approval-satisfies-excused-day.md) and listed in `KNOWN_MISMATCHES` (`src/core/testing/verdict-check.ts`). Ticket 26 fixed it and removed the entry; `KNOWN_MISMATCHES` is empty now.
- `verdictOf` keeps the current end rule (an occurrence due after the pact Ended is not the pact's unless judged before the end); ticket 13 changes it.
- The check skips a run when nothing it reads has changed and no due time, close or Anki hold has passed since the last one, so hourly-ticking scenarios stay fast.
- Gaps in stored facts (bedtime sleep arrival, Anki answer time) are noted on ticket 12.
