#!/usr/bin/env bash
#
# Runs the deep fuzz run (src/core/fuzz.test.ts) on every CPU core at once.
#
#   scripts/fuzz-deep.sh [FROM-TO]     default: 1000-1199
#
# Deals the seeds out in turn to JOBS vitest processes (default: one per core),
# so slow seeds spread evenly. FUZZ_STEPS (default 300) and FUZZ_MODE pass
# through. Each job's output goes to a log; a failing job's log is printed at
# the end. Exits 0 when every seed passed, 1 otherwise, 2 on a bad argument.

set -euo pipefail

range=${1:-1000-1199}
if [[ ! $range =~ ^([0-9]+)-([0-9]+)$ ]]; then
  echo "usage: $0 [FROM-TO]" >&2
  exit 2
fi
from=${BASH_REMATCH[1]}
to=${BASH_REMATCH[2]}
jobs=${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}
export FUZZ_STEPS=${FUZZ_STEPS:-300}

logs=$(mktemp -d)
pids=()
for ((job = 0; job < jobs; job++)); do
  seeds=$(seq -s, $((from + job)) "$jobs" "$to")
  [[ -z $seeds ]] && continue
  FUZZ_SEEDS=$seeds npx vitest run src/core/fuzz.test.ts >"$logs/$job.log" 2>&1 &
  pids+=("$!")
done
echo "Seeds $range, $FUZZ_STEPS steps, ${#pids[@]} jobs; logs in $logs"

failed=0
for job in "${!pids[@]}"; do
  if ! wait "${pids[$job]}"; then
    failed=1
    echo "== job $job failed:"
    cat "$logs/$job.log"
  fi
done
[[ $failed == 0 ]] && echo "All seeds passed."
exit "$failed"
