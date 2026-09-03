/**
 * GET /api/recommendations — module 08 §5, §7.
 *
 * This handler does all the impure work — reads the wardrobe, the style profile, the
 * weather, the cache — and hands a plain object to `recommend()`, which is pure. That
 * split is what lets module 19 replace selection with a model and keep these rules as
 * the fallback.
 *
 * It never returns an error. Degradation, in order: full scoring with weather → no
 * weather, thermal term dropped and the rest renormalised → relaxed filters → an empty
 * list with a `reason` the UI can render.
 */
import { createHash } from 'node:crypto';
import { handle, ok } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { recommend, seasonFor, type EngineContext } from '@/lib/recommender';
import { pairKey } from '@/lib/recommender/score';
import { cityKeyFor, getWeather } from '@/lib/weather';
import { localDay } from '@/lib/budget';
import { toItem, toStyleProfile, type ItemRow, type StyleProfileRow } from '@/lib/mappers';
import { STYLES } from '@/app/api/items/schemas';
import type { Item, Recommendation, Style, WeatherContext } from '@/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_HOURS = 24;

/**
 * Everything the scorer reads. Not ITEM_LIST_COLUMNS — that view has no `last_worn_on`,
 * which the recency term needs — and emphatically not `select('*')`, which would drag
 * `ai_raw` across the wire for every item in the wardrobe.
 */
const RECOMMENDER_SELECT =
  'id, user_id, status, storage_path, thumb_path, bytes, width, height, content_hash, name, notes, category_id, slot, style, brand, subtype, primary_color, color_hex, secondary_colors, pattern, material, formality, warmth, seasons, ai_confidence, ai_model, user_edited, user_tags, favourite, wear_count, last_worn_on, archived, deleted_at, created_at, price, currency, purchased_on, retailer, cpw_target, cost_per_wear, initial_wear_count, condition, condition_rated_at, condition_at_wear, retired_reason, retired_at';

const STYLE_PROFILE_COLUMNS =
  'user_id, color_affinity, category_affinity, formality_bias, novelty_bias, rejected_pairs, sample_count, updated_at';

/** Cached per wardrobe version, so it invalidates on change rather than on a timer. */
const cacheKeyFor = (style: string, bucket: number | null, wardrobeVersion: number) =>
  createHash('md5').update(`${style}:${bucket ?? 'none'}:${wardrobeVersion}`).digest('hex');

interface CachedPayload {
  recommendations: { itemIds: string[]; score: number; rationale: string | null }[];
  reason: string | null;
}

export const GET = handle(async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;

  const styleParam = params.get('style') ?? 'casual';
  const style = (STYLES as readonly string[]).includes(styleParam)
    ? (styleParam as Style)
    : 'casual';
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 5) || 5, 1), 10);
  const refresh = params.get('refresh') === 'true';

  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('city, country, timezone, wardrobe_version')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;
  if (!profile) throw appError('NOT_FOUND');

  const timezone = profile.timezone ?? 'Asia/Kolkata';
  const today = localDay(timezone);

  // A weather outage makes recommendations weather-blind, never broken (module 07 §5).
  let weather: WeatherContext | null = null;
  if (profile.city) {
    weather = await getWeather(cityKeyFor(profile.city, profile.country ?? 'IN'), today);
  }

  const cacheKey = cacheKeyFor(style, weather?.tempBucket ?? null, profile.wardrobe_version ?? 0);

  const [itemsRes, styleRes, categoriesRes, seenRes, cacheRes] = await Promise.all([
    supabase
      .from('items')
      .select(RECOMMENDER_SELECT)
      .eq('status', 'ready')
      .eq('archived', false)
      .is('deleted_at', null),
    supabase.from('style_profiles').select(STYLE_PROFILE_COLUMNS).eq('user_id', user.id).single(),
    supabase.from('categories').select('id, outfit_eligible'),
    supabase.from('outfit_items').select('outfit_id, item_id'),
    refresh
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from('recommendation_cache')
          .select('payload, expires_at')
          .eq('user_id', user.id)
          .eq('cache_key', cacheKey)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle(),
  ]);

  if (itemsRes.error) throw itemsRes.error;

  const items: Item[] = ((itemsRes.data ?? []) as unknown as ItemRow[]).map(toItem);
  const byId = new Map(items.map((i) => [i.id, i]));

  // A cache hit still rehydrates from live rows, so a renamed item is not stale in a
  // cached outfit — only the *selection* is cached, never the item data.
  if (cacheRes.data?.payload) {
    const cached = cacheRes.data.payload as CachedPayload;
    const rehydrated = cached.recommendations
      .map((r) => {
        const outfitItems = r.itemIds
          .map((id) => byId.get(id))
          .filter((i): i is Item => i !== undefined);
        return outfitItems.length === r.itemIds.length
          ? ({
              items: outfitItems,
              slots: outfitItems.map((i) => i.slot).filter((s) => s !== null),
              score: r.score,
              rationale: r.rationale,
              source: 'rules',
            } as Recommendation)
          : null;
      })
      .filter((r): r is Recommendation => r !== null);

    // A binned item can make a cached outfit unrecoverable; fall through and recompute.
    if (rehydrated.length === cached.recommendations.length) {
      return ok({
        recommendations: rehydrated,
        weather,
        cached: true,
        source: 'rules',
        reason: cached.reason,
      });
    }
  }

  const outfitEligible: Record<string, boolean> = {};
  for (const row of (categoriesRes.data ?? []) as unknown as {
    id: string;
    outfit_eligible: boolean;
  }[]) {
    outfitEligible[row.id] = row.outfit_eligible;
  }

  // Pairs the user has already been shown, for the novelty term.
  const seenPairs = new Set<string>();
  const byOutfit = new Map<string, string[]>();
  for (const row of (seenRes.data ?? []) as unknown as {
    outfit_id: string;
    item_id: string;
  }[]) {
    byOutfit.set(row.outfit_id, [...(byOutfit.get(row.outfit_id) ?? []), row.item_id]);
  }
  for (const ids of byOutfit.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (a && b) seenPairs.add(pairKey(a, b));
      }
    }
  }

  const ctx: EngineContext = {
    userId: user.id,
    items,
    styleProfile: styleRes.data
      ? toStyleProfile(styleRes.data as unknown as StyleProfileRow)
      : {
          userId: user.id,
          colorAffinity: {},
          categoryAffinity: {},
          formalityBias: 0,
          noveltyBias: 0.5,
          rejectedPairs: [],
          sampleCount: 0,
          updatedAt: today,
        },
    style,
    weather,
    season: seasonFor(today),
    seenPairs,
    limit,
    today,
    outfitEligible,
  };

  const result = recommend(ctx);

  // Cache the selection, not the items. Failure here is not the user's problem.
  const expires = new Date(Date.now() + CACHE_TTL_HOURS * 3600_000).toISOString();
  const payload: CachedPayload = {
    recommendations: result.recommendations.map((r) => ({
      itemIds: r.items.map((i) => i.id),
      score: r.score,
      rationale: r.rationale,
    })),
    reason: result.reason,
  };

  const { error: cacheError } = await supabase
    .from('recommendation_cache')
    .upsert(
      { user_id: user.id, cache_key: cacheKey, payload, expires_at: expires },
      { onConflict: 'user_id,cache_key' },
    );
  if (cacheError) console.error('[recommendations] cache write failed', cacheError);

  return ok({
    recommendations: result.recommendations,
    weather,
    cached: false,
    source: 'rules',
    reason: result.reason,
  });
});
