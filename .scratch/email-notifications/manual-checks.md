# Manual checks: Email notifications

Things that need a real Gmail account, Fly secrets and a phone. Steps marked **(human)** need the human's hands. Tick items off here; when one turns up a bug, file it under `issues/` and link it.

## Before the first ticket

- [x] **(human)** Create an app password on the Gmail account Pact sends from. A new account made just for Pact was refused one ("The setting you are looking for is not available for your account"), so it's the operator's own account.
- [x] **(human)** Store the address and the app password as Fly secrets `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` (`fly secrets set ... --stage`). Production refuses to start without them, so the deploy's secrets check stops a deploy of ticket 01 until both are set.
- [ ] Check that the Fly machine can reach `smtp.gmail.com` on port 587.

## After the Gmail adapter lands

- [ ] **(human)** An operator alert email arrives at the `OPERATOR_EMAIL` address in Gmail on the iPhone, and isn't in spam.

## After the daily summary lands

- [ ] **(human)** A friend turns on the daily summary. The next 09:00 with an item waiting over 24 hours, it reaches their inbox, not spam, and tapping "Open your Review Queue" opens Review in Safari (signing in with Google the first time).
- [ ] **(human)** A friend's reply to a daily summary lands in the Pact Gmail account's inbox.
