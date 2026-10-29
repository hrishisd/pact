#!/usr/bin/env bash
#
# Reads production logs, and nothing else. Agents may run this without asking
# (allow rule in .claude/settings.json); a general `fly ssh console` stays
# behind the permission prompt. See docs/agents/production.md.
#
#   scripts/prod-log.sh tail [N]       last N lines of /data/logs/pact.log (default 200, max 2000)
#   scripts/prod-log.sh grep PATTERN   matching lines from pact.log.1 and pact.log
#   scripts/prod-log.sh fly            Fly's recent log buffer (Litestream's output too)
#
# PATTERN is limited to letters, digits, spaces and _ . : - so nothing it
# holds can turn into another command on the machine.

set -euo pipefail

app=pact-hrishisd
log=/data/logs/pact.log

usage() {
  sed -n '7,9p' "$0" | sed 's/^# *//' >&2
  exit 2
}

case "${1:-}" in
  tail)
    lines="${2:-200}"
    if ! [[ "$lines" =~ ^[0-9]+$ ]] || ((lines < 1 || lines > 2000)); then usage; fi
    exec fly ssh console -a "$app" -C "tail -n $lines $log"
    ;;
  grep)
    pattern="${2:-}"
    [[ -n "$pattern" && "$pattern" =~ ^[A-Za-z0-9_\ .:-]+$ ]] || usage
    exec fly ssh console -a "$app" -C "sh -c 'grep -h -e \"$pattern\" $log.1 $log 2>/dev/null | tail -n 500'"
    ;;
  fly)
    exec fly logs -a "$app" --no-tail
    ;;
  *)
    usage
    ;;
esac
