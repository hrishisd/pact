# Production

Pact runs on one Fly machine: app `pact-hrishisd`, with the volume at `/data`. See ADR 0002 for the setup and ADR 0003 for logs and disk. The local `flyctl` is signed in as the operator. Use `flyctl` commands directly; never fetch or print a Fly token.

## Reading logs

| Need | Command |
|---|---|
Use `scripts/prod-log.sh`: it only reads logs, so it runs without a permission prompt. A raw `fly ssh console` opens a shell on the production machine and is gated.

| Need | Command |
|---|---|
| The server's own output, back past restarts (capped at about 20 MB) | `scripts/prod-log.sh tail 500` |
| Search it (letters, digits, spaces and `_ . : -` only) | `scripts/prod-log.sh grep OPERATOR_ALERT` |
| Evidence upload sizes and times (one line per upload) | `scripts/prod-log.sh grep evidence-upload` |
| Litestream's output, or the very latest lines | `scripts/prod-log.sh fly` (only about the last 100 lines) |
| Older Fly logs (about 7 days, human only) | Grafana log search at fly-metrics.net. Ask the operator to search and paste. |

## Health

- `curl -sS https://pact.hrishisd.com/health` reports the scheduler tick, disk use and the deployed `commit` (null for an image built without one, such as a manual `fly deploy`). It fails when the tick is stale or the volume is over 80% full.
- `/healthz` is liveness only. Fly's own check uses it.

## Waiting for a deploy

`scripts/wait-deploy.sh [SHA]` (default: HEAD) waits for the commit's CI run on main, watches it, then polls `/health` until it reports that commit. It only reads, and exits non-zero on a CI failure, a time limit, or another commit being live. Use it after pushing to main instead of hand-building the wait.
