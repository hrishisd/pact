# Manual checks

Things only a person at a computer or phone can check: a signed-in `flyctl`, a real Oura Ring, a real phone and real push notifications. Tick items off here; when one turns up a bug, file it under `issues/` and link it.

Last updated 2026-11-04, after PR #3 (production commit `0ecbc7d`).

## Production, as soon as possible

The deploy at 17:32Z on 2026-11-04 was the first to include PR #2. `/health` was fine afterwards, but nobody has read the logs.

- [ ] `scripts/prod-db.sh schema-version` reports 22 (migrations 21 and 22 applied).
- [ ] `scripts/prod-log.sh tail 500`: no migration failures or scheduler tick errors after 17:32Z.
- [ ] `scripts/prod-log.sh grep OPERATOR_ALERT`: nothing unexpected since the deploys of 2026-11-03 and 2026-11-04.
- [ ] **First Wednesday bills, Wed 2026-11-04 18:00 New York.** Migration 20 (deployed 2026-11-03) started billing for existing accounts then. Check that each owner with owed penalties got one "New bill" push per recipient, with the right amount, and that nobody got an overdue alert or an "owner is overdue" push for an old bill.
- [ ] A week later (Wed 2026-11-11 18:00): unpaid bills turn Overdue, the owner gets a reminder, and reviewers get one "owner is overdue" push.

## On a phone (iOS Safari, home-screen app)

The screens for tickets 10–17 were checked only in headless Chromium at 390×844.

- [ ] Push notifications arrive for each new kind: New bill, Overdue bill, Reminder, a reviewer's question and the owner's reply ("Comment" setting), a change request decided, and Connection problem. Turning each setting off stops it.
- [ ] Native date and time fields work in Create pact: due-by time, start and end dates, the One-time deadline, and reminder times (a date and a time for One-time).
- [ ] Request change: the Check view, a Change sheet per term, the diff with "Stricter" / "Needs approval" tags, the optional Why? note, Withdraw change. End pact's sheet.
- [ ] Reviewer questions: Ask from a review item, the owner's Reply from the Today alert on the item's page, and the item leaving and returning to the queue.
- [ ] Heat map: scrolls sideways to now, tapping a square shows that day, and Weekly count shows one square per week.
- [ ] Today: the bill card's Record payment opens the sheet with the bill's amount, the overdue alert, the Yesterday section, a Weekly count card with progress dots, and a One-time card due on a later date.
- [ ] Ledgers: the status line, and "On the … bill" / "Goes on the … bill" in a ledger's history.

## Oura Ring (tickets 08 and 09)

Oura is off in production until its secrets are set. Connecting shows "Oura isn't set up yet".

- [ ] Set the Fly secrets `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` and `OURA_TOKEN_KEY` (`openssl rand -base64 32`). Production starts without them, so there's no deploy ordering to worry about.
- [ ] Add `https://pact.hrishisd.com/api/oura/callback` as a redirect address in the Oura app settings.
- [ ] Connect a real ring and record one `sleep` response (scrubbed). Answer ticket 08's open questions: does `bedtime_start` carry a UTC offset, is sleep under about 3 hours ever `long_sleep`, is `end_date` inclusive, and are the authorize and token URLs right? Seed the fake Oura source from the recording.
- [ ] Make a bedtime pact and live through a few nights: Kept, Missed (late), an approved excuse, and an on-time bedtime that syncs in the morning after an excuse was approved (it should be Kept).
- [ ] The No Oura data card the morning after, before the ring syncs; "Checking Oura…" when Today opens; the 3pm Connection problem push if it still hasn't synced.
- [ ] Revoke Pact's access in Oura: the connection shows Needs reconnecting, with Reconnect on Today, the pact page and Profile. Reconnect, and the waiting night is judged. Disconnect warns how many Active pacts use Oura.
- [ ] **Open Oura link.** On an iPhone with the Oura app, tap `https://cloud.ouraring.com/app/` from a Pact page (typing it in Safari's address bar doesn't trigger universal links). If it opens the app, add the button to the No Oura data card (ticket 09).
- [ ] **Oura's clock for nights (ticket 18).** From the recorded `sleep` response: if `bedtime_start` ends in `Z` or has no offset, nights close on the account's timezone and Kept vs late reads the raw wall clock, which is wrong for `Z`. File a ticket if so. On a trip, check that the first night after a flight carries the new offset, and that at home the offset matches the account's timezone.
- [ ] **Oura refresh tokens (ticket 18).** Confirm Oura refuses a spent refresh token with a 400 or 401, and that 30 s is a sensible wait for its token endpoint. If you can force a refresh to time out after Oura grants it, the account should show Needs reconnecting and `scripts/prod-log.sh grep OPERATOR_ALERT` should find the "lost answer most likely spent it" line.
- [ ] Then mark tickets 08 and 09 done.

## Decisions to confirm

Choices made while building where the spec was open. Each is written up in the ticket's Comments or Notes; ticket 18 lists the known gaps.

- Bills (10): one status line on Ledgers in priority order; held penalties show no bill.
- Overdue spells (18): a spell ends only when approved payments have paid every bill past due. The next spell reminds the owner and tells the reviewers at once. A payment awaiting approval only pauses a spell; if it's rejected, the spell resumes, and the reviewers aren't told again within the week.
- Change requests (11): earlier terms are kept per occurrence; ending a pact needs approval; when a pact Ends, a waiting change request is withdrawn without a notification.
- Questions (12): asking notifies only the owner; questions and replies share one "Comment" setting.
- Reminders (13): a time of day, at most 5 per pact; Camera reminders skip a day with evidence, bedtime reminders always fire; a reminder more than 15 minutes late after downtime is dropped.
- Weekly count (14): a short week adds one penalty of (days short × penalty); a rejected day can't take more evidence.
- One-time (15): no start or end dates; approved evidence is Kept at the deadline.
- Due-by and dates (16): a pact with an end date Ends the day after it (6pm the next day for a bedtime pact).
- Oura's clock (18): a bedtime night with no sleep yet closes at 18:00 on the UTC offset of the owner's latest Oura sleep (a nap counts), else the account's timezone. The in-bed-by time, reminders and excuse windows stay on the account's timezone. The 15:00 No Oura data push follows Oura's clock.
- Money (review fixes): an excuse approved after its penalty was paid leaves owed at $0, and the payment pays the next penalty to that recipient.
