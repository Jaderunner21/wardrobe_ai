#!/usr/bin/env bash
# CI — module 13 §3's downgrade behaves as specified, tested against the real function.
#
# "Deleting a user's data because they stopped paying is the kind of thing people post
# screenshots of." The assertion that nothing is deleted is the one that matters, and it
# is only meaningful when made against the SQL that actually runs.
#
# The whole script runs inside a transaction that rolls back, so it leaves no rows behind
# and is safe to point at any database with the migrations applied.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/downgrade-check.sql

echo "OK: a downgrade archives the excess and deletes nothing"
