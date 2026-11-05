# Manual checks: Anki

Things that need a real AnkiWeb account, AnkiMobile or the Mac. Steps marked **(human)** need the human's hands.

## After ticket 03

- [ ] **(human)** Set the Fly secret `ANKI_TOKEN_KEY`: `flyctl secrets set -a pact-hrishisd ANKI_TOKEN_KEY=$(openssl rand -base64 32)`. Setting it restarts the machine. Production starts without it, with Anki off. Keep it only in Fly: losing it means every owner reconnects.
- [ ] The Docker image builds, and on Fly `/opt/anki/bin/python3 -c "import anki"` works. The session that built ticket 03 had no Docker daemon, so the build is untried.
- [ ] **(human)** Connect AnkiWeb in Pact with the real account, the first real login. The connection shows Connected, and `anki_connection` holds a host key but no password.
- [ ] The Goal step's deck tree matches the deck list in AnkiMobile, subdecks included.
- [ ] The counts Pact shows for a deck match AnkiMobile's deck list at the same moment.
- [ ] **(human)** Finish the deck on the iPhone and let it sync. Today shows the day Satisfied within 10 minutes, or at once after reopening Today.
- [ ] **(human)** After a day of Pact checking, AnkiMobile and the Mac still sync normally, with no full-sync prompt.
- [ ] `scripts/prod-log.sh grep OPERATOR_ALERT` shows no Anki protocol errors.

## After ticket 04

- [ ] **(human)** Change the AnkiWeb password. Pact marks the connection Needs reconnecting with one push, and Reconnect works.
