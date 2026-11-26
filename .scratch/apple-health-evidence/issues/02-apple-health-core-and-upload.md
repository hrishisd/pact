# 02 Apple Health: core, upload key and upload route

Status: ready-for-agent
Blocked by: 01

Spec: `../spec.md` stories 1, 3, 4, 6, 7, 8 and the Terms, Connection, Upload and Judging sections.

## What to build

- Evidence kind `apple_health` (migration: the kind and connection CHECKs, an upload-key table or column storing the SHA-256 hash, last upload time and count on the account, a sample table keyed by account with a type column (sleep, mindful) and the dedupe rule, last-upload counts per type, and the night's sleep source).
- Core commands and queries behind `AccountView`: make an upload key (returns the key once), disconnect, the account's Apple Health status (connected, last upload, count), and the upload command that stores samples and judges waiting nights. Resolving an upload key to an account is a core query the server calls before `core.as(id)`.
- Mindful samples are stored and counted but judge nothing yet (ticket 04).
- Judging from sleep sessions per the spec, on the account's timezone, through ticket 01's shared bedtime logic. The source of the first sample of the deciding session is stored on the night and returned where the night's bedtime is.
- The 15:00 no-data push and reminders for Apple Health nights, worded for Apple Health ("open Pact and tap Sync now").
- Server: `POST /api/apple-health/samples` (key in `?key=` or `Authorization: Bearer`), plain-text and JSON bodies, limits and responses per the spec. Make sure no request log prints the query string. Routes for the setup screen's commands and query, paths in `src/shared/`.
- `docs/behaviour.md` and `GLOSSARY.md` (Apple Health evidence kind, upload key, Pact Health Shortcut, sleep session / main sleep if used in code or copy).

## Acceptance criteria

- [x] Scenarios for every case in the spec's Testing decisions.
- [x] `app.test.ts` covers the upload route's wiring.
- [x] `npm run check` passes; a fresh fuzz run passes, with an action for the upload command.

## Comments

### 2026-11-26, agent

Built; Status left as it was for the human to move. No screens (ticket 03), beyond the minimum that kept the client type-checking and honest (below).

Decisions:
- Key: 24 random bytes (`randomBytes`), base64url, 32 characters; only its hex SHA-256 is stored (`apple_health_key`, one row per account). The core builds the upload URL from `appUrl` (`BETTER_AUTH_URL`): `<appUrl>/api/apple-health/samples?key=<key>`. Making a key upserts the `connection` row (`apple_health`, always `connected`); disconnect deletes both and keeps samples and the last-upload counts.
- Route: registered before the session middleware and the 64 KB JSON limit, with its own 1 MB `bodyLimit`. The key from `?key=` wins over `Authorization: Bearer`. Every answer, 401 and 400 included, is plain text. Nothing logs the query (`onError` logs the path only; there is no request logger).
- Parsing is the server's (`readUpload`, `src/server/apple-health.ts`): a body starting with `{` is JSON, whatever its Content-Type; anything else is lines. Blank lines are ignored; a line with fewer than 3 fields (type, start, end) is unreadable and counted; missing value or source is `""`; extra `|` stay in the source. More than 5,000 non-blank lines (or JSON samples) is a 400, as is malformed JSON. A header line `type|start|end|…` is just an unknown type, skipped silently.
- The core reads dates as ISO 8601 with a time and an offset or `Z` (`+0500` accepted too); a bad date or an end before the start is counted with the unreadable lines. Times are stored in UTC, so dedupe ignores the offset written. Type matching is case-insensitive.
- Last-upload counts are the samples the upload held within the window (new or already stored), per type.
- "By the in-bed-by time" means before it, as for Oura (shared verdict): a sleep starting exactly at 00:00 is Missed for in bed by 00:00. The scenario says so.
- An upload judges the account's waiting Apple Health nights at once (`judgeNights` with an `owner`); the tick calls `judgeNights(ctx, "apple_health", …)` after Oura's, which closes nights with no upload. `SleepSessions` can be a function, asked once per account with its earliest waiting night, so only recent samples are read.
- `tellReviewersOfLaterDueTimes` includes `apple_health`: its nights are read on the account's timezone, so a move west makes the in-bed-by time later. Scenario added.
- `OccurrenceDetail` night gains `source?: string`, present only when known, so Oura's details are unchanged.
- Fuzz: action `apple-health-upload` (stages, gaps, Awake, naps, mindful, other types, too old, future, unreadable, duplicates), Apple Health in `connect-or-disconnect` (new key or disconnect), keys made at setup, and `apple_health` in `newPact` (1 in 20, as Oura).

Client stopgaps (ticket 03 should replace): `SERVICES.apple_health` in `App.tsx` (Profile row; "Reconnect" links to the setup page), a `HeartIcon`, `AppleHealthConnectionAlert` (`src/client/apple-health.tsx`) on Today and the pact page, names in PlanVacation and terms-list. Still Oura-worded for Apple Health nights: Today's `NoSleepDataCard` (and it runs Oura's check now), "No Oura data" in `presentOccurrence`, PactPage's `StageLine`, the kind step's hint.

For ticket 03:
- App path `APP_PATHS.appleHealth` = `/apple-health`.
- `GET API_PATHS.appleHealth` (`/api/apple-health`) → `AppleHealthResponse` (`{ connected, lastUpload: { at, sleepSamples, mindfulSessions } | null }`); `POST API_PATHS.appleHealthKey` (`/api/apple-health/key`) → `MakeAppleHealthKeyResponse` (`{ uploadUrl }`, shown once); `POST API_PATHS.appleHealthDisconnect` → `DisconnectAppleHealthResponse` (the profile). Client: `api.appleHealth()`, `api.makeAppleHealthKey()`, `api.disconnectAppleHealth()`.
- Profile's `Connection` has `lastUpload` for `apple_health`. Refusal `apple-health-not-connected` (copy already in `pact-form-steps.tsx`). `TodayNoSleepDataCard` and `TodayAutomaticCard` carry `evidenceKind`. Night detail `{ kind: "night", inBedAt, source? }`. `RECONNECT_TEXT.apple_health` exists.
- The Sync now URL `shortcuts://run-shortcut?name=Pact%20Health` isn't a constant yet (knip refuses unused exports); add it to `src/shared/api.ts` with its first use.
- Core: `AccountView.appleHealth()`, `makeAppleHealthKey()`, `disconnectAppleHealth()`, `uploadAppleHealth(upload)`; `PactCore.accountIdForUploadKey(key)`.

Verification: `npm run check` passes (89 files, 1742 tests). The upload flow in `docs/agents/local-dev.md` was tried with curl on a dev server with a scratch database. `scripts/fuzz-deep.sh` passes in full: seeds 1000–1199, 300 steps, 4 jobs, about 21 minutes. (Only doc comments, docs and the glossary changed after the fuzz run started; `npm run lint` ran after them.)
