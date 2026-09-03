/**
 * The recommendation engine — module 08. PURE: no database, no clock, no randomness.
 *
 * Everything it needs is in the context, which the route handler builds. That purity is
 * what makes it unit-testable against fixture wardrobes, and — more importantly — it is
 * what lets module 19 swap garment selection for a model with no migration, keeping
 * this as the fallback when the AI is unavailable (module 08 preamble, non-negotiable
 * #3). Put a database query inside this file and that swap becomes a rewrite.
 *
 * This is a scaffold, and it is honest about it: it knows hue distance, a formality
 * integer and a warmth integer. It does not know that a briefcase belongs with a suit.
 */
import type { Item, Recommendation } from '@/types';
import { STYLE_FORMALITY, TARGET_WARMTH_SUM } from '@/types';
import { assemble } from '@/lib/recommender/beam';
import { WEIGHTS } from '@/lib/recommender/score';
import type { EngineContext } from '@/lib/recommender/context';

export { seasonFor } from '@/lib/recommender/context';
export type { EngineContext } from '@/lib/recommender/context';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface EngineResult {
  recommendations: Recommendation[];
  /** Why the list is empty, for the UI to render. Never an error (module 08 §7). */
  reason: string | null;
}

/** The target formality for this request, shifted by what the user has taught us. */
export const targetFormality = (ctx: EngineContext): number =>
  clamp(STYLE_FORMALITY[ctx.style] + ctx.styleProfile.formalityBias, 1, 5);

interface FilterOptions {
  formalityWindow: number;
  seasonFilter: boolean;
}

/** Module 08 §1. Everything a candidate must satisfy to be considered at all. */
export function candidates(ctx: EngineContext, options: FilterOptions): Item[] {
  const target = targetFormality(ctx);
  const bucketWarmth = ctx.weather ? TARGET_WARMTH_SUM[ctx.weather.tempBucket] / 3 : null;

  return ctx.items.filter((item) => {
    if (item.status !== 'ready' || item.archived || item.deletedAt !== null) return false;
    if (!item.slot) return false;

    // Underwear and Sleepwear are browsable and countable, never assembled.
    if (item.categoryId && ctx.outfitEligible[item.categoryId] === false) return false;

    if (options.seasonFilter && item.seasons.length > 0) {
      if (!item.seasons.includes(ctx.season) && !item.seasons.includes('all')) return false;
    }

    // Skipped entirely with no weather, rather than guessed at.
    if (bucketWarmth !== null && item.warmth != null) {
      if (Math.abs(item.warmth - bucketWarmth) > 2) return false;
    }

    if (item.formality != null) {
      if (Math.abs(item.formality - target) > options.formalityWindow) return false;
    }

    return true;
  });
}

/** Distinct slots present, which is what "can this become an outfit" really asks. */
const slotCount = (items: Item[]): number => new Set(items.map((i) => i.slot)).size;

export function recommend(ctx: EngineContext): EngineResult {
  if (ctx.items.length === 0) {
    return { recommendations: [], reason: 'Add a few items to get outfit suggestions.' };
  }

  /**
   * The relaxation ladder — module 08 §1 fallback. Returning nothing to a user with
   * eight items is the worst possible first experience, so the filter loosens rather
   * than the answer being empty.
   */
  const ladders: FilterOptions[] = [
    { formalityWindow: 1, seasonFilter: true },
    { formalityWindow: 2, seasonFilter: true },
    { formalityWindow: 2, seasonFilter: false },
    { formalityWindow: 4, seasonFilter: false },
  ];

  /**
   * Relax until something is actually wearable, not until the pool merely looks big
   * enough. Counting surviving slots is not the same question: a pool of bottoms and
   * shoes has two slots and assembles into nothing, because every outfit needs a top
   * or a dress. Assembly is cheap and the ladder is four rungs, so ask it directly.
   */
  let outfits: Recommendation[] = [];
  let pool: Item[] = [];

  for (const options of ladders) {
    pool = candidates(ctx, options);
    if (slotCount(pool) < 2) continue;

    outfits = assemble(pool, ctx);
    if (outfits.length > 0) break;
  }

  if (outfits.length === 0) {
    return {
      recommendations: [],
      reason:
        slotCount(pool) < 2
          ? 'Add a few more items — a top and a bottom at least — to get outfit suggestions.'
          : 'Nothing in your wardrobe pairs well for this yet. Try another style.',
    };
  }

  return {
    recommendations: outfits.map((outfit) => ({
      ...outfit,
      rationale: explain(outfit, ctx),
    })),
    reason: null,
  };
}

/**
 * A mechanical rationale from the dominant terms — module 08 §6.
 *
 * Free users get *some* reason, so the feature is not empty without AI, and when
 * module 11's prose fails this is what the panel falls back to.
 */
export function explain(outfit: Recommendation, ctx: EngineContext): string {
  const parts: string[] = [];

  const colours = outfit.items
    .map((i) => i.primaryColor)
    .filter((c): c is string => Boolean(c))
    .slice(0, 2);

  if (colours.length === 2) {
    parts.push(`${colours[0]} and ${colours[1]} sit well together`);
  } else if (colours.length === 1) {
    parts.push(`${colours[0]} anchors this`);
  }

  if (ctx.weather) {
    parts.push(`it is warm enough for ${Math.round(ctx.weather.tempC)}°`);
  }

  const formalities = outfit.items
    .map((i) => i.formality)
    .filter((f): f is NonNullable<typeof f> => f != null);
  if (formalities.length > 1 && Math.max(...formalities) - Math.min(...formalities) <= 1) {
    parts.push(`the pieces are pitched at the same level for ${ctx.style.replace('-', ' ')}`);
  }

  if (parts.length === 0) return 'These work together.';

  const sentence = parts.join(', and ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export { WEIGHTS };
