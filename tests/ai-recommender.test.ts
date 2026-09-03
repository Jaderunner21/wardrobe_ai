/**
 * The AI recommendation engine — module 19.
 *
 * Almost everything here tests ONE property: the model names garments, and nothing it
 * names is trusted. Module 19 §2 puts it plainly — "without it the product suggests
 * clothes the user does not own, which is worse than suggesting nothing." A scoring bug
 * makes a bad outfit; a validation bug makes the app lie about what is in your wardrobe.
 *
 * The model is never called. `validate`, `backfill`, `trim` and the prompt builders are
 * pure functions over a response object, which is what lets a recorded bad response —
 * an invented id, a vetoed pair, a duplicated garment — be tested exactly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backfill,
  contextLines,
  describe as describeItem,
  isWearable,
  MAX_CANDIDATES,
  STRETCH_LABEL,
  trim,
  validate,
} from '@/lib/recommender/ai';
import { candidatePool } from '@/lib/recommender';
import { aiEngineEnabled, assignmentOf, AI_ROLLOUT, hashToUnit, toFlags } from '@/lib/flags';
import type { SelectedOutfit } from '@/lib/gemini';
import type { EngineContext } from '@/lib/recommender/context';
import type { Item, Recommendation, Season, Slot, StyleProfile } from '@/types';

let seq = 0;

function item(partial: Partial<Item> & { slot: Slot }): Item {
  seq += 1;
  return {
    id: `i${seq}`,
    userId: 'u1',
    status: 'ready',
    storagePath: `items/u1/${seq}.webp`,
    thumbPath: `items/u1/${seq}_t.webp`,
    bytes: 1000,
    width: 800,
    height: 800,
    contentHash: null,
    name: null,
    notes: null,
    categoryId: 'cat-generic',
    style: 'casual',
    brand: null,
    subtype: null,
    primaryColor: 'navy',
    colorHex: '#000080',
    secondaryColors: [],
    pattern: 'solid',
    material: 'cotton',
    formality: 2,
    warmth: 2,
    seasons: ['all'] as Season[],
    aiConfidence: 0.9,
    aiModel: null,
    userEdited: false,
    userTags: [],
    favourite: false,
    wearCount: 0,
    lastWornOn: null,
    archived: false,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    price: null,
    currency: null,
    purchasedOn: null,
    retailer: null,
    cpwTarget: null,
    costPerWear: null,
    initialWearCount: 0,
    condition: null,
    conditionRatedAt: null,
    conditionAtWear: null,
    retiredReason: null,
    retiredAt: null,
    ...partial,
  };
}

const profile = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  userId: 'u1',
  colorAffinity: {},
  categoryAffinity: {},
  formalityBias: 0,
  noveltyBias: 0.5,
  rejectedPairs: [],
  sampleCount: 0,
  updatedAt: '2026-09-01',
  ...over,
});

function context(items: Item[], over: Partial<EngineContext> = {}): EngineContext {
  return {
    userId: 'u1',
    items,
    styleProfile: profile(),
    style: 'casual',
    weather: null,
    season: 'summer',
    seenPairs: new Set<string>(),
    limit: 5,
    today: '2026-09-03',
    outfitEligible: { 'cat-generic': true },
    ...over,
  };
}

const outfit = (itemIds: string[], over: Partial<SelectedOutfit> = {}): SelectedOutfit => ({
  itemIds,
  rationale: 'These work together.',
  stretch: false,
  ...over,
});

const mapOf = (items: Item[]) => new Map(items.map((i) => [i.id, i]));

describe('validate — the safety property', () => {
  const top = item({ slot: 'top', primaryColor: 'white', colorHex: '#ffffff' });
  const bottom = item({ slot: 'bottom', primaryColor: 'beige', colorHex: '#e8dcc8' });
  const shoes = item({ slot: 'footwear', primaryColor: 'brown', colorHex: '#7b4a22' });
  const wardrobe = [top, bottom, shoes];

  it('keeps an outfit built entirely from garments we sent', () => {
    const kept = validate([outfit([top.id, bottom.id, shoes.id])], mapOf(wardrobe), context(wardrobe));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.items.map((i) => i.id)).toEqual([top.id, bottom.id, shoes.id]);
    expect(kept[0]!.source).toBe('llm');
  });

  it('DISCARDS an outfit containing a garment the user does not own', () => {
    // The whole point of the module. An id we never sent is an invented garment.
    const kept = validate(
      [outfit([top.id, bottom.id, 'a-shirt-that-does-not-exist'])],
      mapOf(wardrobe),
      context(wardrobe),
    );
    expect(kept).toHaveLength(0);
  });

  it('keeps the valid outfits when only some contain an invented id', () => {
    const kept = validate(
      [outfit([top.id, 'ghost']), outfit([top.id, bottom.id])],
      mapOf(wardrobe),
      context(wardrobe),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.items.map((i) => i.id)).toEqual([top.id, bottom.id]);
  });

  it('discards an outfit that wears the same garment twice', () => {
    expect(validate([outfit([top.id, top.id, bottom.id])], mapOf(wardrobe), context(wardrobe))).toHaveLength(0);
  });

  it('discards something that is not wearable — two tops is not an outfit', () => {
    const other = item({ slot: 'top' });
    const pool = [...wardrobe, other];
    expect(validate([outfit([top.id, other.id])], mapOf(pool), context(pool))).toHaveLength(0);
  });

  it('never lets a vetoed pair through, even when the model proposes it', () => {
    // The user said no three times (module 10 §3). That is law, not preference.
    const navyTop = item({ slot: 'top', primaryColor: 'navy' });
    const blackBottom = item({ slot: 'bottom', primaryColor: 'black' });
    const pool = [navyTop, blackBottom];
    const ctx = context(pool, { styleProfile: profile({ rejectedPairs: [['navy', 'black']] }) });

    expect(validate([outfit([navyTop.id, blackBottom.id])], mapOf(pool), ctx)).toHaveLength(0);
  });

  it('does not let two returned outfits share more than one garment', () => {
    const bottom2 = item({ slot: 'bottom', primaryColor: 'grey' });
    const pool = [...wardrobe, bottom2];
    const kept = validate(
      [outfit([top.id, bottom.id, shoes.id]), outfit([top.id, bottom.id, shoes.id])],
      mapOf(pool),
      context(pool),
    );
    expect(kept).toHaveLength(1);
  });

  it('labels the stretch outfit and leaves the others unlabelled', () => {
    // Two outfits sharing nothing, so both survive the diversity rule and the labelling
    // is the only thing under test.
    const top2 = item({ slot: 'top', primaryColor: 'olive' });
    const bottom2 = item({ slot: 'bottom', primaryColor: 'grey' });
    const pool = [...wardrobe, top2, bottom2];

    const kept = validate(
      [
        outfit([top.id, bottom.id], { rationale: 'Straightforward and comfortable.' }),
        outfit([top2.id, bottom2.id], { stretch: true, rationale: 'An unusual pairing.' }),
      ],
      mapOf(pool),
      context(pool),
    );

    expect(kept).toHaveLength(2);
    // An unexplained odd suggestion reads as the AI being wrong; a labelled one reads
    // as an offer — module 19 §4.
    expect(kept[0]!.rationale).toBe('Straightforward and comfortable.');
    expect(kept[1]!.rationale).toBe(`${STRETCH_LABEL} — An unusual pairing.`);
  });

  it('a full-body garment carries an outfit on its own', () => {
    const dress = item({ slot: 'fullbody' });
    const pool = [dress, shoes];
    expect(validate([outfit([dress.id, shoes.id])], mapOf(pool), context(pool))).toHaveLength(1);
  });
});

describe('isWearable', () => {
  it('needs a top and a bottom, or one full-body garment', () => {
    expect(isWearable([item({ slot: 'top' }), item({ slot: 'bottom' })])).toBe(true);
    expect(isWearable([item({ slot: 'fullbody' })])).toBe(true);
    expect(isWearable([item({ slot: 'top' }), item({ slot: 'footwear' })])).toBe(false);
    expect(isWearable([item({ slot: 'accessory' }), item({ slot: 'footwear' })])).toBe(false);
  });
});

describe('backfill', () => {
  const asRec = (items: Item[]): Recommendation => ({
    items,
    slots: items.map((i) => i.slot).filter((s): s is Slot => s !== null),
    score: 0.8,
    rationale: null,
    source: 'rules',
  });

  it('tops up to the limit from the rules engine', () => {
    const a = asRec([item({ slot: 'top' }), item({ slot: 'bottom' })]);
    const b = asRec([item({ slot: 'top' }), item({ slot: 'bottom' })]);
    const filled = backfill([{ ...a, source: 'llm' }], [b], 5);

    expect(filled).toHaveLength(2);
    // Honest about which engine made what — §7's comparison needs it.
    expect(filled[0]!.source).toBe('llm');
    expect(filled[1]!.source).toBe('rules');
  });

  it('will not backfill something that duplicates what the model already chose', () => {
    const shared = item({ slot: 'top' });
    const other = item({ slot: 'bottom' });
    const ai = { ...asRec([shared, other]), source: 'llm' as const };
    const rules = asRec([shared, other]);

    expect(backfill([ai], [rules], 5)).toHaveLength(1);
  });

  it('never returns more than the limit', () => {
    const rules = Array.from({ length: 9 }, () =>
      asRec([item({ slot: 'top' }), item({ slot: 'bottom' })]),
    );
    expect(backfill([], rules, 3)).toHaveLength(3);
  });

  it('returns nothing when neither engine produced anything', () => {
    expect(backfill([], [], 5)).toEqual([]);
  });
});

describe('the prompt', () => {
  it('fits a 200-item wardrobe after filtering', () => {
    const wardrobe = Array.from({ length: 200 }, (_, i) =>
      item({
        slot: (['top', 'bottom', 'footwear', 'outerwear'] as Slot[])[i % 4]!,
        lastWornOn: null,
      }),
    );

    const pool = candidatePool(context(wardrobe));
    const trimmed = trim(pool, context(wardrobe));

    expect(trimmed.length).toBeLessThanOrEqual(MAX_CANDIDATES);

    // Roughly a token per four characters; the ceiling that matters is the context
    // window, and this has to sit far inside it to be worth running daily.
    const prompt = trimmed.map(describeItem).join('\n');
    expect(prompt.length / 4).toBeLessThan(4000);
  });

  it('keeps every slot represented when it has to cut', () => {
    const wardrobe = Array.from({ length: 200 }, (_, i) =>
      item({ slot: (['top', 'bottom', 'footwear'] as Slot[])[i % 3]! }),
    );
    const trimmed = trim(wardrobe, context(wardrobe));

    // A wardrobe trimmed to all tops would be useless — nothing could be assembled.
    expect(new Set(trimmed.map((i) => i.slot)).size).toBe(3);
  });

  it('leaves a small wardrobe untouched', () => {
    const wardrobe = [item({ slot: 'top' }), item({ slot: 'bottom' })];
    expect(trim(wardrobe, context(wardrobe))).toHaveLength(2);
  });

  it('cuts the recently worn first, since the prompt asks for the opposite', () => {
    const wardrobe = [
      ...Array.from({ length: 200 }, () => item({ slot: 'top', lastWornOn: '2026-09-02' })),
      item({ slot: 'bottom', lastWornOn: null, name: 'Never Worn Trousers' }),
    ];
    const trimmed = trim(wardrobe, context(wardrobe));
    expect(trimmed.some((i) => i.name === 'Never Worn Trousers')).toBe(true);
  });

  it('describes a garment by attributes, never by an image', () => {
    const line = describeItem(
      item({ slot: 'top', name: 'White Oxford Shirt', primaryColor: 'white', formality: 4 }),
    );
    expect(line).toContain('White Oxford Shirt');
    expect(line).toContain('formality 4');
    expect(line).not.toContain('http');
  });

  it('states the vetoes and the learned preferences in the context block', () => {
    const ctx = context([], {
      styleProfile: profile({
        colorAffinity: { navy: 0.8, olive: 0.5, mustard: -0.7 },
        rejectedPairs: [['navy', 'black']],
      }),
    });

    const lines = contextLines(ctx);
    expect(lines).toContain('prefers: navy, olive');
    expect(lines).toContain('mustard');
    expect(lines).toContain('never pair navy with black');
  });

  it('tells the model not to reason about weather it does not have', () => {
    expect(contextLines(context([]))).toContain('weather: unknown');
  });
});

describe('the rollout flag — module 19 §7', () => {
  it('is stable for a given user, so nobody lands in both arms', () => {
    const id = '5f2b9a10-0000-4000-8000-000000000001';
    const first = aiEngineEnabled(id, {});
    for (let i = 0; i < 20; i += 1) expect(aiEngineEnabled(id, {})).toBe(first);
  });

  it('splits unassigned users roughly in half, so the arms are comparable', () => {
    let enabled = 0;
    const n = 2000;
    for (let i = 0; i < n; i += 1) {
      if (aiEngineEnabled(`user-${i}-${i * 7}`, undefined)) enabled += 1;
    }
    expect(enabled / n).toBeGreaterThan(AI_ROLLOUT - 0.08);
    expect(enabled / n).toBeLessThan(AI_ROLLOUT + 0.08);
  });

  it('lets an explicit flag override the bucket in both directions', () => {
    const id = 'user-42';
    expect(aiEngineEnabled(id, { aiRecommendations: true })).toBe(true);
    expect(aiEngineEnabled(id, { aiRecommendations: false })).toBe(false);
  });

  it('reports whether an assignment was made or inherited', () => {
    expect(assignmentOf('user-42', { aiRecommendations: true })).toEqual({
      enabled: true,
      source: 'set',
    });
    expect(assignmentOf('user-42', {}).source).toBe('default');
  });

  it('spreads across the unit interval rather than clustering', () => {
    const values = Array.from({ length: 50 }, (_, i) => hashToUnit(`u${i}`));
    expect(Math.min(...values)).toBeLessThan(0.2);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('ignores a flag value written by a version this one does not know', () => {
    expect(toFlags({ aiRecommendations: 'yes please' })).toEqual({});
    expect(toFlags({ someFutureFlag: true })).toEqual({});
    expect(toFlags(null)).toEqual({});
    expect(toFlags({ aiRecommendations: false })).toEqual({ aiRecommendations: false });
  });
});

/**
 * Module 19 §6's degradation table, and its acceptance line: "a forced model failure
 * returns rules-engine outfits with a 200 status."
 *
 * `recommendAI` is the only impure function in this module, so it is the only one that
 * needs the model stubbed. The stub throws the way `callModel` throws after its retries
 * are spent, which is the failure the user actually experiences.
 */
describe('degradation — every failure lands on the rules engine', () => {
  const wardrobe = () => [
    item({ slot: 'top', primaryColor: 'white', colorHex: '#ffffff' }),
    item({ slot: 'bottom', primaryColor: 'beige', colorHex: '#e8dcc8' }),
    item({ slot: 'footwear', primaryColor: 'brown', colorHex: '#7b4a22' }),
  ];

  /**
   * `recommendAI` asserts the daily cap around its own call (module 12's rule, enforced
   * by CI). Stubbed to allow, so these tests exercise the failure they name rather than
   * all quietly passing because the budget check refused first.
   */
  const allowBudget = () => vi.doMock('@/lib/budget', () => ({ assertBudget: async () => {} }));

  afterEach(() => {
    vi.doUnmock('@/lib/gemini');
    vi.doUnmock('@/lib/budget');
  });

  it('returns rules-engine outfits when the model is unavailable', async () => {
    vi.resetModules();
    allowBudget();
    vi.doMock('@/lib/gemini', () => ({
      selectOutfits: () => Promise.reject(new Error('gemini 503')),
    }));

    const { recommendAI } = await import('@/lib/recommender/ai');
    const items = wardrobe();
    const result = await recommendAI(context(items));

    expect(result.source).toBe('rules');
    expect(result.recommendations.length).toBeGreaterThan(0);
    // Nothing was spent, so nothing is recorded against the budget.
    expect(result.inTokens).toBe(0);
  });

  it('falls back when every outfit the model returns fails validation', async () => {
    vi.resetModules();
    allowBudget();
    vi.doMock('@/lib/gemini', () => ({
      selectOutfits: () =>
        Promise.resolve({
          data: {
            outfits: [
              { itemIds: ['ghost-1', 'ghost-2'], rationale: 'Invented.', stretch: false },
            ],
          },
          inTokens: 300,
          outTokens: 40,
          raw: {},
        }),
    }));

    const { recommendAI } = await import('@/lib/recommender/ai');
    const items = wardrobe();
    const result = await recommendAI(context(items));

    // The invented outfit is gone and the user still gets something wearable.
    expect(result.recommendations.every((r) => r.source === 'rules')).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
    // The call was made and must still be charged, even though nothing survived it.
    expect(result.inTokens).toBe(300);
  });

  it('keeps what survives and backfills the rest', async () => {
    const items = wardrobe();
    vi.resetModules();
    allowBudget();
    vi.doMock('@/lib/gemini', () => ({
      selectOutfits: () =>
        Promise.resolve({
          data: {
            outfits: [
              {
                itemIds: [items[0]!.id, items[1]!.id],
                rationale: 'White over beige, easy in the heat.',
                stretch: false,
              },
              { itemIds: ['ghost'], rationale: 'Invented.', stretch: false },
            ],
          },
          inTokens: 300,
          outTokens: 40,
          raw: {},
        }),
    }));

    const { recommendAI } = await import('@/lib/recommender/ai');
    const result = await recommendAI(context(items));

    expect(result.source).toBe('llm');
    expect(result.recommendations[0]!.source).toBe('llm');
    expect(result.recommendations[0]!.rationale).toContain('beige');
  });

  it('falls back silently when the daily cap is spent, and does not call the model', async () => {
    // §6: "Budget exhausted → rules engine, no message needed — the user gets outfits
    // either way." The refusal must not reach the screen as an error.
    let called = false;
    vi.resetModules();
    vi.doMock('@/lib/budget', () => ({
      assertBudget: async () => {
        throw new Error('AI_BUDGET_EXCEEDED');
      },
    }));
    vi.doMock('@/lib/gemini', () => ({
      selectOutfits: () => {
        called = true;
        return Promise.reject(new Error('should not happen'));
      },
    }));

    const { recommendAI } = await import('@/lib/recommender/ai');
    const result = await recommendAI(context(wardrobe()));

    expect(called).toBe(false);
    expect(result.source).toBe('rules');
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.reason).toBeNull();
  });

  it('does not call the model at all for a wardrobe that cannot make an outfit', async () => {
    let called = false;
    vi.resetModules();
    allowBudget();
    vi.doMock('@/lib/gemini', () => ({
      selectOutfits: () => {
        called = true;
        return Promise.reject(new Error('should not happen'));
      },
    }));

    const { recommendAI } = await import('@/lib/recommender/ai');
    const result = await recommendAI(context([item({ slot: 'top' })]));

    expect(called).toBe(false);
    expect(result.source).toBe('rules');
    // The honest answer, not an empty screen — module 08 §7.
    expect(result.reason).toBeTruthy();
  });
});
