#!/bin/sh
# Container entrypoint (ADR 0002, "Restoring on boot").
#
# 1. Restore the database from R2 when the volume has none (a fresh or replaced
#    volume). A normal restart finds the database and skips this; the very first
#    deploy finds no replica and starts empty.
# 2. Run the app under `litestream replicate -exec`, which streams every change
#    to R2 and exits when the app exits.
#
# When step 1 actually restored a database, the app gets PACT_RESTORED=1 and
# raises an OPERATOR_ALERT with the restored database's last scheduler tick.
set -eu

DB="${PACT_DB_PATH:-/data/pact.db}"
APP="node --experimental-strip-types --disable-warning=ExperimentalWarning src/server/main.ts"

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
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
