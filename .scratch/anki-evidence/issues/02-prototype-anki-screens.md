# 02 Prototype the Anki screens

Status: ready-for-agent
Type: prototype
Blocked by: 01

Follows `docs/agents/prototype-first.md`: a throwaway HTML file on branch `prototype/anki-evidence`, cut from main in a worktree, using main's real styles and the glossary's words (Satisfied, not Kept). Spec: `../spec.md` (Screens).

## Moments to make clickable

- **Source:** the third tile, Anki, with an icon and one line of explanation.
- **Connect AnkiWeb:**
  - the email and password fields
  - the terms-of-service line ("AnkiWeb doesn't officially allow other apps to sign in, and could suspend your account.")
  - what Pact keeps, which is not the password
  - the wrong-password state and the AnkiWeb-unreachable state
- **Goal, the deck picker:** a realistic deck tree with about 12 decks, two levels of subdecks, and "Default" present. Show the picked deck's current counts, so the owner sees what "finished" means today. The pact's name fills in from the deck until changed.
- **Today, the Anki card in each state:**
  - Open: "42 cards left · checked 9:10pm" plus "Due at midnight · 2h 50m".
  - Checking AnkiWeb…
  - Just finished, after which the card leaves Today as Satisfied cards do.
  - Missed: "12 cards left at 11:50pm" or "AnkiWeb not reached".
  - The Needs reconnecting alert with Reconnect AnkiWeb.
  - The deck-deleted alert.
- **Reminder push copy:** "Spanish: 42 cards left, due at midnight".

## Options to compare

- **Deck picker:** an indented tree with every deck visible, against drilling down one level at a time.
- **Today card counts:** one total ("42 cards left") against Anki's own three columns (New 10 · Learn 2 · Due 30).

## Acceptance criteria

- [ ] Every moment and option above renders at phone width, and every button does what its option claims.
- [ ] Published as a private Artifact, with screenshots of each moment sent in the chat and a recommendation.
- [ ] After the human picks, `../spec.md` (Screens) and ticket 03 are updated before implementation starts.

## Comments
