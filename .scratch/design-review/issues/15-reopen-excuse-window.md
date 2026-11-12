# 15 A rejected or withdrawn vacation reopens the excuse window

Status: done
Blocked by: 08, 12

Closes: F3 and rule R3 (`../interaction-audit.md` finding 3).

## Decision

Decision 2 in `../spec.md` (rule R3), decided 2026-11-11: when a waiting vacation is rejected or withdrawn, each day it covered gets a 48-hour excuse window that runs from the later of the day's judging and the rejection or withdrawal. A rejected or withdrawn excuse keeps the v0 rule and reopens nothing (v0:256), so an owner cannot refile and be rejected over and over to hold a penalty. This reverses "A rejection never restarts a day's 48-hour excuse window" for vacations only (vac:81) and the decision recorded in `.scratch/vacation/issues/03-rejection-and-starting-while-waiting.md` ("no 48-hour window restarts").

## Problem

A day judged Missed while a vacation or excuse waits for approval is hidden from Today's Missed section (`src/core/today.ts`), gets no Missed push, and is refused for a new excuse as on a waiting cover (`src/core/excuses.ts`). When the cover is rejected or withdrawn, the penalty is released with its original `added_at`, and the window still runs from the original judging (`excusableUntil` at `src/core/occurrence-state.ts`), so it has usually passed.

Scenario: the owner files a vacation covering a week of sick days. The reviewer rejects it on day 5. Days 1 to 3 are past their excuse window; the owner can never ask for those to be excused one by one. Specified at vac:81 and pinned by `vacations.test.ts`.

## What to build

- Rule R3: a day's 48-hour excuse window runs from the later of its judging and the rejection or withdrawal of a waiting vacation that covered it. A rejected or withdrawn excuse does not move it. The time is derived from the vacation rows (`decided_at` of a rejected vacation, `withdrawn_at` of a withdrawn one) through `cover_day_v` from ticket 08; no new column is needed.
- One expression, used everywhere the window is read: `excusableUntil` in the occurrence view, the excuse skip reason (`excuses.ts`), Today's Missed cards and their countdown (`today.ts`), the rejected-vacation alert's "File another excuse · 31h left" (`src/core/vacations.ts`; the rejected-excuse alert at `excuses.ts` reads the same expression and keeps its current countdown), and the bill cut.
- Bills: a released penalty must not go on a bill until its window has closed, or an approved excuse could reach a billed penalty and trip ticket 12's guard. Change the bill selection in `billOwner` (`src/core/money.ts`, today `penalty.added_at <= excusableAfter`) to use the same window start.
- The vacation rejection push (`vacations.ts`) and the rejected-vacation alert say the window is open and when it closes when any released day can now be excused, for example "Mon Jan 5 to Wed Jan 7 can be excused until Thu 18:00." The withdraw confirm on Profile says the same.
- A Missed day whose window reopens shows again on Today's Missed section for the rest of its window.

## Where to start

- `src/core/occurrence-state.ts` (or the view from ticket 08), `src/core/excuses.ts`, `src/core/today.ts`, `src/core/money.ts`, `src/core/vacations.ts`.
- Tests that encode the old rule: `vacations.test.ts` ("a rejection never restarts them") and `vacations.test.ts`. `excuses.test.ts` pins the rule that stays for excuses.

## Acceptance criteria

- [x] Rewritten `vacations.test.ts`: after a rejection on day 5, an excuse for day 1 is accepted within 48 hours of the rejection and refused after.
- [x] New scenario: a vacation withdrawn after day 1 was Missed reopens day 1's window from the withdrawal.
- [x] New scenario: a released penalty whose reopened window spans a Wednesday is not on that Wednesday's bill, and is on the next one if not excused.
- [x] New scenario: the vacation rejection push names the window's end when a day can be excused, and does not when none can.
- [x] New scenario: a rejected excuse for a Missed day does not reopen that day's window; an excuse filed after the original 48 hours is refused.
- [x] `excuses.test.ts` passes unchanged.
- [x] Client: the rejected-vacation alert and withdraw confirm copy, with `Today.test.tsx` and `VacationSection.test.tsx` cases.
- [x] Update `docs/behaviour.md`.
- [x] `npm run check` passes.

## Out of scope

- Reopening the window after a rejected or withdrawn excuse (decided against on 2026-11-11).
- Filing an excuse for a day on a waiting vacation (the audit's option B, rejected as confusing double cover).

## Notes from the agent that built it

- One expression decides the window: `excuseWindowOpensSql` and `excusableUntil` in `src/core/covers.ts`, read by `occurrenceView`, `excuseOptions`, `recentlyMissed`, `rejectedEvidenceAlerts`, `ledgerPenalties` (`nextBillDay` now takes the window's start; a penalty held by a waiting vacation shows the bill it would make if rejected now) and `billOwner`.
- The ticket's description of the rejected-vacation alert was out of date: it had no "File another excuse · 31h left" button. A vacation spans pacts, so instead it gained a line, `excusable` on the alert ("Mon Jan 12 to Wed Jan 14 can be excused until Sat Jan 17, 8:00am."), and the released days now show on Today's Missed beside the alert, each with its own File excuse countdown. Before, Missed hid a day on a rejected vacation while the vacation's alert stood; it no longer does (a rejected excuse still hides it).
- The push and alert share `excusableText` (`src/shared/format.ts`); `formatDayTime` and `clockTime` moved there from `src/client/format.ts`, which re-exports them. `VacationCard` gained `heldDates` for the withdraw confirm.
- The rejected-excuse scenario is in `vacations.test.ts` ("a rejected excuse doesn't move the window again"), on a day whose window a vacation rejection reopened; `excuses.test.ts` already pins the plain case and passes unchanged.

Owner decision (2026-11-11): accept the replacement for the "File another excuse" button the ticket assumed (an alert line naming the days and deadline, plus per-day Missed cards with their own File excuse buttons).

Review (2026-11-11): for days never on a vacation every reader is unchanged. Fixed one gap: bills made before R3 could already hold a penalty whose vacation was rejected in the 48 hours before the bill, and the reopened window would then let an excuse reach it, making the reviewer's approval throw in `settle`. `excuseWindowOpensSql` now reopens nothing once the penalty is on a bill (`vacations.test.ts`, "a penalty already on a bill keeps its window"). Filed ticket 29 for a pre-existing double offer on Today (an excuse rejected before its day is judged).
