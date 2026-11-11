# A day on an excuse rejected before its judging shows twice on Today

Status: ready-for-agent
Blocked by: none

## Problem

Found while reviewing ticket 15. An excuse filed ahead for a day and rejected before that day is judged keeps its rejected-excuse alert, with "File another excuse" (`refile`), once the day is judged Missed. The day also gets a Missed card with its own File excuse button, because `recentlyMissed` (`src/core/today.ts`, `COVER_HIDES_MISS`) hides only a day whose excuse was rejected at or after the judging (`cover.decided_at >= occurrence.judged_at`). So Today offers the same excuse twice for one day.

Scenario (pre-existing; ticket 15 didn't change the excuse condition): Mon/Wed/Fri Gym. On Wed the owner files an excuse for Fri; the reviewer rejects it on Wed. Fri is judged Missed at Sat 00:00. At Sat 01:00 Today shows the `excuse-rejected` alert for Fri and a Missed card for Fri.

`docs/behaviour.md` says Missed leaves out "days on a rejected excuse while its alert stands", which is not what the code does for this case.

## What to decide

Which of the two shows the day: hide the Missed card while any rejected excuse's alert covers the day, or drop the alert's refile for days judged after the rejection. Then make code and `docs/behaviour.md` agree.

## Acceptance criteria

- [ ] A scenario: an excuse rejected before its day is judged; once Missed, Today shows the day once.
- [ ] `docs/behaviour.md` matches.

## Owner decision (2026-11-11)

Ready for an agent.
