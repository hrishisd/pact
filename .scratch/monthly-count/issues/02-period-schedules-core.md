# 02 Every 2 weeks and Once a month in the core

Status: done
Blocked by: 01

Spec: `../spec.md` stories 1–4, 8–10; Schedules, First period, Vacations, Excuses/change requests/ending, Words.

## What to build

- `every-2-weeks` and `once-a-month` in `Schedule`, the server's shape check, and `checkedTerms` (Camera only).
- Occurrence timing (`occurrences.ts`): months and two-week periods, their first period (this one, the next one, or from a start date), `lastDayOf`, `firstDayNotOpen` and `firstOccurrenceAfterChange` for each.
- The first-occurrence query also returns the periods the Schedule step offers: this one (unless due within the hour) and the next.
- Judging, evidence, excuses, change requests, ending and history follow from the period schedules; the missed push names the period.
- Vacations: the 15th-to-the-end and whole-second-week rules.

## Acceptance criteria (core scenarios)

- [x] Made Tue Nov 24 with no start date, the first month is November, due at midnight ending Nov 30; with start date Dec 1, December. Made at 23:30 on Nov 30, December.
- [x] Every 2 weeks made Tue Nov 24: the first period runs Mon Nov 23 – Sun Dec 6; with start date Nov 30, Nov 30 – Dec 13; the next ones follow with no gap.
- [x] One approved photo Satisfies a month; none by its end is Missed with one penalty; a rejected photo can be made up another day of it.
- [x] An excuse for a day covers the month.
- [x] A vacation Dec 12 – Jan 3 filed in November covers December; Dec 16 – Jan 3 doesn't, nor does any vacation filed once December has opened.
- [x] A change approved mid-month applies from the next month; an end request takes effect when the month closes.
- [x] Oura Ring and Anki pacts refuse the new schedules.
- [x] The occurrence timing tests cover month lengths, February in a leap year and a daylight saving change inside a period.
