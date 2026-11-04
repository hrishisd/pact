# 18 Gaps left after tickets 08 and 10–17

Status: ready-for-agent
Blocked by: none

Things the shipped tickets left out or got slightly wrong, collected from the build notes and the 2026-11-04 code review. Each item is small. Triage may split them into tickets or close them.

## Behavior that misses the spec

- **No rename or add-reviewer while a change request waits.** The core allows both, but the pact page hides Request change while one waits (ticket 11). Reminders have their own Change button (ticket 13); the name and reviewers don't. Code: `src/client/PactPage.tsx`.
- **Held penalties show no bill marker.** Spec story 80 says held penalties are marked with their bill too. They show only "Held while an excuse waits for approval" (ticket 10). Code: `src/client/Ledgers.tsx` `PenaltyRow`, `LedgerPenalty.bill` in `src/shared/types.ts`.
- **Oura nights use the account's timezone.** The spec says bedtime pacts use the timezone in Oura's timestamps. The night window and its 18:00 Missed cutoff use the account's timezone; only the kept/late comparison uses Oura's clock. Code: `src/core/occurrences.ts` (~321), `src/core/core.ts` bedtime judging.

## Rough edges

- **Ledgers status line.** One line in priority order (overdue, then bill due, then awaiting approval). The prototype joined several with " · ". Code: `src/client/Ledgers.tsx` `StatusLine`.
- **Bill card countdown.** Reads "45h 20m" for a bill due in two days; "1d 21h" would read better. Code: `src/client/Today.tsx`.
- **Oura option in Create pact when Oura isn't set up.** It isn't disabled; the owner learns only after tapping Connect ("Oura isn't set up yet"). Needs the server to tell the client whether Oura is configured. Code: `src/client/CreatePact.tsx`, `src/server/app.ts`.
- **Overdue alert wording.** "X and Y have been told" shows before the first reviewer push has gone out. Code: `src/client/Today.tsx` `OverdueAlert`.
- **Overdue reminder timestamps carry across spells.** If an owner clears an overdue bill and goes overdue again within 24 hours, the new spell gets no immediate owner reminder. Code: `src/core/core.ts` `#remindOverdue`, `overdue_notice`.

## Robustness

- **Oura refresh-token loss.** If Oura accepts a refresh but the response is lost (timeout, 5xx after the grant), the new token pair is never stored and the single-use refresh token is dead; the account reads as disconnected until the owner reconnects. A connect during an in-flight refresh can also be overwritten. Code: `src/core/oura.ts` (~198–219).

## Tests

- No dedicated test for a Sunday-night bedtime penalty landing on Wednesday's bill (judged Mon 18:00, window closes exactly Wed 18:00). Code: `src/core/bills.test.ts`.
- Some scenarios in tickets 15 and 16 were written after the code and never seen failing.

## Triage (2026-11-04)

Kept in this ticket, to build now:

- Backend: Oura refresh-token loss and the connect race; Oura's timezone for nights; the overdue reminder across spells; the Sunday-night bedtime bill test; seeing the ticket 15 and 16 scenarios fail.
- Screens (the human asked for screenshots instead of a prototype): rename and add a reviewer while a change request waits; the bill marker on held penalties.

Moved out:

- Bill card countdown, the Oura option when Oura isn't set up, and the overdue alert wording go to ticket 19. They change what the owner sees and weren't asked for in this round.
- Ledgers status line: closed. One line in priority order is what spec story 80 says ("one status line only when ..."), and it's already listed under Decisions to confirm in `manual-checks.md`.

## Comments

- 2026-11-04: **Oura's timezone for nights: built.** A night with no period yet closes at 18:00 the next day at the UTC offset of the latest sleep Oura reported for the owner (kept on `account.oura_latest_bedtime_start`, migration 23), or in the account's timezone when Oura hasn't reported a timestamp with an offset, or when that offset is the timezone's own at that moment (the owner was at home, so daylight saving changes still land right). The night's window start (when polling begins), its Missed cutoff, the 15:00 push, Today's No Oura data countdown and an Ended pact's end all read the same clock. The in-bed-by due time (Today's "Tonight" countdown, the first night) and reminders stay on the account's clock; Kept vs late already used Oura's wall clock. Scenarios: `bedtime.test.ts` ("a traveller's night closes at 18:00 on Oura's clock"), `oura-no-data.test.ts` (the traveller's 15:00 push), `occurrences.test.ts`.
