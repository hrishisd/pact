# 08 Connect Oura and judge a bedtime pact

Status: ready-for-agent
Blocked by: 03

Spec stories: 10, 12, 13, 14 (Oura), 35, 36 (on arrival and at 6pm), 39, 40, 93. Rules: Judging bedtime pacts, Oura polling, Oura calls stay out of the way.

## What to build

The owner connects their Oura Ring and makes an in-bed-by pact that's judged automatically from Oura's sleep data.

### First, verify against a live response
Before writing the adapter, connect a real ring and record a real `sleep` collection response. Answer under Comments:
- Do `bedtime_start` timestamps carry a UTC offset? The night window and deadline depend on it.
- Is sleep under about 3 hours ever reported as `long_sleep`?
Use the recorded response (scrubbed) as the seed for the fake Oura source.

### Connection
- **Oura OAuth2** (`daily` scope). Tokens encrypted in the database with a key from Fly secrets. Refresh tokens are single-use: every refresh goes through one place, one at a time, and the new refresh token is stored before it's used again.
- Calls happen before the write transaction, never inside it, with a ~10 s timeout.
- **Profile → Connections:** shown only once a connection exists, listing Oura with its status.
- A Connection exists only after the owner connects.

### Create a bedtime pact
- The Oura Ring tile on Source now works. If the owner has no connection, it goes straight to connecting the ring; cancelling returns to the source picker.
- **Goal:** in-bed-by time (e.g. 12:00am). The name fills in from it ("In bed by midnight") until the owner changes it.
- **Schedule:** Fixed days only. Reviewers and Reminders text adapts (no photos to review).
- First occurrence: the first scheduled night whose in-bed-by time is at least 1 hour after creation.

### Judging
- The night of date D is decided by the first `long_sleep` period whose `bedtime_start` is between 18:00 on D and 18:00 on D+1, in the timezone Oura's timestamps carry. Naps and other types are ignored.
- Judged as soon as that period arrives: Kept if `bedtime_start` is before the deadline, otherwise Missed. A later period in the same window never changes it. The observed bedtime is stored on the occurrence.
- No qualifying period by 18:00 on D+1 → Missed, judged then.
- **Polling:** each scheduler tick (every minute) fetches sleep periods for each account with a bedtime night not judged yet. An account with nothing waiting on Oura causes no calls.
- Missed nights put the penalty on the ledger and can be excused, exactly as in tickets 03 and 07.

### Today
- **Automatic** section (grey): bedtime pacts that run tonight, with tonight's deadline and the cost.
- Last night shows as Missed while it can still be excused (ticket 07's card).

## Acceptance criteria (core scenarios)

- [ ] In bed by 00:00; `long_sleep` starting 23:40 Tue → Tue night Kept as soon as the period arrives.
- [ ] `long_sleep` starting 01:00 Wed → counts for Tue night → Missed, $ owed.
- [ ] A nap at 19:00 Tue is ignored; the `long_sleep` at 23:30 decides the night.
- [ ] First `long_sleep` at 01:10 (Missed), a second at 03:00 → stays Missed.
- [ ] No period by 18:00 Wed → Tue night Missed at 18:00.
- [ ] No calls to the Oura source once every night is judged; calls every tick while one isn't.
- [ ] Two concurrent refreshes never both use the same refresh token.
- [ ] The Oura source failing on its third call during advance to T leaves nothing half-applied; the next tick finishes the work.
- [ ] Oura timestamps in a timezone different from the account's are judged in Oura's timezone.

## Notes

- Apps Oura hasn't approved are limited to 10 users, which is enough. Check Oura's rate limit while here.

## Out of this ticket

The No Oura data card, check-now, the 3pm push and disconnection handling (09). Bedtime reminders (13).
