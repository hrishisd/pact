# 01 Walking skeleton: deploy, sign-in, empty Today, CI, core test harness

Status: ready-for-agent
Blocked by: none

Spec: `.scratch/pact-v0/spec.md`. Stack: ADR 0002.

## What to build

The thinnest end-to-end path through every layer, deployed to `pact.hrishisd.com`, so every later ticket only adds behaviour.

- **Server and client:** one TypeScript program serving the React SPA (Vite), the JSON API and the Pact core. Shared types between client and server.
- **Pact core skeleton:** the deep module with its command/query interface, each call made as a particular account. Four ports with production adapters and fakes: Clock, Oura source (stub adapter for now), Notifier, Photo store (stub adapter for now). The core never reads system time.
- **Storage:** SQLite on `/data` in WAL mode with the production pragmas, schema migrations run on boot. Nothing that matters lives only in memory.
- **Notifications after commit:** an outbox table written in the same transaction as the command's other changes, delivered after commit. Only the fake Notifier and a log-only production adapter exist yet (push is ticket 05).
- **Scheduler:** a one-minute timer calling the core's **advance to T** command with the real clock. The command does nothing domain-wise yet, but records the last tick time in the database.
- **`/health`:** fails when the last scheduler tick is more than 5 minutes old.
- **Litestream:** entrypoint runs `litestream restore -if-db-not-exists -if-replica-exists`, then the app under `litestream replicate -exec`. Litestream ≥ 0.5.1. Replica in R2 with 30 days of point-in-time history. When a restore happened, log an `OPERATOR_ALERT` line giving the restored database's last scheduler tick time.
- **Google sign-in:** an auth library inside the server, long-lived self-renewing sessions. Invite-only: a sign-in that isn't the operator's first account and doesn't carry a valid invite is refused with a plain page saying you need an invite. (The invite path itself is ticket 02; here, only the operator's first account can be created. Identify the operator by a configured email in Fly secrets.)
- **Timezone:** on first sign-in, detect the browser timezone and show it for the user to confirm (story 2). Profile menu lets the user change it (story 5).
- **App shell:** bottom tabs Today · Pacts · Review · Ledgers plus a profile menu, styled per the Screens section (current tab on a soft blue tile, accent colour, bold label; others grey; no tap flash). Light theme only. Today shows the "Nothing to do right now" card. Other tabs show empty states.
- **PWA basics:** web app manifest and icons so the app can be added to the iPhone home screen. Push and install instructions come in ticket 05.
- **CI/CD:** GitHub Actions runs the tests on every push and, on `main` only, deploys to Fly when they pass.

## Test harness (sets the pattern for every later ticket)

- Tests act as named accounts, issue commands, move the fake clock with advance to T, and assert only on query results and on what the recording notifier captured. Never on internal state or storage.
- Each test gets its own temporary SQLite file in WAL mode with the production pragmas.
- A **restart** helper: discard the core and build a new one on the same database file mid-scenario.
- A **failing port** helper: make a fake port fail on its Nth call, to prove a command is all-or-nothing.
- Fakes: controllable clock, recording notifier, in-memory photo store, Oura source returning API-shaped sleep periods or "disconnected".
- Scenario helpers read in domain language (e.g. `owner.createPact(...)`, `clock.advanceTo("Mon 18:00")`).

## Acceptance criteria

- [ ] `git push` to `main` runs tests in CI and deploys to Fly when they pass; a failing test blocks the deploy.
- [ ] The operator can sign in with Google on an iPhone home-screen install, confirm their timezone, and see the empty Today with the four tabs.
- [ ] A different Google account without an invite is refused and no account is created.
- [ ] `/health` returns OK while the scheduler runs and fails if ticks stop for 5 minutes.
- [ ] Deleting the volume and redeploying restores the database from R2 and logs an `OPERATOR_ALERT` with the last tick time (this is also the practice restore ADR 0002 asks for).
- [ ] Harness scenarios: advance to T records the tick; the tick survives a restart; changing timezone shows up in the profile query; a failing-port scenario leaves nothing half-applied.

## Needs the operator

These need accounts and secrets only the operator can set up. Consider generating a `/wizard` script for them.

- Fly app in `ewr` (fallback `iad`), a volume mounted at `/data`, daily volume snapshots left on.
- Cloudflare R2: a bucket for Litestream (photos get their own private bucket in ticket 03) and access keys.
- Google OAuth client with the production and local dev redirect URIs.
- DNS for `pact.hrishisd.com` and the Fly certificate.
- Fly secrets (session secret, Google client, R2 keys, operator email) and a `FLY_API_TOKEN` GitHub Actions secret.
- An external uptime monitor on `/health` that emails the operator.

## Notes

- Still to verify (ADR 0002): Fly pricing and `ewr`; Google sign-in completing inside the home-screen app on a real iPhone. Record the results under Comments.

## Comments

**2026-10-29 — implemented in code; operator steps outstanding.**

Done and checked locally: core skeleton with the four ports and fakes, SQLite (WAL + production pragmas, migrations on boot), outbox delivered after commit, scheduler tick + `/health` 5-minute rule, Better Auth Google sign-in with invite-only refusal (tests confirm no core or auth rows on refusal), timezone confirm and change, app shell with the four tabs and empty Today, PWA manifest and icons, Dockerfile + Litestream 0.5.17 (30-day retention, restore on boot, `OPERATOR_ALERT` with the last tick), `fly.toml`, GitHub Actions CI/deploy. Harness scenarios cover the tick, restart, timezone in profile, and a failing port (clock fails inside the restore-alert command → nothing queued; notifier fails after commit → delivered on the next tick).

Not yet verified (needs the operator, see `scripts/setup-operator.sh`): Docker image build (no local Docker daemon), Fly deploy and `ewr` availability/pricing, R2 replication and the practice restore, real Google sign-in, and Google sign-in inside the iPhone home-screen app. Record those results here.

Decision: no Fly `http_service` health check on `/health`. With one machine, a failing check would take the app offline when only the scheduler is stuck; the external uptime monitor watches `/health` instead.
