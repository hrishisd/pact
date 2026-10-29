# Production

Pact runs on one Fly machine: app `pact-hrishisd`, with the volume at `/data`. See ADR 0002 for the setup and ADR 0003 for logs and disk. The local `flyctl` is signed in as the operator. Use `flyctl` commands directly; never fetch or print a Fly token.

## Reading logs

| Need | Command |
|---|---|
| The server's own output, back past restarts (capped at about 20 MB) | `fly ssh console -a pact-hrishisd -C "tail -n 500 /data/logs/pact.log"` |
| Search it | `fly ssh console -a pact-hrishisd -C "grep -h OPERATOR_ALERT /data/logs/pact.log.1 /data/logs/pact.log"` |
| Litestream's output, or the very latest lines | `fly logs -a pact-hrishisd --no-tail` (only about the last 100 lines) |
| Older Fly logs (about 7 days, human only) | Grafana log search at fly-metrics.net. Ask the operator to search and paste. |

`-C` runs one command without a shell. For pipes or globs, wrap it: `-C "sh -c '…'"`. Ask for a bounded slice (`tail -n`, `grep`), never the whole file.

## Health

- `curl -sS https://pact.hrishisd.com/health` reports the scheduler tick and disk use. It fails when the tick is stale or the volume is over 80% full.
- `/healthz` is liveness only. Fly's own check uses it.
