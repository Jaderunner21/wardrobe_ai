/**
 * The recommendation engine — module 08.
 *
 * This is the only real algorithm in the codebase, and the one thing module 01's
 * testing table calls out first. Everything here runs with no database, no network and
 * no clock, which is exactly the property that lets module 19 swap selection for a
 * model later and keep these rules as the fallback.
 *
 * The colour-harmony numbers are the spec's own reference table and are asserted
 * exactly. The assembly assertions are structural — presence, absence, ordering,
 * diversity — because the spec's reference scores came from a fixture wardrobe whose
 * exact contents it does not publish.
 */
import { describe, expect, it } from 'vitest';
import { colorHarmony, hexToHsl, isNeutral } from '@/lib/recommender/color';
import { recommend, candidates, targetFormality } from '@/lib/recommender';
import { wantsOuterwear } from '@/lib/recommender/beam';
import { isVetoed, pairKey } from '@/lib/recommender/score';
import type { EngineContext } from '@/lib/recommender/context';
import type { Item, Season, Slot, StyleProfile, WeatherContext } from '@/types';
import { tempBucket } from '@/lib/weather';

const HEX = {
  navy: '#000080',
  white: '#ffffff',
  black: '#111111',
  grey: '#8a8a85',
  beige: '#e8dcc8',
  olive: '#6b7d3a',
  red: '#ff0000',
  green: '#00ff00',
  orange: '#ff8c00',
  pink: '#ff69b4',
  brown: '#7b4a22',
};

let seq = 0;

function item(partial: Partial<Item> & { slot: Slot }): Item {
  seq += 1;
  return {
    id: `item-${seq}`,
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
    colorHex: HEX.navy,
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

const emptyProfile = (over: Partial<StyleProfile> = {}): StyleProfile => ({
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

const weatherAt = (tempC: number, precipitationMm = 0): WeatherContext => ({
  cityKey: 'udaipur,in',
  day: '2026-09-01',
  tempC,
  tempMinC: tempC - 5,
  tempMaxC: tempC + 3,
  tempBucket: tempBucket(tempC),
  precipitationMm,
  condition: 'Clear',
});

/** The 11-item shape the spec's reference run used: neutral-heavy, as wardrobes are. */
function wardrobe(): Item[] {
  return [
    item({ slot: 'top', primaryColor: 'white', colorHex: HEX.white, warmth: 1 }),
    item({ slot: 'top', primaryColor: 'olive', colorHex: HEX.olive, warmth: 2 }),
    item({ slot: 'top', primaryColor: 'navy', colorHex: HEX.navy, warmth: 2, formality: 3 }),
    item({ slot: 'bottom', primaryColor: 'navy', colorHex: HEX.navy, warmth: 2 }),
    item({ slot: 'bottom', primaryColor: 'beige', colorHex: HEX.beige, warmth: 2 }),
    item({ slot: 'bottom', primaryColor: 'black', colorHex: HEX.black, warmth: 3, formality: 3 }),
    item({ slot: 'footwear', primaryColor: 'white', colorHex: HEX.white, warmth: 1 }),
    item({ slot: 'footwear', primaryColor: 'brown', colorHex: HEX.brown, warmth: 2, formality: 3 }),
    item({ slot: 'outerwear', primaryColor: 'grey', colorHex: HEX.grey, warmth: 4 }),
    item({ slot: 'fullbody', primaryColor: 'black', colorHex: HEX.black, warmth: 2, formality: 3 }),
    item({ slot: 'accessory', primaryColor: 'brown', colorHex: HEX.brown, warmth: 1 }),
  ];
}

function context(over: Partial<EngineContext> = {}): EngineContext {
  return {
    userId: 'u1',
    items: wardrobe(),
    styleProfile: emptyProfile(),
    style: 'casual',
    weather: weatherAt(28),
    season: 'summer',
    seenPairs: new Set<string>(),
    limit: 5,
    today: '2026-09-01',
    outfitEligible: { 'cat-generic': true },
    ...over,
  };
}

describe('colorHarmony — the spec reference table', () => {
  it('navy/white is the neutral branch at 0.85', () => {
    expect(colorHarmony(HEX.navy, HEX.white)).toBe(0.85);
  });

  it('red/green is triadic-ish at 0.70', () => {
    expect(colorHarmony(HEX.red, HEX.green)).toBe(0.7);
  });

  it('orange/pink is two loud clashing hues at 0.15', () => {
    expect(colorHarmony(HEX.orange, HEX.pink)).toBe(0.15);
  });

  it('navy/navy is analogous at 0.80 — navy is not a neutral by this formula', () => {
    expect(colorHarmony(HEX.navy, HEX.navy)).toBe(0.8);
    expect(isNeutral(hexToHsl(HEX.navy))).toBe(false);
  });

  it('is symmetric', () => {
    expect(colorHarmony(HEX.olive, HEX.pink)).toBe(colorHarmony(HEX.pink, HEX.olive));
  });

  it('treats black, white and grey as neutral', () => {
    for (const hex of [HEX.black, HEX.white, HEX.grey]) {
      expect(isNeutral(hexToHsl(hex))).toBe(true);
    }
  });

  it('draws the neutral line by the formula, not by the colour name', () => {
    // Module 08 §3's prose says neutral "covers black, white, grey, navy, beige,
    // cream" — but the formula is what runs, and it disagrees at the edges. Navy is
    // not neutral (the spec's own reference table confirms it: navy/navy is 0.80,
    // the analogous branch). A mid beige sits just under the l > 0.85 line; a pale
    // one clears it. Recorded rather than papered over: if the boundary ever moves,
    // this is the test that says so.
    expect(isNeutral(hexToHsl(HEX.navy))).toBe(false);
    expect(isNeutral(hexToHsl('#e8dcc8'))).toBe(false); // mid beige
    expect(isNeutral(hexToHsl('#f5f0e6'))).toBe(true); // cream
  });

  it('survives a malformed hex rather than returning NaN', () => {
    expect(Number.isFinite(colorHarmony('not-a-colour', HEX.navy))).toBe(true);
  });
});

describe('recommend', () => {
  it('is deterministic — same context, identical result', () => {
    const a = recommend(context());
    const b = recommend(context());
    expect(a.recommendations.map((r) => r.score)).toEqual(b.recommendations.map((r) => r.score));
  });

  it('returns ranked outfits for a normal wardrobe', () => {
    const { recommendations, reason } = recommend(context());
    expect(reason).toBeNull();
    expect(recommendations.length).toBeGreaterThan(0);

    const scores = recommendations.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    // Good outfits land in 0.70-0.85; the neutral branch is why (module 16 §7.5).
    expect(scores[0]).toBeGreaterThan(0.6);
    expect(scores[0]).toBeLessThanOrEqual(1);
  });

  it('gives every outfit a rationale even with no LLM', () => {
    for (const r of recommend(context()).recommendations) {
      expect(r.rationale).toBeTruthy();
      expect(r.source).toBe('rules');
    }
  });

  it('never returns two outfits sharing more than one item', () => {
    const { recommendations } = recommend(context({ limit: 5 }));
    for (let i = 0; i < recommendations.length; i += 1) {
      for (let j = i + 1; j < recommendations.length; j += 1) {
        const a = new Set(recommendations[i]?.items.map((x) => x.id));
        const shared = recommendations[j]?.items.filter((x) => a.has(x.id)).length ?? 0;
        expect(shared).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never assembles an accessory', () => {
    const slots = recommend(context()).recommendations.flatMap((r) => r.slots);
    expect(slots).not.toContain('accessory');
  });

  it('offers outerwear when it is cold', () => {
    const { recommendations } = recommend(context({ weather: weatherAt(14) }));
    expect(recommendations.some((r) => r.slots.includes('outerwear'))).toBe(true);
  });

  it('never offers outerwear at bucket 4', () => {
    const { recommendations } = recommend(context({ weather: weatherAt(34) }));
    expect(recommendations.every((r) => !r.slots.includes('outerwear'))).toBe(false === false);
    expect(recommendations.flatMap((r) => r.slots)).not.toContain('outerwear');
  });

  it('offers outerwear when it is raining regardless of warmth', () => {
    expect(wantsOuterwear(context({ weather: weatherAt(31, 12) }))).toBe(true);
    expect(wantsOuterwear(context({ weather: weatherAt(31, 0) }))).toBe(false);
  });

  it('works with no weather at all — thermal term dropped, not defaulted', () => {
    const { recommendations, reason } = recommend(context({ weather: null }));
    expect(reason).toBeNull();
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.flatMap((r) => r.slots)).not.toContain('outerwear');
  });

  it('still serves a thin wardrobe by relaxing the filters', () => {
    const thin = [
      item({ slot: 'top', primaryColor: 'white', colorHex: HEX.white, formality: 5 }),
      item({ slot: 'bottom', primaryColor: 'navy', colorHex: HEX.navy, formality: 1 }),
      item({ slot: 'footwear', primaryColor: 'brown', colorHex: HEX.brown, formality: 4 }),
      item({ slot: 'top', primaryColor: 'olive', colorHex: HEX.olive, seasons: ['winter'] }),
      item({ slot: 'bottom', primaryColor: 'beige', colorHex: HEX.beige, seasons: ['winter'] }),
    ];
    const { recommendations } = recommend(context({ items: thin }));
    expect(recommendations.length).toBeGreaterThan(0);
  });

  it('returns a reason, not a crash, when there are no bottoms', () => {
    const topsOnly = [
      item({ slot: 'top', colorHex: HEX.white }),
      item({ slot: 'top', colorHex: HEX.olive }),
      item({ slot: 'footwear', colorHex: HEX.brown }),
    ];
    const { recommendations, reason } = recommend(context({ items: topsOnly }));
    expect(recommendations).toEqual([]);
    expect(reason).toBeTruthy();
  });

  it('returns a reason for an empty wardrobe', () => {
    const { recommendations, reason } = recommend(context({ items: [] }));
    expect(recommendations).toEqual([]);
    expect(reason).toBeTruthy();
  });

  it('never surfaces a vetoed colour pair', () => {
    const ctx = context({
      styleProfile: emptyProfile({ rejectedPairs: [['navy', 'beige']] }),
    });
    for (const r of recommend(ctx).recommendations) {
      const colours = r.items.map((i) => i.primaryColor);
      expect(colours.includes('navy') && colours.includes('beige')).toBe(false);
    }
  });

  it('lets a dress carry an outfit without a bottom', () => {
    const dressOnly = [
      item({ slot: 'fullbody', primaryColor: 'black', colorHex: HEX.black }),
      item({ slot: 'footwear', primaryColor: 'white', colorHex: HEX.white }),
    ];
    const { recommendations } = recommend(context({ items: dressOnly }));
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.slots).toContain('fullbody');
    expect(recommendations[0]?.slots).not.toContain('bottom');
  });

  it('handles a 200-item wardrobe well inside 100ms', () => {
    const big = Array.from({ length: 200 }, (_, i) =>
      item({
        slot: (['top', 'bottom', 'footwear', 'outerwear'] as Slot[])[i % 4] ?? 'top',
        colorHex: [HEX.navy, HEX.white, HEX.olive, HEX.beige][i % 4],
      }),
    );
    const started = performance.now();
    recommend(context({ items: big }));
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('candidate filter', () => {
  it('excludes items whose category is not outfit-eligible', () => {
    const ctx = context({
      items: [
        item({ slot: 'top', categoryId: 'underwear' }),
        item({ slot: 'bottom', categoryId: 'cat-generic' }),
      ],
      outfitEligible: { 'cat-generic': true, underwear: false },
    });
    const pool = candidates(ctx, { formalityWindow: 1, seasonFilter: true });
    expect(pool.every((i) => i.categoryId !== 'underwear')).toBe(true);
  });

  it('excludes drafts, archived and binned items', () => {
    const ctx = context({
      items: [
        item({ slot: 'top', status: 'draft' }),
        item({ slot: 'top', archived: true }),
        item({ slot: 'top', deletedAt: '2026-08-30T00:00:00Z' }),
        item({ slot: 'top' }),
      ],
    });
    expect(candidates(ctx, { formalityWindow: 1, seasonFilter: true })).toHaveLength(1);
  });

  it('shifts the target formality by the learned bias', () => {
    expect(targetFormality(context({ style: 'business' }))).toBe(4);
    expect(
      targetFormality(
        context({ style: 'business', styleProfile: emptyProfile({ formalityBias: -1 }) }),
      ),
    ).toBe(3);
    // Clamped: the bias cannot push the target off the 1..5 scale.
    expect(
      targetFormality(
        context({ style: 'formal', styleProfile: emptyProfile({ formalityBias: 3 }) }),
      ),
    ).toBe(5);
  });
});

describe('pairKey and vetoes', () => {
  it('is order-insensitive, so a pair is one key', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });

  it('vetoes regardless of which way round the colours are', () => {
    const a = item({ slot: 'top', primaryColor: 'Navy' });
    const b = item({ slot: 'bottom', primaryColor: 'beige' });
    expect(isVetoed(a, b, [['beige', 'navy']])).toBe(true);
    expect(isVetoed(a, b, [['navy', 'black']])).toBe(false);
  });
});
