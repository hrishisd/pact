# 15 One-time schedule

Status: done
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

- [x] Deadline 30 minutes after creation is refused.
- [x] Submit anytime off, deadline Thu: evidence on Tue is refused; evidence on Thu at 15:00, approved → Kept, pact Ended.
- [x] Submit anytime off, deadline Thu with due-by 09:00: evidence at 08:59 Thu accepted, at 09:01 refused; no evidence → Missed at 09:00.
- [x] Submit anytime on: evidence three days before the deadline, approved → Kept, pact Ended.
- [x] No evidence by the deadline → Missed, penalty owed (both settings).
- [x] Evidence rejected before the deadline → Missed at once, penalty owed; new evidence is refused.
- [x] Today: Submit anytime off shows under Coming up before the date and under To do on it; Submit anytime on shows under To do from creation.
- [x] Reminder on Apr 10 at 09:00 fires once; doesn't fire if evidence was already submitted.
- [x] Turning Submit anytime on → change request; turning it off applies at once, and evidence already submitted still counts.
- [x] Submit anytime off: moving the date earlier or later → change request.
- [x] Approved later deadline applies to the open occurrence; an earlier deadline under an hour away is refused.

## Notes

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre. Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/one-time.test.ts. Choices the spec left open: the schedule is `{ kind: "one-time", deadline, submitAnytime }` with the time of day in the existing due-by time; the occurrence is dated by the deadline's date, and a change of date re-dates its row, evidence and excuse days; a start or end date on One-time is refused (`invalid-start-date`, `invalid-end-date`) and the form hides them; reminders are "YYYY-MM-DDTHH:MM" (one datetime field each); approved evidence is Kept at the deadline, not at approval; an approval whose new deadline is under an hour away by then is refused (`deadline-too-soon`, the reviewer can still reject); a change request decided after the occurrence was judged leaves the Ended pact as it was; Fixed days, Weekly count and One-time can't be swapped after the edit window; the heat map is one square for the deadline's date; Yesterday includes One-time pacts due yesterday; an excuse dated any day of the Submit anytime window covers the occurrence.

## Comments

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/one-time.test.ts; the choices made where the spec was open are under Notes above. Start and end dates are refused on One-time. Reminders carry their own date. A change of deadline moves the one occurrence, with its evidence and excuse days.

- 2026-11-08: The human confirmed that approved evidence is Satisfied at the deadline. Still open: whether a One-time pact should have a start date (see `manual-checks.md`, Decisions to confirm). Status stays `ready-for-agent` until that is answered.

- 2026-11-10 (design review): Verified every acceptance criterion has a passing scenario on `main` (`src/core/one-time.test.ts`); set to done. The open start-date question is a product decision, not unfinished work, and stays under "Decisions to confirm" in `manual-checks.md`.
