# 10 — Feedback & learning

**Scope:** TEST · **Depends on:** 09 · **Owns:** `feedback`, `style_profiles`,
`app/api/feedback/route.ts`, `lib/learning.ts`

## Responsibility

Turn 👍 / 👎 / "wore this" / "skip" into a personalised style profile that shifts future
recommendations.

## Contracts

`POST /api/feedback` → see `api-contracts.md`.

```ts
// lib/learning.ts — pure
export function applyFeedback(
  profile: StyleProfile,
  outfit: Item[],
  kind: FeedbackKind,
): StyleProfile;
```

Pure, like the recommender. Same reason: it is testable, and you can replay a user's whole
feedback history through it to see where their profile came from.

## Behaviour

### 1. There is no ML pipeline here, deliberately

An exponentially-weighted running average in a JSONB column. That is the entire learning
system, and it is enough. Building an embedding model to discover that a user dislikes brown
with navy is a research project delivering the same outcome as counting.

Say this plainly in any pitch: the personalisation is real and it is arithmetic. Both halves
of that are true and the second half is not a weakness.

### 2. The update

```ts
const RATE = 0.15;                  // learning rate
const DELTA: Record<FeedbackKind, number> = {
  up: +1, worn: +0.6, skipped: -0.3, down: -1,
};

// per item in the outfit
colorAffinity[item.primaryColor] =
  clamp(prev + RATE * (DELTA[kind] - prev), -1, 1);

categoryAffinity[item.category] =
  clamp(prev + RATE * (DELTA[kind] * 0.5 - prev), -1, 1);

// formality drifts toward what they actually accept
formalityBias =
  clamp(formalityBias + RATE * 0.25 * DELTA[kind] * (meanFormality - 3) / 2, -1, +1);

sampleCount += 1;
```

`worn` is weighted lower than `up` because wearing something is weaker evidence than
choosing it — people wear what is clean.

`skipped` is weak negative, not neutral. A user scrolling past an outfit is telling you
something, just not much.

### 3. Vetoes

Three `down` votes on outfits containing the same unordered colour pair adds that pair to
`rejectedPairs`. The recommendation engine treats it as a hard veto (module 08 §2), not a
penalty.

Cap `rejectedPairs` at 20 entries, evicting oldest. Beyond that a user has effectively
narrowed their wardrobe to nothing and something else is wrong.

Provide a way to see and clear vetoes in settings. A veto learned from three bad days should
not be permanent and invisible.

### 4. Synchronous

The update is arithmetic on a small object plus one row write. Do it in the request. A job
queue for this would be more moving parts than the work itself.

### 5. Cold start

A new user has an empty `colorAffinity`, so `styleAffinity` returns a flat 0.5 for every
pair and the term contributes nothing — the other five terms carry the recommendation. This
is the correct behaviour and needs no special-casing.

Optionally, an onboarding step showing 8 outfit images and asking the user to pick the ones
they like seeds the profile. Worth building only if the test phase shows recommendations are
poor for the first week.

### 6. What feedback is worth in the test phase

Fifteen users produce no aggregate. The value is per-user: you can look at one tester's
`style_profile` after two weeks and ask them whether it matches how they actually dress.
That conversation is worth more than any dashboard, and it is only possible because the
profile is human-readable JSON rather than a weight matrix.

Track the overall thumbs-up rate (module 14) as the one aggregate that means something:
target above 60%.

## Acceptance

- [ ] `applyFeedback` is pure and unit-tested against a fixture profile
- [ ] 👍 on an outfit raises the affinity of its colours; 👎 lowers them
- [ ] affinities stay clamped to [−1, +1] under 100 consecutive identical votes
- [ ] three 👎 on outfits sharing a colour pair adds a veto
- [ ] a vetoed pair never appears in subsequent recommendations
- [ ] vetoes are visible and clearable in settings
- [ ] `worn` increments `wearCount` and `lastWornOn` on every item in the outfit
- [ ] a brand-new profile produces sensible recommendations with no special-casing

## Out of scope

- Collaborative filtering, cross-user learning. With 15 users there is nothing to collaborate
  on, and it raises privacy questions the product does not need.
- Embeddings, vector similarity.
- Explaining the profile to the user beyond the veto list.
