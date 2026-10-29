# 13 Reminders for Fixed-days and bedtime pacts

Status: ready-for-agent
Blocked by: 05, 08, 11

Spec stories: 23, 85 (Fixed days), 87. Rules: Reminders, Time. ADR 0002 (After downtime).

## What to build

Per-pact reminders, sent by push, only when they're useful.

- **Reminders step** in the create form (between Reviewers and Check): add reminders, each with a time. Text adapts for Oura Ring pacts (they go off every scheduled night).
- **Fixed days (Camera):** fire on scheduled days at their time, only if that day has no evidence.
- **Bedtime:** fire every scheduled night, even if the owner is already in bed (the app can't know until the ring syncs).
- Changing reminders on an Active pact takes effect at once with no review (extends ticket 11's classification).
- **After downtime:** reminders more than 15 minutes late are dropped, not sent. Each drop is logged, and a summary goes out as an operator alert.

## Acceptance criteria (core scenarios)

- [ ] Mon/Wed/Fri pact, 18:00 reminder → fires Monday at 18:00 when there's no evidence; not when evidence was submitted at 17:00; never on Tuesday.
- [ ] Bedtime pact, 23:30 reminder → fires every scheduled night.
- [ ] Advancing from 17:50 to 18:20 in one step drops the 18:00 reminder and records one operator alert; 17:50 to 18:10 sends it.
- [ ] A reminder fires once, also across a restart right after it fires.
- [ ] Reminder times are in the owner's timezone.

## Out of this ticket

Weekly count reminders (14), One-time dated reminders (15).
