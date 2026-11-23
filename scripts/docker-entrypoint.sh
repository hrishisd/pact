#!/bin/sh
# Container entrypoint (ADR 0002, "Restoring on boot").
#
# 1. Restore the database from R2 when the volume has none (a fresh or replaced
#    volume). A normal restart finds the database and skips this; the very first
#    deploy finds no replica and starts empty.
# 2. Run the app under `litestream replicate -exec`, which streams every change
#    to R2 and exits when the app exits.
#
# On Fly, a missing LITESTREAM_BUCKET stops the machine before step 1; only a
# local `docker run` may run without backups.
#
# When step 1 actually restored a database, the app gets PACT_RESTORED=1 and
# raises an OPERATOR_ALERT with the restored database's last scheduler tick.
set -eu

DB="${PACT_DB_PATH:-/data/pact.db}"
APP="node --experimental-strip-types --disable-warning=ExperimentalWarning src/server/main.ts"

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  # On Fly (which sets FLY_APP_NAME on every machine) a missing bucket means a
  # lost secret: starting would skip the restore, so a fresh volume would start
  # empty, and nothing would be backed up. Refusing fails the deploy's health
  # check and the uptime monitor instead.
  if [ -n "${FLY_APP_NAME:-}" ]; then
    echo "LITESTREAM_BUCKET is not set on Fly: refusing to start without backups. Set the LITESTREAM_* secrets (fly secrets set)." >&2
    exit 1
  fi
  echo "LITESTREAM_BUCKET is not set: running WITHOUT backups (fine for a local docker run, never in production)"
  exec $APP
fi

mkdir -p "$(dirname "$DB")"
had_db=0
[ -f "$DB" ] && had_db=1

litestream restore -if-db-not-exists -if-replica-exists "$DB"

if [ "$had_db" = 0 ] && [ -f "$DB" ]; then
  echo "litestream restored $DB from the replica"
  export PACT_RESTORED=1
fi

exec litestream replicate -exec "$APP"
