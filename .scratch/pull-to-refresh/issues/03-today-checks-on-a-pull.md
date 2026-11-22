# 03 A pull on Today checks Oura and AnkiWeb

Status: done
Blocked by: 01, 02

Spec: `../spec.md`, "What a pull does", "Feedback on the cards" and "A check that can't reach the service".

## What to build

Today's refresh sends check Oura now and check Anki now together, whatever cards it shows (skipping a service whose connection needs reconnecting), then reloads Today. The bar runs until both checks and the reload have answered.

- The cards show each check as they do now: the No Oura data card's "Checking…" chip and "Checking Oura…", the Anki card's "Checking AnkiWeb…".
- A pull while an automatic check of that service is running waits for that check rather than sending another.
- When a check sent by a pull answers unreachable, the No Oura data card says "Couldn't reach Oura. Pact will try again." and the Anki card says "Couldn't reach AnkiWeb. Pact will try again.", under its last check. The line stays while Today is open, until a later check of that service answers ok. Automatic checks never show it.

## Acceptance criteria

- [x] A pull on Today sends both checks, then reloads Today (`Today.test.tsx`).
- [x] A pull skips a service whose connection needs reconnecting.
- [x] A pull whose Anki check answers unreachable shows the line on the Anki card; the next check that answers ok removes it. The same for Oura on the No Oura data card.
- [x] An automatic check that answers unreachable shows nothing.
- [x] `docs/behaviour.md` describes Today's pull.

## Comments

### 2026-11-22: built

Built on branch `claude/dazzling-noether-u1w82i`, with the other pull to refresh tickets, for one pull request. Status stays until it is on `main`.
