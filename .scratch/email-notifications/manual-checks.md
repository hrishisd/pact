# Manual checks: Email notifications

Things that need a real Gmail account, Fly secrets and a phone. Steps marked **(human)** need the human's hands. Tick items off here; when one turns up a bug, file it under `issues/` and link it.

## Before the first ticket

- [ ] **(human)** Create a Gmail account just for Pact. Turn on 2-Step Verification, then create an app password for it.
- [ ] **(human)** Store the address and the app password as Fly secrets. The ticket that adds the Gmail adapter names them.
- [ ] Check that the Fly machine can reach `smtp.gmail.com` on port 587.

## After the Gmail adapter lands

- [ ] **(human)** An operator alert email arrives at the `OPERATOR_EMAIL` address in Gmail on the iPhone, and isn't in spam.

## After the daily emails land

- [ ] **(human)** A friend turns on the daily Review Queue email. The next 09:00 with an item waiting over 24 hours, it reaches their inbox, not spam, and tapping an item opens it in Safari (signing in with Google the first time).
- [ ] **(human)** A friend's reply to a daily email lands in the Pact Gmail account's inbox.
