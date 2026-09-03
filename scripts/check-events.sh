#!/usr/bin/env bash
# Module 14 acceptance — every event in EventName is emitted from exactly one place.
#
# Two failures this catches, both of which are silent:
#
#   * A name in the union with no emitter. The query in docs/queries.sql returns zero
#     rows and reads as "nobody did that" rather than "nobody instrumented that", which
#     is the more expensive of the two mistakes to make.
#   * A name emitted from two places. Every count doubles somewhere and nothing looks
#     wrong until the numbers are used to decide something.
#
# "One place" is counted as one FILE, not one call site. `item_deleted` fires from two
# branches of the same route — the bin and the permanent delete — with different props,
# and that is correct instrumentation rather than a duplicate. What the rule is actually
# protecting against is two unrelated modules both claiming a name, which is what makes
# a count silently double.
#
# PENDING lists names whose feature does not exist yet. They stay in the union because
# the union is module 14's contract; they are listed here so the gap is a checked fact
# rather than something to discover later. Delete a line from PENDING the moment its
# feature ships and this starts enforcing the rule for it.
set -euo pipefail

PENDING="onboarding_completed chat_message upgrade_prompt_shown upgrade_started"

names=$(sed -n "/^export type EventName =/,/;$/p" lib/events.ts \
        | grep -oE "'[a-z_]+'" | tr -d "'")

if [ -z "$names" ]; then
  echo "FAIL: could not read EventName from lib/events.ts"
  exit 1
fi

fail=0

# `|| true` on every count: grep exits 1 when a name has no emitter, which is precisely
# the case this script exists to report, and set -e would abort before it could.
for name in $names; do
  if [ "$name" = "signup" ]; then
    # Emitted by trackSignupOnce, which names it internally rather than taking it as an
    # argument. The auth callback calls it on both sign-in paths — one emitter, one file.
    count=$(grep -rlE "trackSignupOnce\(" --include=*.ts app 2>/dev/null | wc -l | tr -d ' ' || true)
  else
    count=$(grep -rlE "track\(\s*'$name'" --include=*.ts --include=*.tsx app lib 2>/dev/null \
            | wc -l | tr -d ' ' || true)
  fi

  if echo " $PENDING " | grep -q " $name "; then
    if [ "$count" -ne 0 ]; then
      echo "FAIL: $name is listed as pending but is emitted $count time(s) — remove it from PENDING"
      fail=1
    fi
    continue
  fi

  if [ "$count" -eq 0 ]; then
    echo "FAIL: $name is in EventName but nothing emits it"
    fail=1
  elif [ "$count" -gt 1 ]; then
    echo "FAIL: $name is emitted from $count files; it must be exactly one"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "See module 14's acceptance list. Pending names are declared at the top of this script."
  exit 1
fi

echo "OK: every event name has exactly one emitter"
