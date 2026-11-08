# 01 Plan a vacation: Profile row, four steps, waiting card and withdraw

Status: ready-for-agent
Blocked by: none

Spec: `../spec.md` stories 1 to 12, the Rules section, Reviewing ("Picking reviewers"), Screens ("Profile sheet" and "Plan a vacation flow") and Data. The screens follow the prototype on `prototype/vacation` (`.scratch/vacation/prototype/vacation.prototype.html`, section 1, round 4), except that the Reviewers step always shows. It's already prototyped, so build directly.

## What to build

An owner plans a vacation from Profile, sees exactly what it covers before asking, sends it, sees it waiting on Profile, and can withdraw it. Reviewers aren't shown it yet (ticket 02), and it has no effect on judging until it's approved (ticket 02) or its first day comes while it waits (ticket 03).

### Core
- **Migration 28:** `vacation`, `vacation_pact`, `vacation_reviewer` and `vacation_day`, as the spec's Data section describes. `vacation_day` has the same shape and `(pact_id, date)` index as `excuse_day`, a Weekly count week stored by its Monday.
- **Options query** for the Pacts and Reviewers steps: the owner's Active pacts whose edit window has closed, recurring and One-time apart, each with its terms line, its reviewers, and for One-time whether it's already open (Submit anytime); and whether any Active pact is still in its edit window.
- **Preview query:** dates and ticked pacts in; per offered pact, the occurrences it would cover and those it skips with a reason; a refusal for bad dates. It's the function filing uses, so the confirm step and the stored days always agree.
  - Dates: first day after today in the owner's timezone, last on or after it, at most `MAX_EXCUSE_SPAN_DAYS` (62) days.
  - Fixed days by date; a Weekly count week whole when its Thursday is inside; a One-time deadline when it's inside.
  - Weeks the dates touch whose Thursday is outside are listed as not covered, for the confirm step's partial-week lines.
  - Skipped, with a reason the screen can show: already open, already Excused (including a day ahead an approved excuse covers), on an excuse waiting for approval, on another vacation (waiting or approved). A pact that Ends before a day has no such day.
- **File vacation** command: dates, optional note (trimmed; blank is none), ticked pacts, picked reviewers. Refused when no pact is ticked, no reviewer is picked, a picked reviewer doesn't review any ticked pact, a ticked pact isn't offered, the dates are refused, or no occurrence is left to cover. It records the covered occurrences, fixed at filing.
- **Withdraw vacation** command: only while it's waiting for approval (including waiting on the owner's reply); sets `withdrawn_at`. A withdrawn vacation covers nothing and skips nothing.
- **Owner's vacations query** for Profile: each vacation waiting or approved and not over, soonest first, with its dates, note, ticked pacts' summary ("All pacts", "All recurring pacts" or the names), day count, picked reviewers and state. Ticket 04 adds the last one that ended.
- **Excuses** skip days on a waiting vacation, with a new skip reason "on-waiting-vacation" shown as "On a vacation waiting for approval". An occurrence is on at most one excuse or vacation waiting for approval.

### Client
- **Profile sheet:** the Vacation section after the name and email: "None planned" with **Plan a vacation** (always there, below any cards), and a card per vacation in the states this ticket can reach: waiting (chip, note, pacts and day count, who it was sent to, Withdraw with its inline confirm, the "Vacation withdrawn…" message).
- **The flow** on its own app path, a pushed page titled "Vacation" with Back: Dates, Pacts, Reviewers, Check it over, "Step N of 4", the footer bar nothing scrolls under, the copy in the spec's Screens section. The Reviewers step always shows, nobody ticked to start with. The confirm step renders the core's preview, with Edit on each summary row. Ask for approval returns to Today with the Profile sheet open, saying "Sent to Sam and Alex for approval."
- Dates use `<input type="date">`, styled like `.inp`, as in the File excuse sheet.

## Acceptance criteria (core scenarios)

- [x] A Mon/Wed/Fri Camera pact, an every-night bedtime pact and a 3× per week Weekly count pact; a vacation filed on Wed for Mon+1 to Sun+1 covers Mon+1, Wed+1 and Fri+1, the seven nights Mon+1 to Sun+1, and the week of Mon+1.
- [x] Thursday rule, filed on Mon: Sun+1 to Sat+2 covers the week of Mon+2 whole (Sun+2 included) and not the week of Mon+1, whose Thursday is outside; Fri+1 to Wed+2 covers no week, and the preview lists both weeks as not covered; Thu+1 alone covers the week of Mon+1.
- [x] Filed on Tue for Wed to Sun: the week of Mon has its Thursday inside but opened on Monday, so it's skipped as already open.
- [x] One-time: a ticked pact with its deadline inside is covered; one with its deadline outside covers nothing; one with Submit anytime is skipped as already open, and the options query marks it as one that can't be ticked.
- [x] Dates: a first day of today, a last day before the first, and 63 days are refused; 62 days are accepted.
- [x] Overlaps: days already Excused, on a waiting excuse, on a waiting vacation and on an approved vacation are skipped with their reasons; a vacation with nothing left is refused ("nothing-to-cover").
- [x] An excuse filed for a day on a waiting vacation skips it as "on-waiting-vacation"; after the vacation is withdrawn, the excuse covers it.
- [x] Refused: no pact ticked, no reviewer picked, a picked reviewer who reviews none of the ticked pacts, a pact still in its edit window, another owner's pact.
- [x] A pact created after filing isn't covered, and the preview and the stored days agree for the same input.
- [x] Withdraw works while waiting and is refused for another owner's vacation.
- [x] Routes for options, preview, file, withdraw and the owner's vacations (`src/server/app.test.ts`).

## Acceptance criteria (screens)

- [x] Component tests: the Reviewers step shows with one possible reviewer and Next stays disabled until one is ticked; unticking a pact drops a reviewer who reviews no ticked pact; "All pacts" shows when every offered pact is ticked by hand.
- [x] Checked in the browser at 390×844 on a seeded dev database, with screenshots next to the prototype's: Profile with none planned, each of the four steps (with a date error, a partial Weekly count week and a One-time pact), the confirm step, the waiting card, the withdraw confirm and the message after it.

## Manual checks

In `../manual-checks.md` (After ticket 01): the native date pickers and the footer bar on the iPhone.

## Comments

### Built on `claude/modest-allen-7rmsz7`

- **Core** (`src/core/vacations.ts`): migration 28; the options query, the preview (which filing reuses, so the confirm step and the stored days agree), file, withdraw and the owner's waiting vacations for Profile. `vacationOn` in `occurrence-state.ts` says whether a waiting or approved vacation covers an occurrence; excuses skip a day on a waiting vacation as "on-waiting-vacation". 23 scenarios in `vacations.test.ts`.
- **Routes** in `src/server/app.ts` with tests in `app.test.ts`.
- **Client**: the Vacation section on the Profile sheet (`VacationSection.tsx`), and the four steps at `/vacation/new` (`PlanVacation.tsx`). Ask for approval goes back to Today with the Profile sheet open and "Sent to Sam and Alex for approval." Component tests cover the three screen criteria plus the Profile card and Withdraw.
- **Beyond the spec's Data section**: `vacation.pacts_summary` stores "all", "all-recurring" or "some" at filing, so a card filed as "All pacts" stays that way after a newer pact becomes one Plan a vacation offers.
- **Lint**: `scripts/check-conventions.ts` now treats "break" and "pause" as everyday words. The glossary's Vacation entry avoids them as names for a vacation, which made `npm run lint` fail on main over every `break` statement.

### Left open

- The Overlaps criterion stays unticked for one part, "on an approved vacation". Every other part has a scenario. Nothing can approve a vacation until ticket 02, and core tests can't write storage directly. `vacationOn` already counts approved vacations, and the preview skips their days as "on-vacation". Ticket 02 should add that scenario.
- A waiting vacation whose last day has passed stays on Profile with Withdraw, since it can still be decided and, after ticket 03, may hold penalties. Ticket 04, which adds "Last one", should decide when a waiting card leaves.
- The iPhone date pickers and footer bar are in `../manual-checks.md` (After ticket 01).

### Ticket 02 closed the Overlaps gap

- "A new vacation skips days already on an approved one" (`vacations.test.ts`, under "once approved, covered occurrences are Excused") approves a vacation, then previews and files a second one over the same days: they're skipped as "on-vacation". The Overlaps criterion is ticked.
