# 13 Reminders for Fixed-days and bedtime pacts

Status: done
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

- [x] Mon/Wed/Fri pact, 18:00 reminder → fires Monday at 18:00 when there's no evidence; not when evidence was submitted at 17:00; never on Tuesday.
- [x] Bedtime pact, 23:30 reminder → fires every scheduled night.
- [x] Advancing from 17:50 to 18:20 in one step drops the 18:00 reminder and records one operator alert; 17:50 to 18:10 sends it.
- [x] A reminder fires once, also across a restart right after it fires.
- [x] Reminder times are in the owner's timezone.

## Out of this ticket

Weekly count reminders (14), One-time dated reminders (15).

## Comments

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/reminders.test.ts. A reminder is a time of day, refused if at or after the due time; on a bedtime pact a time before 18:00 means the morning after. Camera reminders skip a day with evidence; bedtime reminders always fire; neither fires on an excused occurrence. Each pact keeps a cursor, so a restart can't resend. Reminders more than 15 minutes late are dropped with one operator alert per tick. At most 5 per pact. The pact page has its own Change button for reminders, which also works while a change request waits.

- 2026-11-08: The human confirmed the choices listed for this ticket under "Decisions to confirm" in `manual-checks.md`, so the review is done and the Status is `done`. The phone checks in `manual-checks.md` are still open; a bug found there becomes a new ticket.
