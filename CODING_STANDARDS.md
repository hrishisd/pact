# Coding standards

Read at review time. `npm run lint` enforces the mechanical rules: formatting (Prettier; a pre-commit hook formats staged files, `npm run format` does the whole repo), unused code (knip), glossary words, system time, the machine's timezone and locale, real timers and `Math.random` in the core and in tests, and `localeCompare` without a locale (`scripts/check-conventions.ts`), and shell scripts (shellcheck). This file holds the judgement calls.

## The core owns every domain rule

- Domain decisions live in `src/core/`, behind the command/query interface the server calls as an account (`core.as(id)`). The server translates HTTP to core calls and back; the client renders what the core returns. A rule decided in a route or a component is a finding.
- Commands are async and all-or-nothing: one SQLite transaction (`#command`). Anything a command sends goes into the outbox inside that transaction and is delivered after commit, never sent directly.
- Queries are synchronous reads and never write. `photo` is the one async query, because the photo store is.
- Outside effects go through the five ports (Clock, OuraSource, AnkiSource, Notifier, PhotoStore). New outside effects get a port with a fake in `src/core/testing/`.

## Results and errors

- A domain refusal is a result, `{ ok: false, reason }`, returned as HTTP 200. HTTP error codes are for malformed requests (400), no session (401) and unknown routes (404).
- Paths, the API's and the app's own pages alike (`API_PATHS`, `APP_PATHS`), and request/response types live once in `src/shared/` and both sides import them.
- Error copy says what failed: a network failure asks the user to check their connection; a server error says it's on our side (`failureText` in `src/client/api.ts`). Never blame the connection for a 500.

## Names

- Code and copy use `GLOSSARY.md` terms. The lint catches its avoided words; review catches a concept named in a new way the glossary doesn't cover yet (add it to the glossary).

## Tests

- Core behaviour is tested through `scenario()` with named times ("Mon 18:00", America/New_York) and fake ports, not by calling internals. The one exception is occurrence timing (`src/core/occurrences.ts`), which is also tested at its own interface (`occurrences.test.ts`) for calendar cases a scenario can't express, such as daylight saving changes. HTTP behaviour is tested at the `app.test.ts` seam, with Google faked at its token endpoint.
- Write the test first and watch it fail for the right reason. A test that passes before the code exists (for example, through the SPA fallback's 200) proves nothing.
- Account ids are random, so anything sorted by them comes in a different order each run. A test that fails the `n`th call to a port names one account only when that account is the only one being called.
- Asserting on `s.logs` is fine when the log line is a required output (`OPERATOR_ALERT`). `app.test.ts` may read the auth tables directly to prove a refused sign-in created no rows.

## Auth

- Better Auth's tables are prefixed `auth_*` (the core owns `account`). Better Auth creates a user only after `core.signIn` accepts the identity (`databaseHooks.user.create.before`).

## Settled decisions (don't re-flag)

- Google Fonts load from Google, matching the prototype.
- `db.prepare` per call is fine at this scale; cache statements only when profiling says so.
- Commands don't wait for outbox delivery, so a slow push service never delays a tap; the scheduler's tick does wait. Scenarios wait through their account handles (`deliveriesSettled`).
- `src/server/pages.ts` has its own hex colours: those pages are plain HTML with no shared stylesheet.
- Light theme only.
- `Notification.recipient` is the account being notified, and predates the glossary's Recipient (a penalty's payee, never notified). The type makes clear which one it is.
- The photo bytes route (`GET /api/photos/:id`) answers 404 for a photo the account may not see, not a 200 refusal: an `<img>` can't read a refusal body. The core still returns `photo-not-found`.
