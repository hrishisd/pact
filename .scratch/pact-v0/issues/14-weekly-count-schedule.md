# 14 Weekly count schedule

Status: done
Blocked by: 07, 11, 13

Spec stories: 15, 26 (Weekly count), 32, 50, 69, 86. Rules: Judging pacts with submitted evidence (Weekly count), Excuses, Reminders.

## What to build

Camera pacts with a target per Mon–Sun week (e.g. 3× per week), where the owner chooses which days.

- **Schedule step:** Weekly count with a target, Camera only.
- **First occurrence:** the week starting the Monday after creation. The occurrence is the whole week.
- **Evidence:** accepted any day of the week; at most one day of evidence counts per calendar day. Evidence records the day it counts for.
- **Today:** "1 of 3 this week" progress. A Weekly count pact mid-week sorts by its own due date (end of Sunday), below things due today. Its occurrence label is "This week".
- **Judging** at the end of Sunday: one penalty per session short of the target. Rejected evidence doesn't make a day Missed: it just doesn't count, and the owner can make up the session another day that week. Its rejected-evidence alert says "Doesn't count toward this week · make it up by Sunday" instead of "<day> is Missed · $5 to <recipient>", and Take the L still clears it. Evidence waiting for a decision at the end of Sunday holds the outcome until decided.
- **Excuses:** an approved excuse covering any day of the week excuses the whole week.
- **Reminders:** fire only on days without evidence, and only while the week's target is unmet.
- **Change classification:** lowering the target relaxes; raising it is stricter. Applies from the next week not yet open.

## Acceptance criteria (core scenarios)

- [x] Spec example: 3× week, three photos submitted, one rejected → one penalty; no photos → three penalties.
- [x] Two photos on the same day count once.
- [x] Photo rejected Tuesday → nothing Missed and nothing owed yet; the alert says "Doesn't count toward this week · make it up by Sunday"; Take the L clears it; evidence on Wednesday still counts.
- [x] Created Wednesday → first occurrence is next Monday's week; nothing is owed for this week.
- [x] Excuse for Thursday approved → whole week Excused, no penalties.
- [x] Target met by Thursday → no reminders Friday–Sunday; a day with evidence gets no reminder.
- [x] Spec example: lowering the target, approved Wednesday, applies from next Monday.

## Notes

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre. Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/weekly-count.test.ts. Choices the spec left open: a short week is one penalty row of (days short × penalty); evidence records its `day` (migration 19), and a day whose evidence was rejected takes no more ("make it up another day"); the rejected-day alert also goes once the week is judged; reminders and the To do card stop once approved plus waiting days meet the target; Fixed days and Weekly count can't be swapped after the edit window (`schedule-kind-fixed`); with an end date only whole weeks ending by it count; the Schedule step, Today card and heat map follow `prototype/pact-v0-flows` and the changes prototype (weekly squares).

## Comments

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/weekly-count.test.ts; the choices made where the spec was open are under Notes above. A short week adds one penalty for the days short times the penalty. Fixed days and Weekly count can't be swapped after the edit window.

- 2026-11-08: The human confirmed the choices listed for this ticket under "Decisions to confirm" in `manual-checks.md`, so the review is done and the Status is `done`. The phone checks in `manual-checks.md` are still open; a bug found there becomes a new ticket.
