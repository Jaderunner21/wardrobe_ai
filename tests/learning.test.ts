/**
 * Feedback → style profile — module 10.
 *
 * Pure, like the recommender, and tested for the same reason: you can replay a user's
 * whole feedback history through it and see exactly where their profile came from. With
 * fifteen testers, sitting down with one of them and asking "does this match how you
 * dress?" is the entire evaluation method, and it only works if the arithmetic is
 * trustworthy.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFeedback,
  colorPairKey,
  colorPairsOf,
  DELTA,
  MAX_REJECTED_PAIRS,
  VETO_THRESHOLD,
} from '@/lib/learning';
import type { Item, StyleProfile } from '@/types';

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

/** Only the fields the learner reads; the rest of Item is irrelevant here. */
const garment = (primaryColor: string, formality = 3, categoryId = 'cat-1'): Item =>
  ({ id: `i-${primaryColor}`, primaryColor, formality, categoryId }) as Item;

const outfit = [garment('navy', 4), garment('beige', 3, 'cat-2')];

describe('applyFeedback', () => {
  it('raises the affinity of an outfit’s colours on a thumbs up', () => {
    const next = applyFeedback(profile(), outfit, 'up');
    expect(next.colorAffinity.navy).toBeGreaterThan(0);
    expect(next.colorAffinity.beige).toBeGreaterThan(0);
  });

  it('lowers them on a thumbs down', () => {
    const next = applyFeedback(profile(), outfit, 'down');
    expect(next.colorAffinity.navy).toBeLessThan(0);
    expect(next.colorAffinity.beige).toBeLessThan(0);
  });

  it('weights a wear below an explicit like — people wear what is clean', () => {
    const liked = applyFeedback(profile(), outfit, 'up').colorAffinity.navy ?? 0;
    const wornOnce = applyFeedback(profile(), outfit, 'worn').colorAffinity.navy ?? 0;
    expect(wornOnce).toBeGreaterThan(0);
    expect(wornOnce).toBeLessThan(liked);
    expect(DELTA.worn).toBeLessThan(DELTA.up);
  });

  it('treats a skip as weak negative, not neutral', () => {
    const next = applyFeedback(profile(), outfit, 'skipped');
    expect(next.colorAffinity.navy).toBeLessThan(0);
    expect(next.colorAffinity.navy).toBeGreaterThan(
      applyFeedback(profile(), outfit, 'down').colorAffinity.navy ?? 0,
    );
  });

  it('stays inside [-1, +1] under a hundred identical votes', () => {
    let p = profile();
    for (let i = 0; i < 100; i += 1) p = applyFeedback(p, outfit, 'up');
    expect(p.colorAffinity.navy).toBeLessThanOrEqual(1);
    expect(p.colorAffinity.navy).toBeGreaterThan(0.9); // converged, not stuck

    let q = profile();
    for (let i = 0; i < 100; i += 1) q = applyFeedback(q, outfit, 'down');
    expect(q.colorAffinity.navy).toBeGreaterThanOrEqual(-1);
    expect(q.formalityBias).toBeGreaterThanOrEqual(-1);
    expect(q.formalityBias).toBeLessThanOrEqual(1);
  });

  it('half-weights the category signal against the colour signal', () => {
    const next = applyFeedback(profile(), outfit, 'up');
    expect(next.categoryAffinity['cat-1']).toBeLessThan(next.colorAffinity.navy ?? 0);
    expect(next.categoryAffinity['cat-1']).toBeGreaterThan(0);
  });

  it('drifts formality up when formal outfits are liked, down when they are not', () => {
    const formal = [garment('navy', 5), garment('white', 5)];
    expect(applyFeedback(profile(), formal, 'up').formalityBias).toBeGreaterThan(0);
    expect(applyFeedback(profile(), formal, 'down').formalityBias).toBeLessThan(0);
  });

  it('leaves formality alone when the outfit has no formality data', () => {
    const untagged = [{ id: 'x', primaryColor: 'navy' } as Item];
    expect(applyFeedback(profile({ formalityBias: 0.3 }), untagged, 'up').formalityBias).toBe(0.3);
  });

  it('counts every vote, whatever it was', () => {
    expect(applyFeedback(profile({ sampleCount: 7 }), outfit, 'skipped').sampleCount).toBe(8);
  });

  it('does not mutate the profile it was given', () => {
    const original = profile({ colorAffinity: { navy: 0.5 } });
    applyFeedback(original, outfit, 'down');
    expect(original.colorAffinity.navy).toBe(0.5);
    expect(original.sampleCount).toBe(0);
  });
});

describe('vetoes', () => {
  const counts = (n: number) => ({ [colorPairKey('navy', 'beige')]: n });

  it('adds a pair after the third thumbs down', () => {
    const next = applyFeedback(profile(), outfit, 'down', {
      downPairCounts: counts(VETO_THRESHOLD),
    });
    expect(next.rejectedPairs).toContainEqual(['beige', 'navy']);
  });

  it('does not add it on the first or second', () => {
    for (const n of [1, 2]) {
      const next = applyFeedback(profile(), outfit, 'down', { downPairCounts: counts(n) });
      expect(next.rejectedPairs).toEqual([]);
    }
  });

  it('never adds a veto from a positive vote', () => {
    const next = applyFeedback(profile(), outfit, 'up', { downPairCounts: counts(9) });
    expect(next.rejectedPairs).toEqual([]);
  });

  it('does not duplicate a pair already vetoed', () => {
    const next = applyFeedback(profile({ rejectedPairs: [['beige', 'navy']] }), outfit, 'down', {
      downPairCounts: counts(9),
    });
    expect(next.rejectedPairs).toHaveLength(1);
  });

  it('caps the list and evicts the oldest', () => {
    const existing: [string, string][] = Array.from({ length: MAX_REJECTED_PAIRS }, (_, i) => [
      `c${i}`,
      'x',
    ]);
    const next = applyFeedback(profile({ rejectedPairs: existing }), outfit, 'down', {
      downPairCounts: counts(VETO_THRESHOLD),
    });

    expect(next.rejectedPairs).toHaveLength(MAX_REJECTED_PAIRS);
    expect(next.rejectedPairs).toContainEqual(['beige', 'navy']);
    expect(next.rejectedPairs).not.toContainEqual(['c0', 'x']); // oldest gone
  });
});

describe('colour pairs', () => {
  it('is order-insensitive and case-insensitive', () => {
    expect(colorPairKey('Navy', 'beige')).toBe(colorPairKey('BEIGE', 'navy'));
  });

  it('enumerates every unordered pair in an outfit', () => {
    const three = [garment('navy'), garment('white'), garment('brown')];
    expect(colorPairsOf(three)).toHaveLength(3);
  });

  it('ignores items with no colour and does not pair a colour with itself', () => {
    const mixed = [garment('navy'), { id: 'x' } as Item, garment('navy')];
    expect(colorPairsOf(mixed)).toEqual([]);
  });
});

describe('cold start', () => {
  it('needs no special-casing — an empty profile just learns from the first vote', () => {
    const next = applyFeedback(profile(), outfit, 'up');
    expect(next.sampleCount).toBe(1);
    expect(Object.keys(next.colorAffinity)).toEqual(['navy', 'beige']);
  });
});
