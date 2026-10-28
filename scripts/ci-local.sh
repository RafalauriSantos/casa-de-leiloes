#!/usr/bin/env bash
# Runs `make ci` the way GitHub Actions does (.github/workflows/ci.yml), on this machine: the Node version of .nvmrc,
# dependencies installed from the lockfile, an empty database (migrations only, no seed), fresh secrets and a clean
# environment. A green run here is the same check as the PR's `ci` job, so GitHub's minutes are not needed for it.
set -euo pipefail
cd "$(dirname "$0")/.."

expected=$(tr -d 'v[:space:]' < .nvmrc)
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" != "$expected" ]; then
  echo "Node $expected is expected (see .nvmrc), but $(node -v) is running." >&2
  exit 1
fi

echo "== dependencies from the lockfile"
rm -rf node_modules
npm ci

echo "== local Supabase stack recreated from zero: empty database and services ready, as on a fresh runner"
npx supabase stop --no-backup > /dev/null
npx supabase start > /dev/null

echo "== fresh secrets, as on a fresh runner"
rm -f .env.dev-secrets

echo "== make ci in a clean environment"
exec env -i PATH="$PATH" HOME="$HOME" TERM="${TERM:-dumb}" make ci
