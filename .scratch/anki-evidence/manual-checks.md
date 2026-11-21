# Manual checks: Anki

Things that need a real AnkiWeb account, AnkiMobile or the Mac. Steps marked **(human)** need the human's hands.

## After ticket 03

- [ ] **(human)** Set the Fly secret `ANKI_TOKEN_KEY`: `flyctl secrets set -a pact-hrishisd ANKI_TOKEN_KEY=$(openssl rand -base64 32)`. Setting it restarts the machine. Production starts without it, with Anki off. Keep it only in Fly: losing it means every owner reconnects.
- [x] The Docker image builds and deploys. 2026-11-05: CI run 88 built 48c908f on Fly, and `/health` reported it live with a fresh tick, so migration 26 ran.
- [ ] On Fly, `/opt/anki/bin/python3 -c "import anki"` works: `flyctl ssh console -a pact-hrishisd -C '/opt/anki/bin/python3 -c "import anki; print(anki.version)"'`, which should print 26.9.4. Not yet run: the session that deployed had no `flyctl`.
- [ ] `scripts/prod-log.sh tail 200` shows no errors since the 2026-11-05 deploy. Not yet run, for the same reason.
- [ ] **(human)** Connect AnkiWeb in Pact with the real account, the first real login. The connection shows Connected, and `anki_connection` holds a host key but no password.
- [ ] The Goal step's deck tree matches the deck list in AnkiMobile, subdecks included.
- [ ] The counts Pact shows for a deck match AnkiMobile's deck list at the same moment.
- [ ] **(human)** Finish the deck on the iPhone and let it sync. Today shows the day Satisfied within 10 minutes, or at once after reopening Today.
- [ ] **(human)** After a day of Pact checking, AnkiMobile and the Mac still sync normally, with no full-sync prompt.
- [ ] The log shows a collection download only after the phone synced, not on every check. If every check downloads, reading the deck tree marks the local copy as changed (untested without AnkiWeb).
- [ ] `scripts/prod-log.sh grep OPERATOR_ALERT` shows no Anki protocol errors. If AnkiWeb has an outage, see whether its 5xx answers raise a protocol alert. If they do, `anki_check.py` should map them to "network".

## After ticket 04

- [ ] **(human)** Change the AnkiWeb password. Pact marks the connection Needs reconnecting with one push, and Reconnect works.
  It checks that real AnkiWeb answers a stale host key with an auth error (`anki_check.py` maps it to "disconnected"). If it answers something else, the log shows a failed check or an `OPERATOR_ALERT` every 10 minutes instead.
- [ ] Delete a test deck that an Anki pact is on, in Anki, and sync. The pact page and Today show "The … deck is gone from Anki" within 10 minutes.
- [ ] Reconnect from Profile and from the Today alert on a phone: the email and password fields fill from the password manager.

## After ticket 05

- [ ] After the deploy, once the phone has synced and Pact has downloaded again, `/data/anki/` holds a much smaller copy (the owner's 88.6 MB collection pruned to about 25 MB), and `scripts/prod-log.sh grep OPERATOR_ALERT` shows no protocol error naming the change stamp.
- [ ] The log still shows a download only after the phone synced, not at every check: a pruned copy still matches AnkiWeb's change stamp.
- [ ] On every bump of the anki package: on a copy of a real collection, compare `anki_check.py`'s counts before and after `prune` at the same times, and check that `prune` doesn't raise (it fails if the bumped package changes the change stamp).
