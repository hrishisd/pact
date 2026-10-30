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

- [ ] Due by 09:00: evidence at 08:59 accepted, at 09:01 refused; no evidence → Missed at 09:00.
- [ ] Created Mon 08:30 with due-by 09:00 on a daily pact → first occurrence Tuesday.
- [ ] Start date next Monday → nothing opens before then; a start date earlier than the computed first occurrence changes nothing.
- [ ] End date Friday → Friday is judged, Saturday never opens, pact Ended.
- [ ] Moving the due-by time later → change request; earlier → applies from the next occurrence not yet open.
- [ ] Today shows a Camera pact past its due-by time as Closed under Missed.
