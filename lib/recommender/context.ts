/**
 * The engine's input — module 08 contracts.
 *
 * `RecommendationContext` in `types/index.ts` is the shared shape. The engine needs two
 * things it does not carry, both of which would otherwise force impurity:
 *
 *   today            — the recency term compares against a date, and `recommend` may
 *                      not read the clock (module 08: no DB, no clock, no randomness)
 *   outfitEligible   — the candidate filter excludes Underwear and Sleepwear, which is
 *                      a property of the item's category, not of the item
 *
 * Extended rather than redeclared: the shared type stays the single source of truth.
 */
import type { RecommendationContext } from '@/types';

export interface EngineContext extends RecommendationContext {
  /** ISO date in the user's timezone. Supplied by the caller, never read from a clock. */
  today: string;
  /** Category id → whether items in it may be assembled into an outfit. */
  outfitEligible: Record<string, boolean>;
}

/**
 * India's three seasons, as the tagging prompt and `Season` assume. Derived from the
 * month rather than the hemisphere because the whole product is scoped to one country
 * for the test run; when that stops being true this is the function to change.
 */
export function seasonFor(isoDate: string): 'summer' | 'monsoon' | 'winter' {
  const month = Number(isoDate.slice(5, 7));
  if (month >= 3 && month <= 6) return 'summer';
  if (month >= 7 && month <= 9) return 'monsoon';
  return 'winter';
}
