#!/usr/bin/env bash
#
# Waits for a commit on main to reach production, and changes nothing. See
# docs/agents/production.md.
#
#   scripts/wait-deploy.sh [SHA]       default: HEAD
#
# 1. Waits for the commit's CI run on main to appear: GitHub takes several
#    seconds to register one after a push.
# 2. Watches that run, which ends with the deploy.
# 3. Polls /health until it reports the commit.
#
# Exits 0 once /health reports the commit; 1 on a CI failure or on a time
# limit; 2 on a bad argument. While /health reports another commit, step 3
# keeps polling until its limit. RUN_TIMEOUT and HEALTH_TIMEOUT (seconds) change
# the limits on steps 1 and 3; POLL_SECONDS the gap between their polls. Step 2
# has no limit of its own: it lasts as long as CI.

set -euo pipefail

health_url=https://pact.hrishisd.com/health
run_timeout="${RUN_TIMEOUT:-120}"
health_timeout="${HEALTH_TIMEOUT:-120}"
poll_seconds="${POLL_SECONDS:-5}"

if ! sha="$(git rev-parse --verify --quiet "${1:-HEAD}^{commit}")"; then
  echo "wait-deploy: not a commit: ${1:-HEAD}" >&2
  exit 2
fi

# Only main's run deploys, and a commit pushed to a branch first has a run there too.
echo "wait-deploy: waiting for the CI run of $sha on main (up to ${run_timeout}s)"
run_id=""
SECONDS=0
while true; do
  run_id="$(gh run list --workflow ci.yml --branch main --commit "$sha" --limit 1 \
    --json databaseId --jq '.[0].databaseId // empty' || true)"
  [[ -n "$run_id" ]] && break
  if ((SECONDS >= run_timeout)); then
    echo "wait-deploy: FAILED: no CI run of $sha on main after ${run_timeout}s. Is it pushed to main?" >&2
    exit 1
  fi
  sleep "$poll_seconds"
done

echo "wait-deploy: watching CI run $run_id"
if ! gh run watch "$run_id" --exit-status; then
  echo "wait-deploy: FAILED: CI run $run_id did not succeed: gh run view $run_id --log-failed" >&2
  exit 1
fi

# /health answers 503 with the same body when it is unhealthy, so no curl --fail:
# the commit is still worth reading. During a restart curl may fail outright.
echo "wait-deploy: CI passed; waiting for $health_url to report $sha (up to ${health_timeout}s)"
live=""
SECONDS=0
while true; do
  body="$(curl -sS --max-time 10 "$health_url" || true)"
  live="$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' <<<"$body")"
  if [[ "$live" == "$sha" ]]; then
    echo "wait-deploy: OK: $sha is live"
    echo "$body"
    exit 0
  fi
  if ((SECONDS >= health_timeout)); then
    echo "wait-deploy: FAILED: after ${health_timeout}s /health reports commit '${live:-none}', not $sha" >&2
    echo "$body" >&2
    exit 1
  fi
  sleep "$poll_seconds"
done
