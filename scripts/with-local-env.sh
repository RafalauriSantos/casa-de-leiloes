#!/usr/bin/env bash
# Runs a command with the environment of the local Supabase stack (must be running: make db-up).
# The audit-chain and cron secrets are generated once and kept in .env.dev-secrets (git-ignored), so
# data created in one run (the seed, later) still verifies in the next. Delete the file to rotate them.
set -euo pipefail
cd "$(dirname "$0")/.."

status=$(npx supabase status -o env 2>/dev/null) || {
  echo "Local Supabase is not running. Start it with: make db-up" >&2
  exit 1
}
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }

export SUPABASE_URL="$(get API_URL)"
export SUPABASE_ANON_KEY="$(get ANON_KEY)"
export DATABASE_URL="$(get DB_URL)"
export VITE_SUPABASE_URL="$SUPABASE_URL"
export VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
secrets=".env.dev-secrets"
if [ ! -f "$secrets" ]; then
  ( umask 077; printf 'AUDIT_HMAC_SECRET=%s\nCRON_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > "$secrets" )
fi
while IFS="=" read -r key value; do
  [ -n "$key" ] && [ -z "${!key:-}" ] && export "$key=$value"
done < "$secrets"
exec "$@"
