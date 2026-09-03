#!/usr/bin/env bash
# The tagger must never guess at condition or purchase history.
#
# Module 18 §1 and module 17 §3 are the same rule twice: a model can read colour and
# category off a photo, but it cannot tell pilling from texture or know what something
# cost. A wrong condition rating silently corrupts the retailer durability signal,
# which is the entire point of collecting it, and there is no way to notice from the
# outside that it was invented.
#
# So this is not a style preference — it is the guarantee that those numbers came from
# the user. Adding one of these fields to the tag schema is a one-line change that
# nothing else in the test suite would catch, which is exactly what a guard is for.
set -euo pipefail

FORBIDDEN='condition|price|retailer|purchasedOn|purchased_on|cpwTarget|wearCount|wear_count'

# The Zod schema, the responseSchema handed to Gemini, and the prompt that describes
# them all live in lib/gemini.ts. The tag route must not write these columns either.
hits=$(grep -nE "\"?($FORBIDDEN)\"?\s*:" lib/gemini.ts || true)

if [ -n "$hits" ]; then
  echo "The tag schema mentions a field the model must never fill:"
  echo "$hits"
  echo
  echo "Condition (module 18 §1) and purchase history (module 17 §3) are user-entered."
  exit 1
fi

route_hits=$(grep -nE "($FORBIDDEN)" app/api/items/tag/route.ts || true)
if [ -n "$route_hits" ]; then
  echo "The tag route touches a user-entered field:"
  echo "$route_hits"
  exit 1
fi

echo "ok: the tagger fills no user-entered field"
