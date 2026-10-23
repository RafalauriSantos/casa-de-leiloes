#!/usr/bin/env bash
# Runs a command with the environment of the local Supabase stack (must be running: make db-up).
# Secrets for the audit chain and the cron are random per run and exist only for the command.
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
export AUDIT_HMAC_SECRET="${AUDIT_HMAC_SECRET:-$(openssl rand -hex 32)}"
export CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 24)}"
exec "$@"
