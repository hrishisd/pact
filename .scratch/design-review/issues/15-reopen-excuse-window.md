# 15 A rejected or withdrawn cover reopens the excuse window

Status: needs-info
Blocked by: 08, 12

Closes: F3 and rule R3 (`../interaction-audit.md` finding 3).

## Decision needed

Decision 2 in `../spec.md` (rule R3). It reverses "A rejection never restarts a day's 48-hour excuse window" (v0:256, vac:81) and the decision recorded in `.scratch/vacation/issues/03-rejection-and-starting-while-waiting.md` ("no 48-hour window restarts").

Sub-question: does a rejected excuse also restart the window? If it does, an owner can file an excuse, be rejected, refile within the new window, and repeat, holding the penalty each time it waits. The recommendation is to restart the window only after a vacation is rejected or withdrawn, and keep the v0 rule for a rejected excuse, whose days the owner chose knowingly and whose refiling would ask the same reviewer the same thing. Build whichever the owner picks; the steps below are written for the general rule.

## Problem

A day judged Missed while a vacation or excuse waits for approval is hidden from Today's Missed section (`src/core/today.ts:419-465`), gets no Missed push, and is refused for a new excuse as on a waiting cover (`src/core/excuses.ts:267-271`). When the cover is rejected or withdrawn, the penalty is released with its original `added_at`, and the window still runs from the original judging (`excusableUntil` at `src/core/occurrence-state.ts:178`), so it has usually passed.

Scenario: the owner files a vacation covering a week of sick days. The reviewer rejects it on day 5. Days 1 to 3 are past their excuse window; the owner can never ask for those to be excused one by one. Specified at vac:81 and pinned by `vacations.test.ts:1070`.

## What to build

- Rule R3: a day's 48-hour excuse window runs from the later of its judging and the rejection or withdrawal of a waiting vacation (and, if the owner says so, excuse) that covered it. The time is derived from the cover rows (`decided_at` of a rejected cover, `withdrawn_at` of a withdrawn one) through `cover_day_v` from ticket 08; no new column is needed.
- One expression, used everywhere the window is read: `excusableUntil` in the occurrence view, the excuse skip reason (`excuses.ts:267`), Today's Missed cards and their countdown (`today.ts:419-465`), the rejected-excuse and rejected-vacation alerts' "File another excuse · 31h left" (`excuses.ts:465-528`, `src/core/vacations.ts:614-653`), and the bill cut.
- Bills: a released penalty must not go on a bill until its window has closed, or an approved excuse could reach a billed penalty and trip ticket 12's guard. Change the bill selection in `billOwner` (`src/core/money.ts:394-420`, today `penalty.added_at <= excusableAfter`) to use the same window start.
- The rejection push (`excuses.ts:353-354`, `vacations.ts:574-575`) and the rejected-vacation alert say the window is open and when it closes when any released day can now be excused, for example "Mon Jan 5 to Wed Jan 7 can be excused until Thu 18:00." The withdraw confirm on Profile says the same.
- A Missed day whose window reopens shows again on Today's Missed section for the rest of its window.

## Where to start

- `src/core/occurrence-state.ts:148-185` (or the view from ticket 08), `src/core/excuses.ts:233-290`, `src/core/today.ts:419-470`, `src/core/money.ts:394-420`, `src/core/vacations.ts:548-653`.
- Tests that encode the old rule: `vacations.test.ts:1070` ("a rejection never restarts them"), `vacations.test.ts:1089`, and in `excuses.test.ts:120` if a rejected excuse also restarts.

## Acceptance criteria

- [ ] Rewritten `vacations.test.ts:1070`: after a rejection on day 5, an excuse for day 1 is accepted within 48 hours of the rejection and refused after.
- [ ] New scenario: a vacation withdrawn after day 1 was Missed reopens day 1's window from the withdrawal.
- [ ] New scenario: a released penalty whose reopened window spans a Wednesday is not on that Wednesday's bill, and is on the next one if not excused.
- [ ] New scenario: the rejection push names the window's end when a day can be excused, and does not when none can.
- [ ] `excuses.test.ts:120` passes unchanged or is rewritten, as the owner's answer requires.
- [ ] Client: the rejected-vacation alert and withdraw confirm copy, with `Today.test.tsx` and `VacationSection.test.tsx` cases.
- [ ] Update `docs/behaviour.md`.
- [ ] `npm run check` passes.

## Out of scope

- Filing an excuse for a day on a waiting vacation (the audit's option B, rejected as confusing double cover).
