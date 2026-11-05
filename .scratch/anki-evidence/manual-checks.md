# Manual checks: Anki

Things that need a real AnkiWeb account, AnkiMobile or the Mac. Steps marked **(human)** need the human's hands.

## After ticket 03

- [ ] **(human)** Connect AnkiWeb in Pact with the real account. The connection shows Connected, and `anki_connection` holds a host key but no password.
- [ ] The Goal step's deck tree matches the deck list in AnkiMobile, subdecks included.
- [ ] The counts Pact shows for a deck match AnkiMobile's deck list at the same moment.
- [ ] **(human)** Finish the deck on the iPhone and let it sync. Today shows the day Satisfied within 10 minutes, or at once after reopening Pact.
- [ ] **(human)** After a day of Pact checking, AnkiMobile and the Mac still sync normally, with no full-sync prompt.
- [ ] `scripts/prod-log.sh grep OPERATOR_ALERT` shows no Anki protocol errors.

## After ticket 04

- [ ] **(human)** Change the AnkiWeb password. Pact marks the connection Needs reconnecting with one push, and Reconnect works.
