# 14 Weekly count schedule

Status: ready-for-agent
Blocked by: 07, 11, 13

Spec stories: 15, 26 (Weekly count), 32, 50, 69, 86. Rules: Judging pacts with submitted evidence (Weekly count), Excuses, Reminders.

## What to build

Camera pacts with a target per Mon–Sun week (e.g. 3× per week), where the owner chooses which days.

- **Schedule step:** Weekly count with a target, Camera only.
- **First occurrence:** the week starting the Monday after creation. The occurrence is the whole week.
- **Evidence:** accepted any day of the week; at most one day of evidence counts per calendar day. Evidence records the day it counts for.
- **Today:** "1 of 3 this week" progress. A Weekly count pact mid-week sorts by its own due date (end of Sunday), below things due today. Its occurrence label is "This week".
- **Judging** at the end of Sunday: one penalty per session short of the target. Rejected evidence doesn't count, and the owner can make up the session another day that week. Evidence waiting for a decision at the end of Sunday holds the outcome until decided.
- **Excuses:** an approved excuse covering any day of the week excuses the whole week.
- **Reminders:** fire only on days without evidence, and only while the week's target is unmet.
- **Change classification:** lowering the target relaxes; raising it is stricter. Applies from the next week not yet open.

## Acceptance criteria (core scenarios)

- [ ] Spec example: 3× week, three photos submitted, one rejected → one penalty; no photos → three penalties.
- [ ] Two photos on the same day count once.
- [ ] Created Wednesday → first occurrence is next Monday's week; nothing is owed for this week.
- [ ] Excuse for Thursday approved → whole week Excused, no penalties.
- [ ] Target met by Thursday → no reminders Friday–Sunday; a day with evidence gets no reminder.
- [ ] Spec example: lowering the target, approved Wednesday, applies from next Monday.
