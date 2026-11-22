# Manual checks: pull to refresh

Things that need a real iPhone with Pact installed on the home screen. Steps marked **(human)** need the human's hands.

- [ ] **(human)** On Today, pull down from the top and let go past the threshold. The line under the header grows during the pull, then moves until the refresh finishes. The pull doesn't fight iOS's own bounce, and nothing else on the page moves.
- [ ] **(human)** Let go before the threshold. The content springs back and nothing reloads.
- [ ] **(human)** With an Anki day to do, finish the deck on another device and sync, then pull on Today. The Anki card shows "Checking AnkiWeb…", then leaves Today.
- [ ] **(human)** Pull on Pacts, Review and Ledgers. Each reloads, with no Oura or AnkiWeb check in the log.
- [ ] **(human)** With the phone offline, pull on Today. The bar stops and Today shows its "couldn't load" line above the cards it had. (A server that can't reach AnkiWeb is covered by tests, not here.)
