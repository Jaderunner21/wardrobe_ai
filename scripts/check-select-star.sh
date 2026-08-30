#!/usr/bin/env bash
# CI step 5 — no `select('*')` anywhere (module 02 §3, module 15).
#
# `items` carries an `ai_raw`-sized payload no list view needs. At production scale
# select('*') on the wardrobe grid takes Supabase egress from 1.29 GB/month to 4.29 GB
# against a 5 GB free ceiling. At 15 users it is invisible, which is exactly why the
# habit has to be built now.
set -euo pipefail

if grep -rnE "\.select\(\s*['\"\`]\*" --include='*.ts' --include='*.tsx' app lib components 2>/dev/null; then
  echo
  echo "FAIL: select('*') found. Declare the columns — see types/index.ts ITEM_LIST_COLUMNS."
  exit 1
fi

echo "OK: no select('*')"
