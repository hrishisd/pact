# 04 Anki reminders, broken connections, deleted decks and deck changes

Status: done
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

- [x] A reminder at 21:00 with 42 cards left at the last check sends a push naming the count. With the deck finished at 20:30, nothing is sent.
- [x] An auth error at 08:00 gives one alert and one push, then no further calls. Reconnecting at 12:00 resumes checks, and a 0/0/0 check then satisfies the day.
- [x] Never reconnected, so the day is Missed at its due time.
- [x] "deck-missing" gives an alert on the pact. The day is Missed at the due time and can be excused.
- [x] After the edit window, a deck change creates a change request and the pact keeps its old deck until a reviewer approves it.
- [x] The disconnect query reports the number of Active Anki pacts.

## Comments

### 2026-11-05: parts done early in ticket 03

- **Reminders:** the push already fires while the day isn't judged and names the count ("42 cards left, due at midnight").
- **Profile:** the AnkiWeb row and its Disconnect are built, sharing Oura's row. It shows the status chip and warns how many Active pacts use the connection, and disconnecting deletes the host key and the collection copy. Reconnect is still to do here.
- Ticket 03 ignores a "disconnected" answer for now, and its change form shows the deck as fixed. Both are left for this ticket.

### 2026-11-06: built

Built on `claude/anki-ticket-04`. The core scenarios are in `src/core/anki-days.test.ts` ("AnkiWeb refusing Pact's login", "a deck gone from Anki", "changing an Anki pact's deck", plus the reminder scenario from ticket 03). The deck-change route is in `src/server/app.test.ts` under "connecting AnkiWeb", and the dev stand-in's refused login in `src/core/anki.test.ts`.

- **Needs reconnecting.** A "disconnected" answer from a check (a tick or check now), or from the deck list, marks the connection Needs reconnecting once, with one push ("AnkiWeb needs reconnecting", under Connection problem). Today shows an `anki-connection` alert while there's an Active Anki pact, and each Anki pact's page shows the same alert (`connectionProblem`). No checks are made until the owner reconnects. A connection made again since AnkiWeb was asked isn't marked, as for Oura, and reconnecting lets the next tick check at once. Days due meanwhile are Missed as "AnkiWeb not reached" (or with the last check's count).
- **Reconnect.** AnkiWeb has no OAuth page, so Reconnect signs in again in place: the alert's "Reconnect AnkiWeb" and Profile's Reconnect open the email and password fields (shared with the Connect AnkiWeb step, `src/client/anki.tsx`) and post to the same connect route. Profile already had the status chip and Disconnect; the Connection problem setting's hint now names AnkiWeb.
- **Deck gone.** A check that finds a pact's deck gone records it in a new `anki_pact_deck` table (migration 27), with the deck's last known name, so the alert still names the deck once the deck picker no longer lists it. The pact page and the Today card show "The Spanish deck is gone from Anki." The day is Missed at its due time and can be excused like any Missed day. A check that finds the deck again clears the alert.
- **Deck changes.** `PactChange` takes an optional `ankiDeckId`, and the change form's Goal step shows the deck picker. After the edit window a different deck always needs approval (term "deck", label "Deck"), and the change request shows the old and new deck by name. Approved, it applies from the first day not open yet, like other terms: `pact_earlier_terms` gained `anki_deck_id`, and checks, judging, Today and reminders read the deck of the day. In the edit window the deck changes freely, as ticket 03 already allowed. An earlier due-by time was already stricter; a test now shows it applies from the next day.
- **Dev stand-in.** `"refused": true` in `anki-decks.json` makes it answer "disconnected" (`docs/agents/local-dev.md`).
- **Checked in the app** with the dev stand-in: the Today alert and its Reconnect form, Reconnect on Profile, and the deck-gone alert on Today and the pact page.

Decisions the spec left open, taken as Oura does or as the least surprise:
- The deck list answering "disconnected" also marks the connection, not just checks.
- The deck-gone alert is also on the Today card, not only the pact page, since the card's "Finish Spanish in Anki" would otherwise mislead.
- A Missed day whose deck was gone says "AnkiWeb not reached" (or the last count that day). A separate "deck gone" reason was left out.
