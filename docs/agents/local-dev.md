# Local development

## Dev server

- `npm run dev` runs the API server on :3000 (`node --watch`, restarts on server edits) and Vite on :5173, which proxies `/api/` to :3000. Use http://localhost:5173.
- For the in-app browser preview, `.claude/launch.json` has the config `pact-dev`. It runs under the Node `.nvmrc` pins (`fnm exec --using=.nvmrc`); on another Node major the server refuses to start, because better-sqlite3 is built for one.
- A dev server another session (or the human's terminal) started may already hold the ports. Check before starting one: `lsof -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`. If both are listening, use them; don't start a second.
- `.env` is unreadable to agents (a Read deny rule, and `.claude/hooks/guard-bash.sh` blocks any command naming it). Read `.env.example` for the variables and their dev defaults. The real `OPERATOR_EMAIL` is in `.env`; you don't need it (see below).

## Signing in without Google

Development only: `GET /api/dev/sign-in` signs in and redirects. It doesn't exist in production, and it answers only to a browser on this machine (localhost, 127.0.0.1, ::1). It goes through the same gate as Google (`core.signIn`), then makes a real Better Auth session, so every screen works as after a Google sign-in.

| Who | Visit | Lands on |
|---|---|---|
| The operator (whoever `OPERATOR_EMAIL` is) | http://localhost:5173/api/dev/sign-in?as=operator | `/` |
| A second person | http://localhost:5173/api/dev/sign-in?email=friend@example.test&name=Friend&invite=TOKEN | `/invite/TOKEN`: press Accept to become friends |
| Anyone already with an account | http://localhost:5173/api/dev/sign-in?email=EMAIL | `/` |

- A new account needs an invite token: sign in as the operator, then Profile → Invite a friend, and take the token from the link it shows (`/invite/TOKEN`). Or with curl: `POST /api/invites` with the operator's cookie returns `{ token }`.
- A new account first confirms its timezone, then sees the app. `name` defaults to the email's local part. No usable invite redirects to `/invite-required`.
- To switch person in one browser, visit the URL for the other person; the new session cookie replaces the old one.
- With curl, keep a cookie jar in your scratchpad: `curl -c JAR "http://localhost:5173/api/dev/sign-in?as=operator"`, then `curl -b JAR http://localhost:5173/api/me`.

## Server log

The server writes its output (and crash traces) to `logs/pact.log` next to the database: `.dev-data.nosync/logs/pact.log` with the defaults (its directory is `PACT_DB_PATH`'s). When a screen shows a load error, read the end of it: `tail -n 100 .dev-data.nosync/logs/pact.log`. It rotates to `pact.log.1` at 10 MB.

## Resetting the dev database

The dev database is `.dev-data.nosync/pact.db` (with `-wal` and `-shm` files), unless `PACT_DB_PATH` says otherwise. The `.nosync` suffix keeps iCloud Drive (the repo is in ~/Documents) from syncing it; synced, it made conflict copies like `pact 2.db`. Migrations run on boot and are numbered: one the database has already applied never runs again. After editing a migration the dev database already applied (rather than adding a new one), the server refuses to start: the log (and terminal) shows `migration N has changed since this database applied it`. Reset the database:

1. Stop the dev server (ask the human if it's theirs).
2. Delete `pact.db`, `pact.db-wal` and `pact.db-shm` in `.dev-data.nosync/`. Leave `logs/`.
3. Start the server again. It creates and migrates a fresh database; sign in again as above.

Everything in it is lost: accounts, invites, pacts. Don't reset just to clear data you could work around.
