# 16 Due-by time, start date and end date

Status: ready-for-agent
Blocked by: 11

Spec stories: 17–19, 26 (start date), 83 (Ended). Rules: Creation and change, Judging, Today (Closed).

## What to build

The optional time fields on a pact.

- **Due-by time** (Camera only; Fixed days and Weekly count here, and ticket 15 reuses it as the time of a One-time deadline): evidence is due by a set time of day instead of midnight. Fixed days are judged at the due-by time; a Weekly count week is still judged at the end of Sunday, and the due-by time only limits each day's evidence. Evidence after it is refused. The Today card shows "Due at 9:00pm · 4h 12m". Past today's due-by time, a Camera pact shows under Missed as **Closed**.
- **Start date** (recurring pacts): creates a pact now that begins later. It can only push the first occurrence later. Shows under Coming up ("Starts Mon Oct 26").
- **End date** (recurring pacts): the pact becomes Ended when it passes and produces no further occurrences.
- First occurrence uses the due-by time as the due time for the 1-hour lead rule.
- **Change classification:** later due-by, later start date, earlier end date, removing a due-by time and adding an end date relax; the opposite of each, adding a due-by time and removing an end date are stricter.
- **Pacts tab:** Ended pacts collapsed at the bottom (if ticket 11 didn't already).

## Acceptance criteria (core scenarios)

- [x] Due by 09:00: evidence at 08:59 accepted, at 09:01 refused; no evidence → Missed at 09:00.
- [x] Created Mon 08:30 with due-by 09:00 on a daily pact → first occurrence Tuesday.
- [x] Start date next Monday → nothing opens before then; a start date earlier than the computed first occurrence changes nothing.
- [x] End date Friday → Friday is judged, Saturday never opens, pact Ended.
- [x] Moving the due-by time later → change request; earlier → applies from the next occurrence not yet open.
- [x] Today shows a Camera pact past its due-by time as Closed under Missed.

## Notes

- Trap: `#pactsToJudge` in `src/core/core.ts` selects every pact with no filter on `stage`, so judging keeps adding a penalty for an Ended pact, and setting `stage = 'ended'` alone doesn't stop it. Ticket 11 has the same trap, so check whether it's already fixed; either way, the End date scenario needs Saturday to add no penalty.

## Comments

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/due-by-and-dates.test.ts. A pact with an end date becomes Ended at the start of the day after it, or when its last occurrence closes if later (6pm the next day for a bedtime pact), with no notification. Due-by is Camera only and any HH:MM except 00:00. The start date can't change once the pact has started. The scenarios were written first but weren't run red before the code.
