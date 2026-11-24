# 01 Name Weekly count's machinery by period, not week

Status: ready-for-agent
Blocked by: none

Spec: `../spec.md`, Schedules ("period schedules").

## What to build

A refactor with no change in behaviour, so tickets 02 and 03 add the new schedules without calling a month a week.

- `isPeriodSchedule(schedule)` and `targetOf(schedule)` in `src/shared/`, used wherever code asks "is this Weekly count?" to mean "is each occurrence a period of days". Week-only rules (the vacation Thursday rule, the Weekly count reminder and Today card, week wording) keep asking for Weekly count.
- Wire and shared names: `WeekProgress` → `PeriodProgress`, `HeatMapWeek` → `HeatMapPeriod`, Today's and the review items' `week` field → `period`, the history's `weekly-count` kind → `periods`.
- Core names: `weekProgress` → `periodProgress`, `WEEKLY_COUNT_PACT` → `PERIOD_PACT` (SQL listing the period kinds), `isWeekly` → `isPeriodPact`, `weekToDo` → `periodToDo`, `heatMapWeeks` → `heatMapPeriods`.

## Acceptance criteria

- [ ] `npm run check` passes with no test changed except for the renames.
- [ ] No behaviour change: the fuzz test passes on fresh seeds.
