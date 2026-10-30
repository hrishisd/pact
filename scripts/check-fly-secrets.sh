#!/usr/bin/env bash
#
# Stops a deploy when production would refuse to boot for a missing variable:
# compares what loadConfig (src/server/config.ts) requires with fly.toml's [env]
# and the secrets Fly lists, Deployed or Staged (staged ones apply on this deploy).
#
#   scripts/check-fly-secrets.sh FLY_TOML LIST_COMMAND...
#
# LIST_COMMAND prints `fly secrets list --json`. The deploy job in ci.yml passes
# the real one; the tests in src/server/check-fly-secrets.test.ts pass fakes.
#
# Exits non-zero ONLY when the listing worked and a required name is definitely
# absent. Anything else (no permission to list, network, odd output, a bug here)
# is a warning and exit 0: a broken checker must never block a deploy. So no
# `set -e`. The listing's stdout holds digests, so it is never printed.

set -u

skip() {
  echo "::warning::Fly secrets check skipped, deploy continues: $1"
  exit 0
}

[ "$#" -ge 2 ] || skip "usage: check-fly-secrets.sh FLY_TOML LIST_COMMAND..."
fly_toml="$1"
shift

# ── What production requires: the names in loadConfig's own error ────────────
prefix="missing required environment variables: "
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_error="$(cd "$repo_root" && node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e '
  import { loadConfig } from "./src/server/config.ts";
  try {
    loadConfig({ NODE_ENV: "production" });
  } catch (error) {
    console.log(error.message);
  }
')"
case "$config_error" in
  "$prefix"*) required="${config_error#"$prefix"}" ;;
  *) skip "couldn't read the required names from config.ts" ;;
esac

# ── What fly.toml provides ───────────────────────────────────────────────────
env_names="$(awk '
  /^[[:space:]]*\[/ { in_env = ($0 ~ /^[[:space:]]*\[env\][[:space:]]*(#.*)?$/); next }
  in_env && /^[[:space:]]*"?[A-Za-z_][A-Za-z0-9_]*"?[[:space:]]*=/ {
    sub(/[[:space:]]*=.*/, ""); gsub(/[[:space:]"]/, ""); print
  }
' "$fly_toml")"
[ -n "$env_names" ] || skip "found no [env] variables in $fly_toml"

# ── What Fly has ─────────────────────────────────────────────────────────────
if ! listing="$("$@")"; then
  skip "couldn't list Fly's secrets (is the deploy token allowed to?)"
fi
# Every app has secrets, so an empty list is a wrong answer, not a missing secret.
# jq's own errors can quote the input, so they stay out of the log.
secret_names="$(printf '%s' "$listing" | jq -r '
  if type == "array" and length > 0
  then map(.name | if type == "string" then . else error end) | .[]
  else error
  end
' 2>/dev/null)" || skip "couldn't read the output of the secrets listing"
[ -n "$secret_names" ] || skip "couldn't read the output of the secrets listing"

# ── The comparison ───────────────────────────────────────────────────────────
missing=""
for name in ${required//,/ }; do
  if ! printf '%s\n%s\n' "$env_names" "$secret_names" | grep -qxF "$name"; then
    missing="$missing $name"
  fi
done

if [ -n "$missing" ]; then
  echo "::error::Production won't boot without:$missing. Set with: fly secrets set NAME=value --stage"
  exit 1
fi
echo "Fly secrets check passed: every variable config.ts requires is on Fly or in $fly_toml."
