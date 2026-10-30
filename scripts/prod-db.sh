#!/usr/bin/env bash
#
# Reads counts from the production database, and nothing else: a fixed list of
# queries on a read-only connection. It isn't on the allow list in
# .claude/settings.json, so it may need the user's approval to run. See
# docs/agents/production.md.
#
#   scripts/prod-db.sh schema-version   user_version: how many migrations have run
#   scripts/prod-db.sh penalty-totals   how many penalties, and their total amount_cents
#   scripts/prod-db.sh pact-cursors     pacts per judged_through date, and how many are NULL
#
# No SQL or other argument reaches the machine, and output is counts only: no
# names, emails, reasons or IDs. The program travels as base64 so its quotes
# can't collide with those of the fly -C and sh -c layers it passes through.
# It runs in /app, where node finds the image's better-sqlite3.

set -euo pipefail

app=pact-hrishisd

usage() {
  sed -n '8,10p' "$0" | sed 's/^# *//' >&2
  exit 2
}

[[ $# -eq 1 ]] || usage

case "$1" in
  schema-version)
    query='
console.log("user_version=" + db.pragma("user_version", { simple: true }));
'
    ;;
  penalty-totals)
    query='
const { penalties, cents } = db
  .prepare("SELECT COUNT(*) AS penalties, COALESCE(SUM(amount_cents), 0) AS cents FROM penalty")
  .get();
console.log("penalties=" + penalties + " amount_cents=" + cents);
'
    ;;
  pact-cursors)
    query='
const cursors = db
  .prepare("SELECT judged_through AS date, COUNT(*) AS pacts FROM pact WHERE judged_through IS NOT NULL GROUP BY judged_through ORDER BY judged_through")
  .all();
for (const { date, pacts } of cursors) console.log("judged_through=" + date + " pacts=" + pacts);
const { pacts } = db.prepare("SELECT COUNT(*) AS pacts FROM pact WHERE judged_through IS NULL").get();
console.log("judged_through=NULL pacts=" + pacts);
'
    ;;
  *)
    usage
    ;;
esac

open='
const Database = require("better-sqlite3");
const db = new Database(process.argv[2], { readonly: true });
'

encoded=$(printf '%s' "$open$query" | base64 | tr -d '\n')
exec fly ssh console -a "$app" -C "sh -c 'cd /app && echo $encoded | base64 -d | node - /data/pact.db'"
