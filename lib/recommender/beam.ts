/**
 * Slot assembly by beam search — module 08 §4. Pure.
 *
 * top → bottom → footwear → outerwear?
 *
 * Beam width 8: at each slot every partial outfit is extended by every candidate,
 * scored, and only the best 8 survive. Bounded work regardless of wardrobe size — a
 * 200-item wardrobe costs the same as a 20-item one plus a linear scan.
 */
import type { Item, Recommendation, Slot } from '@/types';
import { TARGET_WARMTH_SUM } from '@/types';
import { conditionFactor } from '@/lib/condition';
import { meanPairScore } from '@/lib/recommender/score';
import type { EngineContext } from '@/lib/recommender/context';

export const BEAM_WIDTH = 8;

/** No two returned outfits may share more than one item (module 08 §4). */
export const MAX_SHARED_ITEMS = 1;

interface Partial {
  items: Item[];
  score: number;
}

/**
 * Outerwear is offered only when the day asks for it. Nobody wants a jacket suggested
 * for a 34° Udaipur afternoon.
 */
export function wantsOuterwear(ctx: EngineContext): boolean {
  if (!ctx.weather) return false;
  return TARGET_WARMTH_SUM[ctx.weather.tempBucket] >= 7 || ctx.weather.precipitationMm > 0;
}

export function assemble(candidates: Item[], ctx: EngineContext): Recommendation[] {
  const bySlot = (slot: Slot) => candidates.filter((i) => i.slot === slot);

  const tops = [...bySlot('top'), ...bySlot('fullbody')];
  const bottoms = bySlot('bottom');
  const footwear = bySlot('footwear');
  const outerwear = wantsOuterwear(ctx) ? bySlot('outerwear') : [];

  if (tops.length === 0) return [];

  // 1 — the top slot, which a fullbody item fills on its own.
  let partials: Partial[] = tops.map((item) => ({ items: [item], score: 0 }));

  // 2 — bottoms, skipped for any partial already carrying a fullbody garment.
  if (bottoms.length > 0) {
    const next: Partial[] = [];
    for (const p of partials) {
      if (p.items[0]?.slot === 'fullbody') {
        next.push(p); // a dress is both halves
        continue;
      }
      for (const c of bottoms) next.push(extend(p, c, ctx));
    }
    partials = topN(next, BEAM_WIDTH);
  } else {
    // Nothing to wear below the waist: only a fullbody garment can carry an outfit.
    partials = partials.filter((p) => p.items[0]?.slot === 'fullbody');
    if (partials.length === 0) return [];
  }

  // 3 — footwear, 4 — outerwear. Both optional; a wardrobe without shoes still styles.
  for (const slotCandidates of [footwear, outerwear]) {
    if (slotCandidates.length === 0) continue;
    const next: Partial[] = [];
    for (const p of partials) for (const c of slotCandidates) next.push(extend(p, c, ctx));
    partials = topN(next, BEAM_WIDTH);
  }

  return diversify(topN(partials, partials.length), ctx.limit).map((p) => ({
    items: p.items,
    slots: p.items.map((i) => i.slot).filter((s): s is Slot => s !== null),
    score: p.score,
    rationale: null, // filled by §6's template, or by module 11 for premium
    source: 'rules' as const,
  }));
}

/**
 * Module 18 §6: a garment in poor condition is DEPRIORITISED, not excluded. Whether to
 * wear a faded shirt is the user's call; all this does is stop one outranking something
 * in good shape. The factor multiplies the outfit's score rather than filtering the
 * pool, so a wardrobe where everything is worn still gets recommendations.
 */
const extend = (p: Partial, item: Item, ctx: EngineContext): Partial => {
  const items = [...p.items, item];
  return { items, score: meanPairScore(items, ctx) * conditionFactor(items) };
};

const topN = (partials: Partial[], n: number): Partial[] =>
  [...partials]
    // A vetoed combination scores 0 and never survives.
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

/**
 * Five near-identical outfits is a worse answer than three varied ones — and the
 * prototype shipped with the same jeans in both cards on one screen (module 16 §6.4).
 */
export function diversify(ranked: Partial[], limit: number): Partial[] {
  const kept: Partial[] = [];

  for (const candidate of ranked) {
    if (kept.length >= limit) break;

    const ids = new Set(candidate.items.map((i) => i.id));
    const tooSimilar = kept.some(
      (k) => k.items.filter((i) => ids.has(i.id)).length > MAX_SHARED_ITEMS,
    );

    if (!tooSimilar) kept.push(candidate);
  }
  return kept;
}
