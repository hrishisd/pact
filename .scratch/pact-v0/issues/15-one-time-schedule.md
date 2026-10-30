# 15 One-time schedule

Status: ready-for-agent
Blocked by: 11, 13, 16

Spec stories: 16, 17 (due-by time on One-time), 23 (dated reminders), 26 (One-time), 31, 85 (One-time). Rules: Creation and change (One-time exception, Submit anytime), Judging, Reminders. Glossary: Deadline, Submit anytime.

User-facing: ask whether to prototype the Schedule step and the Today cards first (`docs/agents/prototype-first.md`).

## What to build

A Camera pact with a single occurrence by a deadline, e.g. a dentist appointment on a set day, or filing taxes any time before April 15.

- **Schedule step:** One-time, Camera only. The owner picks the deadline's date and, optionally, a due-by time; without one it's due at midnight. A small **Submit anytime** toggle, off by default, sits under it with the line "Anytime from now until the selected deadline." The deadline must be at least 1 hour after creation. The start date field is hidden for One-time.
- **The occurrence:**
  - Submit anytime off: opens at 00:00 on the deadline's date. Evidence is accepted only on that date, up to the due time. Evidence before that date is refused.
  - Submit anytime on: opens when the pact is created. Evidence is accepted any time up to the deadline; the due-by time limits only the last day.
  - Either way it's judged at the deadline: no evidence → Missed; waiting evidence holds the outcome; rejected → Missed as of the rejection, even before the deadline, and no more evidence is taken.
- **Check step:** "Thu Nov 12, due midnight", or "Anytime until Thu Nov 12, midnight" with Submit anytime.
- **Today:**
  - Submit anytime off: under Coming up ("Opens Thu Nov 12") until its date, then To do like a Fixed days card ("Due at midnight · 6h 10m", label Due today). Past the due-by time it's Missed.
  - Submit anytime on: To do from creation, sorted by its own due date, below things due today. The occurrence label shows the due date.
- **Reminders:** each has its own date and time and fires once, unless evidence has already been submitted. No recurring reminders on One-time pacts.
- **Change classification:**
  - Turning Submit anytime on relaxes; turning it off is stricter.
  - With Submit anytime on, a later deadline relaxes and an earlier one is stricter.
  - With Submit anytime off, any change of date needs a change request, since only a reviewer can judge whether another day is easier. Due-by time changes follow ticket 16.
  - The exception: a change applies to the occurrence even once it's open, as long as the new deadline is at least 1 hour after the change takes effect. Evidence already submitted still counts.
- After its occurrence is judged, the pact is Ended.

## Acceptance criteria (core scenarios)

- [ ] Deadline 30 minutes after creation is refused.
- [ ] Submit anytime off, deadline Thu: evidence on Tue is refused; evidence on Thu at 15:00, approved → Kept, pact Ended.
- [ ] Submit anytime off, deadline Thu with due-by 09:00: evidence at 08:59 Thu accepted, at 09:01 refused; no evidence → Missed at 09:00.
- [ ] Submit anytime on: evidence three days before the deadline, approved → Kept, pact Ended.
- [ ] No evidence by the deadline → Missed, penalty owed (both settings).
- [ ] Evidence rejected before the deadline → Missed at once, penalty owed; new evidence is refused.
- [ ] Today: Submit anytime off shows under Coming up before the date and under To do on it; Submit anytime on shows under To do from creation.
- [ ] Reminder on Apr 10 at 09:00 fires once; doesn't fire if evidence was already submitted.
- [ ] Turning Submit anytime on → change request; turning it off applies at once, and evidence already submitted still counts.
- [ ] Submit anytime off: moving the date earlier or later → change request.
- [ ] Approved later deadline applies to the open occurrence; an earlier deadline under an hour away is refused.
