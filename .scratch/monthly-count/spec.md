# Once a month and Every 2 weeks

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Status: ready-for-agent

Designed in a grilling session on 2026-11-24, with one prototype round (published at https://claude.ai/artifact/Jo7dtMVHSf1FydTHdgB8Qi; the file is on the local branch `prototype/monthly-count`). The owner picked option C (presets) for the Schedule step and T2 (quiet until the last week) for Today. Vocabulary follows `GLOSSARY.md`. Decisions marked "(build)" were settled while building, from the code, where the grilling left a detail open.

## Problem statement

Some things I want to commit to happen less than weekly: call my grandmother once a month, clean the fridge every two weeks. Today a pact is due on fixed days, a number of days each week, or once by a deadline, so I can't hold myself to a monthly or fortnightly habit without picking an arbitrary date for it.

## Solution

Two new schedules for Camera pacts, offered as presets: **Every 2 weeks** and **Once a month**. Each period (two Mon–Sun weeks, or a calendar month) is one occurrence, like a Weekly count week: one approved photo on any day of it Satisfies it, and it's due at the end of its last day. The owner picks whether the first period is this one or the next. The pact stays quiet on Today until its last 7 days, when reminders start and its To do card comes up. A vacation that doesn't cover the period but overlaps its last 7 days moves the advice and the reminders to the 7 days before the trip.

## User stories

1. As an owner, I want "Once a month" and "Every 2 weeks" on the Schedule step, so that I can commit to something I do less than weekly.
2. As an owner, I want to pick whether my first month (or first 2 weeks) is this one or the next, with the due date of each shown, so that I don't wait a month to start, or start with no time left.
3. As an owner, I want the Check step to say which period is first and when it's due, so that I know what I signed up for.
4. As an owner, I want one approved photo on any day of the period to count, so that the day I do it is up to me.
5. As an owner, I want the pact to stay in a small section at the bottom of Today, with Take photo, until its last 7 days, so that it doesn't nag me all month but stays one tap away.
6. As an owner, I want reminders only in the period's last 7 days, until a photo is in, so that I'm nudged when it matters and not every day.
7. As an owner with a trip coming up that doesn't cover the period, I want Today, the pact page and Plan a vacation to tell me to do it before I leave, and the reminders to move to the week before the trip, so that a trip at the end of the month doesn't make me miss it.
8. As an owner, I want the pact page to show one history square per period, so that I see each month or fortnight at a glance.
9. As an owner, I want excuses, vacations, change requests and ending to work as they do for Weekly count, so that I don't learn new rules.
10. As a reviewer, I want evidence, excuses and missed periods named by their month ("December") or their dates ("Nov 30 – Dec 13"), so that I know which period I'm deciding.

## Implementation decisions

### Schedules

- Two new schedule kinds, Camera only: `every-2-weeks` and `once-a-month`, with no other fields. Every 2 weeks, Once a month and Weekly count are the **period schedules**: each occurrence is a period of days, any of which can take evidence, at most one day counting per calendar day. Their target is Weekly count's `target`, and 1 for the new two.
- A month is a calendar month in the owner's timezone, dated by its 1st. Two weeks are two Mon–Sun weeks counted from the pact's first occurrence (a Monday), dated by their first Monday.
- A period is due at the midnight ending its last day. A due-by time limits each day's evidence, as on Weekly count.
- A period is Satisfied once a day of it has approved evidence. A period that ends without one is Missed with one penalty (the target less its approved days, times the penalty, as Weekly count).
- Oura Ring and Anki pacts can't have them (`invalid-schedule`).

### First period

- With no start date, the first period is the one that has today, if it's due at least an hour after the pact is made; else the next one. With a start date, it's the first period starting on or after it: the first 1st of a month, or the first Monday. (Weekly count keeps its rule: the Monday after creation.)
- The Schedule step's **First month** (or **First 2 weeks**) choice: "This month" sets no start date, "Next month" sets the next period's first day as the start date. "This month" is preselected when 7 or more days of it are left, counting today, and hidden when it would be due less than an hour from now (the core's first-occurrence query says which periods are on offer). The choice takes the place of the Start date field; End (optional) stays. (build) The Request change form doesn't show the choice, since the first period opens once the edit window closes in nearly every case.
- Labels: "November · Due by Mon Nov 30 · 7 days, counting today" and "December · Dec 1 to Thu Dec 31". For two weeks: "This week · Due by Sun Dec 6" and "Next week · Nov 30 to Sun Dec 13".
- The Check step: "Your first month is **December**. It's due by midnight on **Thu Dec 31**." For two weeks: "Your first 2 weeks start **Mon Nov 30**. They're due by midnight on **Sun Dec 13**."

### The reminder window and trips

- A period's **reminder window** is its last 7 days.
- A **trip ahead** of a period: a vacation the owner filed with the pact ticked, waiting for approval or approved, that doesn't cover the period, starts after the period's first day, and overlaps its last 7 days. With several, the earliest-starting one counts. The owner should do it by the day before the trip starts ("do it by"), and the reminder window becomes the 7 days up to and including that day. A "do it by" day before today isn't shown, and the window is the normal one (build).
- "Do it by" is advice: the period still closes at the end of its last day, and a photo during the trip still counts.

### Today

- A Once a month or Every 2 weeks pact whose period is open and still needs evidence today is a To do card while today is in its reminder window, and otherwise a card in a new section after To do, **This month** (all monthly), **These 2 weeks** (all fortnightly) or **Due later** (both). The small card shows "0 of 1 · due Thu Dec 31" and Take photo.
- The To do card shows "0 of 1 this month" (or "these 2 weeks"), and "Due by Thu Dec 31 · 5 days left", or with a trip ahead "Do it by Wed Dec 23 · 6 days left" and "You're away Thu Dec 24 – Sun Jan 3".
- Once a photo is in, the pact leaves the sections and shows under Waiting for approval, as other evidence does. Weekly count is unchanged.

### Reminders

- Each reminder time goes off on the days of the reminder window that have no evidence yet, while the period's approved and waiting days are short of its target.
- Body: "Due Thu Dec 31. 5 days left." or "Do it before your trip: by Wed Dec 23."

### Vacations

- A vacation covers a month only if it covers every day from the 15th to the month's last day, and two weeks only if it covers their whole second week. It still covers only periods that haven't opened (rule: vacations cover only unopened occurrences). Weekly count keeps its Thursday rule.
- Plan a vacation's Check step lists each period the vacation touches but doesn't cover, as it lists weeks, and for a period with a trip ahead, "Do it by Wed Dec 23. Reminders move to the 7 days before your trip."

### Excuses, change requests, ending

- As Weekly count: an excuse for any day of a period covers the period; an approved change applies from the next period that hasn't opened; the schedule kind can't change after the edit window; only whole periods up to the end date count; an end request takes effect when the open period closes.

### Words

- Schedule text: "Once a month", "Every 2 weeks". Term labels: Schedule.
- A period's name: the month, "December", or for two weeks their first and last day, "Nov 30 – Dec 13". (build) No year: as for days elsewhere in the app, the screens around it make the year plain.
- Missed push: "December · $20 penalty to Against Malaria Foundation", "Nov 30 – Dec 13 · …".

### Pact page

- History: one square per period, with how many days counted, labelled by month ("Nov") or by the first Monday ("Nov 30"). "One square per month" / "One square per 2 weeks".
- With a trip ahead of the open period, a line above the buttons: "You're away Thu Dec 24 – Sun Jan 3, so December is due by Wed Dec 23."

## Testing decisions

- Core rules are scenarios through `scenario()`, in a new `src/core/period-schedules.test.ts`, as `weekly-count.test.ts` does for weeks: first period (this, next, start date, the last hour), Satisfied and Missed, excuse over a period, the vacation rules, reminders in the window and moved by a trip, Today's sections, change from the next period, end request, end date whole periods.
- Occurrence timing at its own interface in `occurrences.test.ts`: month lengths, leap February, a two-week period across a daylight saving change, periods after the first.
- `verdict.test.ts` gains a monthly case. The fuzz test creates pacts on the new schedules.
- Client: the Schedule step's presets and First month choice, the Check step's line, Today's later section and the trip line, the pact page's history and trip line, in their `*.test.tsx`.

## Out of scope

- Any other target per month or two weeks ("2× a month").
- Other periods ("every 3 weeks").
- Changing the schedule kind after the edit window.
