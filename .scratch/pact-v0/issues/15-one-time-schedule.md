# 15 One-time schedule

Status: ready-for-agent
Blocked by: 11, 13

Spec stories: 16, 23 (dated reminders), 26 (One-time), 85 (One-time). Rules: Creation and change (One-time exception), Judging, Reminders.

## What to build

A Camera pact with a single occurrence by a deadline, e.g. filing taxes.

- **Schedule step:** One-time with a deadline (date and time), Camera only. The deadline must be at least 1 hour after creation.
- **The occurrence** opens when the pact starts and runs to the deadline. Evidence is accepted any time in that period. Judged at the deadline: no evidence → Missed; waiting evidence holds the outcome; rejected → Missed as of the rejection unless resubmitted before the deadline.
- **Today:** a One-time pact that's already open sorts by its own due date, below things due today. Occurrence label shows the due date.
- **Reminders:** each has its own date and time and fires once, unless evidence has already been submitted. No recurring reminders on One-time pacts.
- **Change classification:** a later deadline relaxes, an earlier one is stricter. The exception: a change applies to the open occurrence, as long as the new deadline is at least 1 hour after the change takes effect.
- After its occurrence is judged, the pact is Ended.

## Acceptance criteria (core scenarios)

- [ ] Deadline 30 minutes after creation is refused.
- [ ] Evidence submitted three days before the deadline, approved → Kept, pact Ended.
- [ ] No evidence by the deadline → Missed, penalty owed.
- [ ] Reminder on Apr 10 at 09:00 fires once; doesn't fire if evidence was already submitted.
- [ ] Approved later deadline applies to the open occurrence; an earlier deadline under an hour away is refused.
