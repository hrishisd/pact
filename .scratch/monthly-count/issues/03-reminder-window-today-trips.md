# 03 Reminder window, trips ahead and Today's later section in the core

Status: ready-for-agent
Blocked by: 02

Spec: `../spec.md` stories 5–7; The reminder window and trips, Today, Reminders, Vacations (the Check step's advice).

## What to build

- One rule for a period's reminder window and its trip ahead, shared by reminders, Today, the pact page and the vacation preview.
- Reminders go off only in the window, on days with no evidence, while the period needs evidence.
- Today: the To do card in the window, else the new later section; the card carries the progress, the "do it by" day and the trip's dates.
- The pact page carries the trip ahead of the open period.
- The vacation preview gives the "do it by" day for each period it touches without covering.

## Acceptance criteria (core scenarios)

- [ ] A monthly pact with a 19:00 reminder: no reminder Dec 1–24, one each day Dec 25–31 until a photo is in.
- [ ] With an approved trip Dec 24 – Jan 3: reminders Dec 17–23 only; Today's card says do it by Dec 23 from the day the trip is approved.
- [ ] A rejected or withdrawn trip, or a trip not overlapping the last 7 days, changes nothing.
- [ ] On Dec 3 the pact is in the later section; on Dec 26 it's a To do card; once a photo is in, it's in neither.
