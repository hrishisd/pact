# A capped log file on the volume, and a disk check in /health

The server copies everything it prints (stdout and stderr) to `/data/logs/pact.log`, with a timestamp on each line. When the file passes 10 MB it is renamed to `pact.log.1`, replacing the previous one, and a new file starts, so logs never take more than about 20 MB. The operator, or an agent, reads it with `fly ssh console`. `/health` also fails when the volume is more than 80% full.

We need this because Fly's `fly logs` shows only a short live buffer. During the first production bug, the error and the boot lines had already scrolled away by the time anyone looked. Fly keeps about 7 days of logs, but reading them needs either a person in Grafana or the operator's Fly token. We rejected:

- **Fly's logs API from a script:** the token it needs can control the whole Fly account, the endpoint isn't officially supported for outside use, and history stops at about 7 days.
- **The Fly log shipper:** it needs a second Fly app (about $2/month) and an account with a log service. ADR 0002 already defers it.

The trade-off is that only the server's own output is in the file. Litestream runs as a separate process, so its errors appear only in Fly's logs. Fly's daily volume snapshots cover the log file too, but Litestream doesn't, so a restore onto a new volume starts with an empty log.

## What lives on the volume

The volume is 1 GB:

| What | Where | Size |
|---|---|---|
| Database, with its WAL and shared-memory files | `/data/pact.db*` | Grows with use: roughly 10–50 MB a year at about 5 users |
| Litestream's working files | `/data/.pact.db-litestream` | Small while R2 is reachable; may grow while it isn't |
| Server log | `/data/logs/pact.log`, `pact.log.1` | At most about 20 MB |

Photos are in R2, not on the volume (ADR 0002). Delivered outbox rows are kept forever for now, which is a slow leak to prune once notifications are real (ticket 05).

The 80% check is what catches a slow fill from any of these, such as Litestream holding changes it can't upload. When it fires, `fly volumes extend` grows the volume while the app runs. A volume can grow but never shrink.
