# 02 Apple Health: core, upload key and upload route

Status: ready-for-agent
Blocked by: 01

Spec: `../spec.md` stories 1, 3, 4, 6, 7, 8 and the Terms, Connection, Upload and Judging sections.

## What to build

- Evidence kind `apple_health` (migration: the kind and connection CHECKs, an upload-key table or column storing the SHA-256 hash, last upload time and count on the account, a sample table keyed by account with the dedupe rule, and the night's sleep source).
- Core commands and queries behind `AccountView`: make an upload key (returns the key once), disconnect, the account's Apple Health status (connected, last upload, count), and the upload command that stores samples and judges waiting nights. Resolving an upload key to an account is a core query the server calls before `core.as(id)`.
- Judging from sessions per the spec, on the account's timezone, through ticket 01's shared bedtime logic. The source of the first sample of the deciding session is stored on the night and returned where the night's bedtime is.
- The 15:00 no-data push and reminders for Apple Health nights, worded for Apple Health ("open Pact and tap Sync now").
- Server: `POST /api/apple-health/sleep` (key in `?key=` or `Authorization: Bearer`), plain-text and JSON bodies, limits and responses per the spec. Make sure no request log prints the query string. Routes for the setup screen's commands and query, paths in `src/shared/`.
- `docs/behaviour.md` and `GLOSSARY.md` (Apple Health evidence kind, upload key, Pact Health Shortcut, sleep session / main sleep if used in code or copy).

## Acceptance criteria

- [ ] Scenarios for every case in the spec's Testing decisions.
- [ ] `app.test.ts` covers the upload route's wiring.
- [ ] `npm run check` passes; a fresh fuzz run passes, with an action for the upload command.

## Comments
