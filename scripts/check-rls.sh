#!/usr/bin/env bash
# CI step 4 — fails the build if any public table lacks RLS (module 02 section 1).
#
# Needs SUPABASE_DB_URL pointing at a database with the migrations applied — the
# ephemeral Postgres CI spins up is enough.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

missing=$(psql "$SUPABASE_DB_URL" -At -f scripts/rls-check.sql)

if [ -n "$missing" ]; then
  echo "FAIL: these public tables have RLS disabled:"
  echo "$missing" | sed 's/^/  - /'
  echo
  echo "RLS is the authorisation layer, not a defence in depth. See module 02 section 1."
  exit 1
fi

echo "OK: every public table has RLS enabled"
