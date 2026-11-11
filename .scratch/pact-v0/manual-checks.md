# Manual checks

Things that need a signed-in `flyctl`, a real Oura Ring, a real phone or real push notifications. Tick items off here; when one turns up a bug, file it under `issues/` and link it.

Who does what: the human doesn't run commands. Every command here (`scripts/prod-db.sh`, `scripts/prod-log.sh`, `flyctl`, `openssl`) is for an agent running on the human's own computer, where `flyctl` is signed in; a cloud session has no `flyctl`. Steps marked **(human)** need the human's hands: a browser signed in to Oura, the ring, or the phone. An agent walks the human through those one at a time.

Last updated 2026-11-04, after ticket 18's backend fixes (migrations 23 and 24).

## Production, as soon as possible

The deploy at 17:32Z on 2026-11-04 was the first to include PR #2. `/health` was fine afterwards, but nobody has read the logs.

- [ ] `scripts/prod-db.sh schema-version` reports 22 (migrations 21 and 22 applied).
- [ ] `scripts/prod-log.sh tail 500`: no migration failures or scheduler tick errors after 17:32Z.
- [ ] `scripts/prod-log.sh grep OPERATOR_ALERT`: nothing unexpected since the deploys of 2026-11-03 and 2026-11-04.
- [ ] **First Wednesday bills, Wed 2026-11-04 18:00 New York.** Migration 20 (deployed 2026-11-03) started billing for existing accounts then. Check that each owner with owed penalties got one "New bill" push per recipient, with the right amount, and that nobody got an overdue alert or an "owner is overdue" push for an old bill.
- [ ] A week later (Wed 2026-11-11 18:00): unpaid bills turn Overdue, the owner gets a reminder, and reviewers get one "owner is overdue" push.

## After ticket 18's deploy

`/health` reported commit `819506e` with a fresh tick at 18:22Z on 2026-11-04, so the server started after migrations 23 and 24.

- [ ] `scripts/prod-db.sh schema-version` reports 24, and `scripts/prod-log.sh grep migration` shows no failure.

## On a phone (iOS Safari, home-screen app)

The screens for tickets 10–17 were checked only in headless Chromium at 390×844.

- [ ] Push notifications arrive for each new kind: New bill, Overdue bill, Reminder, a reviewer's question and the owner's reply ("Comment" setting), a change request decided, and Connection problem. Turning each setting off stops it.
- [ ] Native date and time fields work in Create pact: due-by time, start and end dates, the One-time deadline, and reminder times (a date and a time for One-time).
- [ ] Request change: the Check view, a Change sheet per term, the diff with "Stricter" / "Needs approval" tags, the optional Why? note, Withdraw change. End pact's sheet.
- [ ] Reviewer questions: Ask from a review item, the owner's Reply from the Today alert on the item's page, and the item leaving and returning to the queue.
- [ ] Heat map: scrolls sideways to now, tapping a square shows that day, and Weekly count shows one square per week.
- [ ] Today: the bill card's Record payment opens the sheet with the bill's amount, the overdue alert, the Yesterday section, a Weekly count card with progress dots, and a One-time card due on a later date.
- [ ] Ledgers: the status line, and "On the … bill" / "Goes on the … bill" in a ledger's history, and a held penalty's "Goes on the … bill if the excuse is rejected".
- [ ] Pact page Terms (ticket 18): Name's Change and Reviewer's Add open their sheets, save at once, and work while a change request waits. The added reviewer gets a push and can decide the waiting change.

## Oura Ring (tickets 08 and 09)

Oura is off in production until its secrets are set. Connecting shows "Oura isn't set up yet".

Setup, in order:

- [ ] **(human)** At cloud.ouraring.com, open the API application for Pact (create one if there's none). Add `https://pact.hrishisd.com/api/oura/callback` as a redirect address, and copy the client id and client secret to give the agent.
- [ ] Agent: `flyctl secrets set -a pact-hrishisd OURA_CLIENT_ID=… OURA_CLIENT_SECRET=… OURA_TOKEN_KEY=$(openssl rand -base64 32)`. Setting secrets restarts the machine. Production starts without them, so there's no deploy ordering to worry about. Keep `OURA_TOKEN_KEY` only in Fly: losing it means every owner reconnects.
- [ ] Agent: `curl -sS https://pact.hrishisd.com/health` is ok, and `scripts/prod-log.sh tail 100` shows no Oura start-up error.
- [ ] **(human)** In the app: Profile, connect Oura, approve on Oura's page, land back on Pact connected.
- [ ] Connect a real ring and record one `sleep` response (scrubbed). Answer ticket 08's open questions: does `bedtime_start` carry a UTC offset, is sleep under about 3 hours ever `long_sleep`, is `end_date` inclusive, and are the authorize and token URLs right? Seed the fake Oura source from the recording.
- [ ] **(human)** Make a bedtime pact and live through a few nights: Satisfied, Missed (late), an approved excuse, and an on-time bedtime that syncs in the morning after an excuse was approved (it should be Satisfied).
- [ ] **(human)** The No Oura data card the morning after, before the ring syncs; "Checking Oura…" when Today opens; the 3pm Connection problem push if it still hasn't synced.
- [ ] **(human)** Revoke Pact's access in Oura: the connection shows Needs reconnecting, with Reconnect on Today, the pact page and Profile. Reconnect, and the waiting night is judged. Disconnect warns how many Active pacts use Oura.
- [ ] **(human)** **Open Oura link.** On an iPhone with the Oura app, tap `https://cloud.ouraring.com/app/` from a Pact page (typing it in Safari's address bar doesn't trigger universal links). If it opens the app, add the button to the No Oura data card (ticket 09).
- [ ] **Oura's clock for nights (ticket 18).** From the recorded `sleep` response: if `bedtime_start` ends in `Z` or has no offset, nights close on the account's timezone and Satisfied vs late reads the raw wall clock, which is wrong for `Z`. File a ticket if so. On a trip, check that the first night after a flight carries the new offset, and that at home the offset matches the account's timezone.
- [ ] **Oura refresh tokens (ticket 18).** Confirm Oura refuses a spent refresh token with a 400 or 401, and that 30 s is a sensible wait for its token endpoint. If you can force a refresh to time out after Oura grants it, the account should show Needs reconnecting and `scripts/prod-log.sh grep OPERATOR_ALERT` should find the "lost answer most likely spent it" line.
- Tickets 08 and 09 were set to done on 2026-11-10 with these checks still open. If one fails, file a ticket under `issues/` and link it here.

## Decisions to confirm

Choices made while building where the spec was open. Each is written up in the ticket's Comments or Notes.

- One-time (15): a One-time pact has no start date. Its deadline can be any future date. With Submit anytime off, evidence counts only on the deadline's date. With it on, evidence counts from creation until the deadline. Asked 2026-11-08: should a One-time pact also take a start date, so that with Submit anytime on, evidence counts only from that date? (An end date would be the deadline itself.)

## Confirmed

Confirmed by the human on 2026-11-08:

- Bills (10): one status line on Ledgers in priority order; held penalties show no bill.
- Change requests (11): earlier terms are kept per occurrence; ending a pact needs approval; when a pact Ends, a waiting change request is withdrawn without a notification.
- Questions (12): asking notifies only the owner; questions and replies share one "Comment" setting.
- Reminders (13): a time of day, at most 5 per pact; Camera reminders skip a day with evidence, bedtime reminders always fire; a reminder more than 15 minutes late after downtime is dropped.
- Weekly count (14): a short week adds one penalty of (days short × penalty); a rejected day can't take more evidence.
- One-time (15): approved evidence is Satisfied at the deadline, not when it's approved.
- Due-by and dates (16): a pact with an end date Ends the day after it (6pm the next day for a bedtime pact).
- Oura's clock (18): a bedtime night with no sleep yet closes at 18:00 on the UTC offset of the owner's latest Oura sleep (a nap counts), else the account's timezone. The in-bed-by time, reminders and excuse windows stay on the account's timezone. The 15:00 No Oura data push follows Oura's clock.
- Money (review fixes): an excuse approved after its penalty was paid leaves owed at $0, and the payment pays the next penalty to that recipient.

Earlier:

- Overdue spells (18, confirmed 2026-11-04): a spell ends only when approved payments have paid every bill past due. The next spell reminds the owner and tells the reviewers at once. A payment awaiting approval only pauses a spell; if it's rejected, the spell resumes, and the reviewers aren't told again within the week.
