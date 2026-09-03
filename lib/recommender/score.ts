/**
 * Pair scoring — module 08 §2. Pure.
 *
 * Weights sum to 1.0. When the thermal term is unavailable (no weather) it is dropped
 * and the rest renormalise — substituting a neutral 0.5 would bias every score toward
 * the middle, which quietly flattens the ranking that is the entire point.
 */
import type { Item, ScoredPair, ScoreTerms } from '@/types';
import { TARGET_WARMTH_SUM } from '@/types';
import { colorHarmony } from '@/lib/recommender/color';
import type { EngineContext } from '@/lib/recommender/context';

export const WEIGHTS = {
  colorHarmony: 0.3,
  formalityCoherence: 0.2,
  thermalFit: 0.2,
  styleAffinity: 0.15,
  recency: 0.1,
  novelty: 0.05,
} as const;

/** An order-insensitive key, so (a,b) and (b,a) are the same pair everywhere. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const daysBetween = (fromIso: string, toIso: string): number =>
  Math.floor(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );

/**
 * The user told you three times. This is a veto, not a penalty: the pair scores 0 and
 * is discarded (module 08 §2).
 */
export function isVetoed(a: Item, b: Item, rejected: [string, string][]): boolean {
  const x = a.primaryColor?.toLowerCase();
  const y = b.primaryColor?.toLowerCase();
  if (!x || !y) return false;

  return rejected.some(([p, q]) => {
    const l = p.toLowerCase();
    const r = q.toLowerCase();
    return (l === x && r === y) || (l === y && r === x);
  });
}

function recencyTerm(a: Item, b: Item, today: string): number {
  const gaps = [a.lastWornOn, b.lastWornOn]
    .filter((d): d is string => Boolean(d))
    .map((d) => daysBetween(d, today));

  if (gaps.length === 0) return 1;
  const closest = Math.min(...gaps);

  if (closest <= 3) return 0.4;
  if (closest <= 7) return 0.6;
  return 1;
}

function styleAffinityTerm(a: Item, b: Item, affinity: Record<string, number>): number {
  const colours = [a.primaryColor, b.primaryColor].filter((c): c is string => Boolean(c));
  if (colours.length === 0) return 0.5;

  // affinity runs −1..+1; map to 0..1 so it composes with the other terms.
  const mean =
    colours.reduce((sum, c) => sum + ((affinity[c.toLowerCase()] ?? 0) + 1) / 2, 0) /
    colours.length;
  return mean;
}

export function scorePair(a: Item, b: Item, ctx: EngineContext): ScoredPair {
  const terms: ScoreTerms = {
    colorHarmony: a.colorHex && b.colorHex ? colorHarmony(a.colorHex, b.colorHex) : 0.5,

    formalityCoherence:
      a.formality != null && b.formality != null
        ? 1 - Math.abs(a.formality - b.formality) / 4
        : 0.5,

    thermalFit: thermalFit([a, b], ctx),

    styleAffinity: styleAffinityTerm(a, b, ctx.styleProfile.colorAffinity),

    recency: recencyTerm(a, b, ctx.today),

    // A combination the user has already been shown is worth less than a new one.
    novelty: ctx.seenPairs.has(pairKey(a.id, b.id)) ? 0.3 : 1,
  };

  return {
    a,
    b,
    score: isVetoed(a, b, ctx.styleProfile.rejectedPairs) ? 0 : combine(terms, ctx),
    terms,
  };
}

/** How close the outfit's total warmth is to what the day calls for. */
export function thermalFit(items: Item[], ctx: EngineContext): number {
  if (!ctx.weather) return 0; // dropped, not defaulted — see combine()
  const target = TARGET_WARMTH_SUM[ctx.weather.tempBucket];
  const sum = items.reduce((total, i) => total + (i.warmth ?? 3), 0);
  return Math.max(0, 1 - Math.abs(sum - target) / 6);
}

/**
 * Weighted sum. With no weather the thermal weight is removed and the remaining five
 * are rescaled to sum to 1 — module 08 §2 and the degradation ladder in §7.
 */
export function combine(terms: ScoreTerms, ctx: EngineContext): number {
  const usable = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter(
    (term) => ctx.weather !== null || term !== 'thermalFit',
  );

  const total = usable.reduce((sum, term) => sum + WEIGHTS[term], 0);
  const score = usable.reduce((sum, term) => sum + WEIGHTS[term] * terms[term], 0);

  return score / total;
}

/** An outfit's score is the mean of its pair scores, so 3- and 4-item outfits compare. */
export function meanPairScore(items: Item[], ctx: EngineContext): number {
  if (items.length < 2) return 0;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      const { score } = scorePair(a, b, ctx);
      if (score === 0) return 0; // a vetoed pair vetoes the whole outfit
      sum += score;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}
