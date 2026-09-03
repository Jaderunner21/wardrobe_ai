#!/usr/bin/env bash
# Does every column the code selects actually exist on the live database?
#
# Added after `column outfits.style does not exist` took the Outfits page down in dev.
# Typecheck, lint, tests and build all passed that day: none of them talk to Postgres,
# and `types.ts` is a hand-written description of the schema rather than a projection
# of it. This is the check that would have caught it.
#
# Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local.
# Skips silently when they are absent, so CI without credentials is unaffected.
set -euo pipefail

[ -f .env.local ] && set -a && . ./.env.local && set +a

URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "skip: no Supabase credentials in this environment"
  exit 0
fi

status=0

check () {
  local table="$1"; shift
  for column in "$@"; do
    code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' \
      "$URL/rest/v1/$table?select=$column&limit=1" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
    if [ "$code" != "200" ]; then
      echo "MISSING: $table.$column"
      status=1
    fi
  done
}

check items id user_id status storage_path thumb_path name notes category_id slot style \
  brand subtype primary_color color_hex secondary_colors pattern material formality warmth \
  seasons ai_confidence ai_model ai_raw ai_error user_edited user_tags favourite wear_count \
  last_worn_on archived deleted_at price currency purchased_on retailer cpw_target \
  cost_per_wear initial_wear_count condition condition_rated_at condition_at_wear   retired_reason retired_at
check condition_log id item_id user_id condition wear_count note created_at
check retailer_durability retailer items avg_wears avg_price avg_cost_per_wear   avg_condition avg_wears_to_decline worn_out_count
check outfits id user_id source style season temp_bucket score rationale saved planned_for
check outfit_items outfit_id item_id slot
check profiles id display_name city country timezone plan item_count wardrobe_version \
  currency cpw_target is_admin
check categories id user_id name slug icon default_slot subtypes outfit_eligible sort_order
check feedback id user_id outfit_id item_id kind worn_on
check style_profiles user_id color_affinity category_affinity formality_bias novelty_bias \
  rejected_pairs sample_count
check plan_features plan tag_limit chat_limit rerank_limit item_cap
check ai_usage user_id day tag_calls chat_calls llm_calls in_tokens out_tokens
check weather_cache city_key day payload

if [ "$status" -ne 0 ]; then
  echo
  echo "The code reads a column the database does not have. Fix with a migration."
  exit 1
fi

echo "OK: every column the code selects exists on the database"
