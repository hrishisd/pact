#!/usr/bin/env bash
#
# Reads the production database, and never writes it. It is on the allow list
# in .claude/settings.json, so it runs without a permission prompt. See
# docs/agents/production.md.
#
#   scripts/prod-db.sh schema-version   user_version: how many migrations have run
#   scripts/prod-db.sh penalty-totals   how many penalties, and their total amount_cents
#   scripts/prod-db.sh pact-cursors     pacts per judged_through date, and how many are NULL
#   scripts/prod-db.sh query 'SQL'      one read-only statement; prints rows as JSON lines
#
# Two guards keep `query` read-only: SQLite opens the file read-only, and the
# program refuses any statement better-sqlite3 doesn't mark readonly. prepare()
# also refuses more than one statement. Output stops after 500 rows.
#
# Rows can hold names and emails. Select only the columns the question needs.
#
# The program and the SQL travel as base64 so their quotes can't collide with
# those of the fly -C and sh -c layers they pass through. It runs in /app,
# where node finds the image's better-sqlite3.

set -euo pipefail

app=pact-hrishisd

usage() {
  sed -n '7,10p' "$0" | sed 's/^# *//' >&2
  exit 2
}

sql_arg=""
if [[ "${1:-}" == query ]]; then
  [[ $# -eq 2 && -n "$2" ]] || usage
  sql_arg=$(printf '%s' "$2" | base64 | tr -d '\n')
else
  [[ $# -eq 1 ]] || usage
fi

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
  query)
    query='
const sql = Buffer.from(process.argv[3], "base64").toString("utf8");
const stmt = db.prepare(sql);
if (!stmt.readonly) { console.error("Refused: the statement can write."); process.exit(1); }
if (!stmt.reader) { console.error("Refused: the statement returns no rows."); process.exit(1); }
const limit = 500;
let n = 0;
for (const row of stmt.iterate()) {
  if (n === limit) { console.log("... stopped after " + limit + " rows"); break; }
  console.log(JSON.stringify(row));
  n++;
}
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
exec fly ssh console -a "$app" -C "sh -c 'cd /app && echo $encoded | base64 -d | node - /data/pact.db $sql_arg'"
