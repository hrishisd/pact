# Manual checks: pull to refresh

Things that need a real iPhone with Pact installed on the home screen. Steps marked **(human)** need the human's hands.

- [ ] **(human)** On Today, pull down from the top and let go past the threshold. The line under the header grows during the pull, then moves until the refresh finishes. The pull doesn't fight iOS's own bounce, and nothing else on the page moves.
- [ ] **(human)** Let go before the threshold. The content springs back and nothing reloads.
- [ ] **(human)** With an Anki day to do, finish the deck on another device and sync, then pull on Today. The Anki card shows "Checking AnkiWeb…", then leaves Today.
- [ ] **(human)** Pull on Pacts, Review and Ledgers. Each reloads, with no Oura or AnkiWeb check in the log.
- [ ] **(human)** With the phone offline, pull on Today. The bar stops and Today shows its "couldn't load" line above the cards it had. (A server that can't reach AnkiWeb is covered by tests, not here.)

## Coming back to the front

- [ ] **(human)** On Today, switch to another app for 11 minutes, then come back. The bar under the header moves once and Today reloads (a decision made meanwhile shows, and the Review badge has its new count). Come back after 2 minutes instead: nothing moves.
- [ ] **(human)** On Today at 23:59 in the profile's timezone, switch away, then come back at 00:01. The header shows the new day and Today's cards are the new day's, together.
- [ ] **(human)** Leave Pact open on Today across midnight, the screen on. At midnight the bar moves, the header turns to the new day, and the cards follow.
- [ ] **(human)** Switch away for 11 minutes, turn on Airplane Mode, and come back. The bar moves for about 3 seconds and no "couldn't load" line shows at first; it shows only after the second try fails. Repeat, turning Airplane Mode off within those 3 seconds: Today reloads with no line. No "Couldn't reach Oura" or "Couldn't reach AnkiWeb" shows either way.
- [ ] **(human)** With a sheet open (File excuse, say), switch away for 11 minutes and come back. Nothing reloads while the sheet is open; close it, and the bar moves as Today reloads.
- [ ] **(human)** On a pact's page, switch away for 11 minutes and come back: the bar moves and the page reloads, and it still can't be pulled. On a form (Edit pact or Vacation), with something typed, do the same: the bar doesn't move and what was typed stays, though the Review badge has its new count.
