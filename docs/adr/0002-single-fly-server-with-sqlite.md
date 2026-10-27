# One always-on Fly.io server with SQLite, backed up to R2

Pact runs as one TypeScript program on one always-on Fly.io machine (`ewr`), at `pact.hrishisd.com`. That program serves the React single-page app (built with Vite), the JSON API and the Pact core, and it runs a timer that calls "advance to now" every minute. Data lives in SQLite on a single Fly volume mounted at `/data`. A Fly machine's root filesystem is rebuilt from the image on every start, so nothing that must survive a deploy may live outside the volume. Litestream streams every change to a Cloudflare R2 bucket and keeps 30 days of point-in-time history. Photos go in a private R2 bucket, and the server checks that the viewer is the owner or one of the pact's reviewers before serving a photo or handing out a short-lived link.

We chose this because the app will have at most about 5 users for its whole life, and every one of them is on an iPhone. That makes cost and moving parts matter far more than scale. A single process maps directly onto the spec's design (one core, four ports, a scheduler). The whole setup costs about $3–5/month. We considered and rejected the following:

- **Postgres:** it adds a second service, and it only earns its keep when several servers share data.
- **Supabase or Firebase:** Pact's rules must live in our own tested core, so we'd still need a server, and the logic would split between database policies and code.
- **Serverless platforms such as Cloudflare Workers or Vercel:** they restrict the runtime, local development differs from production, and the system has more pieces.
- **A Raspberry Pi at home:** it needs setup work and makes the home network and power part of the system.
- **Rust:** with this workload it wouldn't save money or noticeable latency, and it would cost the client and server their shared types.

The trade-off is one machine and one disk. Every deploy restarts the app for a few seconds. If the host fails, we restore from Litestream, and downtime is acceptable.

We also rejected a second machine with its own volume as a standby. Fly doesn't copy data between volumes, and SQLite has one writer, so keeping a standby current would need LiteFS or Postgres. That's a lot of machinery to avoid a rare outage for about 5 users.

## If the host dies

A volume lives on one physical server, and Fly won't move a machine that has one. If that server fails, the app stays down until the operator acts:

1. Create a new volume in the same region.
2. Deploy. On boot the new machine finds no database and restores it from R2 (see below).
3. Read the operator alert to see how old the restored data is.

## Restoring on boot

Before starting the app, the entrypoint runs `litestream restore -if-db-not-exists -if-replica-exists`. It then starts the app under `litestream replicate -exec`. A normal restart finds the database already on the volume and skips the restore. A fresh volume gets the latest replica. On the very first deploy there is no replica, so the app starts empty. Litestream must be 0.5.1 or later, because 0.5.0 dropped `-if-replica-exists`.

When a restore happens, the server raises an operator alert that gives the time of the restored database's last scheduler tick. That shows how much was lost, including when backups had silently stopped long before.

## The rest of the stack

- **Sign-in:** Google only, through an auth library inside our server, with long-lived self-renewing sessions. Accounts are invite-only: a sign-in creates an account only through a valid invite, apart from the operator's own first account.
- **Notifications:** Web Push sent directly from our server using VAPID keys, with no push service in between. Email and text messages are deferred.
- **Secrets:** configuration secrets live in Fly secrets. Oura tokens are encrypted in the database with a key from Fly secrets, because database backups leave Fly.
- **Deploys:** every push to `main` runs the tests in GitHub Actions and, if they pass, deploys to Fly. There is no staging site. UI checks on a phone use the laptop's dev server over home Wi-Fi.
- **Monitoring:** a `/health` endpoint fails if the last scheduler tick is more than 5 minutes old, and a free external uptime monitor emails the operator when it fails. Errors are read from Fly's logs, and data is fixed with SQL in a database shell. There is no error-tracking service and no admin UI.
- **Operator alerts:** a log line tagged `OPERATOR_ALERT` plus a Web Push to the operator's account only. They are raised when reminders are dropped after downtime and when the database is restored on boot. The push subscription lives in the database, so after a restore from an old replica the push may not arrive, but the log line always does. Once email exists, operator alerts should go by email, which is more durable than push.
- **After downtime:** judgments, due dates and overdue changes always catch up. Reminders more than 15 minutes late are dropped. Each drop is logged, and a summary goes out as an operator alert.
- **Backups:** one practice restore is done during setup, before real data depends on it. Fly's automatic daily volume snapshots stay on (default 5-day retention) as a backstop behind Litestream.

## Known risk: backups can fail silently

If Litestream can't reach R2 (expired credentials, a deleted bucket, a network fault), it logs the error and keeps retrying while the app runs normally. Nothing alerts the operator, and `/health` only watches the scheduler. We accept this for v0. The volume snapshots cover the last few days, and the boot-restore alert shows staleness at the moment it matters.

Monitoring to consider after v0, with no decision on whether or when:

- **A daily restore check:** a scheduled job (for example in GitHub Actions) restores the latest replica and fails if its last scheduler tick is old. It proves backups are both written and restorable, and it costs nothing.
- **Log alerting:** the Fly log shipper forwards logs to a log service that alerts on `OPERATOR_ALERT` and Litestream errors. It catches more, including crashes, but adds a second Fly app (about $2/month) and an outside account, so it may never be worth it.

## Still to verify

- Fly's current pricing, and that `ewr` is still offered (fallback: `iad`).
- Whether Oura sleep timestamps carry a UTC offset (see the spec).
- Whether iOS Safari keeps a photo's capture time in uploads.
- That Google sign-in completes inside the home-screen app on a real iPhone.
