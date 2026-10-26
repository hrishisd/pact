# One always-on Fly.io server with SQLite, backed up to R2

Pact runs as one TypeScript program on one always-on Fly.io machine (`ewr`), at `pact.hrishisd.com`. That program serves the React single-page app (built with Vite), the JSON API and the Pact core, and it runs a timer that calls "advance to now" every minute. Data lives in SQLite on the machine's disk. Litestream streams every change to a Cloudflare R2 bucket and keeps 30 days of point-in-time history. Photos go in a private R2 bucket, and the server checks that the viewer is the owner or one of the pact's reviewers before serving a photo or handing out a short-lived link.

We chose this because the app will have at most about 5 users for its whole life, and every one of them is on an iPhone. That makes cost and moving parts matter far more than scale. A single process maps directly onto the spec's design (one core, four ports, a scheduler). The whole setup costs about $3–5/month. We considered and rejected the following:

- **Postgres:** it adds a second service, and it only earns its keep when several servers share data.
- **Supabase or Firebase:** Pact's rules must live in our own tested core, so we'd still need a server, and the logic would split between database policies and code.
- **Serverless platforms such as Cloudflare Workers or Vercel:** they restrict the runtime, local development differs from production, and the system has more pieces.
- **A Raspberry Pi at home:** it needs setup work and makes the home network and power part of the system.
- **Rust:** with this workload it wouldn't save money or noticeable latency, and it would cost the client and server their shared types.

The trade-off is one machine and one disk. Every deploy restarts the app for a few seconds. If the host fails, we restore from Litestream, and downtime is acceptable.

## The rest of the stack

- **Sign-in:** Google only, through an auth library inside our server, with long-lived self-renewing sessions. Accounts are invite-only: a sign-in creates an account only through a valid invite, apart from the operator's own first account.
- **Notifications:** Web Push sent directly from our server using VAPID keys, with no push service in between. Email and text messages are deferred.
- **Secrets:** configuration secrets live in Fly secrets. Oura tokens are encrypted in the database with a key from Fly secrets, because database backups leave Fly.
- **Deploys:** every push to `main` runs the tests in GitHub Actions and, if they pass, deploys to Fly. There is no staging site. UI checks on a phone use the laptop's dev server over home Wi-Fi.
- **Monitoring:** a `/health` endpoint fails if the last scheduler tick is more than 5 minutes old, and a free external uptime monitor emails the operator when it fails. Errors are read from Fly's logs, and data is fixed with SQL in a database shell. There is no error-tracking service and no admin UI.
- **After downtime:** judgments, due dates and overdue changes always catch up. Reminders more than 15 minutes late are dropped. Each drop is logged, and a summary is pushed to the operator only.
- **Backups:** one practice restore is done during setup, before real data depends on it.

## Still to verify

- Fly's current pricing, and that `ewr` is still offered (fallback: `iad`).
- Whether Oura sleep timestamps carry a UTC offset (see the spec).
- Whether iOS Safari keeps a photo's capture time in uploads.
- That Google sign-in completes inside the home-screen app on a real iPhone.
