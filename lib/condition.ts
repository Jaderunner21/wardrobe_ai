/**
 * Wear & tear — module 18. Pure.
 *
 * USER-RATED, NEVER INFERRED (§1). A vision model can read colour and category off a
 * photograph; it cannot tell pilling from texture or a worn sole from a dark one, and a
 * wrong rating silently corrupts the retailer signal, which is the entire point of the
 * feature. So `condition` is absent from module 06's tag schema, the same rule price
 * follows in module 17 §3.
 *
 * These are the rules the SQL in 0004/0005 enforces, restated in TypeScript so the UI
 * can decide what to show without a round trip. `needsConditionRating` here and
 * `needs_condition_rating()` there must agree; the tests pin the boundaries.
 */
import type { Condition, Item, RetiredReason } from '@/types';
import { CONDITION_FIRST_PROMPT_WEARS, CONDITION_REPROMPT_WEARS, wearConfidence } from '@/types';

/** Worded so they mean the same thing to different people — module 18 §1. */
export const CONDITION_LABELS: Record<Condition, string> = {
  5: 'Like new',
  4: 'Good — no visible wear',
  3: 'Worn but fine',
  2: 'Visible wear',
  1: 'Worn out',
};

/** Short enough for a card or a chip. */
export const CONDITION_SHORT: Record<Condition, string> = {
  5: 'Like new',
  4: 'Good',
  3: 'Worn but fine',
  2: 'Visible wear',
  1: 'Worn out',
};

export const RETIRED_REASON_LABELS: Record<RetiredReason, string> = {
  worn_out: 'Worn out',
  no_longer_fits: 'No longer fits',
  disliked: "Didn't like it",
  sold: 'Sold',
  donated: 'Donated',
  lost: 'Lost',
  other: 'Something else',
};

/** At or below this, an item is failing and the wardrobe should say so — §6. */
export const NEEDS_REPLACING_AT: Condition = 2;

export const needsReplacing = (item: Pick<Item, 'condition'>): boolean =>
  item.condition !== null && item.condition <= NEEDS_REPLACING_AT;

/**
 * §3 — prompt at milestones, never every wear. Asking after every wearing turns a
 * useful feature into a chore and people stop tapping "Wore Today", which costs you
 * cost-per-wear and the recency signal too.
 *
 * First ask at 10 wears, then every 15 wears since the last rating.
 */
export function needsConditionRating(
  item: Pick<Item, 'wearCount' | 'conditionAtWear'>,
): boolean {
  if (item.wearCount < CONDITION_FIRST_PROMPT_WEARS) return false;
  if (item.conditionAtWear === null) return true;
  return item.wearCount - item.conditionAtWear >= CONDITION_REPROMPT_WEARS;
}

/** How many wears since the rating was taken. Null when it has never been rated. */
export const wearsSinceRating = (
  item: Pick<Item, 'wearCount' | 'conditionAtWear'>,
): number | null =>
  item.conditionAtWear === null ? null : Math.max(0, item.wearCount - item.conditionAtWear);

/**
 * §3b — anything leaning on wear data should say so when most of that history was
 * estimated rather than observed. A cost-per-wear built on a guessed 80 deserves the
 * caveat, and "based mostly on your estimate" is the honest way to give it.
 */
export const ESTIMATE_CAVEAT_BELOW = 0.5;

export function confidenceNote(
  item: Pick<Item, 'wearCount' | 'initialWearCount'>,
): string | null {
  if (item.wearCount === 0) return null;
  return wearConfidence(item) < ESTIMATE_CAVEAT_BELOW
    ? 'Based mostly on your estimate'
    : null;
}

/**
 * §6 — a failing garment is DEPRIORITISED in recommendations, never excluded. Whether
 * to wear a faded shirt is the user's call, not the engine's; all this does is stop
 * one being the top suggestion while something in good shape sits below it.
 */
export const CONDITION_FACTOR: Record<Condition, number> = {
  5: 1,
  4: 1,
  3: 1,
  2: 0.85,
  1: 0.7,
};

/** The multiplier for a whole outfit: the worst garment in it sets the penalty. */
export function conditionFactor(items: Pick<Item, 'condition'>[]): number {
  let factor = 1;
  for (const item of items) {
    if (item.condition === null) continue;
    factor = Math.min(factor, CONDITION_FACTOR[item.condition]);
  }
  return factor;
}
