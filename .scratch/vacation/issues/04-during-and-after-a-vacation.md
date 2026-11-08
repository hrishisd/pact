# 04 During and after a vacation: Today's banner, the heat map and Profile

Status: done
Blocked by: 02

Spec: `../spec.md` stories 18 to 20, and Screens (Today "During an approved vacation" and the covered occurrences left off it, "Heat map", and the Profile cards "On now" and "Last one"). The screens follow the prototype's sections 2 (move the clock to during and back) and 3.

## What to build

While an approved vacation is on, Today shows a banner instead of the covered pacts. Afterwards, the heat map marks the vacation's days with their own square, and Profile says when the last one was.

### Core
- **Today:** the owner's approved vacation on today's date (first to last day) as a banner entry: last day, note, the covered pacts' names (or that it covers every pact) and each covered pact's line, as the confirm step words them. Every occurrence an approved vacation covers is left out of every section, whenever it would show: To do, Coming up (a covered One-time deadline from the moment the vacation is approved), Missed and Yesterday. A covered Weekly count week that runs past the last day stays out too. Uncovered pacts show as usual.
- **History:** `recordedStatus` says when an Excused occurrence was excused by a vacation, with the vacation's dates, so the heat map can draw it. A covered occurrence that ended Satisfied (approved evidence, an on-time bedtime) stays Satisfied.
- **Profile:** the owner's vacations query reports a vacation on now, and the last approved one that ended. A waiting vacation whose last day has passed stays a Waiting card, with Withdraw, until it's approved, rejected or withdrawn, since it may hold penalties; only an approved one becomes "Last one" (the human's decision, recorded in the spec's Screens section).

### Client
- **Today banner:** "On vacation until Sat Jan 2", the note, "Bed by midnight, Gym and Spanish deck are Excused on these days, with no reminders and no penalties." ("Your pacts are Excused on these days, …" when it covers every pact), and **See what's excused** / Hide, listing each covered pact's line.
- **Heat map** (`src/client/history.tsx`): a "vacation" square, hatched grey as in the prototype (`.cell.vac`), a "Vacation" legend entry between Excused and Not judged yet, and on tapping, the "Vacation" chip (`c-vac`) with "Vacation, Dec 20 – Jan 2. Excused, no penalty." The Weekly count view draws a covered week the same way.
- **Profile:** "On vacation until Sat Jan 2" with the "On now" chip during it; "Last one: Dec 20 – Jan 2" beside Plan a vacation after it.

## Acceptance criteria (core scenarios)

- [x] Approved vacation Mon+1 to Sun+1 over a Mon/Wed/Fri Camera pact and an every-night bedtime pact, and an uncovered 3× per week pact: on Wed+1, Today has the banner, no card for the two covered pacts in any section, and the uncovered pact's To do card.
- [x] A covered One-time deadline isn't under Coming up once the vacation is approved.
- [x] On Mon+2, Yesterday has no row for the covered pacts' Sun+1, and the banner is gone.
- [x] A covered Weekly count week Mon+1 to Sun+1 for a vacation ending Sat+1 stays off Today on Sun+1.
- [x] A waiting vacation shows no banner and hides nothing (ticket 03 covers its Missed cards).
- [x] The pact's history on Mon+2 marks Mon+1 to Sun+1 as excused by the vacation with its dates; an ordinary excused day isn't marked; a covered night Oura satisfied is Satisfied.
- [x] Profile reports the vacation as on now during it and as the last one after it.
- [x] A vacation still waiting after its last day stays on Profile as waiting, with Withdraw, and isn't the last one; once approved, it is.

## Acceptance criteria (screens)

- [x] Checked in the browser at 390×844 on a seeded dev database, with screenshots next to the prototype's: Today during a vacation with the banner closed and open, Today the day after, the bedtime pact's heat map with vacation squares, the legend and a tapped vacation day, a Weekly count pact's week view, and Profile on now and after.

## Comments

### Agent, after building it

Built on `claude/vacation-ticket-04-wgnec7`. `npm run check` passes: 68 test files, 1235 tests (1210 before), typecheck, lint and build. Every criterion above has a scenario in `src/core/vacations.test.ts` ("Today during an approved vacation", "the heat map after an approved vacation", "Profile during and after a vacation"). The client has tests in `Today.test.tsx`, `VacationSection.test.tsx` and a new `history.test.tsx`, and `app.test.ts` covers the new route.

Decisions worth knowing:

- "Last one" comes from its own query, `lastVacation()`, on `GET /api/vacations/last`. Existing tests pin `vacations()` to `[]` once a vacation is over, so it can't carry the last one too. The Profile sheet loads it and passes it to `VacationSection`, so the section's existing tests need no new stub.
- `Today.vacations` and `RecordedStatus.vacation` are left out when empty, so existing `toEqual` assertions on Today and history are unchanged.
- The banners sit after the alerts and before the sections, as in the prototype. "Nothing to do right now" doesn't show while a banner does.
- A pact's Coming up card is the occurrence it names, so a recurring pact whose first occurrence the vacation covers has no Coming up card either. The spec says "Every occurrence an approved vacation covers is left off Today, whenever it would show: To do, Coming up, Missed and Yesterday."
- On the heat map, a covered occurrence not judged yet already shows the vacation square, as an approved excuse marks a day ahead. A covered night Oura satisfies then turns Satisfied.
- The banner names the pacts with something covered. It says "Your pacts are" only when the vacation picked every pact.
- The "On now" chip uses the Approved chip's green.

Screenshots at 390×844 on a seeded dev database were compared with the prototype's sections 2 and 3: the banner closed and open (every pact, and some pacts beside an uncovered To do card), Today the day after, the bedtime heat map (vacation, excuse and covered Satisfied nights tapped), the Weekly week view, and Profile On now and Last one. Copy follows the spec where the prototype differs ("See what's excused", "Excused").

Review: the Standards review found the Weekly view passing a made-up `evidenceKind="camera"` to the chip; `OccurrenceChip` now takes an `oura` flag. Simplify split `vacationBasics` out of `vacationSummary`, so the banner doesn't look up reviewers it throws away, and replaced a nested ternary on the Profile card.
