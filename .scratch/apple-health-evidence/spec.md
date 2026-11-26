# Apple Health evidence kind

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Decided in a chat with the human on 2026-11-26. Research: `../fitbit-evidence/google-health-api-research.md` (the server-side Fitbit route, not taken for now).

## Problem statement

I use an Oura Ring for bedtime pacts. My brother Anish wants a bedtime pact with a Fitbit. We both use iPhones. Fitbit's own API moved to Google's Health API in November 2026, which needs a Google Cloud project, a restricted OAuth scope and an "unverified app" screen. But both the Oura app and the Google Health app (Fitbit's app since May 2026) write sleep into Apple Health on the iPhone. If Pact can read Apple Health, one evidence kind covers Oura, Fitbit, Apple Watch and any other tracker that writes sleep there. Later it can cover other Health data too, such as steps or workouts.

Reading Apple Health normally needs a native iOS app, with Apple's $99 a year program and builds that expire. Apple's Shortcuts app can read Health data and send it to a URL without any of that, so Pact uses a Shortcut.

## Solution

A fourth evidence kind, **Apple Health**. In this version it measures bedtime only, with the same terms and judging as an Oura Ring pact. The owner makes an **upload key** in Pact and builds a Shortcut called **Pact Health** on their iPhone. The Shortcut reads the last 3 days of sleep samples from Apple Health and posts them to Pact. Personal automations run it each morning, and the owner can also run it from Pact's **Sync now** button. Pact stores the samples and judges each night from them.

The human accepted that the owner controls the data: they can edit the Shortcut, or enter sleep by hand in the Health app. Pact records and shows the app each night's sleep came from, and doesn't try to detect faking.

The Oura Ring evidence kind stays. A later version may move Oura pacts onto Apple Health and retire the direct Oura connection; that needs a decision about changing a pact's evidence kind, which today never changes.

## User stories

1. As an owner with an iPhone, I want to pick Apple Health as a pact's evidence kind, so that my bedtime is judged from whatever tracker writes sleep into Health.
2. As an owner, I want a setup screen that gives me my upload URL to copy, the exact steps to build the Pact Health Shortcut, and the automations to add, so that I can set it up once in a few minutes.
3. As an owner, I want the setup screen to show when Pact last got an upload and how many sleep samples it held, so that I know my Shortcut works.
4. As an owner, I want my nights judged as Oura Ring nights are: Satisfied if my first main sleep of the night started by the in-bed-by time, Missed if later or if none arrived before the night closed.
5. As an owner, I want a **Sync now** button on Today's no-data card that runs my Shortcut, so that I can send last night's sleep when the automation didn't run (for example, the phone stayed locked).
6. As an owner, I want the same 15:00 push as Oura Ring pacts when no sleep has arrived for last night, telling me to open Pact and sync.
7. As an owner, I want to make a new upload key if I lose mine, which stops the old one working.
8. As a reviewer, I want Apple Health nights judged automatically, with excuses and change requests still coming to me, as on Oura Ring pacts, and I want to see which app each night's sleep came from.

## Implementation decisions

### Shared bedtime logic

Oura Ring and Apple Health pacts are both **bedtime pacts**: the same terms (in-bed-by time, Fixed days, no description, no due-by), the same night (opens at the start of its date, closes at 18:00 the next day), the same verdict, reminders, 15:00 no-data push and Today cards. Ticket 01 first moves this logic off Oura-only names and types onto a bedtime concept fed by a source, with no change in behaviour. The two kinds differ only in:

- **Where sleep comes from.** Oura: Pact polls Oura's API. Apple Health: the Shortcut posts samples to Pact.
- **The clock a night is read on.** Oura: Oura's reported UTC offset, with the existing earlier-clock rules. Apple Health: the account's timezone, with the existing timezone-change rules, as Camera and Anki days are. A Shortcut's dates carry the phone's current offset, not the offset where the sleep happened, so they are no good as a clock; the instants are still exact.
- **Checking now.** Oura: Today checks Oura itself. Apple Health: Pact can't reach the phone, so Today's no-data card shows **Sync now** instead, a link to `shortcuts://run-shortcut?name=Pact%20Health`.

### Terms

- Evidence kind `apple_health`, shown as "Apple Health". What it measures is fixed to bedtime in this version, so there is no new term for it yet. A later measure (steps, workouts) adds a term with bedtime as the value for existing pacts.
- Everything else as an Oura Ring pact.

### Connection

- An Apple Health connection exists while the account has an **upload key**. Making one connects; Disconnect deletes the key. There is no "Needs reconnecting" state: a wrong key is refused at upload, which the owner sees on the setup screen as no recent upload.
- The key is a random secret, stored hashed (SHA-256). It is shown once, inside the **upload URL** `https://<host>/api/apple-health/sleep?key=<key>`, when made. **Make a new key** replaces it; the old one stops working at once. The query parameter keeps setup to one paste; the server never logs the query string.
- Creating an Apple Health pact needs the connection, as Oura and Anki pacts need theirs.
- Pact stores the time of the last upload and its sample count on the account, for the setup screen and Profile.
- Disconnect keeps stored samples; they're the evidence for nights already judged.

### Upload

- `POST /api/apple-health/sleep?key=<key>` (the key may also come as `Authorization: Bearer <key>`). No session cookie. A missing or unknown key answers 401. This is the one route that authenticates by upload key.
- The body is plain text, one sample per line: `start|end|value|source`. `start` and `end` are ISO 8601 with a UTC offset or `Z` (Shortcuts' "ISO 8601" date format with time). `value` is the Sleep Analysis value as Shortcuts writes it ("In Bed", "Asleep", "Core", "Deep", "REM", "Awake", or others). `source` is the app's name ("Oura", "Google Health") and may be empty. Blank lines are ignored. The server also accepts JSON `{ "samples": [{ "start", "end", "value", "source" }] }`, in case a Shortcut builds that instead.
- A line that doesn't parse is skipped and counted; the response says how many. A body over 1 MB or with more than 5,000 lines is refused with 400.
- Samples are kept per account, deduplicated on (start, end, value, source). Samples ending more than 14 days before the upload, or starting after it, are ignored.
- The response is plain text for a person reading it in Shortcuts, e.g. "Pact got 14 sleep samples." or "Pact got 14 sleep samples and skipped 2 it couldn't read."
- The upload is a core command (one transaction): it stores the samples, records the upload, and judges the account's waiting Apple Health nights.

### Judging

- Samples whose value contains "awake" (any case) are ignored. Every other sample counts as sleep, "In Bed" included, so that a tracker that writes only In Bed (Oura) and one that writes only stages both work.
- **Sleep sessions:** the counted samples, merged where they overlap or the gap between them is at most 60 minutes. A session starts at its earliest start and ends at its latest end.
- **Main sleep:** a session at least 3 hours long. Shorter ones are naps and never decide a night.
- A night is decided by the first main sleep that starts in its window (as Oura's first long sleep): Satisfied if it starts by the in-bed-by time, Missed if later. No main sleep before the night closes means Missed at close. The bedtime, when it arrived and its source (the source of the session's earliest sample) are stored on the night, as for Oura.
- A night stays decided once settled, as for Oura: a later upload doesn't rejudge it.

### Shortcut

The human builds it once from the setup screen's steps (Pact can't make a signed Shortcut file). The steps:

1. New Shortcut, named exactly **Pact Health**.
2. **Find Health Samples** where Type is Sleep Analysis and Start Date is in the last 3 days. Sort by Start Date, oldest first.
3. **Repeat with Each** item in Health Samples.
4. Inside the repeat, a **Text** action: Repeat Item's Start Date, `|`, Repeat Item's End Date, `|`, Repeat Item's Value, `|`, Repeat Item's Source. Set both dates' format to ISO 8601 with "Include ISO 8601 Time" on.
5. After End Repeat, **Combine Text**: Repeat Results, with New Lines.
6. **Get Contents of URL**: the upload URL, Method POST, Request Body File, the Combined Text.
7. Optional: **Show Notification** with Contents of URL, to see Pact's answer.

Automations (Shortcuts → Automation → New, each set to **Run Immediately**): when the iPhone is disconnected from power; when the Oura or Google Health app is closed. Health data can't be read while the iPhone is locked, so these triggers fire while it's in use. Each run sends 3 days, so a missed run is made up by the next.

### Screens

- **Create pact:** a fourth Source tile, Apple Health ("Bedtime, from the Health app on your iPhone"). Without a connection, the next step is the Apple Health setup screen, then the pact form continues as for Oura.
- **Apple Health setup** (its own page, reached from the create flow and from Profile): make the key and show the upload URL with Copy; the Shortcut steps; the automations; a "Run Pact Health" button (the `shortcuts://` link); last upload ("Last upload 9:02am, 14 sleep samples" or "No upload yet").
- **Profile:** Apple Health under connections, with last upload, Set up / Make a new key, and Disconnect (warning how many Active pacts use it, as for Oura).
- **Today:** the Automatic card and the no-data card as for Oura, worded for Apple Health ("No Apple Health data"), with **Sync now** on the no-data card.
- **Nights:** where a bedtime is shown for an Apple Health night, show its source ("In bed 1:59am · Oura").

## Testing decisions

- Core scenarios with the fake clock: uploads arriving before, at and after the in-bed-by time; naps; Awake samples; stages with gaps; duplicates; a night with no upload Missed at close; the 15:00 no-data push; timezone of the account deciding the window; a new key invalidating the old one.
- `app.test.ts`: the upload route's wiring (401 without a key, 400 for an oversized body, a success through to the core, text and JSON bodies).
- Client tests for the setup screen and the create flow's new tile.
- The Shortcut itself is checked by hand (`manual-checks.md`).

## Out of scope

- Measures other than bedtime (steps, workouts, heart rate).
- Moving Oura pacts to Apple Health, or retiring the Oura connection.
- Detecting faked or hand-entered sleep.
- A native iOS app, background HealthKit delivery, or a distributable signed Shortcut file (a later version can show an iCloud link to the human's Shortcut instead of build steps).
- Fitbit through Google's Health API.
