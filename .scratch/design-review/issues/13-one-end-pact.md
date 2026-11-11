# 13 One `endPact`, and ending waits for the open occurrence

Status: done
Blocked by: 12

Closes: F1 and rule R1 (`../interaction-audit.md` finding 1, probe P1); H3 steps 6 and 7 (`../architecture-review.md`, H3); the judging-writes check from W4. Last of three `settle` tickets.

## Problem

Approving an end request drops the occurrence that is open. `decideChangeRequest` calls `endPact(now)` (`src/core/change-requests.ts:712-714`), and `dueAfterEnd` (`src/core/occurrence-state.ts:202-208`) then skips any occurrence due after `ended_at`. The spec says the opposite: "Change requests never rescue an open occurrence; excuses do that" (v0:218). The other end paths agree with the spec: an end date ends the pact after the last occurrence closes (`src/core/judging.ts:94-115`), and an earlier end date set by a change keeps the open occurrence (`change-requests.ts:455`).

Scenario: on Saturday of a week with no gym visits, the owner asks to end a Weekly count pact and a friendly reviewer approves. The week's $15 vanishes. Probe P1 (`../probes/audit-probes.test.ts.txt`, "probe 1") gave "PROBE1 weekly penalties: []" against a control week of one $15 penalty; a Fixed-days pact ended Thursday 23:00 with no photo got penalties for Mon, Tue and Wed only.

Two tests codify the drop: `change-requests.test.ts:671` ("approved end → Ended, no further occurrences...") and `change-requests.test.ts:758` ("evidence waiting for the day open when the end was approved, rejected afterwards, adds no penalty"). The copy hides it: "Approving makes {pact} Ended at once: no more days" (`src/client/Review.tsx:390`), "If approved, {pact} is Ended at once: no more days" (`src/client/ChangeRequestPage.tsx:91`), and "Ended {date}. It makes no more days." (`src/client/PactPage.tsx:108`).

Ending is also spread out: One-time ends inside `judge` (`judging.ts:210`), and `endPact` silently withdraws waiting change requests (`judging.ts:234-243`).

## What to build

- Rule R1: an approved end request takes effect when the occurrence or week open at approval closes, as every other change does. The open occurrence is judged normally. With nothing open, the pact Ends at once. Until it Ends the pact is Active and takes evidence and excuses for the open occurrence as usual; the pact page says when it Ends.
- One `endPact(ctx, pactId, cause, at)` with `cause` one of `end-date`, `one-time-judged`, `end-request`, called from `settle` (One-time), the tick (end date) and the end request's approval. It records `ended_at` and withdraws waiting change requests; ticket 20 adds the recorded reason, so leave a `cause` it can read.
- Remove the change-request catch-up in `decide` (`src/core/review.ts:151-160`): the tick and `settle` make it unnecessary. Check `change-requests.test.ts:822` ("an end approved after midnight, before the scheduler's tick, still judges the day before") still passes.
- Rewrite `change-requests.test.ts:671` and `:758` to the new rule.
- Copy: the three client strings above say the pact Ends once the open occurrence or week closes, naming when (for example "Approving ends Gym after Sun Jan 18, once this week is judged."). The feature specs are not edited; `docs/behaviour.md` is the record.
- Conventions check in `scripts/check-conventions.ts`: `INSERT INTO penalty`, `DELETE FROM penalty`, `UPDATE occurrence` (outcome or `judged_at`) and `UPDATE pact SET stage` appear only in `settle.ts`, the end function's module and migrations.

## Where to start

- `src/core/change-requests.ts:696-745`, `src/core/judging.ts:94-115` and `:189-245`, `src/core/review.ts:138-166`, `src/core/occurrence-state.ts:202-208`.
- `change-requests.test.ts:671-830`.

## Acceptance criteria

- [x] Rewritten `change-requests.test.ts:671`: a Weekly count 3× pact with no sessions, end approved on Saturday, is Missed at the end of Sunday with the full penalty, then Ended.
- [x] Rewritten `change-requests.test.ts:758`: evidence for the day open at approval, rejected afterwards, adds the penalty.
- [x] New scenario: a Fixed-days pact whose end is approved Thursday 23:00 with no photo is Missed for Thursday.
- [x] New scenario: an end approved when no occurrence is open (a Fixed-days pact on an unscheduled day) Ends at once.
- [x] `change-requests.test.ts:771`, `:803` and `:822` pass.
- [x] Client tests for the three strings updated (`Review.test.tsx`, `PactPage.test.tsx`).
- [x] The judging-writes check refuses `INSERT INTO penalty` in, say, `excuses.ts`; shown by trying it.
- [x] Update `docs/behaviour.md`: R1, and remove the F1 known-bug note.
- [x] `npm run check` passes.

## Out of scope

- Withdrawal reasons (ticket 20).
- The comment at `src/client/PactPage.tsx:339` (ticket 18).

## Comments

From ticket 13 (2026-11-11): built.

- "Open" means opened and not closed yet, unless judged (`endTiming`, `src/core/ending.ts`). With one open, approval sets the end date to the last day of its period and records `pact.end_approved_at` (migration 32); `endPastEndDate` then Ends it once that occurrence closes, with cause `end-request`. A One-time pact keeps its deadline and Ends when judged. The pact page carries `ending: { lastDay }`, and an end request's view carries `ending` (`after` a day, or `at-once`) while it waits.
- The catch-up in `decide` stays, against "What to build": without it, `one-time.test.ts` "a later deadline approved after the old one passed, before the scheduler's tick, doesn't rescue it" fails, because nothing judges a past-due One-time occurrence before its change applies. It also judges what an end approved at once, with nothing open, leaves due (the new "a day the schedule skips" scenario fails without it).
- Tests changed by the rule beyond the two named: `:738` (Thursday, open at approval, now Missed), `:822` (Friday opened at midnight, so it is kept and Missed), the bedtime "later nights" test (Tuesday night opened at the start of Tuesday), `history.test.ts` (an Ended pact's heat map; Yesterday), and the end request in `app.test.ts` (Active with `ending` after approval).
- The client copy: Review "Approving ends Gym after Sun Jan 18, once this week is judged." or "Approving ends Gym now."; ChangeRequestPage "If approved, Gym ends ..."; PactPage "Ending approved: Gym ends after ..., once that day is judged." The Ended line on the pact page is unchanged.
- Filed ticket 27: end and change requests the owner can still send while an approved end waits.

## Owner decision (2026-11-11)

Keep the change-request catch-up in `decide`. Removing it would judge a One-time occurrence Missed after a later deadline was approved, which the current code correctly avoids. The criterion that asked for its removal counts as met with this decision.
