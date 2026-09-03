/**
 * The AI recommendation engine — module 19.
 *
 * Module 08 has two jobs and this module takes exactly one of them. The FILTER stays:
 * season, weather, formality window, eligibility and status are cheap, deterministic,
 * and stop the model ever seeing a winter coat in a Udaipur summer. The SELECTION moves
 * to the model, because a colour-wheel heuristic knows hue distance and two integers,
 * and does not know that a briefcase belongs with a suit or that a floral summer dress
 * does not take hiking boots. Those are not gaps you close by adding scoring terms.
 *
 * Nothing about the data model changes and there is no migration for the engine itself.
 * That is the payoff for having built module 08 as a pure function over a context.
 *
 * ── VALIDATION IS THE WHOLE SAFETY PROPERTY ─────────────────────────────────────────
 * The model returns ids. Every one is checked against the candidate set that was sent,
 * and an outfit containing an id that was not in that set is DISCARDED — not repaired,
 * not queried, discarded. Without that check the product suggests clothes the user does
 * not own, which is worse than suggesting nothing. `validate()` below is the only reason
 * it is safe to let a language model name garments at all.
 *
 * Every failure path lands on the rules engine, which is built and tested and now has a
 * second job: it is the reason this module can fail safely.
 *
 * The daily cap is asserted HERE rather than by the caller. Module 12's rule is that a
 * model call site guards itself, and the CI check enforces it precisely so a second
 * caller of `recommendAI` cannot appear later without one. A refusal is not an error
 * either: an exhausted budget lands on the rules engine like every other failure, and
 * §6 is explicit that the user needs no message — they get outfits either way.
 */
import type { Item, Recommendation, Slot } from '@/types';
import { MAX_SHARED_ITEMS } from '@/lib/recommender/beam';
import { isVetoed, meanPairScore } from '@/lib/recommender/score';
import { candidatePool, recommend, type EngineResult } from '@/lib/recommender';
import { conditionFactor } from '@/lib/condition';
import { selectOutfits, type SelectedOutfit } from '@/lib/gemini';
import { assertBudget } from '@/lib/budget';
import type { EngineContext } from '@/lib/recommender/context';

/** §4's label. Kept here so the UI and the prompt cannot drift apart on the wording. */
export const STRETCH_LABEL = 'Something different';

/**
 * A hard ceiling on what goes into the prompt. Module 19's acceptance asks that a
 * 200-item wardrobe fit after filtering; the filter usually leaves 15-30, but a user
 * with 200 all-season casual garments and no weather is a real shape. At ~18 tokens a
 * line this is roughly 2,200 tokens of candidates, comfortably inside the window and
 * cheap enough to run daily.
 */
export const MAX_CANDIDATES = 120;

export interface AiResult extends EngineResult {
  source: 'rules' | 'llm';
  inTokens: number;
  outTokens: number;
}

export async function recommendAI(ctx: EngineContext): Promise<AiResult> {
  const fallback = recommend(ctx);

  const pool = candidatePool(ctx);
  // Two slots is the minimum that can become an outfit at all; below that the rules
  // engine's own "add a few more items" reason is the honest answer, not a model call.
  if (new Set(pool.map((i) => i.slot)).size < 2) {
    return { ...fallback, source: 'rules', inTokens: 0, outTokens: 0 };
  }

  const candidates = trim(pool, ctx);
  const byId = new Map(candidates.map((i) => [i.id, i]));

  try {
    await assertBudget(ctx.userId, 'rerank');

    const result = await selectOutfits(
      candidates.map(describe),
      contextLines(ctx),
      ctx.limit,
    );

    const outfits = validate(result.data.outfits, byId, ctx);

    // Module 19 §2: if fewer than asked survive, backfill from the rules engine rather
    // than asking the model again — a second call doubles the cost to fix a response
    // that was already wrong once.
    const filled = backfill(outfits, fallback.recommendations, ctx.limit);

    if (filled.length === 0) {
      return { ...fallback, source: 'rules', inTokens: result.inTokens, outTokens: result.outTokens };
    }

    return {
      recommendations: filled,
      reason: null,
      // 'llm' only when the model actually contributed something that survived.
      source: filled.some((r) => r.source === 'llm') ? 'llm' : 'rules',
      inTokens: result.inTokens,
      outTokens: result.outTokens,
    };
  } catch (e) {
    // Model unavailable, malformed response, budget refusal — all the same answer.
    console.info('[recommendations] AI selection unavailable', (e as Error)?.message);
    return { ...fallback, source: 'rules', inTokens: 0, outTokens: 0 };
  }
}

/**
 * Turn the model's answer into outfits, discarding anything that fails a check the
 * model is not trusted to have made itself.
 */
export function validate(
  selected: SelectedOutfit[],
  byId: Map<string, Item>,
  ctx: EngineContext,
): Recommendation[] {
  const kept: Recommendation[] = [];

  for (const outfit of selected) {
    // 1. Every id must be one we sent. An unknown id is an invented garment.
    const items = outfit.itemIds.map((id) => byId.get(id));
    if (items.some((i) => i === undefined)) continue;

    const real = items as Item[];

    // 2. No duplicates. "Two shirts" is a response, not an outfit.
    if (new Set(real.map((i) => i.id)).size !== real.length) continue;

    // 3. Wearable: a top and a bottom, or one full-body garment (§3's first rule).
    if (!isWearable(real)) continue;

    /**
     * 4. The vetoes are absolute — module 19 §4. The user told us three times that navy
     * does not go with black (module 10 §3); a model that proposes it anyway is
     * overruled here rather than argued with in the prompt. This is the one place where
     * the learned profile is law rather than preference.
     */
    if (hasVetoedPair(real, ctx)) continue;

    // 5. Diversity — module 08 §4, and the prototype bug in module 16 §6.4: the same
    // jeans appeared in two cards on one screen.
    const ids = new Set(real.map((i) => i.id));
    if (kept.some((k) => k.items.filter((i) => ids.has(i.id)).length > MAX_SHARED_ITEMS)) continue;

    kept.push({
      items: real,
      slots: real.map((i) => i.slot).filter((s): s is Slot => s !== null),
      // Scored with the rules engine so an AI outfit and a backfilled one are on one
      // scale, and so the match badge means the same thing in both arms.
      score: meanPairScore(real, ctx) * conditionFactor(real),
      rationale: outfit.stretch ? `${STRETCH_LABEL} — ${outfit.rationale}` : outfit.rationale,
      source: 'llm',
    });
  }

  return kept;
}

/** A top and a bottom, or one full-body garment. Accessories never carry an outfit. */
export function isWearable(items: Item[]): boolean {
  const slots = new Set(items.map((i) => i.slot));
  if (slots.has('fullbody')) return true;
  return slots.has('top') && slots.has('bottom');
}

function hasVetoedPair(items: Item[], ctx: EngineContext): boolean {
  const rejected = ctx.styleProfile.rejectedPairs;
  if (rejected.length === 0) return false;

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a && b && isVetoed(a, b, rejected)) return true;
    }
  }
  return false;
}

/**
 * Top up with rules-engine outfits, skipping any that overlap what the model already
 * chose by more than one garment. A backfilled outfit keeps `source: 'rules'`, so the
 * response can say honestly which engine produced what.
 */
export function backfill(
  aiOutfits: Recommendation[],
  ruleOutfits: Recommendation[],
  limit: number,
): Recommendation[] {
  const filled = [...aiOutfits];

  for (const candidate of ruleOutfits) {
    if (filled.length >= limit) break;
    const ids = new Set(candidate.items.map((i) => i.id));
    const overlaps = filled.some(
      (k) => k.items.filter((i) => ids.has(i.id)).length > MAX_SHARED_ITEMS,
    );
    if (!overlaps) filled.push(candidate);
  }

  return filled.slice(0, limit);
}

/**
 * One line per garment — module 19 §3. Attributes, never images: the attributes are
 * enough to style with and images would cost twenty times the tokens for information
 * the tagger already extracted.
 */
export function describe(item: Item): string {
  const parts = [
    item.id,
    item.name ?? item.subtype ?? 'item',
    item.slot ?? 'unknown',
    item.primaryColor ?? 'unknown colour',
    `formality ${item.formality ?? '?'}`,
    `warmth ${item.warmth ?? '?'}`,
    item.lastWornOn ? `worn ${item.lastWornOn}` : 'never worn',
  ];
  return `  ${parts.join('  ')}`;
}

/** The occasion, the weather, and what the user has taught us — §3's CONTEXT block. */
export function contextLines(ctx: EngineContext): string {
  const { colorAffinity, rejectedPairs } = ctx.styleProfile;

  const sorted = Object.entries(colorAffinity).sort((a, b) => b[1] - a[1]);
  const prefers = sorted.filter(([, v]) => v > 0.2).slice(0, 5).map(([c]) => c);
  const avoids = sorted.filter(([, v]) => v < -0.2).slice(-5).map(([c]) => c);

  const lines = [
    `  occasion: ${ctx.style}`,
    `  season: ${ctx.season}`,
    ctx.weather
      ? `  weather: ${Math.round(ctx.weather.tempC)}C, ${ctx.weather.condition}${
          ctx.weather.precipitationMm > 0 ? ', rain' : ''
        }`
      : '  weather: unknown — do not reason about temperature',
  ];

  if (prefers.length > 0) lines.push(`  prefers: ${prefers.join(', ')}`);
  if (avoids.length > 0) lines.push(`  avoids: ${avoids.join(', ')}`);
  for (const [a, b] of rejectedPairs.slice(0, 10)) {
    lines.push(`  never pair ${a} with ${b}`);
  }

  return lines.join('\n');
}

/**
 * Keep the prompt bounded on a large wardrobe. Least-recently-worn first, because §3's
 * own rule is "prefer garments not worn recently" — so if a wardrobe has to be cut, the
 * garments the model was going to skip anyway are the ones to cut.
 *
 * Every slot keeps a share, or a 200-item wardrobe of tops would arrive with no shoes.
 */
export function trim(pool: Item[], ctx: EngineContext): Item[] {
  if (pool.length <= MAX_CANDIDATES) return pool;

  const bySlot = new Map<string, Item[]>();
  for (const item of pool) {
    const key = item.slot ?? 'unknown';
    bySlot.set(key, [...(bySlot.get(key) ?? []), item]);
  }

  const share = Math.max(4, Math.floor(MAX_CANDIDATES / bySlot.size));
  const kept: Item[] = [];

  for (const items of bySlot.values()) {
    const ordered = [...items].sort((a, b) => staleness(b, ctx) - staleness(a, ctx));
    kept.push(...ordered.slice(0, share));
  }

  return kept.slice(0, MAX_CANDIDATES);
}

/** Days since it was last worn; never-worn sorts first, as the most overdue thing there is. */
const staleness = (item: Item, ctx: EngineContext): number => {
  if (!item.lastWornOn) return Number.MAX_SAFE_INTEGER;
  return Math.floor(
    (Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${item.lastWornOn}T00:00:00Z`)) / 86_400_000,
  );
};
