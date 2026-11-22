# An edit in the window can leave a Satisfied Anki day on a day the pact no longer has

Status: needs-triage
Blocked by: none

Found while checking an outside audit's finding about deleting a pact in its edit window (fixed in `deletePact`, `src/core/pacts.ts`, commit b99604d). Same root cause, in `editPact`.

## In plain words

Someone creates an Anki pact for every weekday, has already finished today's (Monday's) deck, and Pact's check marks Monday Satisfied. Still inside the 10 minutes, they edit the schedule to Tuesdays only. The edit goes through, but Monday's Satisfied stays stored for a pact that no longer has Mondays. What the owner sees depends on which screen reads that row; the stored outcome and what the rules say about that day now disagree. Probably the same happens when the edit swaps the Anki deck: a day satisfied by finishing the old deck stays satisfied for the new one.

## Evidence

- In a scenario, an Anki pact had Monday satisfied by Check now, then `editPact` changed the schedule to Tuesday only. The scenario's verdict check (`src/core/testing/verdict-check.ts`) threw: stored `{"outcome":"satisfied",...}`, verdict `{"kind":"not-the-pacts"}` for Monday. In production nothing runs that check, so the edit succeeds and the row stays.
- `editPact` removes evidence on days the new terms don't keep (`removeEvidence`), but `removeEvidence` only removes occurrence rows that have evidence. An Anki day judged Satisfied by `recordAnkiChecks` (`src/core/anki-days.ts`) has an `occurrence` row and no evidence, so it is left alone.
- The deck change was not tried.

## What to build

`editPact` drops judged occurrence rows on days the new terms don't keep, and probably on a deck change too, so the next check judges them again under the new terms.

## Acceptance criteria

- [ ] A scenario: an Anki pact's Monday is satisfied by a check in the window, an edit to Tuesday only leaves no stored outcome for Monday, and the verdict check passes.
- [ ] A scenario for an edit that changes the deck, with the behaviour decided (judged again from the new deck, or kept).
- [ ] `docs/behaviour.md` (Edit window) says what an edit does to days already judged.
- [ ] `npm run check` passes.
