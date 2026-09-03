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
 *
 * Module 19 swapped the SELECTION half for the model, behind a per-user flag. The route
 * signature did not change and neither did the schema — `source` already distinguished
 * 'rules' from 'llm', which is what made the swap a branch here rather than a rewrite.
 */
import { createHash } from 'node:crypto';
import { handle, ok } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { recommend, seasonFor, type EngineContext } from '@/lib/recommender';
import { recommendAI } from '@/lib/recommender/ai';
import { aiEngineEnabled } from '@/lib/flags';
import { pairKey } from '@/lib/recommender/score';
import { cityKeyFor, getWeather } from '@/lib/weather';
import { publicUrlsFor } from '@/lib/storage';
import { assertBudget, localDay, recordUsage } from '@/lib/budget';
import { rerankOutfits } from '@/lib/gemini';
import { toItem, toStyleProfile, type ItemRow, type StyleProfileRow } from '@/lib/mappers';
import { toFlags } from '@/lib/flags';
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
  recommendations: {
    itemIds: string[];
    score: number;
    rationale: string | null;
    /**
     * Per outfit, because module 19's AI arm mixes them: outfits the model chose sit
     * next to rules-engine outfits that backfilled the ones validation threw out. §7's
     * comparison is only answerable if each outfit says honestly which engine made it.
     */
    source?: 'rules' | 'llm';
  }[];
  reason: string | null;
  /** Cached alongside the selection so a rerank is not re-bought on every open. */
  source?: 'rules' | 'llm';
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
    .select('city, country, timezone, wardrobe_version, flags')
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

  /**
   * The dashboard's weather select is a manual override (module 16 §4): the forecast is
   * the default, and a person who knows it will be colder than forecast should be able
   * to say so. Additive to the documented query string.
   */
  const bucketOverride = Number(params.get('tempBucket'));
  if (Number.isInteger(bucketOverride) && bucketOverride >= 0 && bucketOverride <= 4) {
    weather = weather
      ? { ...weather, tempBucket: bucketOverride as WeatherContext['tempBucket'] }
      : {
          cityKey: 'override',
          day: today,
          tempC: [5, 14, 21, 27, 34][bucketOverride] ?? 27,
          tempMinC: [2, 11, 18, 24, 30][bucketOverride] ?? 24,
          tempMaxC: [9, 17, 23, 29, 38][bucketOverride] ?? 29,
          tempBucket: bucketOverride as WeatherContext['tempBucket'],
          precipitationMm: 0,
          condition: 'As you set it',
        };
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
              source: r.source ?? cached.source ?? 'rules',
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
        source: cached.source ?? 'rules',
        reason: cached.reason,
        imageUrls: await thumbUrls(rehydrated),
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

  /**
   * Module 19 §7: the two engines run side by side behind a per-user flag until the
   * thumbs-up rate says which one to keep. `aiEngineEnabled` buckets deterministically,
   * so a user stays in one arm rather than re-rolling per request — random assignment
   * would put the same person in both arms within a session and make both numbers
   * meaningless.
   */
  const useAi = aiEngineEnabled(user.id, toFlags(profile.flags));

  let result = recommend(ctx);
  let source: 'rules' | 'llm' = 'rules';

  if (useAi) {
    /**
     * Selection AND explanation in one call — module 19 §1. The model returns a
     * rationale per outfit it chose, so the module 11 rerank below is skipped in this
     * arm: buying a second call to re-explain what the first call already explained is
     * pure waste.
     *
     * No `assertBudget` here — `recommendAI` asserts it around its own call. Doing both
     * would reserve the day's quota twice for one request, because `reserve_ai_call` is
     * an atomic reservation rather than a read.
     */
    const ai = await recommendAI(ctx);
    result = { recommendations: ai.recommendations, reason: ai.reason };
    source = ai.source;
    if (ai.inTokens > 0) await recordUsage(user.id, 'rerank', ai.inTokens, ai.outTokens);
  }

  /**
   * The premium layer — module 11 §4, §6. One model call per (user, style, day): the
   * result is cached alongside the rules selection, so refreshing does not re-buy it.
   *
   * Every failure here is silent. A free plan, an exhausted rerank budget, a model
   * outage, a response that will not parse — all of them leave the rules-engine order
   * and its mechanical rationale in place. This endpoint never returns an error
   * (module 08 §7), and a paying user's bad afternoon must not become everyone's.
   */
  if (source === 'rules' && result.recommendations.length > 1) {
    try {
      await assertBudget(user.id, 'rerank');
      const reranked = await applyRerank(result.recommendations, ctx);
      if (reranked) {
        result.recommendations = reranked.recommendations;
        source = 'llm';
        await recordUsage(user.id, 'rerank', reranked.inTokens, reranked.outTokens);
      }
    } catch (e) {
      // PREMIUM_REQUIRED and AI_BUDGET_EXCEEDED land here too; both are normal.
      console.info('[recommendations] rerank skipped', (e as Error)?.message);
    }
  }

  // Cache the selection, not the items. Failure here is not the user's problem.
  const expires = new Date(Date.now() + CACHE_TTL_HOURS * 3600_000).toISOString();
  const payload: CachedPayload = {
    recommendations: result.recommendations.map((r) => ({
      itemIds: r.items.map((i) => i.id),
      score: r.score,
      rationale: r.rationale,
      source: r.source === 'llm' ? ('llm' as const) : ('rules' as const),
    })),
    reason: result.reason,
    source,
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
    source,
    reason: result.reason,
    imageUrls: await thumbUrls(result.recommendations),
  });
});

/**
 * Describes each candidate compactly — the garments and the terms that selected it, not
 * full item rows (module 11 §4). Returns null when the model declines to be useful, so
 * the caller keeps the rules order.
 */
async function applyRerank(
  candidates: Recommendation[],
  ctx: EngineContext,
): Promise<{ recommendations: Recommendation[]; inTokens: number; outTokens: number } | null> {
  const described = candidates.map((r) => ({
    description: r.items
      .map((i) => `${i.primaryColor ?? 'unknown'} ${i.subtype ?? i.slot ?? 'item'}`)
      .join(' + '),
  }));

  const context = [
    `STYLE: ${ctx.style}`,
    ctx.weather
      ? `WEATHER: ${Math.round(ctx.weather.tempMinC)}-${Math.round(ctx.weather.tempMaxC)}C, ${ctx.weather.condition}`
      : 'WEATHER: unknown',
    `SEASON: ${ctx.season}`,
  ].join('\n');

  const result = await rerankOutfits(described, context);

  const ordered = result.data.ranked
    .flatMap<Recommendation>(({ index, rationale }) => {
      const candidate = candidates[index];
      return candidate ? [{ ...candidate, rationale, source: 'llm' }] : [];
    });

  if (ordered.length === 0) return null;

  // Anything the model dropped keeps its rules-engine rationale and its place at the
  // end, so a partial response never loses an outfit.
  const kept = new Set(ordered.map((r) => r.items.map((i) => i.id).join(':')));
  const remainder = candidates.filter((r) => !kept.has(r.items.map((i) => i.id).join(':')));

  return {
    recommendations: [...ordered, ...remainder].slice(0, ctx.limit),
    inTokens: result.inTokens,
    outTokens: result.outTokens,
  };
}

/**
 * Signed thumbnails for everything in the response — one batch call, on the server
 * (module 04 §6). Keyed by item id so the card does not need to know about paths.
 */
async function thumbUrls(recommendations: Recommendation[]): Promise<Record<string, string>> {
  const items = recommendations.flatMap((r) => r.items);
  const byPath = await publicUrlsFor(items.map((i) => i.thumbPath));

  const byId: Record<string, string> = {};
  for (const item of items) {
    const url = byPath[item.thumbPath];
    if (url) byId[item.id] = url;
  }
  return byId;
}
