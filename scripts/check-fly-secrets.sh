#!/usr/bin/env bash
#
# Stops a deploy when production would refuse to boot for a missing variable:
# runs loadConfig (src/server/config.ts) as production with every name in
# fly.toml's [env] and every secret Fly lists, Deployed or Staged (staged ones
# apply on this deploy), set to a placeholder, and reports the names it still
# misses. So an optional secret that needs others counts: OURA_CLIENT_ID alone
# misses OURA_CLIENT_SECRET and OURA_TOKEN_KEY. It also requires the LITESTREAM_*
# names the backup needs, which loadConfig doesn't read.
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

# ── What production would still miss: the names in loadConfig's own error ────
# Only that error counts: the placeholders can fail loadConfig's other checks
# (a key's length, say), which this can't judge without the real values.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checked="$(cd "$repo_root" && PRESENT_NAMES="$env_names $secret_names" node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e '
  import { loadConfig } from "./src/server/config.ts";
  const prefix = "missing required environment variables: ";
  const present = (process.env.PRESENT_NAMES ?? "").split(/\s+/).filter(Boolean);
  let missing = "";
  try {
    loadConfig({ ...Object.fromEntries(present.map((name) => [name, "placeholder"])), NODE_ENV: "production" });
  } catch (error) {
    if (error.message.startsWith(prefix)) missing = error.message.slice(prefix.length);
  }
  console.log("missing:" + missing);
')"
case "$checked" in
  missing:*) missing="${checked#missing:}" ;;
  *) skip "couldn't read the required names from config.ts" ;;
esac

# ── And the backup's names, which the entrypoint and litestream.yml read ─────
# loadConfig never sees them; without the bucket the entrypoint refuses to
# start on Fly rather than run with no backups (docker-entrypoint.sh).
present=$'\n'"$env_names"$'\n'"$secret_names"$'\n'
for name in LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY; do
  [[ "$present" == *$'\n'"$name"$'\n'* ]] || missing="${missing:+$missing, }$name"
done

if [ -n "$missing" ]; then
  echo "::error::Production won't boot without: ${missing//,/}. Set with: fly secrets set NAME=value --stage"
  exit 1
fi
echo "Fly secrets check passed: every variable config.ts and the backup require is on Fly or in $fly_toml."
