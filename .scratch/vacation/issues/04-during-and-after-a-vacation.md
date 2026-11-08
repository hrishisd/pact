# 04 During and after a vacation: Today's banner, the heat map and Profile

Status: ready-for-agent
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

- [ ] Approved vacation Mon+1 to Sun+1 over a Mon/Wed/Fri Camera pact and an every-night bedtime pact, and an uncovered 3× per week pact: on Wed+1, Today has the banner, no card for the two covered pacts in any section, and the uncovered pact's To do card.
- [ ] A covered One-time deadline isn't under Coming up once the vacation is approved.
- [ ] On Mon+2, Yesterday has no row for the covered pacts' Sun+1, and the banner is gone.
- [ ] A covered Weekly count week Mon+1 to Sun+1 for a vacation ending Sat+1 stays off Today on Sun+1.
- [ ] A waiting vacation shows no banner and hides nothing (ticket 03 covers its Missed cards).
- [ ] The pact's history on Mon+2 marks Mon+1 to Sun+1 as excused by the vacation with its dates; an ordinary excused day isn't marked; a covered night Oura satisfied is Satisfied.
- [ ] Profile reports the vacation as on now during it and as the last one after it.
- [ ] A vacation still waiting after its last day stays on Profile as waiting, with Withdraw, and isn't the last one; once approved, it is.

## Acceptance criteria (screens)

- [ ] Checked in the browser at 390×844 on a seeded dev database, with screenshots next to the prototype's: Today during a vacation with the banner closed and open, Today the day after, the bedtime pact's heat map with vacation squares, the legend and a tapped vacation day, a Weekly count pact's week view, and Profile on now and after.

## Comments
