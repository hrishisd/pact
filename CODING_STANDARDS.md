# Coding standards

Read before writing code and at review time. `npm run lint` enforces the mechanical rules: formatting (Prettier; a pre-commit hook formats staged files, `npm run format` does the whole repo), unused code (knip), glossary words, system time, the machine's timezone and locale, real timers and `Math.random` in the core and in tests, `localeCompare` without a locale, and a `.test.ts` beside a same-name `.test.tsx`, which `tsc` would skip (`scripts/check-conventions.ts`), and shell scripts (shellcheck). This file holds the judgement calls.

## The core owns every domain rule

- Domain decisions live in `src/core/`, behind the command/query interface the server calls as an account (`core.as(id)`). The server translates HTTP to core calls and back; the client renders what the core returns. A rule decided in a route or a component is a finding.
- Commands are async and all-or-nothing: one SQLite transaction (`#command`). Anything a command sends goes into the outbox inside that transaction and is delivered after commit, never sent directly.
- Queries are synchronous reads and never write. `photo` is the one async query, because the photo store is.
- Outside effects go through the six ports (Clock, OuraSource, AnkiSource, Notifier, Mailer, PhotoStore). New outside effects get a port with a fake in `src/core/testing/`.

## Results and errors

- A domain refusal is a result, `{ ok: false, reason }`, returned as HTTP 200. HTTP error codes are for malformed requests (400), no session (401), unknown routes (404) and a handler that threw (500 `server-error`, logged by `app.onError`).
- Paths, the API's and the app's own pages alike (`API_PATHS`, `APP_PATHS`), and request/response types live once in `src/shared/` and both sides import them.
- Error copy says what failed: a network failure asks the user to check their connection; a server error says it's on our side (`failureText` in `src/client/api.ts`). Never blame the connection for a 500.

## Names

- Code and copy use `GLOSSARY.md` terms. The lint catches its avoided words; review catches a concept named in a new way the glossary doesn't cover yet (add it to the glossary).

## Tests

- Core behaviour is tested through `scenario()` with named times ("Mon 18:00", America/New_York) and fake ports, not by calling internals. The one exception is occurrence timing (`src/core/occurrences.ts`), which is also tested at its own interface (`occurrences.test.ts`) for calendar cases a scenario can't express, such as daylight saving changes. The second is the verdict function (`verdictOf`, `src/core/verdict.ts`), tested at its own interface (`verdict.test.ts`) because the combinations of evidence, covers, automatic data and ends are many; every scenario also checks after each command and tick that stored outcomes match it (`src/core/testing/verdict-check.ts`). HTTP behaviour is tested at the `app.test.ts` seam, with Google faked at its token endpoint.
- The randomised test (`src/core/fuzz.test.ts`) applies seeded random runs of commands and ticks to a scenario and checks named invariants after each one (`src/core/testing/fuzz-invariants.ts`); it also checks that one tick and many ticks to the same time leave every query answering the same. `npm test` runs a few fixed seeds. Run fresh seeds after a change to judging, money, covers or change requests: `FUZZ_SEEDS=1000-1199 FUZZ_STEPS=300 npx vitest run src/core/fuzz.test.ts`. A failure prints the seed, the invariant and the shortest run found that breaks it. A new command gets an action in `src/core/testing/fuzz.ts`; a new rule that must always hold gets an invariant. A failure that is a ticketed bug goes in `KNOWN` until the fix.
- Client components are tested in `*.test.tsx` files, which run in jsdom (Vitest's `dom` project; every other test runs in Node). They render a screen with `renderWithUser` and answer its api calls with `stubApi` (`src/client/testing/render.tsx`); a call left unstubbed throws.
- Write the test first and watch it fail for the right reason. A test that passes before the code exists (for example, through the SPA fallback's 200) proves nothing.
- Account ids are random in production (scenarios make them rise in creation order); never depend on id order. A test that fails the `n`th call to a port names one account only when that account is the only one being called.
- Asserting on `s.logs` is fine when the log line is a required output (`OPERATOR_ALERT`). `app.test.ts` may read the auth tables directly to prove a refused sign-in created no rows.
- Server tests check route wiring: one test per route for a shape refused with 400, a refusal returned as 200, and one success through to the core, using `objectContaining` on core output. Domain flows are tested in the core.

## Auth

- Better Auth's tables are prefixed `auth_*` (the core owns `account`). Better Auth creates a user only after `core.signIn` accepts the identity (`databaseHooks.user.create.before`).

## Docs

- Point at code by file and symbol name (`editPact` in `pacts.ts`), never by line number. A line number goes stale on any edit above it, and nothing checks it.

## Settled decisions (don't re-flag)

- Google Fonts load from Google, matching the prototype.
- `ctx.one` and `ctx.all` keep one prepared statement per SQL text (`src/core/context.ts`), because profiling put re-preparing at about 37% of an idle tick (683 prepares a tick) and the cache cut `vacations.test.ts` from about 20 s to 11 s; elsewhere `db.prepare` per call is fine at this scale, and other statements are cached only when profiling says so.
- Commands don't wait for outbox delivery, so a slow push service never delays a tap; the scheduler's tick does wait. Scenarios wait through their account handles (`deliveriesSettled`).
- `src/server/pages.ts` has its own hex colours: those pages are plain HTML with no shared stylesheet.
- Light theme only.
- `Notification.recipient` is the account being notified, and predates the glossary's Recipient (a penalty's payee, never notified). The type makes clear which one it is.
- Operator alert emails skip the outbox on purpose (`operator-alerts.ts`): the outbox lives in the database, and the restore alert must reach the operator after a restore from an old backup, when the database may have lost the operator's push subscription and the queued rows. They're sent at once, not waited for, and a failed one is logged, not retried.
- The photo bytes route (`GET /api/photos/:id`) answers 404 for a photo the account may not see, not a 200 refusal: an `<img>` can't read a refusal body. The core still returns `photo-not-found`.
