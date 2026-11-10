# 08 One occurrence view in the core

Status: ready-for-agent
Blocked by: 01

Closes: F7 and rule R7 (`../interaction-audit.md` finding 7, probe P4); architecture ranked item 1, H2 steps 1 to 3 (`../architecture-review.md`, "More important than the four" and H2); the cover-predicate check from W4.

## Problem

Where an occurrence stands for its owner, especially its cover state, is answered by five predicates that each pick a different subset, consulted in about 25 places:

- `excuseOn` (`src/core/occurrence-state.ts:67-80`): waiting excuse, then approved excuse or vacation, then waiting vacation.
- `vacationOn` (`occurrence-state.ts:97-109`): vacations only.
- `stillToDo` (`occurrence-state.ts:88-91`): hides the card for a waiting excuse, keeps it for a waiting vacation.
- `excuseCoversSql` and `vacationCoversSql` (`occurrence-state.ts:286-306`), with three different condition strings at `evidence.ts:383`, `evidence.ts:439` and `today.ts:441`.
- Reminders read only `excuseOn(...) === "approved"` (`src/core/reminders.ts:125`).

The visible bug is F7. Scenario: the owner files an excuse for today in the morning. Today hides the To do card (`today.ts:338` via `stillToDo`), but in the evening the reminder still fires, because `worthReminding` skips only approved cover. Probe P4 output: "to-do cards for Gym: 0 reminders: ["2026-01-08"]". The existing test `reminders.test.ts:169` covers approved cover only.

## What to build

Follow `../architecture-review.md` H2 "Target design" and the `OccurrenceView` sketch in "More important than the four".

1. A migration adding the `cover_day_v` view over `excuse_day`/`excuse` and `vacation_day`/`vacation` (sketch in H2). Rewrite `excuseCoversSql` and `vacationCoversSql` as one `coveredSql(pact, date, state)` over it. No behaviour change.
2. `coverOn(ctx, pactId, date): Cover | null` in a new `src/core/covers.ts`, returning the one cover that counts with its kind (`excuse` or `vacation`) and state (`waiting` or `approved`), with the precedence rules written once. A per-kind `CoverPolicy` with `keepsToDoWhileWaiting` (excuse false, vacation true, citing vac:80 and vac:104 in its comment).
3. `occurrenceStatus` (`occurrence-state.ts:148-185`) becomes the single occurrence view. Besides what it returns now, it carries `cover: { kind, state } | null`, a `phase` (`ahead`, `open`, `past-due`) for the client (ticket 09), `toDo` and `remind`. `toDo` is what Today shows as the owner's to do; `remind` is `toDo` restricted to what reminders also check (a Camera day with evidence submitted, an Anki day already judged). Rule R7: a reminder fires if and only if Today shows the occurrence as something to do (To do card, or for a bedtime night the Automatic or No Oura data card). A waiting excuse removes both; a waiting vacation keeps both.
4. Replace `excuseOn`, `vacationOn` and `stillToDo` at their call sites with `coverOn` or the view: `anki-days.ts:111`, `bedtime.ts:152`, `bedtime.ts:193`, `evidence.ts:241`, `excuses.ts:270`, `history.ts:112`, `judging.ts:131`, `judging.ts:151`, `reminders.ts:125` (`worthReminding`, `reminders.ts:118-135`), `today.ts:192`, `today.ts:243`, `today.ts:299`, `today.ts:338`, `today.ts:400`, `vacations.ts:188-190`. Rename the shared helpers so a reader can see vacations are included.
5. Update `OccurrenceStatus` in `src/shared/types.ts:1259-1284`: `cover` replaces `excuse`, `held` and `heldByVacation`. Keep the client compiling with the smallest change; ticket 09 rewrites the client side.
6. Conventions check in `scripts/check-conventions.ts`: the old predicates and raw `excuse_day`/`vacation_day` reads may appear only in `covers.ts` and `occurrence-state.ts` (and migrations).

Steps 1, 2 and 4 must not change any test. Only step 3's reminder change moves tests.

## Where to start

- `src/core/occurrence-state.ts:55-310`.
- `src/core/reminders.ts:118-135`, `src/core/today.ts:213-420`.
- `../architecture-review.md`, H2 "Target design" and "Migration order" steps 1 to 3.
- Probe P4 in `../probes/audit-probes.test.ts.txt` (copy it into `src/core/` to run it; it imports from `./testing/`), output in `../probes/probe-output.txt`.

## Acceptance criteria

- [ ] Steps 1, 2 and 4 land with no test changed (run the suite between steps).
- [ ] New scenario in `reminders.test.ts`: an excuse filed in the morning for today's Camera day; Today has no To do card for it and no reminder fires that evening.
- [ ] New scenario: a vacation waiting for approval keeps both the To do card and the reminder (pins vac:80).
- [ ] New scenario: a bedtime night under a waiting excuse gets no reminder and no Automatic card.
- [ ] `reminders.test.ts:169` still passes.
- [ ] The conventions check refuses `excuseOn` in, say, `today.ts`; shown by trying it.
- [ ] Update `docs/behaviour.md`: R7 as a rule, and remove the F7 known-bug note.
- [ ] `npm run check` passes.

## Out of scope

- Client changes beyond keeping it compiling (ticket 09).
- The pure verdict function (ticket 10) and any change to judging.
- Merging the excuse and vacation tables (not doing; see `../spec.md`).
- F9's cleanup (ticket 14).
