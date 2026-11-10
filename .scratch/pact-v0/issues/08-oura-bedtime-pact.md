# 08 Connect Oura and judge a bedtime pact

Status: done
Blocked by: 03

Built and on `main`, deployed with Oura switched off. It hasn't been tried against real Oura data; those checks are in `.scratch/pact-v0/manual-checks.md` (Oura Ring section). Original list:
- [ ] Set the Fly secrets `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` and `OURA_TOKEN_KEY` (`openssl rand -base64 32`). Production now starts without them, with Oura off.
- [ ] Add `https://pact.hrishisd.com/api/oura/callback` as a redirect address in the Oura app.
- [ ] Connect a real ring and record a `sleep` response. Answer the open questions under Comments (UTC offset, short `long_sleep`, `end_date`, Oura's URLs), and seed the fake from it.
- [x] Decide whether a failing Oura call should stop the whole tick or skip only that account's nights. Decided in the 2026-11-04 review: it skips only that account, for that tick.

Spec stories: 10, 12, 13, 14 (Oura), 35, 36 (on arrival and at 6pm), 39, 40, 93. Rules: Judging bedtime pacts, Oura polling, Oura calls stay out of the way.

Settled with the prototype `.scratch/pact-v0/prototype/oura.prototype.html`: a Connect step before Oura's page (1B), the phone's own time field for the in-bed-by time (2A), a tonight-only Automatic card (3A), and a Missed card that says when Oura saw the owner get into bed.

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
- The Oura Ring tile on Source now works. If the owner has no connection, the next step is **Connect your Oura Ring**: "Oura asks you to sign in and allow Pact." and "Pact checks when your main sleep each night starts. Your reviewers see only Kept or Missed and that time.", with Back and **Connect Oura**. Connect Oura opens Oura's page; allowing it returns to the form at Goal, and cancelling there returns to the source picker. With a connection, the tile goes straight to Goal.
- **Goal:** "In bed by", the phone's own time field (e.g. 12:00am), with "Late is when your ring says you got into bed after this." Then Name, which fills in from the time ("In bed by midnight", "In bed by 11:30pm", "In bed by 1am") until the owner changes it.
- **Schedule** says "Each night is judged when your ring syncs. A night with no sleep data by 6pm the next day counts as missed." **Reviewers** says "Your ring decides each night, so there are no photos to review. Reviewers decide on your excuses." **Check** names the first night: "The first night is Mon Nov 2, in bed by 12:00am."
- **Schedule:** Fixed days only. Reviewers and Reminders text adapts (no photos to review).
- First occurrence: the first scheduled night whose in-bed-by time is at least 1 hour after creation.

### Judging
- The night of date D is decided by the first `long_sleep` period whose `bedtime_start` is between 18:00 on D and 18:00 on D+1, in the timezone Oura's timestamps carry. Naps and other types are ignored.
- Judged as soon as that period arrives: Kept if `bedtime_start` is before the deadline, otherwise Missed. A later period in the same window never changes it. The observed bedtime is stored on the occurrence.
- No qualifying period by 18:00 on D+1 → Missed, judged then.
- **Polling:** each scheduler tick (every minute) fetches sleep periods for each account with a bedtime night not judged yet. An account with nothing waiting on Oura causes no calls.
- Missed nights put the penalty on the ledger and can be excused, exactly as in tickets 03 and 07.

### Today
- **Automatic** section (grey): bedtime pacts that run tonight, one card each with an "Automatic" chip, the cost, and "Tonight, in bed by 12:00am · 3h 12m". A night already Kept isn't shown.
- Last night shows as Missed while it can still be excused (ticket 07's card), with why: "Tue Nov 3 night · in bed at 1:00am", or "· no sleep data by 6pm".
- The pact page's terms add "In bed by 12:00am", and Profile lists the connection as "Oura Ring · Connected Mon Nov 2".

## Acceptance criteria (core scenarios)

- [x] In bed by 00:00; `long_sleep` starting 23:40 Tue → Tue night Kept as soon as the period arrives.
- [x] `long_sleep` starting 01:00 Wed → counts for Tue night → Missed, $ owed.
- [x] A nap at 19:00 Tue is ignored; the `long_sleep` at 23:30 decides the night.
- [x] First `long_sleep` at 01:10 (Missed), a second at 03:00 → stays Missed.
- [x] No period by 18:00 Wed → Tue night Missed at 18:00.
- [x] No calls to the Oura source once every night is judged; calls every tick while one isn't.
- [x] Two concurrent refreshes never both use the same refresh token.
- [x] The Oura source failing on its third call during advance to T leaves nothing half-applied; the next tick finishes the work.
- [x] Oura timestamps in a timezone different from the account's are judged in Oura's timezone.

## Notes

- Apps Oura hasn't approved are limited to 10 users, which is enough. Check Oura's rate limit while here.

## Out of this ticket

The No Oura data card, check-now, the 3pm push and disconnection handling (09). Bedtime reminders (13).

## Comments

**Built on `claude/admiring-franklin-7zbf41` (2026-11-02).** Every acceptance criterion has a scenario in `src/core/bedtime.test.ts`, and the refresh one is also in `src/core/oura.test.ts`.

**Not verified against a live response yet.** That needs a real ring connected to the deployed app. The fake is shaped from Oura's documented `sleep` fields. The adapter reads `bedtime_start` on its own wall clock, which is right if the timestamps carry Oura's offset (as `ports.ts` assumes). If they come back in UTC, nights will be judged on UTC time, which is wrong. Still open:
- Does `bedtime_start` carry an offset?
- Is sleep under about 3 hours ever reported as `long_sleep`?
- Is `end_date` inclusive? Each request asks for the night's date through two days later, so either way works.
- Are Oura's authorize and token URLs `cloud.ouraring.com/oauth/authorize` and `api.ouraring.com/oauth/token`? They're configurable in `src/core/oura.ts`.

**Rate limit.** A third-party integration page (nango.dev) gives 5000 requests per 5 minutes. Oura's OpenAPI spec says there are per-token and per-app limits and that approved apps have none. Polling once a minute per account with a night waiting is far below either.

**Decided while building:**
- An approved excuse beats a late bedtime, and an on-time bedtime beats an excuse, as approved photos do for Camera pacts.
- A failed Oura call fails the whole tick, so nothing is half-applied, and the next tick retries. (Changed 2026-11-04: a failure now affects only that account's nights for that tick.)
- Connecting needs `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` and `OURA_TOKEN_KEY` in production. Development without them connects at once and reads sleep from `oura-sleep.json` next to the database.

- 2026-11-10 (design review): Verified every acceptance criterion has a passing scenario on `main` (`src/core/bedtime.test.ts`, refreshes in `src/core/oura.test.ts`); set to done under the closing rule in `docs/agents/issue-tracker.md`, with the real-ring, secrets and redirect checks left in `manual-checks.md` (Oura Ring section).
