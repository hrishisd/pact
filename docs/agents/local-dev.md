# Local development

The `fnm` and iCloud notes apply to the owner's Mac. A cloud session has Node on its path and the repo checked out locally.

## Dev server

- `npm run dev` runs the API server on :3000 (`node --watch`, restarts on server edits) and Vite on :5173, which proxies `/api/` to :3000. Use http://localhost:5173.
- For the in-app browser preview, `.claude/launch.json` has the config `pact-dev`. It runs under the Node `.nvmrc` pins (`fnm exec --using=.nvmrc`); on another Node major the server refuses to start, because better-sqlite3 is built for one.
- If better-sqlite3's binary got built for another Node, the server and `npm test` stop with one line saying so (the `NODE_MODULE_VERSION` error underneath isn't a test failure). Rebuild it: `fnm exec --using=.nvmrc npm rebuild better-sqlite3`.
- A dev server another session (or the human's terminal) started may already hold the ports. Check before starting one: `lsof -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`. If both are listening, use them; don't start a second.
- `.env` is unreadable to agents (a Read deny rule, and `.claude/hooks/guard-bash.sh` blocks any command naming it). Read `.env.example` for the variables and their dev defaults. The real `OPERATOR_EMAIL` is in `.env`; you don't need it (see below).

- The dev server applies a migration the moment `src/core/migrations.ts` is saved, to the human's dev database. To correct a migration it has applied, append another; an edited one makes the server refuse to open the database.
- The browser pane denies notification permission and can't register a service worker. Check push on a real device, or stub the device APIs (`Notification`, `PushManager`, `navigator.serviceWorker`) to see the screens. Tests run `sw.js` itself (`src/client/sw.test.ts`).

## Checking a change

`npm run check` runs typecheck, lint, test and build in that order, stopping at the first failure. CI's `test` job runs the same command, so passing it locally means the same four steps pass there.

## Browser smoke test

`npm run test:e2e` runs one Playwright flow (`e2e/smoke.spec.ts`) across screens as two people: invite and become friends, create a Camera pact, submit evidence, approve it, a day Missed, file an excuse from the Missed card and open it from Waiting for approval, reject it, record a payment. It asserts on what a user sees (text and roles), not on CSS classes. About 10 seconds. Not part of `npm run check`; CI runs it as its own job (`e2e` in `.github/workflows/ci.yml`), in parallel with the check, and a failure there keeps the trace as the `playwright-traces` artifact.

- `playwright.config.ts` builds the client and starts the server in development (`npm start`) on port 3100 with a fresh database in the system temp directory (`pact-e2e/`), so it doesn't touch the dev database or a dev server on 3000 and 5173.
- `@playwright/test` is pinned to the machine's Playwright (1.63.0), whose Chromium is preinstalled. Elsewhere, `npx playwright install chromium` once.
- A failure keeps a trace in `test-results/`: `npx playwright show-trace test-results/<test>/trace.zip`.

### Moving the dev server's clock

With `PACT_DEV_CLOCK=1` (the smoke test sets it), the server runs on a clock that can be moved forward: `POST /api/dev/advance` with `{ "minutes": N }` moves it N minutes ahead, runs the scheduler's tick up to the new time, and answers `{ "now": "<ISO time>" }`. Time keeps running between advances, and never goes back. Like the dev sign-in it answers only to this machine, and production refuses to start with `PACT_DEV_CLOCK` set. The browser's clock doesn't move with it: the smoke test moves each page's clock too (`page.clock.setSystemTime`), so screens and server agree on the time. Restart the server to return to the real time; data written at a later time stays later.

## Signing in without Google

Development only: `GET /api/dev/sign-in` signs in and redirects. It doesn't exist in production, and it answers only to a browser on this machine (localhost, 127.0.0.1, ::1). It goes through the same gate as Google (`core.signIn`), then makes a real Better Auth session, so every screen works as after a Google sign-in.

| Who | Visit | Lands on |
|---|---|---|
| The operator (whoever `OPERATOR_EMAIL` is) | http://localhost:5173/api/dev/sign-in?as=operator | `/` |
| A second person | http://localhost:5173/api/dev/sign-in?email=friend@example.test&name=Friend&invite=TOKEN | `/invite/TOKEN`: press Accept to become friends |
| Anyone already with an account | http://localhost:5173/api/dev/sign-in?email=EMAIL | `/` |

- A new account needs an invite token: sign in as the operator, then Profile → Invite a friend, and take the token from the link it shows (`/invite/TOKEN`). Or with curl: `POST /api/invites` with the operator's cookie returns `{ token }`.
- A new account gets the timezone in `timezone` (an IANA name, such as `&timezone=Europe/London`), as a Google sign-in brings the browser's; it defaults to `America/New_York`. An existing account keeps its own: change it in Profile. `name` defaults to the email's local part. No usable invite redirects to `/invite-required`.
- To switch person in one browser, visit the URL for the other person; the new session cookie replaces the old one.
- With curl, keep a cookie jar in your scratchpad: `curl -c JAR "http://localhost:5173/api/dev/sign-in?as=operator"`, then `curl -b JAR http://localhost:5173/api/me`.

## Anki without AnkiWeb

Without `ANKI_TOKEN_KEY` set, development uses a stand-in for AnkiWeb (`devAnki` in `src/core/anki.ts`), as Oura has one:

- Connect AnkiWeb accepts any email and password, except the password `wrong` (shows the wrong-password state) and `unreachable` (shows AnkiWeb not answering).
- Decks and their counts come from `anki-decks.json` next to the database (`.dev-data.nosync/anki-decks.json`), read on every check, so editing it is "studying". Each check counts for the Anki day the current time falls in, at `timezone`:

```json
{
  "rolloverHour": 4,
  "timezone": "America/New_York",
  "decks": [
    { "id": "1", "name": "Spanish", "parentId": null, "counts": { "new": 10, "learn": 2, "review": 30 } },
    { "id": "2", "name": "Spanish::Verbs", "parentId": "1", "counts": { "new": 0, "learn": 0, "review": 5 } }
  ]
}
```

- Set every count of a deck to 0 to finish it: Today's next check (open Today, or wait up to 10 minutes) makes the day Satisfied.
- Add `"refused": true` to make AnkiWeb refuse Pact's login: the next check marks the connection Needs reconnecting, with its alerts and push. Take it out again before using Reconnect, which takes any password as Connect does.
- Take a deck out of `decks` to delete it in Anki: the next check shows the "deck is gone from Anki" alert on its pact.
- With no file there are no decks. In Anki a parent's counts include its subdecks'; the stand-in shows what the file says, so keep them consistent.

To try the real adapter, set `ANKI_TOKEN_KEY` and `ANKI_PYTHON` (a Python with `pip install -r src/core/anki-requirements.txt`). Anki's own sync server (`python -m anki.syncserver`, from the same package) can stand in for AnkiWeb: `ankiAdapter`'s `loginEndpoint` option points the login at it.

## Server log

The server writes its output (and crash traces) to `logs/pact.log` next to the database: `.dev-data.nosync/logs/pact.log` with the defaults (its directory is `PACT_DB_PATH`'s). When a screen shows a load error, read the end of it: `tail -n 100 .dev-data.nosync/logs/pact.log`. It rotates to `pact.log.1` at 10 MB.

## Resetting the dev database

The dev database is `.dev-data.nosync/pact.db` (with `-wal` and `-shm` files), unless `PACT_DB_PATH` says otherwise. The `.nosync` suffix keeps iCloud Drive (the repo is in ~/Documents) from syncing it; synced, it made conflict copies like `pact 2.db`. Migrations run on boot and are numbered: one the database has already applied never runs again. After editing a migration the dev database already applied (rather than adding a new one), the server refuses to start: the log (and terminal) shows `migration N has changed since this database applied it`. Reset the database:

1. Stop the dev server (ask the human if it's theirs).
2. Delete `pact.db`, `pact.db-wal` and `pact.db-shm` in `.dev-data.nosync/`. Leave `logs/`.
3. Start the server again. It creates and migrates a fresh database; sign in again as above.

Everything in it is lost: accounts, invites, pacts. Don't reset just to clear data you could work around.
