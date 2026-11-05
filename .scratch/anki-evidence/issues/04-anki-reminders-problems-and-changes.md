# 04 Anki reminders, broken connections, deleted decks and deck changes

Status: ready-for-agent
Blocked by: 03

Spec: `../spec.md` stories 10, 12, 13 and 14, and the Checking AnkiWeb and Connection sections.

## What to build

- **Reminders:** on an Anki pact, a reminder fires on a scheduled day while the deck isn't finished as of the last check, and its push includes the count: "Spanish: 42 cards left, due at midnight". Use the existing Reminders step, with no new default reminder.
- **Needs reconnecting:**
  - An auth error from AnkiWeb marks the connection Needs reconnecting once, with one alert in the app and on each Anki pact, plus one push (the Connection problem setting). There are no further checks until the owner reconnects.
  - A reconnect that races a tick isn't undone, as for Oura.
  - Days whose due time passes meanwhile are Missed.
- **Profile → Connections:** the AnkiWeb row with its status and Reconnect. Disconnect warns how many Active pacts use it, and deletes the host key and the collection copy.
- **Deleted deck:** "deck-missing" shows an alert on the pact ("The Spanish deck is gone from Anki"). The pact's days are Missed at their due times, and the owner can excuse them.
- **Deck changes:**
  - In the edit window, the deck can change freely.
  - After the window, a deck change is part of a change request, always reviewed, because Pact can't tell whether it relaxes the pact.
  - An earlier due-by time is a stricter change and applies to occurrences not open yet.
  - The change request page shows the old and new deck by name.

## Acceptance criteria (core scenarios)

- [ ] A reminder at 21:00 with 42 cards left at the last check sends a push naming the count. With the deck finished at 20:30, nothing is sent.
- [ ] An auth error at 08:00 gives one alert and one push, then no further calls. Reconnecting at 12:00 resumes checks, and a 0/0/0 check then satisfies the day.
- [ ] Never reconnected, so the day is Missed at its due time.
- [ ] "deck-missing" gives an alert on the pact. The day is Missed at the due time and can be excused.
- [ ] After the edit window, a deck change creates a change request and the pact keeps its old deck until a reviewer approves it.
- [ ] The disconnect query reports the number of Active Anki pacts.

## Comments

### 2026-11-05: parts done early in ticket 03

- **Reminders:** the push already fires while the day isn't judged and names the count ("42 cards left, due at midnight").
- **Profile:** the AnkiWeb row and its Disconnect are built, sharing Oura's row. It shows the status chip and warns how many Active pacts use the connection, and disconnecting deletes the host key and the collection copy. Reconnect is still to do here.
- Ticket 03 ignores a "disconnected" answer for now, and its change form shows the deck as fixed. Both are left for this ticket.
