#!/usr/bin/env bash
# CI step 6 — every Gemini call site calls assertBudget first (module 12, module 15).
#
# The guard is only a guard if nothing can route around it. Any file that calls the
# model must also call assertBudget; lib/gemini.ts itself is the one exception, since
# it is the wrapper the guard is applied around.
#
# Vacuously true until module 12 and module 06 land. It stays in CI from L0 so the
# first Gemini call ever written arrives with the check already watching.
set -euo pipefail

fail=0

while IFS= read -r file; do
  [ "$file" = "lib/gemini.ts" ] && continue
  if ! grep -q "assertBudget" "$file"; then
    echo "FAIL: $file calls the model without assertBudget"
    fail=1
  fi
done < <(grep -rl -E "generateContent|from '@/lib/gemini'|from \"@/lib/gemini\"" \
           --include='*.ts' --include='*.tsx' app lib 2>/dev/null || true)

if [ "$fail" -ne 0 ]; then
  echo
  echo "Every model call goes through the daily per-user cap. See module 12 §2."
  exit 1
fi

echo "OK: every Gemini call site is budget-guarded"
