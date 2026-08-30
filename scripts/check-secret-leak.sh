#!/usr/bin/env bash
# CI step 7 — no server secret reaches the client bundle (module 15 — Secrets).
#
# Only NEXT_PUBLIC_-prefixed variables are supposed to. The failure mode to guard
# against is importing a server module into a client component and dragging a secret
# along; Next.js catches most of these, not all.
#
# Run AFTER `pnpm build`.
set -euo pipefail

if [ ! -d .next/static ]; then
  echo "FAIL: .next/static missing — run pnpm build first"
  exit 1
fi

status=0

for name in SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY CRON_SECRET RAZORPAY_KEY_SECRET; do
  value="${!name-}"
  # A short or unset value would match everything or nothing useful.
  if [ -z "$value" ] || [ "${#value}" -lt 12 ]; then
    echo "skip: $name not set in this environment"
    continue
  fi
  if grep -rqF -- "$value" .next/static; then
    echo "LEAK: $name found in the client bundle"
    status=1
  else
    echo "OK: $name absent from .next/static"
  fi
done

exit "$status"
