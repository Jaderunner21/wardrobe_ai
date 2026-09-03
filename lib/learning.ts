/**
 * Feedback → style profile — module 10. Pure.
 *
 * There is no ML pipeline here, deliberately. This is an exponentially-weighted running
 * average in a JSONB column, and it is enough: building an embedding model to discover
 * that someone dislikes brown with navy is a research project delivering the same
 * outcome as counting.
 *
 * Pure for the same reason the recommender is — you can replay a user's entire feedback
 * history through it and see exactly where their profile came from. With fifteen
 * testers that replay, and the fact that the profile is human-readable JSON rather than
 * a weight matrix, is the whole value of this module (§6).
 */
import type { FeedbackKind, Item, StyleProfile } from '@/types';

/** Learning rate. Slow enough that one bad day does not rewrite someone's taste. */
export const RATE = 0.15;

/**
 * `worn` is weighted below `up` because wearing something is weaker evidence than
 * choosing it — people wear what is clean. `skipped` is weak negative rather than
 * neutral: scrolling past is telling you something, just not much.
 */
export const DELTA: Record<FeedbackKind, number> = {
  up: 1,
  worn: 0.6,
  skipped: -0.3,
  down: -1,
};

/** Three downs on the same unordered colour pair makes it a veto (§3). */
export const VETO_THRESHOLD = 3;

/**
 * Beyond this a user has effectively narrowed their wardrobe to nothing and something
 * else is wrong. Oldest evicted first.
 */
export const MAX_REJECTED_PAIRS = 20;

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Order-insensitive, lowercased: "Navy|beige" and "beige|Navy" are one pair. */
export function colorPairKey(a: string, b: string): string {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  return `${x}|${y}`;
}

/** Every unordered colour pair in an outfit, for veto counting. */
export function colorPairsOf(outfit: Item[]): string[] {
  const colours = outfit
    .map((i) => i.primaryColor)
    .filter((c): c is string => Boolean(c))
    .map((c) => c.trim().toLowerCase());

  const pairs: string[] = [];
  for (let i = 0; i < colours.length; i += 1) {
    for (let j = i + 1; j < colours.length; j += 1) {
      const a = colours[i];
      const b = colours[j];
      if (a && b && a !== b) pairs.push(colorPairKey(a, b));
    }
  }
  return [...new Set(pairs)];
}

export interface LearningInput {
  /**
   * How many `down` votes each colour pair has now received, this one included.
   * Counted by the caller from stored feedback — the veto rule is a fact about
   * history, and history is the one thing a pure function cannot look up.
   */
  downPairCounts?: Record<string, number>;
}

export function applyFeedback(
  profile: StyleProfile,
  outfit: Item[],
  kind: FeedbackKind,
  input: LearningInput = {},
): StyleProfile {
  const delta = DELTA[kind];

  const colorAffinity = { ...profile.colorAffinity };
  const categoryAffinity = { ...profile.categoryAffinity };

  for (const item of outfit) {
    if (item.primaryColor) {
      const key = item.primaryColor.trim().toLowerCase();
      const prev = colorAffinity[key] ?? 0;
      colorAffinity[key] = clamp(prev + RATE * (delta - prev));
    }

    if (item.categoryId) {
      const prev = categoryAffinity[item.categoryId] ?? 0;
      // Category signal is half-weighted: liking an outfit says more about its colours
      // than about the fact that it contained a pair of shoes.
      categoryAffinity[item.categoryId] = clamp(prev + RATE * (delta * 0.5 - prev));
    }
  }

  // Formality drifts toward what they actually accept, not what they said they wanted.
  const formalities = outfit
    .map((i) => i.formality)
    .filter((f): f is NonNullable<typeof f> => f != null);

  const formalityBias =
    formalities.length === 0
      ? profile.formalityBias
      : clamp(
          profile.formalityBias +
            RATE *
              0.25 *
              delta *
              ((formalities.reduce((s, f) => s + f, 0) / formalities.length - 3) / 2),
        );

  return {
    ...profile,
    colorAffinity,
    categoryAffinity,
    formalityBias,
    rejectedPairs: nextVetoes(profile, outfit, kind, input.downPairCounts ?? {}),
    sampleCount: profile.sampleCount + 1,
  };
}

function nextVetoes(
  profile: StyleProfile,
  outfit: Item[],
  kind: FeedbackKind,
  counts: Record<string, number>,
): [string, string][] {
  if (kind !== 'down') return profile.rejectedPairs;

  const existing = new Set(profile.rejectedPairs.map(([a, b]) => colorPairKey(a, b)));
  const additions: [string, string][] = [];

  for (const key of colorPairsOf(outfit)) {
    if (existing.has(key)) continue;
    if ((counts[key] ?? 0) < VETO_THRESHOLD) continue;

    const [a, b] = key.split('|');
    if (a && b) additions.push([a, b]);
  }

  if (additions.length === 0) return profile.rejectedPairs;

  // Oldest first, so slicing from the end keeps the most recent vetoes.
  return [...profile.rejectedPairs, ...additions].slice(-MAX_REJECTED_PAIRS);
}
